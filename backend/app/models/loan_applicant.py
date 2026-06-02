from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.encrypted_type import EncryptedString


class LoanApplicant(Base):
    """An additional director/applicant attached to a commercial loan application.

    The *primary* applicant remains stored inline on ``LoanApplication`` (the
    ``applicant_*`` columns). This table holds every *additional* director who
    applies for the same commercial loan. Documents stay pooled at the
    application level; each director signs their own declaration.
    """

    __tablename__ = "loan_applicants"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    application_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("loan_applications.id", ondelete="CASCADE"), nullable=False, index=True
    )
    contact_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("contacts.id"), nullable=True)

    # When set, this party is a director/signatory of a *corporate* guarantor on the
    # application rather than a direct individual party on the borrowing entity.
    application_guarantor_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("application_guarantors.id", ondelete="CASCADE"), nullable=True, index=True
    )

    role: Mapped[str] = mapped_column(String(30), default="director", nullable=False)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Personal (PII encrypted at rest)
    applicant_title: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    applicant_first_name: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    applicant_last_name: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    applicant_middle_name: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    applicant_dob: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    applicant_gender: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    applicant_marital_status: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)

    # Contact
    applicant_email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    applicant_mobile: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    # Address (encrypted at rest)
    applicant_address: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    applicant_suburb: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    applicant_state: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    applicant_postcode: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)

    # Identification / residency
    id_expiry_date: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    applicant_residency_status: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Employment / income
    employment_category: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    employer_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    employer_industry: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    job_title: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    income_frequency: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    gross_income: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)

    # Overflow JSON (identification docs metadata, extra fields)
    lend_extra_data: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Declarations + per-director signature
    previously_declined: Mapped[Optional[bool]] = mapped_column(nullable=True)
    change_of_circumstances: Mapped[Optional[bool]] = mapped_column(nullable=True)
    signature_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    signed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Per-applicant magic-link invite (hybrid: each director invitable independently)
    invite_token: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    invite_email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    invite_sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    application = relationship("LoanApplication", back_populates="additional_applicants")
    contact = relationship("Contact", foreign_keys=[contact_id])
    guarantor = relationship("ApplicationGuarantor", back_populates="signatories", foreign_keys=[application_guarantor_id])


class ApplicationGuarantor(Base):
    """A *corporate* guarantor on a commercial loan application.

    The guarantor is an ``Organization`` (its own company with an ABN). Every
    director of that company signs the guarantee, so the directors are stored as
    ``LoanApplicant`` signatory rows pointing back here via
    ``application_guarantor_id`` — each independently invited and signed.
    """

    __tablename__ = "application_guarantors"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    application_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("loan_applications.id", ondelete="CASCADE"), nullable=False, index=True
    )
    organization_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"), nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    application = relationship("LoanApplication", back_populates="corporate_guarantors")
    organization = relationship("Organization", foreign_keys=[organization_id])
    signatories = relationship(
        "LoanApplicant",
        back_populates="guarantor",
        foreign_keys="LoanApplicant.application_guarantor_id",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
