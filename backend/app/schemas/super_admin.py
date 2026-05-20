from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator

from app.schemas.common import normalize_email


class SuperAdminLogin(BaseModel):
    email: EmailStr
    password: str

    _normalize_email = field_validator("email", mode="before")(normalize_email)


class TenantUpdate(BaseModel):
    name: Optional[str] = None
    logo_url: Optional[str] = None
    primary_color: Optional[str] = None
    support_email: Optional[str] = None
    is_active: Optional[bool] = None
