from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator

from app.models.user import KYCStatus, UserRole


def _validate_password(v: str) -> str:
    if len(v) < 8:
        raise ValueError("Password must be at least 8 characters")
    if not any(c.isupper() for c in v):
        raise ValueError("Password must contain at least one uppercase letter")
    if not any(c.isdigit() for c in v):
        raise ValueError("Password must contain at least one digit")
    return v


class UserRegister(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    phone: Optional[str] = None

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password(v)

    @field_validator("full_name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name cannot be empty")
        return v.strip()


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    full_name: str
    phone: Optional[str]
    role: UserRole
    kyc_status: KYCStatus
    is_active: bool
    email_verified: bool
    auth_method: str = "password"
    employee_id: Optional[str] = None
    department: Optional[str] = None
    license_number: Optional[str] = None
    organization_name: Optional[str] = None
    tenant_id: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ResendVerificationRequest(BaseModel):
    email: EmailStr


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class AccessTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None


class KYCStatusUpdate(BaseModel):
    kyc_status: KYCStatus


class UserRoleUpdate(BaseModel):
    role: UserRole


class UserActiveUpdate(BaseModel):
    is_active: bool


class RefreshRequest(BaseModel):
    refresh_token: str


class InvitationCreate(BaseModel):
    email: EmailStr
    full_name: str
    phone: Optional[str] = None

    @field_validator("full_name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name cannot be empty")
        return v.strip()


class BrokerCreate(BaseModel):
    email: EmailStr
    full_name: str
    phone: Optional[str] = None
    employee_id: str
    department: Optional[str] = None
    license_number: Optional[str] = None

    @field_validator("full_name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name cannot be empty")
        return v.strip()

    @field_validator("employee_id")
    @classmethod
    def employee_id_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Employee ID cannot be empty")
        return v.strip()


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password(v)


class LogoutRequest(BaseModel):
    refresh_token: str


class CodeRequest(BaseModel):
    email: EmailStr


class CodeVerify(BaseModel):
    email: EmailStr
    code: str


class InvitationOut(BaseModel):
    id: str
    email: str
    full_name: str
    phone: Optional[str]
    is_active: bool
    auth_method: str
    created_at: datetime
    invited_by_name: Optional[str] = None

    model_config = {"from_attributes": True}


from app.schemas.pagination import PaginatedResponse


class PaginatedInvitations(PaginatedResponse[InvitationOut]):
    pass


class InviteToCompleteCreate(BaseModel):
    application_id: str


class StartApplicationForClient(BaseModel):
    client_id: str
    loan_type: str
    amount: float
    notes: Optional[str] = None
