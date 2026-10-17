from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


RepaymentFrequencyLiteral = Literal["weekly", "fortnightly", "monthly"]


class LendingHistoryEntryCreate(BaseModel):
    lender_name: str = Field(min_length=1, max_length=200)
    amount: float = Field(ge=0)
    balloon: Optional[float] = Field(default=None, ge=0)
    other_broker_name: Optional[str] = Field(default=None, max_length=200)
    repayment_amount: Optional[float] = Field(default=None, ge=0)
    repayment_frequency: Optional[RepaymentFrequencyLiteral] = None
    start_date: Optional[date] = None
    identifier: Optional[str] = Field(default=None, max_length=200)
    guaranteed_by_contact_id: Optional[str] = None
    notes: Optional[str] = None


class LendingHistoryEntryUpdate(BaseModel):
    lender_name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    amount: Optional[float] = Field(default=None, ge=0)
    balloon: Optional[float] = Field(default=None, ge=0)
    other_broker_name: Optional[str] = Field(default=None, max_length=200)
    repayment_amount: Optional[float] = Field(default=None, ge=0)
    repayment_frequency: Optional[RepaymentFrequencyLiteral] = None
    start_date: Optional[date] = None
    identifier: Optional[str] = Field(default=None, max_length=200)
    guaranteed_by_contact_id: Optional[str] = None
    notes: Optional[str] = None


class LendingHistoryEntryOut(BaseModel):
    id: str
    contact_id: Optional[str]
    lender_name: str
    amount: float
    balloon: Optional[float]
    other_broker_name: Optional[str]
    repayment_amount: Optional[float]
    repayment_frequency: Optional[RepaymentFrequencyLiteral]
    start_date: Optional[date]
    identifier: Optional[str]
    guaranteed_by_contact_id: Optional[str]
    guaranteed_by_name: Optional[str] = None
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CommitmentLineUpdate(BaseModel):
    """A business commitment schedule line, ours or held elsewhere — see
    services/commitment_schedule.py. Rates are % p.a."""

    lender_name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    amount: Optional[float] = Field(default=None, ge=0)
    balloon: Optional[float] = Field(default=None, ge=0)
    repayment_amount: Optional[float] = Field(default=None, ge=0)
    repayment_frequency: Optional[RepaymentFrequencyLiteral] = None
    start_date: Optional[date] = None
    interest_rate: Optional[float] = Field(default=None, ge=0, le=100)
    term_months: Optional[int] = Field(default=None, ge=1, le=600)
    end_date: Optional[date] = None
    asset_description: Optional[str] = Field(default=None, max_length=2000)
    vin: Optional[str] = Field(default=None, max_length=1000)
    ppsr_charge_number: Optional[str] = Field(default=None, max_length=60)
    ppsr_change_number: Optional[str] = Field(default=None, max_length=60)
    ppsr_organisation_identifier: Optional[str] = Field(default=None, max_length=60)
    asset_price_ex_gst: Optional[float] = Field(default=None, ge=0)
    gst_claimed: Optional[float] = Field(default=None, ge=0)
    tax_invoice_date: Optional[date] = None
    notes: Optional[str] = None
    # Internal only — never printed on the schedule.
    other_broker_name: Optional[str] = Field(default=None, max_length=200)


class CommitmentLineCreate(CommitmentLineUpdate):
    lender_name: str = Field(min_length=1, max_length=200)
    amount: float = Field(ge=0)
