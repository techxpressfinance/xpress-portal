from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.application_broker import ApplicationBroker
from app.models.encrypted_type import EncryptedString


class LoanType(str, enum.Enum):
    personal = "personal"
    home = "home"
    business = "business"
    vehicle = "vehicle"
    equipment_finance = "equipment_finance"
    business_loan = "business_loan"
    commercial_property = "commercial_property"
    home_loan = "home_loan"


# Loan types treated as "commercial" — these support multiple directors per
# application (the LoanApplicant child table) and reconciliation of independent
# applies. Personal/home/vehicle are single-applicant and unaffected.
COMMERCIAL_LOAN_TYPES = frozenset({
    LoanType.business,
    LoanType.business_loan,
    LoanType.commercial_property,
    LoanType.equipment_finance,
})


# Who is borrowing. ``company`` means the borrowing entity itself is the
# applicant — there is no natural person in the inline ``applicant_*`` columns
# and the parties are its directors (``loan_applicants``). ``individual`` is the
# classic single applicant, business ABN or not.
APPLICANT_TYPE_INDIVIDUAL = "individual"
APPLICANT_TYPE_COMPANY = "company"
APPLICANT_TYPES = (APPLICANT_TYPE_INDIVIDUAL, APPLICANT_TYPE_COMPANY)


class ApplicationStatus(str, enum.Enum):
    draft = "draft"
    application_received = "application_received"
    application_assessed = "application_assessed"
    submitted = "submitted"
    approval = "approval"
    settled = "settled"
    rejected = "rejected"
    not_proceeding = "not_proceeding"


class AnalysisStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class LoanApplication(Base):
    __tablename__ = "loan_applications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    loan_type: Mapped[LoanType] = mapped_column(Enum(LoanType), index=True, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    status: Mapped[ApplicationStatus] = mapped_column(
        Enum(ApplicationStatus), default=ApplicationStatus.draft, index=True, nullable=False
    )
    assigned_broker_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), index=True, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), index=True, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    analysis_status: Mapped[Optional[AnalysisStatus]] = mapped_column(Enum(AnalysisStatus), nullable=True, default=None)
    analysis_result: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    analysis_error: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    analyzed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    completed_by_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Whether the applicant is a natural person or the borrowing entity itself.
    # Set at creation; a company application leaves applicant_* empty by design,
    # so nothing downstream should read emptiness as "not filled in yet".
    applicant_type: Mapped[str] = mapped_column(
        String(20), default=APPLICANT_TYPE_INDIVIDUAL, nullable=False
    )

    # Client-filled — Personal (PII fields use EncryptedString for at-rest encryption)
    applicant_title: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    applicant_first_name: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    applicant_last_name: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    applicant_middle_name: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    applicant_dob: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    applicant_gender: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    applicant_marital_status: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)

    # Client-filled — Address (encrypted at rest)
    applicant_address: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    applicant_suburb: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    applicant_state: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    applicant_postcode: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)

    # Client-filled — Business (when loan_type=business)
    business_abn: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    business_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    business_registration_date: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    business_industry_id: Mapped[Optional[int]] = mapped_column(nullable=True)
    business_monthly_sales: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)

    # Client-filled — Loan
    loan_purpose_id: Mapped[Optional[int]] = mapped_column(nullable=True)
    loan_term_requested: Mapped[Optional[int]] = mapped_column(nullable=True)

    # Client-filled — Overflow JSON (identification incl. licence/passport
    # numbers, employment, income, etc.) — encrypted at rest
    lend_extra_data: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)

    # Client-filled — Contact (encrypted; not matchable with SQL LIKE)
    applicant_email: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    applicant_mobile: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    preferred_contact_method: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Client-filled — Identification extra
    id_expiry_date: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    applicant_residency_status: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Client-filled — Living situation
    residential_status: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    time_at_address: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    applicant_num_dependants: Mapped[Optional[int]] = mapped_column(nullable=True)
    has_partner: Mapped[Optional[bool]] = mapped_column(nullable=True)
    partner_working: Mapped[Optional[bool]] = mapped_column(nullable=True)

    # Client-filled — Employment
    employment_category: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    employer_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    employer_industry: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    job_title: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    income_frequency: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    gross_income: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)

    # Client-filled — Business extra
    trading_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    business_structure: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    gst_registered: Mapped[Optional[bool]] = mapped_column(nullable=True)
    num_directors: Mapped[Optional[int]] = mapped_column(nullable=True)
    time_trading: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Client-filled — Declarations
    previously_declined: Mapped[Optional[bool]] = mapped_column(nullable=True)
    change_of_circumstances: Mapped[Optional[bool]] = mapped_column(nullable=True)
    signature_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    # Client-filled — Emergency contact (third-party PII, encrypted)
    emergency_contact_name: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    emergency_contact_relationship: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    emergency_contact_phone: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)

    # Broker-filled — Lend controls
    lend_product_type_id: Mapped[Optional[int]] = mapped_column(nullable=True)
    lend_owner_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    lend_send_type: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    lend_who_to_contact: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    # Kanban board position (independent of workflow status)
    kanban_column_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)

    # Contact linkage
    contact_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("contacts.id"), nullable=True)

    # Business / company linkage
    business_organization_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("organizations.id"), nullable=True)

    # The broker was asked whether this application's client is part of its
    # business and said no. Stops the prompt returning on every save; reset
    # whenever the client or the entity changes, since that is a new question.
    business_link_declined: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Provenance: the application this one was cloned from (personal + company
    # details copied, loan details entered fresh). Null for originals.
    cloned_from_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("loan_applications.id"), nullable=True)

    lend_ref: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    # Referrer-filled
    client_engagement_model: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    # Client invite (magic-link token for unauthenticated form completion)
    client_invite_token: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    client_invite_email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    client_invite_sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, default=None, index=True)

    # Stamped once, the first time status transitions to settled (settled is a
    # terminal state — see VALID_TRANSITIONS in constants.py). Drives the
    # monthly settled-deal archiving sweep (services/settled_deal_archiving.py).
    settled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, default=None)

    # Broker lock — prevents client from editing the draft
    is_locked: Mapped[bool] = mapped_column(default=False, nullable=False)

    # Broker-selected sections the client may complete (JSON array of section keys).
    # null = all sections visible.
    client_sections: Mapped[Optional[str]] = mapped_column(Text, nullable=True, default=None)

    # Commercial multi-director reconciliation: set when an independent director's
    # loan details diverge from this application. Surfaced to the broker to resolve.
    needs_reconciliation: Mapped[bool] = mapped_column(default=False, nullable=False)
    reconciliation_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True, default=None)

    # Hidden from the owning client's portal until the broker releases it (used for
    # referrer direct-engagement leads — broker configures sections, then invites).
    hidden_from_client: Mapped[bool] = mapped_column(default=False, nullable=False)

    # Set when the application (re-)enters the Approval status; see
    # change_application_status() and ApprovalCondition.
    approval_lender_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    contact = relationship("Contact", back_populates="applications", foreign_keys=[contact_id])
    business_organization = relationship("Organization", foreign_keys=[business_organization_id])
    user = relationship("User", back_populates="applications", foreign_keys=[user_id])
    completed_by = relationship("User", foreign_keys=[completed_by_id])
    # Legacy single-broker FK kept for backward compat / migration
    assigned_broker = relationship("User", back_populates="assigned_applications", foreign_keys=[assigned_broker_id])
    documents = relationship("Document", back_populates="application")

    # Additional directors (commercial loans only). Primary applicant stays inline.
    # Includes both direct individual parties and corporate-guarantor signatories;
    # serialization splits them by application_guarantor_id.
    additional_applicants = relationship(
        "LoanApplicant",
        back_populates="application",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    # Corporate guarantors (another company guaranteeing this loan). Each has its
    # own director signatories nested via LoanApplicant.application_guarantor_id.
    corporate_guarantors = relationship(
        "ApplicationGuarantor",
        back_populates="application",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    # Lender-approval conditions checklist (replaced each time the application
    # (re-)enters the Approval status).
    approval_conditions = relationship(
        "ApprovalCondition",
        back_populates="application",
        cascade="all, delete-orphan",
        order_by="ApprovalCondition.sort_order",
        lazy="selectin",
    )

    # Many-to-many: multiple brokers per application
    brokers = relationship(
        "User",
        secondary=ApplicationBroker.__table__,
        backref="broker_applications",
        lazy="selectin",
    )
