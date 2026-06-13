from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, field_validator

from app.schemas.pagination import PaginatedResponse

SERVICE_REQUEST_TYPES = [
    "Status Update",
    "Document Update",
    "Callback Request",
    "Change of Details",
    "General Enquiry",
    "Complaint",
    "SOA",
    "Amortization Schedule",
    "Accountant Pack",
    "Payout Figure",
    "Change of Direct Debit Details",
    "Loan Details Sheet (PPSR)",
    "Other",
]

VALID_STATUSES = {"pending", "in_progress", "resolved", "closed"}


class AssignedBrokerOut(BaseModel):
    id: str
    full_name: str

    model_config = {"from_attributes": True}


class ServiceRequestNoteOut(BaseModel):
    id: str
    author_id: Optional[str] = None
    author_name: Optional[str] = None
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ServiceRequestNoteCreate(BaseModel):
    content: str

    @field_validator("content")
    @classmethod
    def validate_content(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Note cannot be empty")
        return v.strip()


class ServiceRequestCreate(BaseModel):
    request_type: str
    custom_request: Optional[str] = None
    description: Optional[str] = None
    client_id: Optional[str] = None
    assigned_broker_id: Optional[str] = None
    assigned_broker_ids: Optional[List[str]] = None

    @field_validator("request_type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Request type cannot be empty")
        return v.strip()

    @field_validator("custom_request")
    @classmethod
    def validate_custom(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            stripped = v.strip()
            return stripped if stripped else None
        return v


class ServiceRequestOrderUpdate(BaseModel):
    ordered_ids: List[str]


class ServiceRequestUpdate(BaseModel):
    status: Optional[str] = None
    assigned_broker_id: Optional[str] = None
    assigned_broker_ids: Optional[List[str]] = None
    client_id: Optional[str] = None
    request_type: Optional[str] = None
    custom_request: Optional[str] = None
    description: Optional[str] = None
    broker_notes: Optional[str] = None


class ServiceRequestOut(BaseModel):
    id: str
    request_type: str
    custom_request: Optional[str] = None
    description: Optional[str] = None
    status: str
    client_id: str
    client_name: Optional[str] = None
    client_email: Optional[str] = None
    assigned_broker_id: Optional[str] = None
    assigned_broker_name: Optional[str] = None
    assigned_brokers: List[AssignedBrokerOut] = []
    broker_notes: Optional[str] = None
    notes: List[ServiceRequestNoteOut] = []
    sort_position: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PaginatedServiceRequests(PaginatedResponse[ServiceRequestOut]):
    pass
