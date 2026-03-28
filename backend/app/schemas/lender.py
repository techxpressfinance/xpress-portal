from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, field_validator


class LenderCreate(BaseModel):
    name: str
    contact_name: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    notes: str | None = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Lender name cannot be empty")
        return v.strip()


class LenderUpdate(BaseModel):
    name: str | None = None
    contact_name: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    notes: str | None = None
    is_active: bool | None = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("Lender name cannot be empty")
        return v.strip() if v else v


class LenderOut(BaseModel):
    id: str
    name: str
    contact_name: str | None
    contact_email: str | None
    contact_phone: str | None
    notes: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
