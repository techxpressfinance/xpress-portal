from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, Field

from app.models.loan_application import AnalysisStatus, ApplicationStatus, LoanType


class LoanApplicationCreate(BaseModel):
    loan_type: LoanType
    amount: Decimal = Field(..., ge=0)
    notes: Optional[str] = None
    # Who is borrowing. "company" leaves the applicant_* block empty by design —
    # the borrowing entity is the applicant and its directors are the parties.
    applicant_type: Literal["individual", "company"] = "individual"
    # An existing CRM contact chosen as the client, rather than a new one being
    # minted from whatever was typed. See POST /applications/{id}/client.
    contact_id: Optional[str] = None
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
    # An entity picked out of the book rather than matched by ABN. The ABN match
    # is only a guess: an ABN-less entity whose name is punctuated differently
    # would be matched into a second stub instead of the one that was chosen.
    business_organization_id: Optional[str] = None
    business_registration_date: Optional[str] = None
    business_industry_id: Optional[int] = None
    business_monthly_sales: Optional[Decimal] = Field(None, ge=0)
    # Client-filled — Loan
    loan_purpose_id: Optional[int] = None
    loan_term_requested: Optional[int] = None
    # Overflow JSON
    lend_extra_data: Optional[str] = None
    # Extended fields
    applicant_email: Optional[str] = None
    applicant_mobile: Optional[str] = None
    preferred_contact_method: Optional[str] = None
    id_expiry_date: Optional[str] = None
    applicant_residency_status: Optional[str] = None
    applicant_visa_number: Optional[str] = None
    applicant_visa_category: Optional[str] = None
    residential_status: Optional[str] = None
    time_at_address: Optional[str] = None
    applicant_num_dependants: Optional[int] = None
    has_partner: Optional[bool] = None
    partner_working: Optional[bool] = None
    employment_category: Optional[str] = None
    employer_name: Optional[str] = None
    employer_industry: Optional[str] = None
    job_title: Optional[str] = None
    income_frequency: Optional[str] = None
    gross_income: Optional[Decimal] = Field(None, ge=0)
    trading_name: Optional[str] = None
    business_structure: Optional[str] = None
    gst_registered: Optional[bool] = None
    num_directors: Optional[int] = None
    time_trading: Optional[str] = None
    previously_declined: Optional[bool] = None
    change_of_circumstances: Optional[bool] = None
    signature_name: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_relationship: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    client_engagement_model: Optional[str] = None


class LoanApplicationUpdate(BaseModel):
    loan_type: Optional[LoanType] = None
    amount: Optional[Decimal] = Field(None, ge=0)
    status: Optional[ApplicationStatus] = None
    notes: Optional[str] = None
    applicant_type: Optional[Literal["individual", "company"]] = None
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
    # Extended fields
    applicant_email: Optional[str] = None
    applicant_mobile: Optional[str] = None
    preferred_contact_method: Optional[str] = None
    id_expiry_date: Optional[str] = None
    applicant_residency_status: Optional[str] = None
    applicant_visa_number: Optional[str] = None
    applicant_visa_category: Optional[str] = None
    residential_status: Optional[str] = None
    time_at_address: Optional[str] = None
    applicant_num_dependants: Optional[int] = None
    has_partner: Optional[bool] = None
    partner_working: Optional[bool] = None
    employment_category: Optional[str] = None
    employer_name: Optional[str] = None
    employer_industry: Optional[str] = None
    job_title: Optional[str] = None
    income_frequency: Optional[str] = None
    gross_income: Optional[Decimal] = Field(None, ge=0)
    trading_name: Optional[str] = None
    business_structure: Optional[str] = None
    gst_registered: Optional[bool] = None
    num_directors: Optional[int] = None
    time_trading: Optional[str] = None
    previously_declined: Optional[bool] = None
    change_of_circumstances: Optional[bool] = None
    signature_name: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_relationship: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    client_engagement_model: Optional[str] = None


class AssignedBroker(BaseModel):
    id: str
    full_name: str

    model_config = {"from_attributes": True}


class LoanApplicantBase(BaseModel):
    role: Optional[str] = "director"
    applicant_title: Optional[str] = None
    applicant_first_name: Optional[str] = None
    applicant_last_name: Optional[str] = None
    applicant_middle_name: Optional[str] = None
    applicant_dob: Optional[str] = None
    applicant_gender: Optional[str] = None
    applicant_marital_status: Optional[str] = None
    applicant_email: Optional[str] = None
    applicant_mobile: Optional[str] = None
    applicant_address: Optional[str] = None
    applicant_suburb: Optional[str] = None
    applicant_state: Optional[str] = None
    applicant_postcode: Optional[str] = None
    id_expiry_date: Optional[str] = None
    applicant_residency_status: Optional[str] = None
    applicant_visa_number: Optional[str] = None
    applicant_visa_category: Optional[str] = None
    employment_category: Optional[str] = None
    employer_name: Optional[str] = None
    employer_industry: Optional[str] = None
    job_title: Optional[str] = None
    income_frequency: Optional[str] = None
    gross_income: Optional[Decimal] = Field(None, ge=0)
    lend_extra_data: Optional[str] = None
    previously_declined: Optional[bool] = None
    change_of_circumstances: Optional[bool] = None
    signature_name: Optional[str] = None


class LoanApplicantCreate(LoanApplicantBase):
    """Broker adds a director, optionally sending them an invite to self-complete."""

    invite_email: Optional[str] = None


