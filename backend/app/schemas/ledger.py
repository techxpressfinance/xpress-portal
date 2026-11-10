from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

ShareBase = Literal["brokerage", "total_income", "finance_amount"]
ShareStatus = Literal["unpaid", "scheduled", "paid", "not_payable"]
Category = Literal["asset_finance", "consumer", "home_loan", "commercial"]


class LedgerDealUpdate(BaseModel):
    """The owner's figures for one settled deal. Only the fields sent are
    changed; sending null clears a figure back to its prefill."""

    finance_amount: Optional[float] = None
    brokerage: Optional[float] = None
    doc_fee: Optional[float] = None
    origination_fee: Optional[float] = None
    vir: Optional[float] = None
    volume_bonus: Optional[float] = None
    income_gst: Optional[bool] = None
    lender_name: Optional[str] = Field(None, max_length=200)
    is_clawback: Optional[bool] = None
    new_lead: Optional[bool] = None
    repeat_customer: Optional[bool] = None
    # referrer_set=False goes back to the referrer on the client.
    referrer_set: Optional[bool] = None
    referrer_id: Optional[str] = None
    share_percent: Optional[float] = Field(None, ge=-1000, le=1000)
    share_base: Optional[Literal["brokerage", "total_income", "finance_amount"]] = None
    share_amount: Optional[float] = None
    share_gst: Optional[bool] = None
    paid_on: Optional[date] = None
    payment_method: Optional[str] = Field(None, max_length=50)
    payment_notes: Optional[str] = Field(None, max_length=4000)
    # Ledger-only deals: what the deal is.
    manual_settled_on: Optional[date] = None
    manual_customer_name: Optional[str] = Field(None, max_length=255)
    manual_entity_name: Optional[str] = Field(None, max_length=255)
    manual_category: Optional[Category] = None
    manual_broker_id: Optional[str] = Field(None, max_length=36)
    manual_broker_name: Optional[str] = Field(None, max_length=200)
    notes: Optional[str] = Field(None, max_length=4000)


class LedgerManualDealCreate(BaseModel):
    """A deal with no portal application behind it."""

    settled_on: date
    customer_name: str = Field(min_length=1, max_length=255)
    entity_name: Optional[str] = Field(None, max_length=255)
    category: Optional[Category] = None
    broker_id: Optional[str] = Field(None, max_length=36)
    broker_name: Optional[str] = Field(None, max_length=200)
    lender_name: Optional[str] = Field(None, max_length=200)
    finance_amount: Optional[float] = None
    brokerage: Optional[float] = None
    doc_fee: Optional[float] = None
    origination_fee: Optional[float] = None
    vir: Optional[float] = None
    volume_bonus: Optional[float] = None
    income_gst: bool = True
    is_clawback: bool = False
    new_lead: Optional[bool] = None
    repeat_customer: Optional[bool] = None
    notes: Optional[str] = Field(None, max_length=4000)


class LedgerShareIn(BaseModel):
    """One payee's cut of a deal. payee_key is "u:<referrer user id>" or "p:<payee id>"."""

    payee_key: str = Field(min_length=3, max_length=60)
    share_percent: Optional[float] = Field(None, ge=-1000, le=1000)
    share_base: ShareBase = "brokerage"
    share_amount: Optional[float] = None
    share_gst: Optional[bool] = None
    status: ShareStatus = "unpaid"
    scheduled_on: Optional[date] = None
    paid_on: Optional[date] = None
    payment_method: Optional[str] = Field(None, max_length=50)
    payment_reference: Optional[str] = Field(None, max_length=200)
    payment_notes: Optional[str] = Field(None, max_length=4000)


class LedgerSharesUpdate(BaseModel):
    """The deal's payees, replacing whatever it had. Empty = nobody is paid."""

    shares: list[LedgerShareIn] = Field(max_length=20)


class LedgerBulkPaid(BaseModel):
    """Set the payment status of several deals in one go — a payee's invoice,
    or one bank transfer that covered several deals."""

    application_ids: list[str] = Field(min_length=1, max_length=500)
    # Whose share; None = every payee on those deals.
    payee_key: Optional[str] = Field(None, max_length=60)
    status: ShareStatus = "paid"
    paid_on: Optional[date] = None
    scheduled_on: Optional[date] = None
    payment_method: Optional[str] = Field(None, max_length=50)
    payment_reference: Optional[str] = Field(None, max_length=200)
    payment_notes: Optional[str] = Field(None, max_length=4000)

    @model_validator(mode="after")
    def _dates(self):
        if self.status == "paid" and not self.paid_on:
            raise ValueError("A paid date is needed")
        if self.status == "scheduled" and not self.scheduled_on:
            raise ValueError("A scheduled date is needed")
        return self


class LedgerPayeeIn(BaseModel):
    """An off-portal payee's details (all of them), or a portal referrer's
    ledger-only extras (notes, usual cut) — the rest of a portal referrer's
    record is their own billing profile."""

    name: Optional[str] = Field(None, max_length=255)
    company_name: Optional[str] = Field(None, max_length=255)
    abn: Optional[str] = Field(None, max_length=20)
    gst_registered: Optional[bool] = None
    email: Optional[str] = Field(None, max_length=255)
    phone: Optional[str] = Field(None, max_length=50)
    address: Optional[str] = Field(None, max_length=500)
    bank_account_name: Optional[str] = Field(None, max_length=255)
    bank_name: Optional[str] = Field(None, max_length=100)
    bank_bsb: Optional[str] = Field(None, max_length=10)
    bank_account_number: Optional[str] = Field(None, max_length=20)
    notes: Optional[str] = Field(None, max_length=4000)
    default_share_percent: Optional[float] = Field(None, ge=-1000, le=1000)
    default_share_base: Optional[ShareBase] = None
    default_share_amount: Optional[float] = None
    is_active: Optional[bool] = None


class LedgerReceiptIn(BaseModel):
    received_on: date
    from_name: str = Field(min_length=1, max_length=255)
    amount: float = Field(ge=-10_000_000, le=10_000_000)
    reference: Optional[str] = Field(None, max_length=200)
    notes: Optional[str] = Field(None, max_length=4000)


class LedgerGrantCreate(BaseModel):
    user_id: str
    scopes: list[str] = Field(min_length=1)


class LedgerGrantUpdate(BaseModel):
    scopes: list[str] = Field(min_length=1)


class LedgerVbTier(BaseModel):
    min_volume: float = Field(ge=0)
    share_percent: float = Field(ge=0, le=100)


class LedgerSettingsUpdate(BaseModel):
    business_name: Optional[str] = Field(None, max_length=255)
    business_abn: Optional[str] = Field(None, max_length=20)
    business_address: Optional[str] = Field(None, max_length=500)
    business_email: Optional[str] = Field(None, max_length=255)
    invoice_prefix: Optional[str] = Field(None, max_length=20)
    next_invoice_number: Optional[int] = Field(None, ge=1)
    vb_tiers: Optional[list[LedgerVbTier]] = Field(None, max_length=20)



class LedgerMonthUpdate(BaseModel):
    vb_received_inc_gst: Optional[float] = Field(None, ge=-10_000_000, le=10_000_000)


class LedgerInvoiceCreate(BaseModel):
    # The payee key ("u:…" / "p:…"); a bare referrer user id still works.
    referrer_id: str = Field(max_length=60)
    application_ids: list[str] = Field(min_length=1, max_length=500)
    layout: Literal["breakdown", "single"] = "breakdown"
    issue_date: Optional[date] = None
    period_from: Optional[date] = None
    period_to: Optional[date] = None
