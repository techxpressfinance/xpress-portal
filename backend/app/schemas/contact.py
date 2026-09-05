from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field

from app.models.loan_application import LoanType
from app.schemas.lending_history import LendingHistoryEntryOut


class OrganizationOut(BaseModel):
    id: str
    name: str
    entity_type: Optional[str] = None
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


class ContactOrganizationLite(BaseModel):
    """Just enough of a linked company to tell two same-named clients apart in
    a picker — the full company comes from OrganizationOut on the detail view."""
    id: str
    name: str
    abn: Optional[str] = None
    role: Optional[str] = None


class ContactClientAccount(BaseModel):
    """A portal user already registered to a contact's email address."""

    id: str
    full_name: Optional[str] = None
    role: str


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
    # Only populated when the list is asked for it (?include_organizations=1);
    # ContactDetailOut overrides this with the full OrganizationOut rows.
    organizations: list[ContactOrganizationLite] = []
    # The portal account already registered to this contact's email, when the
    # list is asked for it (?include_client_account=1). None means choosing this
    # person as the client would create a new account.
    client_account: Optional[ContactClientAccount] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ContactDetailOut(ContactOut):
    """Full contact with organizations, portal applications, and manual lending history."""
    organizations: list[OrganizationOut] = []
    applications: list[ContactApplicationOut] = []
    lending_history: list[LendingHistoryEntryOut] = []


class ContactCreate(BaseModel):
    first_name: str
    last_name: str
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


class ContactPipelineCreate(BaseModel):
    """Quick-add of a contact to the pipeline as a draft application card."""

    loan_type: LoanType
    amount: Decimal = Field(..., ge=0)
    # Form sub-type (car, refinance, new_fit_out, …) with its display label —
    # stored in lend_extra_data so the card resolves to the right loan category.
    sub_type: Optional[str] = None
    sub_type_label: Optional[str] = None
    notes: Optional[str] = None
    # Placement. Omit both to use the tenant's default board and its first column.
    board_id: Optional[str] = None
    column_id: Optional[str] = None


class ContactOrganizationLink(BaseModel):
    organization_id: str
    role: Optional[str] = None


class ContactMergeRequest(BaseModel):
    primary_id: str
    duplicate_ids: list[str]


class ContactDuplicateCheck(BaseModel):
    """Partial form values to screen for existing duplicates before creating."""
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    date_of_birth: Optional[str] = None
    drivers_license_number: Optional[str] = None
    address: Optional[str] = None
    suburb: Optional[str] = None
    state: Optional[str] = None
    postcode: Optional[str] = None


class PaginatedContacts(BaseModel):
    items: list[ContactOut]
    total: int
    page: int
    per_page: int
