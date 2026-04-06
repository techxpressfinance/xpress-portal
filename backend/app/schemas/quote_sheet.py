from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class QuoteOptionCreate(BaseModel):
    lender_name: str
    lender_product: str | None = None
    sort_order: int = 0
    is_recommended: bool = False
    purchase_price: float | None = None
    deposit: float | None = None
    loan_amount: float | None = None
    loan_term_months: int | None = None
    balloon_residual: float | None = None
    interest_rate: float | None = None
    comparison_rate: float | None = None
    establishment_fee: float | None = None
    monthly_account_fee: float | None = None
    application_fee: float | None = None
    brokerage: float | None = None
    repayment_monthly: float | None = None
    repayment_fortnightly: float | None = None
    repayment_weekly: float | None = None
    total_repayments: float | None = None
    total_interest: float | None = None
    total_fees: float | None = None
    features: str | None = None
    notes: str | None = None


class QuoteOptionUpdate(BaseModel):
    lender_name: str | None = None
    lender_product: str | None = None
    sort_order: int | None = None
    is_recommended: bool | None = None
    purchase_price: float | None = None
    deposit: float | None = None
    loan_amount: float | None = None
    loan_term_months: int | None = None
    balloon_residual: float | None = None
    interest_rate: float | None = None
    comparison_rate: float | None = None
    establishment_fee: float | None = None
    monthly_account_fee: float | None = None
    application_fee: float | None = None
    brokerage: float | None = None
    repayment_monthly: float | None = None
    repayment_fortnightly: float | None = None
    repayment_weekly: float | None = None
    total_repayments: float | None = None
    total_interest: float | None = None
    total_fees: float | None = None
    features: str | None = None
    notes: str | None = None


class QuoteOptionOut(BaseModel):
    id: str
    quote_sheet_id: str
    sort_order: int
    is_recommended: bool
    lender_name: str
    lender_product: str | None
    purchase_price: float | None
    deposit: float | None
    loan_amount: float | None
    loan_term_months: int | None
    balloon_residual: float | None
    interest_rate: float | None
    comparison_rate: float | None
    establishment_fee: float | None
    monthly_account_fee: float | None
    application_fee: float | None
    brokerage: float | None
    repayment_monthly: float | None
    repayment_fortnightly: float | None
    repayment_weekly: float | None
    total_repayments: float | None
    total_interest: float | None
    total_fees: float | None
    features: str | None
    notes: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class QuoteSheetCreate(BaseModel):
    title: str | None = None
    broker_notes: str | None = None
    options: list[QuoteOptionCreate] = []


class QuoteSheetUpdate(BaseModel):
    title: str | None = None
    status: str | None = None
    broker_notes: str | None = None


class QuoteSheetOut(BaseModel):
    id: str
    application_id: str
    version: int
    title: str | None
    status: str
    created_by_id: str
    created_by_name: str | None = None
    broker_notes: str | None
    sent_at: datetime | None
    options: list[QuoteOptionOut] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
