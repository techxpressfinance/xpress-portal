from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator

from app.models.user import UserRole
from app.schemas.common import normalize_email
from app.services.loan_category import LOAN_CATEGORIES


def _validate_specialties(v):
    """Accept the stored comma-separated form or a list; emit a list of slugs."""
    if v is None:
        return []
    if isinstance(v, str):
        v = [part.strip() for part in v.split(",")]
    out: list[str] = []
    for slug in v:
        slug = (slug or "").strip()
        if not slug:
            continue
        if slug not in LOAN_CATEGORIES:
            raise ValueError(f"Invalid loan category: {slug}")
        if slug not in out:
            out.append(slug)
    return out


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

    _normalize_email = field_validator("email", mode="before")(normalize_email)

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

    _normalize_email = field_validator("email", mode="before")(normalize_email)


class UserOut(BaseModel):
    id: str
    email: str
    full_name: str
    phone: Optional[str]
    role: UserRole
    is_active: bool
    email_verified: bool
    auth_method: str = "password"
    employee_id: Optional[str] = None
    department: Optional[str] = None
    license_number: Optional[str] = None
    specialties: list[str] = []
    organization_name: Optional[str] = None
    tenant_id: Optional[str] = None
    invited_by_id: Optional[str] = None
    created_at: datetime

    _parse_specialties = field_validator("specialties", mode="before")(_validate_specialties)

    model_config = {"from_attributes": True}


class InvitedUserOut(UserOut):
    """Invite/create response — carries the setup link so the inviter can copy it.

    Only returned from the POST that issues the invite; the token is never
    exposed via GET endpoints.
    """

    invite_url: Optional[str] = None


class ResendVerificationRequest(BaseModel):
    email: EmailStr

    _normalize_email = field_validator("email", mode="before")(normalize_email)


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
    # Brokers/admins may set their own loan-category specialties.
    specialties: Optional[list[str]] = None

    _parse_specialties = field_validator("specialties", mode="before")(_validate_specialties)


class ReferrerAttach(BaseModel):
    """Staff request to credit a referrer for a client whose lead arrived outside the portal."""
    referrer_id: str


class ClientProfile(BaseModel):
    """Saved constant personal details a client reuses to autofill new applications."""
    applicant_title: Optional[str] = None
    applicant_first_name: Optional[str] = None
    applicant_middle_name: Optional[str] = None
    applicant_last_name: Optional[str] = None
    applicant_dob: Optional[str] = None
    applicant_gender: Optional[str] = None
    applicant_mobile: Optional[str] = None
    preferred_contact_method: Optional[str] = None
    id_type: Optional[str] = None
    id_number: Optional[str] = None
    id_issuing_state_country: Optional[str] = None
    id_expiry_date: Optional[str] = None
    residency_status: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_relationship: Optional[str] = None
    emergency_contact_phone: Optional[str] = None


class UserUpdate(BaseModel):
    """Admin/broker update of any user's profile fields."""
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None  # admin only — changes the user's login identity
    phone: Optional[str] = None
    employee_id: Optional[str] = None
    department: Optional[str] = None
    license_number: Optional[str] = None
    specialties: Optional[list[str]] = None
    organization_name: Optional[str] = None

    _parse_specialties = field_validator("specialties", mode="before")(_validate_specialties)
    _normalize_email = field_validator("email", mode="before")(normalize_email)


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

    _normalize_email = field_validator("email", mode="before")(normalize_email)

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
    specialties: list[str] = []

    _normalize_email = field_validator("email", mode="before")(normalize_email)
    _parse_specialties = field_validator("specialties", mode="before")(_validate_specialties)

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


class AdminCreate(BaseModel):
    email: EmailStr
    full_name: str
    phone: Optional[str] = None

    _normalize_email = field_validator("email", mode="before")(normalize_email)

    @field_validator("full_name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name cannot be empty")
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


class InvitationOut(BaseModel):
    id: str
    email: str
    full_name: str
    phone: Optional[str]
    is_active: bool
    auth_method: str
    setup_pending: bool = False
    setup_expired: bool = False
    created_at: datetime
    invited_by_name: Optional[str] = None
    # Copyable setup link — only while the invite is pending and unexpired
    invite_url: Optional[str] = None

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


class DeletedClientOut(BaseModel):
    id: str
    original_email: str
    original_name: str
    deleted_at: datetime
    application_count: int = 0

    model_config = {"from_attributes": True}


class SetupAccountRequest(BaseModel):
    token: str
    password: str

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password(v)
