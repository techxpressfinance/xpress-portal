from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator

from app.schemas.common import normalize_email


_SLUG_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$")
_RESERVED_SLUGS = {"www", "api", "admin", "default", "app", "mail", "ftp", "static", "assets"}


class TenantSignup(BaseModel):
    tenant_name: str
    slug: str
    admin_email: EmailStr
    admin_password: str
    admin_full_name: str
    admin_phone: Optional[str] = None

    _normalize_email = field_validator("admin_email", mode="before")(normalize_email)

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: str) -> str:
        v = v.lower().strip()
        if not _SLUG_PATTERN.match(v):
            raise ValueError("Slug must be 3-50 chars, lowercase alphanumeric and hyphens only")
        if v in _RESERVED_SLUGS:
            raise ValueError(f"'{v}' is a reserved name")
        return v

    @field_validator("admin_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        if not any(c.isupper() for c in v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain at least one digit")
        return v

    @field_validator("tenant_name", "admin_full_name")
    @classmethod
    def not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Cannot be empty")
        return v.strip()


class TenantBranding(BaseModel):
    id: str
    name: str
    slug: str
    logo_url: Optional[str] = None
    primary_color: Optional[str] = None
    support_email: Optional[str] = None

    model_config = {"from_attributes": True}


class TenantOut(BaseModel):
    id: str
    name: str
    slug: str
    logo_url: Optional[str] = None
    primary_color: Optional[str] = None
    support_email: Optional[str] = None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
