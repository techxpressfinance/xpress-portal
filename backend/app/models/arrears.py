"""Arrears book — contracts of ours that have fallen behind on repayments.

A client or company can hold several contracts with us where only one or two
are in arrears, so the unit of record here is the *contract*, never the
client: `ArrearsRecord` is one contract in arrears, linked to a Contact
and/or an Organization so it surfaces on their detail pages.

Contract facts (lender, contract number, repayment, asset) are entered by
hand — no existing model carries them (LoanApplication has no contract
number/repayment/asset columns, and LendingHistoryEntry records lending
written by *other* brokers).

Day counts and ageing buckets are never stored on the live record: they're
derived from `in_arrears_since` on read (see services/arrears.py) so a row
can't silently go stale. `ArrearsSnapshot` freezes the derived state once per
month so a past month's book can be reproduced exactly.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.encrypted_type import EncryptedString


class ArrearsRecord(Base):
    __tablename__ = "arrears_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)

    # Party linkage — at least one of these is required (enforced in the router)
    # so every record maps onto a contact and/or company detail page.
    contact_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("contacts.id"), index=True, nullable=True
    )
    organization_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("organizations.id"), index=True, nullable=True
    )
    # Optional provenance: the deal we wrote that became this contract.
    application_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("loan_applications.id"), nullable=True
    )

    # Lender: picked from the lender book where possible, but the name is always
    # stored so the record survives a lender row being renamed or deleted.
    lender_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("lenders.id"), nullable=True)
    lender_name: Mapped[str] = mapped_column(String(200), nullable=False)

    contract_number: Mapped[Optional[str]] = mapped_column(String(100), index=True, nullable=True)
    # Vehicle Identification Number (or chassis number) of the secured asset.
    # Required on new records; nullable only because rows written before the
    # column existed can't be backfilled.
    vin: Mapped[Optional[str]] = mapped_column(String(50), index=True, nullable=True)
    asset_details: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # One of ARREARS_FILE_TYPES (services/arrears.py).
    file_type: Mapped[str] = mapped_column(String(30), nullable=False)

    repayment_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    repayment_frequency: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    # Total currently overdue. Optional — some lender reports quote only a day count.
    arrears_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)

    # Drives days_in_arrears and the ageing bucket; both recompute daily.
    in_arrears_since: Mapped[date] = mapped_column(Date, index=True, nullable=False)

    resolved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    resolved_by_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)

    proof_of_payment_received: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    proof_received_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    proof_received_by_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)

    # Manual flag, valid at any day count — a contract in legal action/default at
    # 40 days is delinquent, and it reports as delinquent instead of its age bucket.
    delinquent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    delinquent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    delinquent_by_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    delinquent_reason: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_by_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    contact = relationship("Contact", foreign_keys=[contact_id])
    organization = relationship("Organization", foreign_keys=[organization_id])
    lender = relationship("Lender", foreign_keys=[lender_id])
    created_by = relationship("User", foreign_keys=[created_by_id])

    # Co-financed contracts carry several lenders. The parent's lender_id /
    # lender_name stay a denormalised copy of the *first* lender so list views,
    # search, and the lender filter keep working off the single row they were
    # built on (see _set_lenders in routers/arrears.py).
    record_lenders = relationship(
        "ArrearsRecordLender",
        back_populates="record",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="ArrearsRecordLender.position",
    )

    # Collections touch log — phone/email/text attempts. Unlike the append-only
    # events timeline, attempt rows are editable (the attempted-at time is often
    # backfilled); every add/edit still stamps an ArrearsEvent so the audit
    # trail survives the edits.
    contact_attempts = relationship(
        "ArrearsContactAttempt",
        back_populates="record",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="ArrearsContactAttempt.attempted_at.desc()",
    )

    attachments = relationship(
        "ArrearsAttachment",
        back_populates="record",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    events = relationship(
        "ArrearsEvent",
        back_populates="record",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class ArrearsRecordLender(Base):
    """One of a contract's lenders.

    Lender rows created before this table only have the parent columns; reads
    fall back to the parent's lender_id/lender_name when no children exist,
    and any create/update that sends a lender list writes children plus the
    synced parent copy — so legacy rows need no backfill.
    """

    __tablename__ = "arrears_record_lenders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    arrears_record_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("arrears_records.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Null for lenders typed by hand that aren't in the lender book — the name
    # is always stored so the record survives renames/deletes, same as the parent.
    lender_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("lenders.id"), nullable=True)
    lender_name: Mapped[str] = mapped_column(String(200), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    record = relationship("ArrearsRecord", back_populates="record_lenders")


class ArrearsContactAttempt(Base):
    """One collections touch on a contract — a phone call, email, or text attempt.

    `attempted_at` is the user-editable "when it happened" (brokers log attempts
    after the fact); created_at / updated_at are the system audit of when the
    entry itself was written and last touched, which the UI shows alongside it.
    Snips/pics hang off ArrearsAttachment rows via `contact_attempt_id`.
    """

    __tablename__ = "arrears_contact_attempts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    arrears_record_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("arrears_records.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # One of ATTEMPT_METHODS (routers/arrears.py).
    method: Mapped[str] = mapped_column(String(10), nullable=False)
    attempted_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_by_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    # Seeded from created_at rather than a second now() call: two independent
    # now() defaults land microseconds apart, which reads as "edited" to the UI
    # the instant the row is written.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda ctx: ctx.get_current_parameters()["created_at"],
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    record = relationship("ArrearsRecord", back_populates="contact_attempts")
    created_by = relationship("User", foreign_keys=[created_by_id])
    attachments = relationship(
        "ArrearsAttachment",
        back_populates="contact_attempt",
        cascade="all, delete-orphan",
        order_by="ArrearsAttachment.uploaded_at",
    )


class ArrearsSnapshot(Base):
    """State of one arrears record frozen at a month end.

    Written by the month-end sweep (services/arrears.py) so the book can be
    reported as it stood in any past month — the live record keeps moving, and
    a PDF issued for March must still say what March said.
    """

    __tablename__ = "arrears_snapshots"
    __table_args__ = (
        UniqueConstraint("arrears_record_id", "snapshot_month", name="uq_arrears_snapshot_record_month"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), index=True, nullable=True)
    # Not FK-constrained, deliberately: deleting a live record must not erase the
    # historical months it appeared in (same reasoning as SettledDealSnapshot).
    arrears_record_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)

    snapshot_month: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    days_in_arrears: Mapped[int] = mapped_column(Integer, nullable=False)
    bucket: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    proof_of_payment_received: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    delinquent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    repayment_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    arrears_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)


class ArrearsAttachment(Base):
    """A screenshot, document, or dropped email attached to an arrears record."""

    __tablename__ = "arrears_attachments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    arrears_record_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("arrears_records.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # "file" (uploaded/dropped document), "screenshot" (clipboard paste), "email"
    # (parsed .eml/.msg — the header fields below are populated).
    kind: Mapped[str] = mapped_column(String(20), default="file", nullable=False)

    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)

    # Parsed email headers/body. Correspondence about a client's missed payments
    # is PII, so sender, recipients, subject, and body are encrypted at rest.
    email_from: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    email_to: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    email_subject: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    email_body: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    email_sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    uploaded_by_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    # Set when the file is a snip/pic attached to a contact attempt instead of
    # a record-level attachment — the attempt owns its display then.
    contact_attempt_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("arrears_contact_attempts.id", ondelete="CASCADE"), nullable=True, index=True
    )

    record = relationship("ArrearsRecord", back_populates="attachments")
    contact_attempt = relationship("ArrearsContactAttempt", back_populates="attachments")
    uploaded_by = relationship("User", foreign_keys=[uploaded_by_id])


class ArrearsEvent(Base):
    """Append-only timeline entry — who changed what on an arrears record, when.

    Arrears records are evidence in collections disputes, so every state change
    (and every note, screenshot, or email added) is stamped here rather than
    only mutating the record in place.
    """

    __tablename__ = "arrears_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    arrears_record_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("arrears_records.id", ondelete="CASCADE"), nullable=False, index=True
    )

    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    detail: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_by_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc), index=True, nullable=False
    )

    record = relationship("ArrearsRecord", back_populates="events")
    created_by = relationship("User", foreign_keys=[created_by_id])
