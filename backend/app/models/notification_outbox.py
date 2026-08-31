from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.encrypted_type import EncryptedString


class NotificationAudience(str, enum.Enum):
    client = "client"
    referrer = "referrer"
    broker = "broker"


class NotificationChannel(str, enum.Enum):
    email = "email"
    sms = "sms"


class NotificationStatus(str, enum.Enum):
    # Sending is switched off tenant-wide (STAGE_COMMS_ENABLED); the message was
    # composed and recorded but deliberately not handed to a sender.
    suppressed = "suppressed"
    # Ready for a dispatcher to pick up.
    queued = "queued"
    sent = "sent"
    failed = "failed"
    # Not sent for a reason that is not a failure: the mover declined it, or the
    # audience had no address to send to.
    skipped = "skipped"


class StageNotificationRule(Base):
    """Who gets told what when a card enters a stage.

    Rules are data, so the desk decides its own communication plan per stage
    without a deploy. A rule does not send anything on its own — it puts a
    confirmation in front of whoever moves the card (see the move endpoint),
    and their decision is recorded either way."""

    __tablename__ = "stage_notification_rules"
    __table_args__ = (
        UniqueConstraint("column_id", "audience", "channel", name="uq_stage_rule_audience_channel"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    column_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("kanban_columns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    audience: Mapped[NotificationAudience] = mapped_column(Enum(NotificationAudience), nullable=False)
    channel: Mapped[NotificationChannel] = mapped_column(Enum(NotificationChannel), nullable=False)
    subject: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # Whether the confirmation arrives pre-ticked. The mover can always change it.
    default_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    column = relationship("KanbanColumn", back_populates="notification_rules")


class NotificationOutbox(Base):
    """One recorded message per intended recipient of one card move.

    The recipient and the message body are resolved and rendered at write time,
    never at send time: what the desk meant to say, to whom, at that moment is
    the record worth keeping — addresses and stage copy both change later.

    Rows the mover declined are written too, with status `skipped`. Choosing not
    to tell a client is as much a decision as choosing to."""

    __tablename__ = "notification_outbox"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    application_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("loan_applications.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # The move that caused it. Kept as a plain id: the transition record is
    # immutable, and this must not cascade a delete onto it.
    stage_transition_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    rule_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    stage_title: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    audience: Mapped[NotificationAudience] = mapped_column(Enum(NotificationAudience), nullable=False)
    channel: Mapped[NotificationChannel] = mapped_column(Enum(NotificationChannel), nullable=False)
    # Encrypted at rest, like the applicant_email/applicant_mobile columns these
    # are copied from. The rendered body carries the client's name and the loan
    # amount, so it is treated as contact PII too — and, like every encrypted
    # column, none of this is matchable with SQL LIKE.
    recipient_name: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    recipient_address: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    subject: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    body: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    status: Mapped[NotificationStatus] = mapped_column(Enum(NotificationStatus), nullable=False, index=True)
    status_reason: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    decided_by_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc), index=True, nullable=False
    )
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
