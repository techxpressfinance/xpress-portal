from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, EmailStr


class SuperAdminLogin(BaseModel):
    email: EmailStr
    password: str


class TenantUpdate(BaseModel):
    name: Optional[str] = None
    logo_url: Optional[str] = None
    primary_color: Optional[str] = None
    support_email: Optional[str] = None
    is_active: Optional[bool] = None
