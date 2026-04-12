from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class LenderSubmissionCreate(BaseModel):
    lender_id: str
    status: str = "pending"
    submitted_at: Optional[datetime] = None
    offered_rate: Optional[float] = None
    offered_amount: Optional[float] = None
    conditions: Optional[str] = None
    notes: Optional[str] = None


class LenderSubmissionUpdate(BaseModel):
    status: Optional[str] = None
    responded_at: Optional[datetime] = None
    offered_rate: Optional[float] = None
    offered_amount: Optional[float] = None
    conditions: Optional[str] = None
    notes: Optional[str] = None


class LenderSubmissionOut(BaseModel):
    id: str
    application_id: str
    lender_id: str
    lender_name: Optional[str] = None
    submitted_by_id: str
    submitted_by_name: Optional[str] = None
    status: str
    submitted_at: datetime
    responded_at: Optional[datetime]
    offered_rate: Optional[float]
    offered_amount: Optional[float]
    conditions: Optional[str]
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
