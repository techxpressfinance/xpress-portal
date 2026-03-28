from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import DateTime, Enum, ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class SubmissionStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    declined = "declined"
    conditional = "conditional"
    withdrawn = "withdrawn"


class LenderSubmission(Base):
    __tablename__ = "lender_submissions"
    __table_args__ = (
        UniqueConstraint("application_id", "lender_id", name="uq_app_lender"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    application_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("loan_applications.id", ondelete="CASCADE"), nullable=False
    )
    lender_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("lenders.id", ondelete="CASCADE"), nullable=False
    )
    submitted_by_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False
    )
    status: Mapped[SubmissionStatus] = mapped_column(
        Enum(SubmissionStatus), default=SubmissionStatus.pending, nullable=False
    )
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )
    responded_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    offered_rate: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2), nullable=True)
    offered_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    conditions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    lender = relationship("Lender", lazy="selectin")
    application = relationship("LoanApplication", lazy="selectin")
    submitted_by = relationship("User", lazy="selectin")
