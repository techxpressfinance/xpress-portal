from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class LenderSubmissionCreate(BaseModel):
    lender_id: str
    status: str = "pending"
    submitted_at: datetime | None = None
    offered_rate: float | None = None
    offered_amount: float | None = None
    conditions: str | None = None
    notes: str | None = None


class LenderSubmissionUpdate(BaseModel):
    status: str | None = None
    responded_at: datetime | None = None
    offered_rate: float | None = None
    offered_amount: float | None = None
    conditions: str | None = None
    notes: str | None = None


class LenderSubmissionOut(BaseModel):
    id: str
    application_id: str
    lender_id: str
    lender_name: str | None = None
    submitted_by_id: str
    submitted_by_name: str | None = None
    status: str
    submitted_at: datetime
    responded_at: datetime | None
    offered_rate: float | None
    offered_amount: float | None
    conditions: str | None
    notes: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
