from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class OrganizationOut(BaseModel):
    id: str
    name: str
    abn: str | None
    industry: str | None
    address: str | None
    notes: str | None
    role: str | None = None  # from ContactOrganization join
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ContactApplicationOut(BaseModel):
    """Minimal application info for contact's lending history."""
    id: str
    loan_type: str
    amount: float
    status: str
    business_name: str | None
    business_abn: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ContactOut(BaseModel):
    id: str
    first_name: str
    last_name: str
    middle_name: str | None
    email: str | None
    phone: str | None
    date_of_birth: str | None
    drivers_license_number: str | None
    address: str | None
    suburb: str | None
    state: str | None
    postcode: str | None
    notes: str | None
    application_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ContactDetailOut(ContactOut):
    """Full contact with organizations and lending history."""
    organizations: list[OrganizationOut] = []
    applications: list[ContactApplicationOut] = []


class ContactUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    middle_name: str | None = None
    email: str | None = None
    phone: str | None = None
    date_of_birth: str | None = None
    drivers_license_number: str | None = None
    address: str | None = None
    suburb: str | None = None
    state: str | None = None
    postcode: str | None = None
    notes: str | None = None


class ContactOrganizationLink(BaseModel):
    organization_id: str
    role: str | None = None


class PaginatedContacts(BaseModel):
    items: list[ContactOut]
    total: int
    page: int
    per_page: int
