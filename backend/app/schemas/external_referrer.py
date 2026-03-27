from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, EmailStr, field_validator


class ReferrerCreate(BaseModel):
    email: EmailStr
    full_name: str
    phone: str | None = None
    organization_name: str | None = None

    @field_validator("full_name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name cannot be empty")
        return v.strip()


class ExternalReferralInvite(BaseModel):
    email: EmailStr
    full_name: str | None = None

    @field_validator("email")
    @classmethod
    def email_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Email cannot be empty")
        return v.strip()


class ExternalReferralOut(BaseModel):
    id: str
    referrer_id: str
    referrer_name: str | None = None
    referred_email: str
    referred_client_id: str | None = None
    referred_client_name: str | None = None
    status: str
    created_at: datetime
    converted_at: datetime | None = None


class ExternalReferrerStats(BaseModel):
    total_referred: int
    signed_up: int
    applied: int
