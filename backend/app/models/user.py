from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.encrypted_type import EncryptedString


class UserRole(str, enum.Enum):
    client = "client"
    broker = "broker"
    admin = "admin"
    referrer = "referrer"
    super_admin = "super_admin"


class User(Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("email", "tenant_id", name="uq_user_email_tenant"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    email: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False, default="!invited")
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    auth_method: Mapped[str] = mapped_column(String(10), default="password", nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.client, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    email_verification_token: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    email_verification_token_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    login_code: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    login_code_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    login_code_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    failed_login_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    tokens_revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    invited_by_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)

    # Broker-specific fields
    employee_id: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    department: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    license_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    # Loan categories this broker specialises in — comma-separated slugs from
    # LOAN_CATEGORIES (services/loan_category.py). Advisory only: it defaults
    # the broker's board/application views to their categories, it does not
    # restrict what they can open or be assigned.
    specialties: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Referrer-specific fields
    organization_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Referrer business & payment details — captured at account setup so the tenant
    # can raise a monthly tax invoice on the referrer's behalf.
    business_abn: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    # Tri-state: None = not yet answered, True/False = declared.
    business_gst_registered: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    business_director_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    business_address: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    # Bank details are financial PII — encrypted at rest like other sensitive columns.
    bank_account_name: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    bank_bsb: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    bank_account_number: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    # Optional branding assets used on the generated invoice
    business_logo_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    business_logo_filename: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    business_letterhead_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    business_letterhead_filename: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    business_details_updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Password reset
    password_reset_token: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    password_reset_token_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Saved client profile — encrypted JSON blob of constant personal details used to
    # autofill new applications (title, name, DOB, contact, ID, residency, emergency contact).
    client_profile: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)

    # Soft-delete tracking (admin deleted clients)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    deleted_original_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    deleted_original_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    applications = relationship("LoanApplication", back_populates="user", foreign_keys="LoanApplication.user_id")
    assigned_applications = relationship(
        "LoanApplication", back_populates="assigned_broker", foreign_keys="LoanApplication.assigned_broker_id"
    )
    activity_logs = relationship("ActivityLog", back_populates="user")
