from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.models.loan_application import AnalysisStatus, ApplicationStatus, LoanType


class LoanApplicationCreate(BaseModel):
    loan_type: LoanType
    amount: Decimal = Field(..., ge=0)
    notes: str | None = None
    # Client-filled — Personal
    applicant_title: str | None = None
    applicant_first_name: str | None = None
    applicant_last_name: str | None = None
    applicant_middle_name: str | None = None
    applicant_dob: str | None = None
    applicant_gender: str | None = None
    applicant_marital_status: str | None = None
    # Client-filled — Address
    applicant_address: str | None = None
    applicant_suburb: str | None = None
    applicant_state: str | None = None
    applicant_postcode: str | None = None
    # Client-filled — Business
    business_abn: str | None = None
    business_name: str | None = None
    business_registration_date: str | None = None
    business_industry_id: int | None = None
    business_monthly_sales: Decimal | None = Field(None, ge=0)
    # Client-filled — Loan
    loan_purpose_id: int | None = None
    loan_term_requested: int | None = None
    # Overflow JSON
    lend_extra_data: str | None = None


class LoanApplicationUpdate(BaseModel):
    loan_type: LoanType | None = None
    amount: Decimal | None = Field(None, ge=0)
    status: ApplicationStatus | None = None
    notes: str | None = None
    # Client-filled — Personal
    applicant_title: str | None = None
    applicant_first_name: str | None = None
    applicant_last_name: str | None = None
    applicant_middle_name: str | None = None
    applicant_dob: str | None = None
    applicant_gender: str | None = None
    applicant_marital_status: str | None = None
    # Client-filled — Address
    applicant_address: str | None = None
    applicant_suburb: str | None = None
    applicant_state: str | None = None
    applicant_postcode: str | None = None
    # Client-filled — Business
    business_abn: str | None = None
    business_name: str | None = None
    business_registration_date: str | None = None
    business_industry_id: int | None = None
    business_monthly_sales: Decimal | None = Field(None, ge=0)
    # Client-filled — Loan
    loan_purpose_id: int | None = None
    loan_term_requested: int | None = None
    # Overflow JSON
    lend_extra_data: str | None = None
    # Broker-filled — Lend controls
    lend_product_type_id: int | None = None
    lend_owner_type: str | None = None
    lend_send_type: str | None = None
    lend_who_to_contact: str | None = None


class AssignedBroker(BaseModel):
    id: str
    full_name: str

    model_config = {"from_attributes": True}


class LoanApplicationOut(BaseModel):
    id: str
    user_id: str
    user_name: str | None = None
    user_email: str | None = None
    loan_type: LoanType
    amount: Decimal = Field(..., ge=0)
    status: ApplicationStatus
    assigned_broker_id: str | None = None
    assigned_broker_name: str | None = None
    assigned_brokers: list[AssignedBroker] = []
    notes: str | None
    created_at: datetime
    updated_at: datetime
    analysis_status: AnalysisStatus | None = None
    analysis_result: str | None = None
    analysis_error: str | None = None
    analyzed_at: datetime | None = None
    completed_by_id: str | None = None
    completed_by_name: str | None = None
    completed_at: datetime | None = None
    # Client-filled — Personal
    applicant_title: str | None = None
    applicant_first_name: str | None = None
    applicant_last_name: str | None = None
    applicant_middle_name: str | None = None
    applicant_dob: str | None = None
    applicant_gender: str | None = None
    applicant_marital_status: str | None = None
    # Client-filled — Address
    applicant_address: str | None = None
    applicant_suburb: str | None = None
    applicant_state: str | None = None
    applicant_postcode: str | None = None
    # Client-filled — Business
    business_abn: str | None = None
    business_name: str | None = None
    business_registration_date: str | None = None
    business_industry_id: int | None = None
    business_monthly_sales: Decimal | None = Field(None, ge=0)
    # Client-filled — Loan
    loan_purpose_id: int | None = None
    loan_term_requested: int | None = None
    # Overflow JSON
    lend_extra_data: str | None = None
    # Broker-filled — Lend controls
    lend_product_type_id: int | None = None
    lend_owner_type: str | None = None
    lend_send_type: str | None = None
    lend_who_to_contact: str | None = None
    # Lend sync tracking
    lend_ref: str | None = None
    lend_sync_status: str | None = None
    lend_sync_error: str | None = None
    lend_synced_at: datetime | None = None

    model_config = {"from_attributes": True}


from app.schemas.pagination import PaginatedResponse


class PaginatedApplications(PaginatedResponse[LoanApplicationOut]):
    pass
