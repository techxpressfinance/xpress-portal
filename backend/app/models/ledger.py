"""The private commission ledger — one tenant member's own books.

A tenant has at most one ledger OWNER (set server-side by set_ledger_owner.py,
never from the UI). Nobody else — other admins included — can see it unless the
owner grants them access, and a grant only goes live 24 hours after it is made
(LEDGER_GRANT_DELAY in services/ledger.py) with whatever subset of the ledger
the owner chose to show.

Deliberately no foreign key to loan_applications or users: like
SettledDealSnapshot, the books must outlive a purged application or a deleted
team member. Names are resolved at query time.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.encrypted_type import EncryptedString


def _now() -> datetime:
    return datetime.now(timezone.utc)


class LedgerSettings(Base):
    """Who owns the tenant's ledger, and the details printed on its invoices."""

    __tablename__ = "ledger_settings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), unique=True, index=True, nullable=False)
    owner_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    # The "bill to" block on a referrer's commission invoice — us.
    business_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    business_abn: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    business_address: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    business_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    invoice_prefix: Mapped[str] = mapped_column(String(20), default="RC-", nullable=False)
    next_invoice_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now, nullable=False)


class LedgerGrant(Base):
    """A team member the owner has let see (part of) the ledger.

    ``scopes`` is a comma-separated subset of GRANT_SCOPES. Access starts at
    ``active_from`` (made + 24h) and ends the moment ``revoked_at`` is set.
    Grantees are always read-only."""

    __tablename__ = "ledger_grants"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    user_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    scopes: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    granted_by_id: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
    active_from: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class LedgerDeal(Base):
    """The owner's figures for one settled deal.

    Every money column is nullable: None means "not entered", and the ledger
    shows the figure prefilled from the application (lender pricing, the
    approval lender, the referrer on the client) until one is. Income amounts
    are ex GST, as the desk's spreadsheet keeps them; clawbacks are entered as
    negatives."""

    __tablename__ = "ledger_deals"
    __table_args__ = (UniqueConstraint("tenant_id", "application_id", name="uq_ledger_deal_application"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    application_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)

    finance_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    brokerage: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    doc_fee: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    origination_fee: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    vir: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    volume_bonus: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    # GST charged on our income lines (10%). Off for the rare GST-free deal.
    income_gst: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    lender_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    is_clawback: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # None = derive (see services/ledger.py); True/False = the owner's call.
    new_lead: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    repeat_customer: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)

    # Who is paid a share. referrer_set=False follows the referrer on the
    # client; True means referrer_id is the owner's choice (None = nobody).
    referrer_set: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    referrer_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    # The share, as the quote sheets do brokerage: a percentage of a base, or a
    # dollar figure that wins when set. Ex GST.
    share_percent: Mapped[Optional[Decimal]] = mapped_column(Numeric(7, 4), nullable=True)
    share_base: Mapped[str] = mapped_column(String(20), default="brokerage", nullable=False)
    share_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    # GST on top of the share. None = follow the referrer's GST registration.
    share_gst: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)

    # When we paid the referrer — the owner's eyes only.
    paid_on: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    payment_method: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    payment_notes: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)

    updated_by_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now, nullable=False)


class LedgerInvoice(Base):
    """A referrer commission invoice as issued: its number, the deals on it and
    the figures at the time, so a reprint matches what was sent even after the
    deals are edited."""

    __tablename__ = "ledger_invoices"
    __table_args__ = (UniqueConstraint("tenant_id", "number", name="uq_ledger_invoice_number"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    number: Mapped[str] = mapped_column(String(40), nullable=False)
    referrer_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    issue_date: Mapped[date] = mapped_column(Date, nullable=False)
    period_from: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    period_to: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    # "breakdown" lists every deal; "single" prints one overall figure.
    layout: Mapped[str] = mapped_column(String(20), nullable=False, default="breakdown")
    # JSON: the supplier/recipient blocks, lines and totals as printed.
    snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    total_ex_gst: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    total_gst: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    total_inc_gst: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    created_by_id: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)


class LedgerAuditEvent(Base):
    """What happened in the ledger, for the owner. Kept apart from the shared
    activity log, which every admin can read."""

    __tablename__ = "ledger_audit_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    actor_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    detail: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True, nullable=False)
