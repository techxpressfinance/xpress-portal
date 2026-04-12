from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr

from app.models.referral import ReferralStatus


class ReferralInvite(BaseModel):
    email: EmailStr
    name: Optional[str] = None


class ReferralCodeOut(BaseModel):
    code: str
    link: str


class ReferralOut(BaseModel):
    id: str
    referrer_id: str
    referral_code: str
    referred_email: Optional[str] = None
    referred_user_id: Optional[str] = None
    referred_user_name: Optional[str] = None
    status: ReferralStatus
    created_at: datetime
    converted_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ReferralStats(BaseModel):
    total_referred: int
    signed_up: int
    applied: int
