from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class QuoteOptionCreate(BaseModel):
    lender_name: str
    lender_product: Optional[str] = None
    sort_order: int = 0
    is_recommended: bool = False
    purchase_price: Optional[float] = None
    deposit: Optional[float] = None
    loan_amount: Optional[float] = None
    loan_term_months: Optional[int] = None
    balloon_residual: Optional[float] = None
    interest_rate: Optional[float] = None
    comparison_rate: Optional[float] = None
    client_interest_rate: Optional[float] = None
    establishment_fee: Optional[float] = None
    monthly_account_fee: Optional[float] = None
    application_fee: Optional[float] = None
    brokerage: Optional[float] = None
    repayment_monthly: Optional[float] = None
    repayment_fortnightly: Optional[float] = None
    repayment_weekly: Optional[float] = None
    total_repayments: Optional[float] = None
    total_interest: Optional[float] = None
    total_fees: Optional[float] = None
    features: Optional[str] = None
    notes: Optional[str] = None


class QuoteOptionUpdate(BaseModel):
    lender_name: Optional[str] = None
    lender_product: Optional[str] = None
    sort_order: Optional[int] = None
    is_recommended: Optional[bool] = None
    purchase_price: Optional[float] = None
    deposit: Optional[float] = None
    loan_amount: Optional[float] = None
    loan_term_months: Optional[int] = None
    balloon_residual: Optional[float] = None
    interest_rate: Optional[float] = None
    comparison_rate: Optional[float] = None
    client_interest_rate: Optional[float] = None
    establishment_fee: Optional[float] = None
    monthly_account_fee: Optional[float] = None
    application_fee: Optional[float] = None
    brokerage: Optional[float] = None
    repayment_monthly: Optional[float] = None
    repayment_fortnightly: Optional[float] = None
    repayment_weekly: Optional[float] = None
    total_repayments: Optional[float] = None
    total_interest: Optional[float] = None
    total_fees: Optional[float] = None
    features: Optional[str] = None
    notes: Optional[str] = None


class QuoteOptionOut(BaseModel):
    id: str
    quote_sheet_id: str
    sort_order: int
    is_recommended: bool
    lender_name: str
    lender_product: Optional[str]
    purchase_price: Optional[float]
    deposit: Optional[float]
    loan_amount: Optional[float]
    loan_term_months: Optional[int]
    balloon_residual: Optional[float]
    interest_rate: Optional[float]
    comparison_rate: Optional[float]
    client_interest_rate: Optional[float]
    establishment_fee: Optional[float]
    monthly_account_fee: Optional[float]
    application_fee: Optional[float]
    brokerage: Optional[float]
    repayment_monthly: Optional[float]
    repayment_fortnightly: Optional[float]
    repayment_weekly: Optional[float]
    total_repayments: Optional[float]
    total_interest: Optional[float]
    total_fees: Optional[float]
    features: Optional[str]
    notes: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class QuoteSheetCreate(BaseModel):
    title: Optional[str] = None
    broker_notes: Optional[str] = None
    input_parameters: Optional[str] = None  # JSON string of shared inputs
    options: list[QuoteOptionCreate] = []
    recipient_name: Optional[str] = None
    recipient_email: Optional[str] = None


class QuoteSheetUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    broker_notes: Optional[str] = None
    input_parameters: Optional[str] = None
    recipient_name: Optional[str] = None
    recipient_email: Optional[str] = None


class QuoteSheetEmailRequest(BaseModel):
    to_email: str
    to_name: Optional[str] = None
    include_terms: Optional[list[int]] = None  # which term years to include; None = all
    client_facing: bool = True


class QuoteSheetOut(BaseModel):
    id: str
    application_id: Optional[str] = None
    version: int
    title: Optional[str]
    status: str
    created_by_id: str
    created_by_name: Optional[str] = None
    broker_notes: Optional[str]
    input_parameters: Optional[str] = None
    recipient_name: Optional[str] = None
    recipient_email: Optional[str] = None
    sent_at: Optional[datetime]
    options: list[QuoteOptionOut] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
