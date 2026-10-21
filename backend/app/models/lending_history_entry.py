from __future__ import annotations

import enum
import uuid
from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy import Date, DateTime, Enum as SAEnum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class RepaymentFrequency(str, enum.Enum):
    weekly = "weekly"
    fortnightly = "fortnightly"
    monthly = "monthly"


class LendingHistoryEntry(Base):
    """A loan a person or entity holds — one line of their business commitment
    schedule (see services/commitment_schedule.py).

    Two kinds share the table. With `application_id` set it is a loan we
    arranged, created from the settled deal the first time the holder's schedule
    is drawn and the desk's to correct from then on; it outlives the
    application's archiving. Without it, it is a commitment held elsewhere,
    keyed in by the desk. `other_broker_name` is internal: the schedule never
    prints who arranged a loan held elsewhere.

    The holder is a contact (`contact_id`) or an entity (`organization_id`) —
    exactly one."""

    __tablename__ = "lending_history_entries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    contact_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("contacts.id"), nullable=True, index=True)
    organization_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("organizations.id"), nullable=True, index=True
    )
    # The settled deal this line was created from. No FK: settled applications
    # are archived to snapshots and purged, and the schedule line must survive.
    application_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)

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

    # ── Commitment schedule ───────────────────────────────────────────
    interest_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # % p.a.
    term_months: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    end_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    # Brokerage the lender paid on the loan (GST-inclusive where GST applies).
    brokerage_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # Several assets can sit under one loan (a truck and its trailer): one per line.
    asset_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    vin: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # PPSR register details — off the schedule unless the desk switches them on.
    ppsr_charge_number: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    ppsr_change_number: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    ppsr_organisation_identifier: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    asset_price_ex_gst: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    gst_claimed: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    tax_invoice_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    contact = relationship("Contact", foreign_keys=[contact_id])
    organization = relationship("Organization", foreign_keys=[organization_id])
    guarantor = relationship("Contact", foreign_keys=[guaranteed_by_contact_id])
