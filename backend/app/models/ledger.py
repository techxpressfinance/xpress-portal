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
    # Our share of the volume bonus by the month's settled volume, as JSON
    # [{"min_volume": 250000, "share_percent": 50}, …]. NULL = DEFAULT_VB_TIERS.
    vb_tiers: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
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
    # LEGACY: the referrer/share/payment fields above and here describe the
    # deal's single payee from before LedgerDealShare. They are read as that
    # payee's share until the owner saves shares for the deal, which clears them.
    paid_on: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    payment_method: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    payment_notes: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)

    # A ledger-only deal: no portal application behind it (history imported
    # from the spreadsheet, or business written outside the portal).
    # application_id is then just the deal's own key, and these describe it.
    is_manual: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    manual_settled_on: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    manual_customer_name: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    manual_entity_name: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    # asset_finance / consumer / home_loan / commercial (the colour coding).
    manual_category: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    # Whose book the deal belongs to: a team member, or a name for history.
    manual_broker_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    manual_broker_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)

    updated_by_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now, nullable=False)


class LedgerPayee(Base):
    """Someone the owner pays referral commission to.

    Either a portal referrer (user_id set — their billing details stay on the
    User, this row only holds ledger-private extras) or someone who never had a
    portal login (an accountant, a sub-contractor, a staff member): their
    details live here. Ledger-private: nobody outside the ledger sees this."""

    __tablename__ = "ledger_payees"
    __table_args__ = (UniqueConstraint("tenant_id", "user_id", name="uq_ledger_payee_user"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    company_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    abn: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    gst_registered: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    email: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    address: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    bank_account_name: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    bank_name: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    bank_bsb: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    bank_account_number: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    # Their usual cut, prefilled on deals that don't have one entered yet.
    default_share_percent: Mapped[Optional[Decimal]] = mapped_column(Numeric(7, 4), nullable=True)
    default_share_base: Mapped[str] = mapped_column(String(20), default="brokerage", nullable=False)
    default_share_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now, nullable=False)


SHARE_STATUSES = ("unpaid", "scheduled", "paid", "not_payable")


class LedgerDealShare(Base):
    """One payee's cut of one deal — a deal can pay several (e.g. 33% / 67%
    between two partners). The share is a percentage of a base or a dollar
    figure, as the quote sheets do brokerage; each is paid on its own."""

    __tablename__ = "ledger_deal_shares"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    # LedgerDeal.application_id — the deal's key (a portal application or a manual deal).
    deal_key: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    payee_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    share_percent: Mapped[Optional[Decimal]] = mapped_column(Numeric(7, 4), nullable=True)
    share_base: Mapped[str] = mapped_column(String(20), default="brokerage", nullable=False)
    share_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    # None = follow the payee's GST registration.
    share_gst: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    # unpaid / scheduled (scheduled_on) / paid (paid_on) / not_payable.
    status: Mapped[str] = mapped_column(String(20), default="unpaid", nullable=False)
    scheduled_on: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    paid_on: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    payment_method: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    # One transfer often covers several deals ("paid as part of $17,501.75").
    payment_reference: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    payment_notes: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now, nullable=False)


class LedgerReceipt(Base):
    """Money received from another party — commission passed on by another
    broker or aggregator, a split settled up. Kept to reconcile against."""

    __tablename__ = "ledger_receipts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    received_on: Mapped[date] = mapped_column(Date, nullable=False)
    from_name: Mapped[str] = mapped_column(String(255), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    reference: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    created_by_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now, nullable=False)


class LedgerMonth(Base):
    """What the owner records against a whole month — the volume bonus the
    aggregator actually paid for it (entered inc GST, as it arrives). Final
    profit for the month is net profit plus this, ex GST."""

    __tablename__ = "ledger_months"
    __table_args__ = (UniqueConstraint("tenant_id", "month", name="uq_ledger_month"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    month: Mapped[str] = mapped_column(String(7), nullable=False)  # YYYY-MM
    vb_received_inc_gst: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
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
    # The payee's portal user id, or the payee id for someone off-portal.
    referrer_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    payee_id: Mapped[Optional[str]] = mapped_column(String(36), index=True, nullable=True)
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
