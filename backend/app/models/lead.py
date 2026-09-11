from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import DateTime, Enum, ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.encrypted_type import EncryptedString


class LeadStatus(str, enum.Enum):
    """Where a deal inquiry stands. A lead is not an application: it has no
    ApplicationStatus, sends no client email, and never reaches the client
    portal or the application analytics until it is converted."""

    open = "open"
    converted = "converted"
    lost = "lost"


class Lead(Base):
    """A deal inquiry — someone asked about a loan, before there is anything to
    apply with. It sits in a board's lead column and becomes a LoanApplication
    (plus a CRM contact) when the desk drags it into an application stage."""

    __tablename__ = "leads"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    created_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    assigned_broker_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )

    first_name: Mapped[str] = mapped_column(EncryptedString(), nullable=False)
    last_name: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    company_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    # Filled from an ABR search on the company name. Encrypted like
    # LoanApplication.business_abn, which it becomes on conversion.
    company_abn: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)

    # Plain (unencrypted) on purpose: unlike an application, whose category is
    # derived from encrypted form JSON, a lead's category filters in SQL.
    loan_category: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    sub_type: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    # Where the inquiry came from — phone, walk-in, website, a dealer… free text.
    source: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    status: Mapped[LeadStatus] = mapped_column(
        Enum(LeadStatus), default=LeadStatus.open, index=True, nullable=False
    )
    lost_reason: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    lost_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Set on conversion. SET NULL rather than a hard reference: purging a
    # trashed application must not be blocked by the lead that produced it.
    converted_application_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("loan_applications.id", ondelete="SET NULL"), nullable=True
    )
    converted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    converted_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # The CRM contact the lead became. Contacts are only created on conversion,
    # so a lead that goes nowhere never litters the contact book.
    contact_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("contacts.id", ondelete="SET NULL"), index=True, nullable=True
    )

    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc), index=True, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    created_by = relationship("User", foreign_keys=[created_by_id])
    assigned_broker = relationship("User", foreign_keys=[assigned_broker_id])


class LeadStagePlacement(Base):
    """Where a lead sits on one board — the lead counterpart of
    ApplicationStagePlacement. Kept as its own table rather than a nullable
    column on that one: its application_id is NOT NULL and part of a unique
    constraint, and SQLite can't relax either with ALTER."""

    __tablename__ = "lead_stage_placements"
    __table_args__ = (UniqueConstraint("lead_id", "board_id", name="uq_lead_placement_lead_board"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    lead_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True
    )
    board_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("kanban_boards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    column_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("kanban_columns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    entered_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    moved_by_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
