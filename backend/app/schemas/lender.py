from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator


class LenderContactCreate(BaseModel):
    name: str
    designation: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Contact name cannot be empty")
        return v.strip()


class LenderContactUpdate(BaseModel):
    name: Optional[str] = None
    designation: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None


class LenderContactOut(BaseModel):
    id: str
    name: str
    designation: Optional[str]
    email: Optional[str]
    phone: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class LenderCreate(BaseModel):
    name: str
    notes: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Lender name cannot be empty")
        return v.strip()


class LenderUpdate(BaseModel):
    name: Optional[str] = None
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
    notes: Optional[str]
    is_active: bool
    contacts: list[LenderContactOut] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
