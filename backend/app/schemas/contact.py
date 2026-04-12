from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class OrganizationOut(BaseModel):
    id: str
    name: str
    abn: Optional[str]
    industry: Optional[str]
    address: Optional[str]
    notes: Optional[str]
    role: Optional[str] = None  # from ContactOrganization join
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ContactApplicationOut(BaseModel):
    """Minimal application info for contact's lending history."""
    id: str
    loan_type: str
    amount: float
    status: str
    business_name: Optional[str]
    business_abn: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ContactOut(BaseModel):
    id: str
    first_name: str
    last_name: str
    middle_name: Optional[str]
    email: Optional[str]
    phone: Optional[str]
    date_of_birth: Optional[str]
    drivers_license_number: Optional[str]
    address: Optional[str]
    suburb: Optional[str]
    state: Optional[str]
    postcode: Optional[str]
    notes: Optional[str]
    application_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ContactDetailOut(ContactOut):
    """Full contact with organizations and lending history."""
    organizations: list[OrganizationOut] = []
    applications: list[ContactApplicationOut] = []


class ContactUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    middle_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    date_of_birth: Optional[str] = None
    drivers_license_number: Optional[str] = None
    address: Optional[str] = None
    suburb: Optional[str] = None
    state: Optional[str] = None
    postcode: Optional[str] = None
    notes: Optional[str] = None


class ContactOrganizationLink(BaseModel):
    organization_id: str
    role: Optional[str] = None


class PaginatedContacts(BaseModel):
    items: list[ContactOut]
    total: int
    page: int
    per_page: int
