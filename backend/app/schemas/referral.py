from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, EmailStr

from app.models.referral import ReferralStatus


class ReferralInvite(BaseModel):
    email: EmailStr
    name: str | None = None


class ReferralCodeOut(BaseModel):
    code: str
    link: str


class ReferralOut(BaseModel):
    id: str
    referrer_id: str
    referral_code: str
    referred_email: str | None = None
    referred_user_id: str | None = None
    referred_user_name: str | None = None
    status: ReferralStatus
    created_at: datetime
    converted_at: datetime | None = None

    model_config = {"from_attributes": True}


class ReferralStats(BaseModel):
    total_referred: int
    signed_up: int
    applied: int
