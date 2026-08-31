"""Tax invoices raised against a loan application.

The asset is bought from one of three kinds of supplier and each needs a
different document, which is what the three `SupplierType` values are for:

  dealer   — a GST-registered business. A normal tax invoice.
  private  — an individual selling their own asset. Usually not registered for
             GST, so the document is a receipt/statement rather than a tax
             invoice claiming GST; `abn_withholding_declared` records the
             supplier's "no ABN required" declaration where one applies.
  auction  — an auction house selling as agent, which adds a buyer's premium
             and normally invoices in its own name.

Field set follows the ATO's tax-invoice requirements (supplier identity + ABN,
date, description, GST, and the buyer's identity for sales of $1,000 or more).
Anything specific to this desk's paperwork is still to come — the detailed
sheet had not arrived when this was built.
"""
from __future__ import annotations

import enum
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.encrypted_type import EncryptedString

# Sales at or above this (GST-inclusive) must show the buyer's identity or ABN.
BUYER_IDENTITY_THRESHOLD = Decimal("1000")


class SupplierType(str, enum.Enum):
    dealer = "dealer"
    private = "private"
    auction = "auction"


class TaxInvoiceStatus(str, enum.Enum):
    draft = "draft"
    issued = "issued"


class TaxInvoice(Base):
    __tablename__ = "tax_invoices"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    application_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("loan_applications.id", ondelete="CASCADE"), nullable=False, index=True
    )
    supplier_type: Mapped[SupplierType] = mapped_column(Enum(SupplierType), nullable=False)
    status: Mapped[TaxInvoiceStatus] = mapped_column(
        Enum(TaxInvoiceStatus), default=TaxInvoiceStatus.draft, nullable=False
    )
    invoice_number: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    invoice_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Supplier — who is selling. A private seller is an individual, so their
    # contact details are encrypted like any other individual's.
    supplier_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    supplier_abn: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    supplier_address: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    supplier_email: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    supplier_phone: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    supplier_gst_registered: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # A supplier with no ABN who has declared the sale is not part of a business
    # (ATO "Statement by a supplier"), which is what lets the buyer pay in full
    # rather than withholding.
    abn_withholding_declared: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Buyer — required on the document once the total reaches $1,000.
    buyer_name: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    buyer_abn: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    buyer_address: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)

    # The asset. Free-text description plus the identifiers a financier needs.
    asset_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    asset_make: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    asset_model: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    asset_year: Mapped[Optional[str]] = mapped_column(String(4), nullable=True)
    asset_vin: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    asset_registration: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    asset_odometer: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Money. Stored as entered; totals are derived, never trusted from input.
    sale_price: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    # Auction only — the house's commission on top of the hammer price.
    buyers_premium: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    other_charges: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    other_charges_label: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    deposit_paid: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)

    # Where the money goes. Bank details are PII and encrypted, as on the
    # referrer billing profile.
    payout_account_name: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    payout_bsb: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    payout_account_number: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)

    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_by_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    issued_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    created_by = relationship("User", foreign_keys=[created_by_id], lazy="selectin")