class LoanApplicantOut(LoanApplicantBase):
    id: str
    application_id: str
    contact_id: Optional[str] = None
    is_primary: bool = False
    signed_at: Optional[datetime] = None
    invite_email: Optional[str] = None
    invite_sent_at: Optional[datetime] = None
    # Set only on the POST response that issues the invite — None on GETs
    invite_url: Optional[str] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CompanyDirectorCandidate(BaseModel):
    """A contact linked to a company in the contact book, offered for adding to
    an application as a party. ``already_added`` marks the ones on it already."""

    contact_id: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    link_role: Optional[str] = None
    already_added: bool = False


class AddCompanyDirectorsRequest(BaseModel):
    """Pull selected contacts of the borrowing/guarantor company onto the
    application as parties. Those with an email are invited straight away."""

    contact_ids: list[str] = Field(..., min_length=1)
    role: str = "director"
    guarantor_id: Optional[str] = None


class PartyInviteRequest(BaseModel):
    """Set (or correct) a party's email and send them their invite."""

    invite_email: str


class CorporateGuarantorCreate(BaseModel):
    """Attach a company as a guarantor (identified by name and/or ABN)."""

    business_name: Optional[str] = None
    business_abn: Optional[str] = None


class CorporateGuarantorOut(BaseModel):
    id: str
    organization_id: str
    organization_name: Optional[str] = None
    organization_abn: Optional[str] = None
    signatories: list[LoanApplicantOut] = []
    ready: bool = False

    model_config = {"from_attributes": True}


class ReferrerInfoOut(BaseModel):
    id: str
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    organization_name: Optional[str] = None

    model_config = {"from_attributes": True}


class ApprovalConditionOut(BaseModel):
    id: str
    text: str
    is_completed: bool
    sort_order: int
    completed_at: Optional[datetime] = None
    completed_by_id: Optional[str] = None
    completed_by_name: Optional[str] = None

    model_config = {"from_attributes": True}


class ApprovalConditionCreate(BaseModel):
    """One or more conditions to add to an application's approval checklist.
    Conditions it already carries are skipped rather than duplicated."""

    conditions: list[str]


class ApprovalConditionUpdate(BaseModel):
    text: str


class ApprovalDetailsRequest(BaseModel):
    """Lender name + conditions checklist required to move an application into
    the Approval status — see change_application_status()."""

    lender_name: str
    conditions: list[str]


class PendingBusinessLink(BaseModel):
    """An unconfirmed client↔business pairing, for the broker's confirmation."""

    contact_id: str
    contact_name: Optional[str] = None
    organization_id: str
    organization_name: str
    organization_abn: Optional[str] = None


class LoanApplicationOut(BaseModel):
    id: str
    user_id: str
    user_name: Optional[str] = None
    user_email: Optional[str] = None
    user_role: Optional[str] = None
    loan_type: LoanType
    amount: Decimal = Field(..., ge=0)
    status: ApplicationStatus
    assigned_broker_id: Optional[str] = None
    assigned_broker_name: Optional[str] = None
    assigned_brokers: list[AssignedBroker] = []
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime
    deleted_at: Optional[datetime] = None
    analysis_status: Optional[AnalysisStatus] = None
    analysis_result: Optional[str] = None
    analysis_error: Optional[str] = None
    analyzed_at: Optional[datetime] = None
    completed_by_id: Optional[str] = None
    completed_by_name: Optional[str] = None
    completed_at: Optional[datetime] = None
    applicant_type: str = "individual"
    # CRM linkage. Undeclared until now, so the response model dropped them and
    # every consumer ("View entity & trust structure", the directors picker) was
    # silently reading undefined.
    business_organization_id: Optional[str] = None
    contact_id: Optional[str] = None
    business_link_declined: bool = False
    # The client↔business link this application implies that nobody has confirmed
    # yet. Present only on detail responses; None once linked or declined.
    pending_business_link: Optional[PendingBusinessLink] = None
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
    lend_ref: Optional[str] = None
    # Extended fields
    applicant_email: Optional[str] = None
    applicant_mobile: Optional[str] = None
    preferred_contact_method: Optional[str] = None
    id_expiry_date: Optional[str] = None
    applicant_residency_status: Optional[str] = None
    applicant_visa_number: Optional[str] = None
    applicant_visa_category: Optional[str] = None
    residential_status: Optional[str] = None
    time_at_address: Optional[str] = None
    applicant_num_dependants: Optional[int] = None
    has_partner: Optional[bool] = None
    partner_working: Optional[bool] = None
    employment_category: Optional[str] = None
    employer_name: Optional[str] = None
    employer_industry: Optional[str] = None
    job_title: Optional[str] = None
    income_frequency: Optional[str] = None
    gross_income: Optional[Decimal] = None
    trading_name: Optional[str] = None
    business_structure: Optional[str] = None
    gst_registered: Optional[bool] = None
    num_directors: Optional[int] = None
    time_trading: Optional[str] = None
    previously_declined: Optional[bool] = None
    change_of_circumstances: Optional[bool] = None
    signature_name: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_relationship: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    client_engagement_model: Optional[str] = None
    cloned_from_id: Optional[str] = None
    referrer: Optional[ReferrerInfoOut] = None
    additional_applicants: list[LoanApplicantOut] = []
    corporate_guarantors: list[CorporateGuarantorOut] = []
    parties_ready: bool = False
    needs_reconciliation: bool = False
    reconciliation_note: Optional[str] = None
    hidden_from_client: bool = False
    is_locked: bool = False
    client_sections: Optional[str] = None
    client_account_pending: bool = False
    client_invite_sent_at: Optional[datetime] = None
    # Set only on the POST response that issues a direct-engagement invite
    invite_url: Optional[str] = None
    approval_lender_name: Optional[str] = None
    approval_conditions: list[ApprovalConditionOut] = []

    model_config = {"from_attributes": True}


from app.schemas.pagination import PaginatedResponse


class PaginatedApplications(PaginatedResponse[LoanApplicationOut]):
    pass
