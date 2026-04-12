from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator


class ReferrerCreate(BaseModel):
    email: EmailStr
    full_name: str
    phone: Optional[str] = None
    organization_name: Optional[str] = None

    @field_validator("full_name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name cannot be empty")
        return v.strip()


class ExternalReferralInvite(BaseModel):
    email: EmailStr
    full_name: Optional[str] = None

    @field_validator("email")
    @classmethod
    def email_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Email cannot be empty")
        return v.strip()


class ExternalReferralOut(BaseModel):
    id: str
    referrer_id: str
    referrer_name: Optional[str] = None
    referred_email: str
    referred_client_id: Optional[str] = None
    referred_client_name: Optional[str] = None
    status: str
    created_at: datetime
    converted_at: Optional[datetime] = None


class ExternalReferrerStats(BaseModel):
    total_referred: int
    signed_up: int
    applied: int
