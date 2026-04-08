from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.encrypted_type import EncryptedString


class ContactOrganization(Base):
    __tablename__ = "contact_organizations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    contact_id: Mapped[str] = mapped_column(String(36), ForeignKey("contacts.id"), nullable=False)
    organization_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"), nullable=False)
    role: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # e.g. director, guarantor, employee
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    contact = relationship("Contact", back_populates="contact_organizations")
    organization = relationship("Organization", back_populates="contact_organizations")


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    abn: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, unique=True)
    industry: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    address: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    contact_organizations = relationship("ContactOrganization", back_populates="organization", cascade="all, delete-orphan")


class Contact(Base):
    __tablename__ = "contacts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    first_name: Mapped[str] = mapped_column(EncryptedString(), nullable=False)
    last_name: Mapped[str] = mapped_column(EncryptedString(), nullable=False)
    middle_name: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    date_of_birth: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    drivers_license_number: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    address: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    suburb: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    postcode: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    applications = relationship("LoanApplication", back_populates="contact", foreign_keys="LoanApplication.contact_id")
    contact_organizations = relationship("ContactOrganization", back_populates="contact", cascade="all, delete-orphan")
