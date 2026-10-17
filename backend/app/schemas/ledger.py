from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field


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


class LedgerBulkPaid(BaseModel):
    """Mark several deals paid in one go — a referrer's invoice, usually."""

    application_ids: list[str] = Field(min_length=1, max_length=500)
    paid_on: date
    payment_method: Optional[str] = Field(None, max_length=50)
    payment_notes: Optional[str] = Field(None, max_length=4000)


class LedgerGrantCreate(BaseModel):
    user_id: str
    scopes: list[str] = Field(min_length=1)


class LedgerGrantUpdate(BaseModel):
    scopes: list[str] = Field(min_length=1)


class LedgerSettingsUpdate(BaseModel):
    business_name: Optional[str] = Field(None, max_length=255)
    business_abn: Optional[str] = Field(None, max_length=20)
    business_address: Optional[str] = Field(None, max_length=500)
    business_email: Optional[str] = Field(None, max_length=255)
    invoice_prefix: Optional[str] = Field(None, max_length=20)
    next_invoice_number: Optional[int] = Field(None, ge=1)


class LedgerInvoiceCreate(BaseModel):
    referrer_id: str
    application_ids: list[str] = Field(min_length=1, max_length=500)
    layout: Literal["breakdown", "single"] = "breakdown"
    issue_date: Optional[date] = None
    period_from: Optional[date] = None
    period_to: Optional[date] = None
