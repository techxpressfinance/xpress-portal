from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, field_validator, model_validator

from app.schemas.pagination import PaginatedResponse
from app.services.arrears import ARREARS_FILE_TYPES, REPAYMENT_FREQUENCIES


class ArrearsAttachmentOut(BaseModel):
    id: str
    kind: str
    original_filename: str
    email_from: Optional[str] = None
    email_to: Optional[str] = None
    email_subject: Optional[str] = None
    email_body: Optional[str] = None
    email_sent_at: Optional[datetime] = None
    uploaded_by_name: Optional[str] = None
    uploaded_at: datetime

    model_config = {"from_attributes": True}


class ArrearsEventOut(BaseModel):
    id: str
    event_type: str
    detail: Optional[str] = None
    created_by_name: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ArrearsNoteCreate(BaseModel):
    detail: str

    @field_validator("detail")
    @classmethod
    def validate_detail(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Note cannot be empty")
        return v.strip()[:5000]


class ArrearsRecordBase(BaseModel):
    contact_id: Optional[str] = None
    organization_id: Optional[str] = None
    application_id: Optional[str] = None
    lender_id: Optional[str] = None
    lender_name: str
    contract_number: Optional[str] = None
    asset_details: Optional[str] = None
    file_type: str
    repayment_amount: Optional[Decimal] = None
    repayment_frequency: Optional[str] = None
    arrears_amount: Optional[Decimal] = None
    in_arrears_since: date
    notes: Optional[str] = None

    @field_validator("lender_name")
    @classmethod
    def validate_lender_name(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Lender name is required")
        return v.strip()

    @field_validator("file_type")
    @classmethod
    def validate_file_type(cls, v: str) -> str:
        if v not in ARREARS_FILE_TYPES:
            raise ValueError(f"file_type must be one of: {', '.join(ARREARS_FILE_TYPES)}")
        return v

    @field_validator("repayment_frequency")
    @classmethod
    def validate_frequency(cls, v: Optional[str]) -> Optional[str]:
        if v and v not in REPAYMENT_FREQUENCIES:
            raise ValueError(f"repayment_frequency must be one of: {', '.join(REPAYMENT_FREQUENCIES)}")
        return v

    @field_validator("in_arrears_since")
    @classmethod
    def validate_since(cls, v: date) -> date:
        if v > date.today():
            raise ValueError("'In arrears since' cannot be in the future")
        return v


class ArrearsRecordCreate(ArrearsRecordBase):
    @model_validator(mode="after")
    def require_party(self) -> "ArrearsRecordCreate":
        # Every record must hang off a real contact and/or company so it maps
        # onto their detail pages — free-text party names are not accepted.
        if not self.contact_id and not self.organization_id:
            raise ValueError("Select a client, a company, or both")
        return self


class ArrearsRecordUpdate(BaseModel):
    """Partial update. Resolved / proof / delinquent flags are set here too;
    the router stamps the matching *_at / *_by_id columns and logs an event."""

    contact_id: Optional[str] = None
    organization_id: Optional[str] = None
    application_id: Optional[str] = None
    lender_id: Optional[str] = None
    lender_name: Optional[str] = None
    contract_number: Optional[str] = None
    asset_details: Optional[str] = None
    file_type: Optional[str] = None
    repayment_amount: Optional[Decimal] = None
    repayment_frequency: Optional[str] = None
    arrears_amount: Optional[Decimal] = None
    in_arrears_since: Optional[date] = None
    notes: Optional[str] = None
    resolved: Optional[bool] = None
    proof_of_payment_received: Optional[bool] = None
    delinquent: Optional[bool] = None
    delinquent_reason: Optional[str] = None

    @field_validator("file_type")
    @classmethod
    def validate_file_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ARREARS_FILE_TYPES:
            raise ValueError(f"file_type must be one of: {', '.join(ARREARS_FILE_TYPES)}")
        return v

    @field_validator("repayment_frequency")
    @classmethod
    def validate_frequency(cls, v: Optional[str]) -> Optional[str]:
        if v and v not in REPAYMENT_FREQUENCIES:
            raise ValueError(f"repayment_frequency must be one of: {', '.join(REPAYMENT_FREQUENCIES)}")
        return v

    @field_validator("lender_name")
    @classmethod
    def validate_lender_name(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("Lender name is required")
        return v.strip() if v else v

    @field_validator("in_arrears_since")
    @classmethod
    def validate_since(cls, v: Optional[date]) -> Optional[date]:
        if v and v > date.today():
            raise ValueError("'In arrears since' cannot be in the future")
        return v


class ArrearsRecordOut(BaseModel):
    id: str
    contact_id: Optional[str] = None
    contact_name: Optional[str] = None
    organization_id: Optional[str] = None
    organization_name: Optional[str] = None
    application_id: Optional[str] = None
    lender_id: Optional[str] = None
    lender_name: str
    contract_number: Optional[str] = None
    asset_details: Optional[str] = None
    file_type: str
    repayment_amount: Optional[Decimal] = None
    repayment_frequency: Optional[str] = None
    arrears_amount: Optional[Decimal] = None
    in_arrears_since: date
    # Derived on read — never stored on the live row (see services/arrears.py).
    days_in_arrears: int
    bucket: str
    resolved: bool
    resolved_at: Optional[datetime] = None
    proof_of_payment_received: bool
    proof_received_at: Optional[datetime] = None
    delinquent: bool
    delinquent_at: Optional[datetime] = None
    delinquent_reason: Optional[str] = None
    notes: Optional[str] = None
    attachment_count: int = 0
    email_count: int = 0
    created_by_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ArrearsRecordDetailOut(ArrearsRecordOut):
    attachments: List[ArrearsAttachmentOut] = []
    events: List[ArrearsEventOut] = []


class PaginatedArrears(PaginatedResponse[ArrearsRecordOut]):
    pass


class ArrearsBucketCount(BaseModel):
    bucket: str
    count: int
    total_arrears: Decimal
    total_repayment: Decimal


class ArrearsMonthSummary(BaseModel):
    month: date
    count: int
    total_arrears: Decimal
    buckets: List[ArrearsBucketCount]


class ArrearsSummaryOut(BaseModel):
    """Powers the bucket strip and the monthly chart above the table."""

    as_of: date
    total_count: int
    total_arrears: Decimal
    resolved_count: int
    unresolved_count: int
    buckets: List[ArrearsBucketCount]
    months: List[ArrearsMonthSummary]
