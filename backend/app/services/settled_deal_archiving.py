from __future__ import annotations

import logging
from datetime import date, datetime

from sqlalchemy.orm import Session, joinedload

from app.database import SessionLocal
from app.models.lender_submission import LenderSubmission, SubmissionStatus
from app.models.loan_application import ApplicationStatus, LoanApplication
from app.models.settled_deal_snapshot import SettledDealSnapshot
from app.models.user import UserRole
from app.services.loan_category import application_loan_category
from app.services.serialization import referrer_info_map

logger = logging.getLogger(__name__)


def _month_start(dt: datetime) -> date:
    return dt.date().replace(day=1)


def _resolve_broker_id(app: LoanApplication) -> str | None:
    if app.assigned_broker_id:
        return app.assigned_broker_id
    if app.brokers:
        return app.brokers[0].id
    return None


def _resolve_lender_id(db: Session, application_id: str) -> str | None:
    """Best-effort "winning" lender: the most recently approved submission.

    There's no explicit "settled via this lender" field on LoanApplication
    today, so this is a heuristic — if multiple lenders approved the same
    deal, the most recently responded/submitted one wins.
    """
    submission = (
        db.query(LenderSubmission)
        .filter(
            LenderSubmission.application_id == application_id,
            LenderSubmission.status == SubmissionStatus.approved,
        )
        .order_by(LenderSubmission.responded_at.desc(), LenderSubmission.submitted_at.desc())
        .first()
    )
    return submission.lender_id if submission else None


def _resolve_referrer_id(app: LoanApplication, referrer_map: dict[str, dict]) -> str | None:
    if app.user and app.user.role == UserRole.referrer:
        return app.user.id
    info = referrer_map.get(app.user_id)
    return info["id"] if info else None


def archive_settled_deals(session_factory=SessionLocal) -> None:
    """Snapshot every settled application not yet archived into SettledDealSnapshot.

    Runs on a short interval (see the scheduler in main.py — every
    REMINDER_POLL_MINUTES, same cadence as the reminder pollers) and once at
    startup, so a newly-settled deal shows up in analytics within minutes
    rather than waiting for month-end. Idempotent: settled is a terminal
    status (VALID_TRANSITIONS in constants.py never leaves it), and the
    unique constraint on application_id means each settled deal is archived
    exactly once, ever — running this repeatedly is always safe.

    snapshot_month is derived from settled_at (falling back to updated_at for
    rows settled before that column existed), not "whenever this sweep ran" —
    so historical deals bucket into the month they actually settled.
    """
    db = session_factory()
    try:
        already_archived = {
            row[0] for row in db.query(SettledDealSnapshot.application_id).all()
        }

        query = db.query(LoanApplication).options(joinedload(LoanApplication.user)).filter(
            LoanApplication.status == ApplicationStatus.settled,
        )
        if already_archived:
            query = query.filter(LoanApplication.id.notin_(already_archived))
        candidates = query.all()

        if not candidates:
            return

        referrer_map = referrer_info_map(db, (app.user_id for app in candidates))

        # Committed one at a time (not batched into a single commit at the end):
        # a single bad row (bad data, a transient constraint issue) must not roll
        # back — and therefore silently drop — every other deal in the same sweep.
        # Without the per-item rollback, one failure would poison the session for
        # every application after it (SQLAlchemy refuses further work on a session
        # until it's rolled back), so the whole run would net-zero.
        archived_count = 0
        for app in candidates:
            try:
                basis_dt = app.settled_at or app.updated_at
                db.add(SettledDealSnapshot(
                    tenant_id=app.tenant_id,
                    application_id=app.id,
                    snapshot_month=_month_start(basis_dt),
                    loan_category=application_loan_category(app),
                    loan_type=app.loan_type.value,
                    amount=app.amount,
                    client_user_id=app.user_id,
                    broker_id=_resolve_broker_id(app),
                    referrer_id=_resolve_referrer_id(app, referrer_map),
                    lender_id=_resolve_lender_id(db, app.id),
                ))
                db.commit()
                archived_count += 1
            except Exception:
                db.rollback()
                logger.exception("Failed to archive settled deal for application %s", app.id)

        if archived_count:
            logger.info("Archived %d settled deal(s) into monthly snapshots", archived_count)
    finally:
        db.close()
