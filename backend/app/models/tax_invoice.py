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
date, description, GST, and the buyer's identity for sales of $1,000 or more),
plus the desk's own "Tax Invoice Request" sheet — the document sent TO a dealer
on approval asking them to invoice us: who it is addressed to, the Sold To /
Delivery To parties, the full identity of the goods (build and compliance
dates, engine number, colour, rego expiry) and the cost build-up that nets a
trade-in and an existing payout against the cash price.

A `dealer` invoice therefore prints as that request; `private` and `auction`
print as the invoice/receipt this desk raises itself.
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

    # Who the request is addressed to at the dealership, and where their reply
    # goes. Fax is still on the sheet because some dealer back-offices still
    # want one; blank on everything else.
    attention: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    fax_number: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    # The address the dealer emails their tax invoice back to — the broker on
    # the file, not a shared inbox, so the reply lands with whoever is chasing.
    reply_to_email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

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

    # Buyer — the "Sold To" party. Required on the document once the total
    # reaches $1,000. A company also shows its ACN, which a dealer checks the
    # goods out against.
    buyer_name: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    buyer_abn: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    buyer_acn: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    buyer_address: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)

    # "Delivery To" — usually the buyer, occasionally not (a company buying for
    # a site, a director taking delivery at home). The flag is what the document
    # prints from, so clearing it doesn't silently strip the address below.
    delivery_same_as_buyer: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    delivery_name: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)
    delivery_abn: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    delivery_acn: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    delivery_address: Mapped[Optional[str]] = mapped_column(EncryptedString(), nullable=True)

    # The asset. Free-text description plus the identifiers a financier needs.
    asset_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    asset_make: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    asset_model: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    asset_year: Mapped[Optional[str]] = mapped_column(String(4), nullable=True)
    asset_vin: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    asset_registration: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    asset_odometer: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # "new" or "used" — a used asset is priced and inspected differently, and
    # the dealer's invoice has to agree with what the lender approved.
    asset_condition: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    asset_engine_number: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    # Free text: these arrive as "01/11/2021" or "11/2021" depending on what
    # the compliance plate shows, so they are not stored as dates.
    asset_build_date: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    asset_compliance_date: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    asset_colour: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    asset_registration_expiry: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)

    # Money. Stored as entered; totals are derived, never trusted from input.
    sale_price: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    # Auction only — the house's commission on top of the hammer price.
    buyers_premium: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    other_charges: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    other_charges_label: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    deposit_paid: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    # Netted off the cash price when the buyer trades an asset in.
    trade_in_value: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    # Added back on: what is still owing on the trade-in, which the dealer pays
    # out of the settlement rather than the buyer clearing it first.
    payout_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)

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
