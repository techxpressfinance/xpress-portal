from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class ApplicationNoteCreate(BaseModel):
    content: str
    visibility: list[str] = ["broker"]
    category: str = "general"
    lender_submission_id: Optional[str] = None
    decline_reason_id: Optional[str] = None


class ApplicationNoteUpdate(BaseModel):
    content: Optional[str] = None
    visibility: Optional[list[str]] = None
    lender_submission_id: Optional[str] = None
    decline_reason_id: Optional[str] = None


class ApplicationNoteOut(BaseModel):
    id: str
    application_id: str
    author_id: str
    author_name: Optional[str] = None
    author_role: Optional[str] = None
    content: str
    visibility: list[str]
    category: str = "general"
    lender_submission_id: Optional[str] = None
    lender_name: Optional[str] = None
    decline_reason_id: Optional[str] = None
    decline_reason: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    updated_by_name: Optional[str] = None

    model_config = {"from_attributes": True}


class ScratchpadOut(BaseModel):
    content: str
    updated_at: Optional[datetime] = None
    updated_by_name: Optional[str] = None


class ScratchpadUpdate(BaseModel):
    content: str
    # The updated_at the editor loaded. A save is refused (409) when someone
    # else has saved since, so two brokers never silently overwrite each other.
    base_updated_at: Optional[datetime] = None


class DeclineReasonOut(BaseModel):
    id: str
    label: str
    sort_order: int
    is_active: bool

    model_config = {"from_attributes": True}


class DeclineReasonCreate(BaseModel):
    label: str


class DeclineReasonUpdate(BaseModel):
    label: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None
