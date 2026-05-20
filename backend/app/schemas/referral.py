from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator

from app.models.referral import ReferralStatus
from app.schemas.common import normalize_email


class ReferralInvite(BaseModel):
    email: EmailStr
    name: Optional[str] = None

    _normalize_email = field_validator("email", mode="before")(normalize_email)


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
