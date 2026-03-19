from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import DateTime, Enum, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.application_broker import ApplicationBroker
from app.models.encrypted_type import EncryptedString


class LoanType(str, enum.Enum):
    personal = "personal"
    home = "home"
    business = "business"
    vehicle = "vehicle"


class ApplicationStatus(str, enum.Enum):
    draft = "draft"
    submitted = "submitted"
    reviewing = "reviewing"
    approved = "approved"
    rejected = "rejected"


class AnalysisStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class LoanApplication(Base):
    __tablename__ = "loan_applications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    loan_type: Mapped[LoanType] = mapped_column(Enum(LoanType), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    status: Mapped[ApplicationStatus] = mapped_column(
        Enum(ApplicationStatus), default=ApplicationStatus.draft, nullable=False
    )
    assigned_broker_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
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

    # Client-filled — Overflow JSON (identification, employment, income, etc.)
    lend_extra_data: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Broker-filled — Lend controls
    lend_product_type_id: Mapped[Optional[int]] = mapped_column(nullable=True)
    lend_owner_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    lend_send_type: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    lend_who_to_contact: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    # Lend sync tracking
    lend_ref: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    lend_sync_status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    lend_sync_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    lend_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    user = relationship("User", back_populates="applications", foreign_keys=[user_id])
    completed_by = relationship("User", foreign_keys=[completed_by_id])
    # Legacy single-broker FK kept for backward compat / migration
    assigned_broker = relationship("User", back_populates="assigned_applications", foreign_keys=[assigned_broker_id])
    documents = relationship("Document", back_populates="application")

    # Many-to-many: multiple brokers per application
    brokers = relationship(
        "User",
        secondary=ApplicationBroker.__table__,
        backref="broker_applications",
        lazy="selectin",
    )
