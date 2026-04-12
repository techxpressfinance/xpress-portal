from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field

from app.models.loan_application import AnalysisStatus, ApplicationStatus, LoanType


class LoanApplicationCreate(BaseModel):
    loan_type: LoanType
    amount: Decimal = Field(..., ge=0)
    notes: Optional[str] = None
    # Client-filled — Personal
    applicant_title: Optional[str] = None
    applicant_first_name: Optional[str] = None
    applicant_last_name: Optional[str] = None
    applicant_middle_name: Optional[str] = None
    applicant_dob: Optional[str] = None
    applicant_gender: Optional[str] = None
    applicant_marital_status: Optional[str] = None
    # Client-filled — Address
    applicant_address: Optional[str] = None
    applicant_suburb: Optional[str] = None
    applicant_state: Optional[str] = None
    applicant_postcode: Optional[str] = None
    # Client-filled — Business
    business_abn: Optional[str] = None
    business_name: Optional[str] = None
    business_registration_date: Optional[str] = None
    business_industry_id: Optional[int] = None
    business_monthly_sales: Optional[Decimal] = Field(None, ge=0)
    # Client-filled — Loan
    loan_purpose_id: Optional[int] = None
    loan_term_requested: Optional[int] = None
    # Overflow JSON
    lend_extra_data: Optional[str] = None


class LoanApplicationUpdate(BaseModel):
    loan_type: Optional[LoanType] = None
    amount: Optional[Decimal] = Field(None, ge=0)
    status: Optional[ApplicationStatus] = None
    notes: Optional[str] = None
    # Client-filled — Personal
    applicant_title: Optional[str] = None
    applicant_first_name: Optional[str] = None
    applicant_last_name: Optional[str] = None
    applicant_middle_name: Optional[str] = None
    applicant_dob: Optional[str] = None
    applicant_gender: Optional[str] = None
    applicant_marital_status: Optional[str] = None
    # Client-filled — Address
    applicant_address: Optional[str] = None
    applicant_suburb: Optional[str] = None
    applicant_state: Optional[str] = None
    applicant_postcode: Optional[str] = None
    # Client-filled — Business
    business_abn: Optional[str] = None
    business_name: Optional[str] = None
    business_registration_date: Optional[str] = None
    business_industry_id: Optional[int] = None
    business_monthly_sales: Optional[Decimal] = Field(None, ge=0)
    # Client-filled — Loan
    loan_purpose_id: Optional[int] = None
    loan_term_requested: Optional[int] = None
    # Overflow JSON
    lend_extra_data: Optional[str] = None
    # Broker-filled — Lend controls
    lend_product_type_id: Optional[int] = None
    lend_owner_type: Optional[str] = None
    lend_send_type: Optional[str] = None
    lend_who_to_contact: Optional[str] = None


class AssignedBroker(BaseModel):
    id: str
    full_name: str

    model_config = {"from_attributes": True}


class LoanApplicationOut(BaseModel):
    id: str
    user_id: str
    user_name: Optional[str] = None
    user_email: Optional[str] = None
    loan_type: LoanType
    amount: Decimal = Field(..., ge=0)
    status: ApplicationStatus
    assigned_broker_id: Optional[str] = None
    assigned_broker_name: Optional[str] = None
    assigned_brokers: list[AssignedBroker] = []
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime
    analysis_status: Optional[AnalysisStatus] = None
    analysis_result: Optional[str] = None
    analysis_error: Optional[str] = None
    analyzed_at: Optional[datetime] = None
    completed_by_id: Optional[str] = None
    completed_by_name: Optional[str] = None
    completed_at: Optional[datetime] = None
    # Client-filled — Personal
    applicant_title: Optional[str] = None
    applicant_first_name: Optional[str] = None
    applicant_last_name: Optional[str] = None
    applicant_middle_name: Optional[str] = None
    applicant_dob: Optional[str] = None
    applicant_gender: Optional[str] = None
    applicant_marital_status: Optional[str] = None
    # Client-filled — Address
    applicant_address: Optional[str] = None
    applicant_suburb: Optional[str] = None
    applicant_state: Optional[str] = None
    applicant_postcode: Optional[str] = None
    # Client-filled — Business
    business_abn: Optional[str] = None
    business_name: Optional[str] = None
    business_registration_date: Optional[str] = None
    business_industry_id: Optional[int] = None
    business_monthly_sales: Optional[Decimal] = Field(None, ge=0)
    # Client-filled — Loan
    loan_purpose_id: Optional[int] = None
    loan_term_requested: Optional[int] = None
    # Overflow JSON
    lend_extra_data: Optional[str] = None
    # Broker-filled — Lend controls
    lend_product_type_id: Optional[int] = None
    lend_owner_type: Optional[str] = None
    lend_send_type: Optional[str] = None
    lend_who_to_contact: Optional[str] = None
    # Lend sync tracking
    lend_ref: Optional[str] = None
    lend_sync_status: Optional[str] = None
    lend_sync_error: Optional[str] = None
    lend_synced_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


from app.schemas.pagination import PaginatedResponse


class PaginatedApplications(PaginatedResponse[LoanApplicationOut]):
    pass
