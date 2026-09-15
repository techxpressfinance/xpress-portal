from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class LenderContact(Base):
    __tablename__ = "lender_contacts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    lender_id: Mapped[str] = mapped_column(String(36), ForeignKey("lenders.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    designation: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    lender: Mapped[Lender] = relationship("Lender", back_populates="contacts")


class Lender(Base):
    __tablename__ = "lenders"
    __table_args__ = (UniqueConstraint("name", "tenant_id", name="uq_lender_name_tenant"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # Superseded by the `contacts` rows, which carry a designation and let a
    # lender have more than one person. Kept because existing rows still hold
    # data; nothing reads or writes them.
    contact_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    contact_email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    contact_phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    address: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # A lender is not one mailbox. Each of these reaches a different desk inside
    # the lender, and sending to the wrong one is how a payout request sits
    # unanswered for a week — so they are separate columns rather than a note
    # for whoever is on the file to read and interpret.
    #
    # Named for the job, not the lender's own team names, which differ at every
    # one: "credit" is wherever an application is assessed, "settlements" is
    # wherever the money is booked.
    service_request_email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    collections_email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    payout_letter_email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    settlements_email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    credit_email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    doc_request_email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    contacts: Mapped[list[LenderContact]] = relationship(
        "LenderContact", back_populates="lender", cascade="all, delete-orphan", lazy="selectin"
    )
