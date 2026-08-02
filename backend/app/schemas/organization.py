from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.constants import ENTITY_TYPES


def _validate_entity_type(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = value.strip().lower()
    if not normalized:
        return None
    if normalized not in ENTITY_TYPES:
        raise ValueError(f"entity_type must be one of: {', '.join(ENTITY_TYPES)}")
    return normalized


class OrganizationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    entity_type: Optional[str] = Field(default=None, max_length=30)
    abn: Optional[str] = Field(default=None, max_length=20)
    industry: Optional[str] = Field(default=None, max_length=200)
    address: Optional[str] = Field(default=None, max_length=500)
    notes: Optional[str] = None

    _check_entity_type = field_validator("entity_type")(_validate_entity_type)


class OrganizationUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    entity_type: Optional[str] = Field(default=None, max_length=30)
    abn: Optional[str] = Field(default=None, max_length=20)
    industry: Optional[str] = Field(default=None, max_length=200)
    address: Optional[str] = Field(default=None, max_length=500)
    notes: Optional[str] = None

    _check_entity_type = field_validator("entity_type")(_validate_entity_type)


class OrganizationOut(BaseModel):
    id: str
    name: str
    entity_type: Optional[str] = None
    abn: Optional[str]
    industry: Optional[str]
    address: Optional[str]
    notes: Optional[str]
    contact_count: int = 0
    application_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


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
