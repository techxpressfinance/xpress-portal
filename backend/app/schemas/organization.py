from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.constants import ENTITY_TYPES, TRUST_PARTY_KINDS, TRUST_PARTY_ROLES, TRUST_TYPES


def _one_of(value: Optional[str], allowed: list[str], field: str) -> Optional[str]:
    if value is None:
        return None
    normalized = value.strip().lower()
    if not normalized:
        return None
    if normalized not in allowed:
        raise ValueError(f"{field} must be one of: {', '.join(allowed)}")
    return normalized


def _validate_entity_type(value: Optional[str]) -> Optional[str]:
    return _one_of(value, ENTITY_TYPES, "entity_type")


def _validate_trust_type(value: Optional[str]) -> Optional[str]:
    return _one_of(value, TRUST_TYPES, "trust_type")


def _validate_party_role(value: Optional[str]) -> Optional[str]:
    return _one_of(value, TRUST_PARTY_ROLES, "role")


def _validate_party_kind(value: Optional[str]) -> Optional[str]:
    return _one_of(value, TRUST_PARTY_KINDS, "party_kind")


class OrganizationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    entity_type: Optional[str] = Field(default=None, max_length=30)
    abn: Optional[str] = Field(default=None, max_length=20)
    acn: Optional[str] = Field(default=None, max_length=20)
    industry: Optional[str] = Field(default=None, max_length=200)
    address: Optional[str] = Field(default=None, max_length=500)
    notes: Optional[str] = None
    trust_type: Optional[str] = Field(default=None, max_length=30)
    # Broker's "no ABN — checked with the accountant" acknowledgement. Required
    # by the API when creating a trust without an ABN.
    no_abn_confirmed: bool = False

    _check_entity_type = field_validator("entity_type")(_validate_entity_type)
    _check_trust_type = field_validator("trust_type")(_validate_trust_type)


class OrganizationUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    entity_type: Optional[str] = Field(default=None, max_length=30)
    abn: Optional[str] = Field(default=None, max_length=20)
    acn: Optional[str] = Field(default=None, max_length=20)
    industry: Optional[str] = Field(default=None, max_length=200)
    address: Optional[str] = Field(default=None, max_length=500)
    notes: Optional[str] = None
    trust_type: Optional[str] = Field(default=None, max_length=30)
    no_abn_confirmed: Optional[bool] = None

    _check_entity_type = field_validator("entity_type")(_validate_entity_type)
    _check_trust_type = field_validator("trust_type")(_validate_trust_type)


class OrganizationOut(BaseModel):
    id: str
    name: str
    entity_type: Optional[str] = None
    abn: Optional[str]
    acn: Optional[str] = None
    industry: Optional[str]
    address: Optional[str]
    notes: Optional[str]
    trust_type: Optional[str] = None
    no_abn_confirmed: bool = False
    no_abn_confirmed_at: Optional[datetime] = None
    contact_count: int = 0
    application_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class EntitySearchResult(BaseModel):
    """A compact entity row for the "pick an existing entity" typeahead on the
    application forms. ``director_count`` is how many of the company's contacts
    would come across as parties if it were made the applicant."""

    id: str
    name: str
    entity_type: Optional[str] = None
    trust_type: Optional[str] = None
    abn: Optional[str] = None
    acn: Optional[str] = None
    industry: Optional[str] = None
    address: Optional[str] = None
    director_count: int = 0
    application_count: int = 0


class TrustPartyBase(BaseModel):
    role: str = Field(max_length=30)
    party_kind: str = Field(default="individual", max_length=20)
    contact_id: Optional[str] = None
    linked_organization_id: Optional[str] = None
    name: Optional[str] = Field(default=None, max_length=200)
    abn: Optional[str] = Field(default=None, max_length=20)
    ownership_percentage: Optional[Decimal] = Field(default=None, ge=0, le=100)
    notes: Optional[str] = None

    @field_validator("role")
    @classmethod
    def _check_role(cls, value: str) -> str:
        normalized = _validate_party_role(value)
        if not normalized:
            raise ValueError(f"role must be one of: {', '.join(TRUST_PARTY_ROLES)}")
        return normalized

    @field_validator("party_kind")
    @classmethod
    def _check_kind(cls, value: str) -> str:
        normalized = _validate_party_kind(value)
        if not normalized:
            raise ValueError(f"party_kind must be one of: {', '.join(TRUST_PARTY_KINDS)}")
        return normalized


class TrustPartyCreate(TrustPartyBase):
    pass


class TrustPartyUpdate(BaseModel):
    role: Optional[str] = Field(default=None, max_length=30)
    party_kind: Optional[str] = Field(default=None, max_length=20)
    contact_id: Optional[str] = None
    linked_organization_id: Optional[str] = None
    name: Optional[str] = Field(default=None, max_length=200)
    abn: Optional[str] = Field(default=None, max_length=20)
    ownership_percentage: Optional[Decimal] = Field(default=None, ge=0, le=100)
    notes: Optional[str] = None

    _check_role = field_validator("role")(_validate_party_role)
    _check_kind = field_validator("party_kind")(_validate_party_kind)


class TrustPartyOut(BaseModel):
    id: str
    organization_id: str
    role: str
    party_kind: str
    contact_id: Optional[str] = None
    linked_organization_id: Optional[str] = None
    # Resolved display name: the linked Contact/Organization's name, else `name`.
    display_name: str
    name: Optional[str] = None
    abn: Optional[str] = None
    # Derived, never stored: a corporate trustee's ACN, off its linked entity or
    # read from its ABN. Null for individual, partnership and class parties.
    acn: Optional[str] = None
    ownership_percentage: Optional[Decimal] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class OrganizationContactOut(BaseModel):
    id: str
    first_name: str
    last_name: str
    email: Optional[str]
    phone: Optional[str]
    role: Optional[str] = None


class OrganizationApplicationOut(BaseModel):
    id: str
    loan_type: str
    amount: float
    status: str
    created_at: datetime
    user_name: Optional[str] = None


class OrganizationDetailOut(OrganizationOut):
    contacts: list[OrganizationContactOut] = []
    applications: list[OrganizationApplicationOut] = []
    trust_parties: list[TrustPartyOut] = []


class OrganizationContactLink(BaseModel):
    contact_id: str
    role: Optional[str] = Field(default=None, max_length=100)


class OrganizationMergeRequest(BaseModel):
    primary_id: str
    duplicate_ids: list[str]


class OrganizationDuplicateCheck(BaseModel):
    """Partial form values to screen for existing duplicates before creating."""
    name: Optional[str] = None
    abn: Optional[str] = None
    address: Optional[str] = None


class PaginatedOrganizations(BaseModel):
    items: list[OrganizationOut]
    total: int
    page: int
    per_page: int
