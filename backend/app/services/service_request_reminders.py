from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.config import REMINDER_DUE_SOON_HOURS
from app.database import SessionLocal
from app.models.loan_application import LoanApplication
from app.models.service_request import ServiceRequest
from app.models.user import User, UserRole
from app.services.email import send_service_request_reminder

logger = logging.getLogger(__name__)

# Statuses that are "done" — reminders never fire for these.
_DONE_STATUSES = ("resolved", "closed")

# How the due time is rendered in reminder emails (e.g. "25 Jun 2026, 02:30 PM").
_DUE_FORMAT = "%d %b %Y, %I:%M %p"


def _resolve_notify_recipients(db: Session, sr: ServiceRequest, tenant_id: str) -> list[User]:
    """Who should be emailed/notified about a request.

    The assigned brokers if any; otherwise the broker on the client's most recent
    application; otherwise active admins so the request isn't silently dropped.
    """
    if sr.assigned_brokers:
        return list(sr.assigned_brokers)

    app = (
        db.query(LoanApplication)
        .filter(
            LoanApplication.user_id == sr.client_id,
            LoanApplication.tenant_id == tenant_id,
            LoanApplication.assigned_broker_id.isnot(None),
        )
        .order_by(LoanApplication.created_at.desc())
        .first()
    )
    if app and app.assigned_broker_id:
        broker = (
            db.query(User)
            .filter(User.id == app.assigned_broker_id, User.tenant_id == tenant_id, User.is_active == True)
            .first()
        )
        if broker:
            return [broker]

    return (
        db.query(User)
        .filter(User.tenant_id == tenant_id, User.role == UserRole.admin.value, User.is_active == True)
        .all()
    )


def _send_reminder(db: Session, sr: ServiceRequest, when_label: str) -> None:
    """Email every resolved recipient that ``sr`` is approaching its due date."""
    due_display = sr.due_at.strftime(_DUE_FORMAT) if sr.due_at else ""
    for recipient in _resolve_notify_recipients(db, sr, sr.tenant_id):
        if recipient.email:
            send_service_request_reminder(
                to_email=recipient.email,
                broker_name=recipient.full_name,
                request_type=sr.request_type,
                custom_request=sr.custom_request,
                due_display=due_display,
                when_label=when_label,
            )


def process_due_reminders(session_factory=SessionLocal) -> None:
    """Poll open service requests and send any due-date reminders whose window has arrived.

    Two reminders per request, each stamped once in the DB so they never resend:
      • midpoint — halfway between creation and the due time
      • due-soon — ``REMINDER_DUE_SOON_HOURS`` before the due time
    Datetimes are naive UTC throughout (the stored convention).
    """
    # Naive UTC to match stored due_at/created_at (timezone-aware now() avoids the
    # utcnow() deprecation, then dropped to naive for comparison).
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db = session_factory()
    try:
        candidates = (
            db.query(ServiceRequest)
            .options(joinedload(ServiceRequest.client))
            .filter(
                ServiceRequest.due_at.isnot(None),
                ServiceRequest.due_at > now,
                ServiceRequest.status.notin_(_DONE_STATUSES),
                or_(
                    ServiceRequest.reminder_midpoint_sent_at.is_(None),
                    ServiceRequest.reminder_due_soon_sent_at.is_(None),
                ),
            )
            .all()
        )

        sent_any = False
        for sr in candidates:
            try:
                due_soon_trigger = sr.due_at - timedelta(hours=REMINDER_DUE_SOON_HOURS)
                midpoint_trigger = sr.created_at + (sr.due_at - sr.created_at) / 2

                if sr.reminder_due_soon_sent_at is None and now >= due_soon_trigger:
                    _send_reminder(db, sr, f"is due in about {REMINDER_DUE_SOON_HOURS} hours")
                    sr.reminder_due_soon_sent_at = now
                    sent_any = True

                if sr.reminder_midpoint_sent_at is None and now >= midpoint_trigger:
                    if now < due_soon_trigger:
                        _send_reminder(db, sr, "is now halfway to its due date")
                        sent_any = True
                    # Stamp regardless: once the due-soon window is reached there's no point
                    # sending a separate "halfway" reminder, so just retire the midpoint slot.
                    sr.reminder_midpoint_sent_at = now
            except Exception:
                logger.exception("Failed to process reminders for service request %s", sr.id)

        if sent_any or candidates:
            db.commit()
    finally:
        db.close()
