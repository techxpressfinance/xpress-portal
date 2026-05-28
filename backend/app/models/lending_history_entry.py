from __future__ import annotations

import enum
import uuid
from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy import Date, DateTime, Enum as SAEnum, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class RepaymentFrequency(str, enum.Enum):
    weekly = "weekly"
    fortnightly = "fortnightly"
    monthly = "monthly"


class LendingHistoryEntry(Base):
    __tablename__ = "lending_history_entries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    contact_id: Mapped[str] = mapped_column(String(36), ForeignKey("contacts.id"), nullable=False, index=True)

    lender_name: Mapped[str] = mapped_column(String(200), nullable=False)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    balloon: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    other_broker_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    repayment_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    repayment_frequency: Mapped[Optional[RepaymentFrequency]] = mapped_column(
        SAEnum(RepaymentFrequency, name="repayment_frequency"), nullable=True
    )
    start_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    identifier: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    guaranteed_by_contact_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("contacts.id"), nullable=True, index=True
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    contact = relationship("Contact", foreign_keys=[contact_id])
    guarantor = relationship("Contact", foreign_keys=[guaranteed_by_contact_id])
