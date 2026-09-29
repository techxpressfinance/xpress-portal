from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Valid visibility targets
VALID_VISIBILITY = {"broker", "client", "referrer", "personal"}

# What a note is. "general" is the original Deal Notes feed (and the only kind a
# client or referrer can ever see). The rest are staff-only working notes kept
# per loan and pulled together across a client's loans by the notes-history
# export. "scratchpad" is a single shared pad per loan, edited in place.
NOTE_CATEGORIES = ("general", "compliance", "learning", "decline", "scratchpad")
STAFF_ONLY_CATEGORIES = frozenset({"compliance", "learning", "decline", "scratchpad"})


class ApplicationNote(Base):
    __tablename__ = "application_notes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    application_id: Mapped[str] = mapped_column(String(36), ForeignKey("loan_applications.id"), nullable=False, index=True)
    author_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # Legacy column — kept with default so existing NOT NULL constraint doesn't break inserts
    is_internal: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Comma-separated list of roles that can see this note (e.g. "broker,client,referrer")
    # Admins always see all notes. "broker" implies broker+admin visibility.
    visibility: Mapped[str] = mapped_column(String(100), default="broker", nullable=False)
    category: Mapped[str] = mapped_column(String(20), default="general", nullable=False, index=True)
    # Decline notes only: which lender declined (one of this loan's submissions)
    # and the tenant-managed reason tag the notes-history summary counts by.
    lender_submission_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("lender_submissions.id", ondelete="SET NULL"), nullable=True
    )
    decline_reason_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("decline_reasons.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    # Stamped on edit. The scratchpad shows "last edited by" from these and uses
    # updated_at to refuse a save made over someone else's newer edit.
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    updated_by_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)

    application = relationship("LoanApplication", backref="application_notes")
    author = relationship("User", foreign_keys=[author_id])
    updated_by = relationship("User", foreign_keys=[updated_by_id])
    lender_submission = relationship("LenderSubmission")
    decline_reason = relationship("DeclineReason")
