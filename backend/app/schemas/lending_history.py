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
    contact_id: str
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
