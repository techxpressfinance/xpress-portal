"""Totals and validation for a tax invoice.

Totals are always derived here, never taken from the client — a document that
claims a GST figure the line items don't support is worse than no document.
"""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from app.models.tax_invoice import BUYER_IDENTITY_THRESHOLD, SupplierType, TaxInvoice

# GST is 1/11th of a GST-inclusive amount.
GST_DIVISOR = Decimal("11")


def _money(value: Optional[Decimal]) -> Decimal:
    return Decimal(value or 0)


def _round(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def totals(invoice: TaxInvoice) -> dict:
    """Subtotal, GST and balance owing.

    Amounts are treated as GST-inclusive, which is how prices are quoted and
    written on Australian invoices. A supplier who is not registered for GST
    (typically a private seller) charges none, so the GST line is zero and the
    document must not present itself as a tax invoice."""
    subtotal = _money(invoice.sale_price) + _money(invoice.buyers_premium) + _money(invoice.other_charges)
    gst = _round(subtotal / GST_DIVISOR) if invoice.supplier_gst_registered else Decimal("0")
    balance = subtotal - _money(invoice.deposit_paid)
    return {
        "subtotal": float(_round(subtotal)),
        "gst": float(gst),
        "total": float(_round(subtotal)),
        "deposit_paid": float(_round(_money(invoice.deposit_paid))),
        "balance_due": float(_round(balance)),
        # The heading the document may legally carry.
        "is_tax_invoice": invoice.supplier_gst_registered,
        "buyer_identity_required": _round(subtotal) >= BUYER_IDENTITY_THRESHOLD,
    }


def completeness(invoice: TaxInvoice) -> list[str]:
    """What still has to be filled in before this can be issued. Returned rather
    than raised so the form can show every gap at once."""
    missing: list[str] = []
    sums = totals(invoice)

    if not invoice.supplier_name:
        missing.append("Supplier name")
    if invoice.supplier_gst_registered and not invoice.supplier_abn:
        missing.append("Supplier ABN (required to charge GST)")
    if invoice.supplier_type == SupplierType.private and not invoice.supplier_abn and not invoice.abn_withholding_declared:
        missing.append("Supplier has no ABN — record their 'statement by a supplier' declaration")
    if not invoice.invoice_date:
        missing.append("Invoice date")
    if not invoice.asset_description and not (invoice.asset_make or invoice.asset_model):
        missing.append("Description of what is being sold")
    if not invoice.sale_price:
        missing.append("Sale price")
    if sums["buyer_identity_required"] and not (invoice.buyer_name or invoice.buyer_abn):
        missing.append("Buyer name or ABN (required at $1,000 or more)")
    if invoice.supplier_type == SupplierType.auction and invoice.buyers_premium is None:
        missing.append("Buyer's premium")
    return missing


def serialize(invoice: TaxInvoice) -> dict:
    data = {
        "id": invoice.id,
        "application_id": invoice.application_id,
        "supplier_type": invoice.supplier_type.value,
        "status": invoice.status.value,
        "invoice_number": invoice.invoice_number,
        "invoice_date": invoice.invoice_date.isoformat() if invoice.invoice_date else None,
        "supplier_name": invoice.supplier_name,
        "supplier_abn": invoice.supplier_abn,
        "supplier_address": invoice.supplier_address,
        "supplier_email": invoice.supplier_email,
        "supplier_phone": invoice.supplier_phone,
        "supplier_gst_registered": invoice.supplier_gst_registered,
        "abn_withholding_declared": invoice.abn_withholding_declared,
        "buyer_name": invoice.buyer_name,
        "buyer_abn": invoice.buyer_abn,
        "buyer_address": invoice.buyer_address,
        "asset_description": invoice.asset_description,
        "asset_make": invoice.asset_make,
        "asset_model": invoice.asset_model,
        "asset_year": invoice.asset_year,
        "asset_vin": invoice.asset_vin,
        "asset_registration": invoice.asset_registration,
        "asset_odometer": invoice.asset_odometer,
        "sale_price": float(invoice.sale_price) if invoice.sale_price is not None else None,
        "buyers_premium": float(invoice.buyers_premium) if invoice.buyers_premium is not None else None,
        "other_charges": float(invoice.other_charges) if invoice.other_charges is not None else None,
        "other_charges_label": invoice.other_charges_label,
        "deposit_paid": float(invoice.deposit_paid) if invoice.deposit_paid is not None else None,
        "payout_account_name": invoice.payout_account_name,
        "payout_bsb": invoice.payout_bsb,
        "payout_account_number": invoice.payout_account_number,
        "notes": invoice.notes,
        "created_by_id": invoice.created_by_id,
        "created_by_name": invoice.created_by.full_name if invoice.created_by else None,
        "issued_at": invoice.issued_at.isoformat() if invoice.issued_at else None,
        "created_at": invoice.created_at.isoformat() if invoice.created_at else None,
        "updated_at": invoice.updated_at.isoformat() if invoice.updated_at else None,
    }
    data["totals"] = totals(invoice)
    data["missing"] = completeness(invoice)
    return data
