"""Per-stage board communications.

A stage carries rules saying who should be told when a card enters it. Moving a
card puts those rules in front of the mover as confirmations; whatever they
decide is composed, addressed and written to the outbox — including the ones
they declined.

Nothing is sent while STAGE_COMMS_ENABLED is off, which is the default. The
rows are written all the same, so the desk accumulates a real record of what it
would have said before a single message goes out. When sending is switched on,
rows land as `queued` instead of `suppressed` and a dispatcher drains them
through the existing SES and Twilio services — no change to any of this.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from app.config import STAGE_COMMS_ENABLED
from app.models.kanban import KanbanColumn
from app.models.loan_application import LoanApplication
from app.models.notification_outbox import (
    NotificationAudience,
    NotificationChannel,
    NotificationOutbox,
    NotificationStatus,
)
from app.models.user import User
from app.services.serialization import referrer_info_map

# Placeholders a rule's subject/body may use. Anything else is left as written.
PLACEHOLDERS = ("client_name", "recipient_name", "stage", "lender", "amount", "reference")


def _client_name(application: LoanApplication, client: Optional[User]) -> str:
    parts = [application.applicant_first_name, application.applicant_last_name]
    name = " ".join(p for p in parts if p).strip()
    return name or (client.full_name if client else "") or "there"


def _format_amount(amount: Optional[Decimal]) -> str:
    if amount is None:
        return ""
    return f"${amount:,.0f}"


def render(text: str, values: dict[str, str]) -> str:
    """Substitute {placeholders}. Deliberately not str.format: a stray brace in
    someone's message copy must not blow up a card move."""
    out = text
    for key in PLACEHOLDERS:
        out = out.replace("{" + key + "}", values.get(key, ""))
    return out


def _recipients(
    db: Session,
    application: LoanApplication,
    audience: NotificationAudience,
    channel: NotificationChannel,
) -> list[tuple[str, Optional[str]]]:
    """(name, address) for an audience on a channel. Address is None when the
    party exists but has nothing to reach them on — that is recorded as skipped,
    not silently dropped."""
    client = db.query(User).filter(User.id == application.user_id).first()

    if audience == NotificationAudience.client:
        name = _client_name(application, client)
        if channel == NotificationChannel.email:
            address = application.applicant_email or (client.email if client else None)
        else:
            address = application.applicant_mobile or (client.phone if client else None)
        # A placeholder address from a deleted account is not a recipient.
        if address and address.endswith("@deleted.invalid"):
            address = None
        return [(name, address)]

    if audience == NotificationAudience.referrer:
        info = referrer_info_map(db, [application.user_id]).get(application.user_id)
        if not info:
            return []
        address = info.get("email") if channel == NotificationChannel.email else info.get("phone")
        return [(info.get("full_name") or "Referrer", address)]

    brokers = list(application.brokers) or []
    if not brokers and application.assigned_broker_id:
        broker = db.query(User).filter(User.id == application.assigned_broker_id).first()
        brokers = [broker] if broker else []
    return [
        (b.full_name or "Broker", b.email if channel == NotificationChannel.email else b.phone)
        for b in brokers
    ]


def record_stage_notifications(
    db: Session,
    application: LoanApplication,
    column: KanbanColumn,
    *,
    decisions: dict[str, bool],
    transition_id: Optional[str],
    actor_id: str,
    tenant_id: Optional[str],
) -> list[NotificationOutbox]:
    """Write one outbox row per intended recipient of this move.

    `decisions` maps rule id -> whether the mover chose to send it; a rule the
    mover said nothing about falls back to its own default."""
    rules = sorted(column.notification_rules, key=lambda r: (r.sort_order, r.created_at))
    if not rules:
        return []

    client = db.query(User).filter(User.id == application.user_id).first()
    values = {
        "client_name": _client_name(application, client),
        "stage": column.title,
        "lender": application.approval_lender_name or "",
        "amount": _format_amount(application.amount),
        "reference": application.id[:8],
    }

    written: list[NotificationOutbox] = []
    for rule in rules:
        send = decisions.get(rule.id, rule.default_enabled)
        parties = _recipients(db, application, rule.audience, rule.channel)

        if not send:
            # Recorded, not sent. Declining to tell someone is a decision worth
            # keeping, and one row per rule says who was not told.
            written.append(NotificationOutbox(
                application_id=application.id,
                tenant_id=tenant_id,
                stage_transition_id=transition_id,
                rule_id=rule.id,
                stage_title=column.title,
                audience=rule.audience,
                channel=rule.channel,
                recipient_name=parties[0][0] if parties else None,
                recipient_address=parties[0][1] if parties else None,
                status=NotificationStatus.skipped,
                status_reason="Declined by the person moving the card",
                decided_by_id=actor_id,
            ))
            continue

        if not parties:
            written.append(NotificationOutbox(
                application_id=application.id,
                tenant_id=tenant_id,
                stage_transition_id=transition_id,
                rule_id=rule.id,
                stage_title=column.title,
                audience=rule.audience,
                channel=rule.channel,
                status=NotificationStatus.skipped,
                status_reason=f"No {rule.audience.value} on this application",
                decided_by_id=actor_id,
            ))
            continue

        for name, address in parties:
            recipient_values = {**values, "recipient_name": name}
            if not address:
                status, reason = NotificationStatus.skipped, f"No {rule.channel.value} address on file"
            elif STAGE_COMMS_ENABLED:
                status, reason = NotificationStatus.queued, None
            else:
                status, reason = NotificationStatus.suppressed, "Stage communications are switched off"
            written.append(NotificationOutbox(
                application_id=application.id,
                tenant_id=tenant_id,
                stage_transition_id=transition_id,
                rule_id=rule.id,
                stage_title=column.title,
                audience=rule.audience,
                channel=rule.channel,
                recipient_name=name,
                recipient_address=address,
                subject=render(rule.subject, recipient_values) if rule.subject else None,
                body=render(rule.body, recipient_values),
                status=status,
                status_reason=reason,
                decided_by_id=actor_id,
            ))

    for row in written:
        db.add(row)
    return written
