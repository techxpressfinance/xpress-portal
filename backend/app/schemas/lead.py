from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


class LeadCreate(BaseModel):
    first_name: str
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    company_name: Optional[str] = None
    company_abn: Optional[str] = None
    loan_category: str
    sub_type: Optional[str] = None
    amount: Optional[Decimal] = Field(None, ge=0)
    source: Optional[str] = None
    notes: Optional[str] = None
    assigned_broker_id: Optional[str] = None
    # The lead stage it was added from. Without one the lead renders in each
    # board's first lead stage.
    board_id: Optional[str] = None
    column_id: Optional[str] = None


class LeadUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    company_name: Optional[str] = None
    company_abn: Optional[str] = None
    loan_category: Optional[str] = None
    sub_type: Optional[str] = None
    amount: Optional[Decimal] = Field(None, ge=0)
    source: Optional[str] = None
    notes: Optional[str] = None
    assigned_broker_id: Optional[str] = None


class LeadLostRequest(BaseModel):
    reason: Optional[str] = None


class LeadOut(BaseModel):
    id: str
    first_name: str
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    company_name: Optional[str] = None
    company_abn: Optional[str] = None
    loan_category: str
    sub_type: Optional[str] = None
    amount: Optional[float] = None
    source: Optional[str] = None
    notes: Optional[str] = None
    status: str
    lost_reason: Optional[str] = None
    lost_at: Optional[datetime] = None
    assigned_broker_id: Optional[str] = None
    assigned_broker_name: Optional[str] = None
    created_by_id: Optional[str] = None
    created_by_name: Optional[str] = None
    converted_application_id: Optional[str] = None
    converted_at: Optional[datetime] = None
    contact_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    # Board-only: when the lead entered the stage it is shown in.
    stage_entered_at: Optional[datetime] = None
