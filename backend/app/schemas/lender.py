from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator


class LenderCreate(BaseModel):
    name: str
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Lender name cannot be empty")
        return v.strip()


class LenderUpdate(BaseModel):
    name: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("Lender name cannot be empty")
        return v.strip() if v else v


class LenderOut(BaseModel):
    id: str
    name: str
    contact_name: Optional[str]
    contact_email: Optional[str]
    contact_phone: Optional[str]
    notes: Optional[str]
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
