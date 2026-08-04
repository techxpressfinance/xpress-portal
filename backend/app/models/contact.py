from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.encrypted_type import EncryptedString


class ContactOrganization(Base):
    __tablename__ = "contact_organizations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    contact_id: Mapped[str] = mapped_column(String(36), ForeignKey("contacts.id"), nullable=False)
    organization_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"), nullable=False)
    role: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # e.g. director, guarantor, employee
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    contact = relationship("Contact", back_populates="contact_organizations")
    organization = relationship("Organization", back_populates="contact_organizations")


class Organization(Base):
    __tablename__ = "organizations"
    __table_args__ = (UniqueConstraint("abn", "tenant_id", name="uq_org_abn_tenant"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # One of ENTITY_TYPES (app/constants.py). Null on rows created before entity
    # typing existed, and on organizations auto-created from application data.
    entity_type: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    abn: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    industry: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    address: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Trust-only (entity_type == "trust"). A trust may legitimately have no ABN,
    # so the broker must tick the "checked with the accountant" acknowledgement
    # instead — recorded here rather than only shown as a UI prompt.
    trust_type: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)  # TRUST_TYPES
    no_abn_confirmed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    no_abn_confirmed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    no_abn_confirmed_by_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    contact_organizations = relationship("ContactOrganization", back_populates="organization", cascade="all, delete-orphan")
    # Trust structure — only populated on entity_type == "trust" rows.
    trust_parties = relationship(
        "TrustParty",
        back_populates="trust",
        foreign_keys="TrustParty.organization_id",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class Contact(Base):
    __tablename__ = "contacts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
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
