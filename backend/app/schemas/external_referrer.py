from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, field_validator

from app.schemas.common import normalize_email

ClientEngagementModel = Literal["self_managed", "direct_engagement"]


def _digits(value: str) -> str:
    return "".join(ch for ch in value if ch.isdigit())


def _normalize_abn(v):
    """Accept a spaced/hyphenated ABN, store the 11 digits."""
    if v is None:
        return None
    digits = _digits(str(v))
    if not digits:
        return None
    if len(digits) != 11:
        raise ValueError("ABN must be 11 digits")
    return digits


def _normalize_bsb(v):
    """Accept 123456 or 123-456, store as 123-456."""
    if v is None:
        return None
    digits = _digits(str(v))
    if not digits:
        return None
    if len(digits) != 6:
        raise ValueError("BSB must be 6 digits")
    return f"{digits[:3]}-{digits[3:]}"


def _normalize_account_number(v):
    if v is None:
        return None
    digits = _digits(str(v))
    if not digits:
        return None
    if not 4 <= len(digits) <= 10:
        raise ValueError("Bank account number must be between 4 and 10 digits")
    return digits


def _blank_to_none(v):
    if v is None:
        return None
    v = str(v).strip()
    return v or None


class ReferrerBusinessProfile(BaseModel):
    """Billing details a referrer supplies so we can raise their monthly tax invoice."""

    business_abn: Optional[str] = None
    business_gst_registered: Optional[bool] = None
    business_director_name: Optional[str] = None
    business_address: Optional[str] = None
    bank_account_name: Optional[str] = None
    bank_bsb: Optional[str] = None
    bank_account_number: Optional[str] = None

    _clean_abn = field_validator("business_abn", mode="before")(_normalize_abn)
    _clean_bsb = field_validator("bank_bsb", mode="before")(_normalize_bsb)
    _clean_account = field_validator("bank_account_number", mode="before")(_normalize_account_number)
    _clean_text = field_validator(
        "business_director_name", "business_address", "bank_account_name", mode="before"
    )(_blank_to_none)


class ReferrerBusinessProfileOut(ReferrerBusinessProfile):
    """Read model — adds the identity fields and the uploaded branding assets."""

    id: str
    full_name: str
    email: str
    phone: Optional[str] = None
    organization_name: Optional[str] = None
    business_logo_filename: Optional[str] = None
    business_letterhead_filename: Optional[str] = None
    business_details_updated_at: Optional[datetime] = None
    # True once every field needed to raise a tax invoice is present.
    is_complete: bool = False

    model_config = {"from_attributes": True}


class ReferrerCreate(ReferrerBusinessProfile):
    email: EmailStr
    full_name: str
    phone: Optional[str] = None
    organization_name: Optional[str] = None

    _normalize_email = field_validator("email", mode="before")(normalize_email)

    @field_validator("full_name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name cannot be empty")
        return v.strip()


class ExternalReferralInvite(BaseModel):
    email: EmailStr
    full_name: Optional[str] = None
    client_engagement_model: Optional[ClientEngagementModel] = None

    _normalize_email = field_validator("email", mode="before")(normalize_email)


class ExternalReferralOut(BaseModel):
    id: str
    referrer_id: str
    referrer_name: Optional[str] = None
    referred_email: str
    referred_client_id: Optional[str] = None
    referred_client_name: Optional[str] = None
    status: str
    client_engagement_model: Optional[str] = None
    created_at: datetime
    converted_at: Optional[datetime] = None


class ExternalReferrerStats(BaseModel):
    total_referred: int
    signed_up: int
    applied: int
