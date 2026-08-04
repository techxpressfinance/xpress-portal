from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.encrypted_type import EncryptedString


class TrustParty(Base):
    """One party in the structure of a trust entity (settlor, appointor,
    trustee, beneficiary or beneficial owner).

    Parties hang off the trust ``Organization`` (``entity_type == "trust"``) so
    the structure is captured once and reused by every application that borrows
    through that trust. A party is either a linked record — a ``Contact`` for an
    individual, an ``Organization`` for a corporate/partnership trustee — or,
    when no full record is warranted (a beneficiary *class*, a settlor who is
    only ever a name on the deed), just ``name``.

    Guarantees stay per-application: ``ApplicationGuarantor`` (company) and
    ``LoanApplicant`` with ``role == "guarantor"`` (individual) already carry the
    invite/sign flow, so trust guarantors are not duplicated here.
    """

    __tablename__ = "trust_parties"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)

    # The trust this party belongs to.
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )

    role: Mapped[str] = mapped_column(String(30), nullable=False)  # TRUST_PARTY_ROLES
    party_kind: Mapped[str] = mapped_column(String(20), default="individual", nullable=False)  # TRUST_PARTY_KINDS

    # Linked record (optional) — exactly one of these at most.
    contact_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("contacts.id"), nullable=True, index=True)
    linked_organization_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("organizations.id"), nullable=True, index=True
    )

    # Free-text fallback when the party isn't (yet) a Contact/Organization.
    # Holds individuals' names, so encrypted at rest like other PII.
    name: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    # ABN of an unlinked corporate/partnership trustee (digits only).
    abn: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    # Beneficial ownership / control percentage (AML/CTF), when known.
    ownership_percentage: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2), nullable=True)

    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    trust = relationship("Organization", back_populates="trust_parties", foreign_keys=[organization_id])
    contact = relationship("Contact", foreign_keys=[contact_id])
    linked_organization = relationship("Organization", foreign_keys=[linked_organization_id])
