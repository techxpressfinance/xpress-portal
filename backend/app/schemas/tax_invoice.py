from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel


class TaxInvoiceCreate(BaseModel):
    supplier_type: Literal["dealer", "private", "auction"]
    invoice_number: Optional[str] = None
    invoice_date: Optional[date] = None


class TaxInvoiceUpdate(BaseModel):
    """Every field is optional — the form saves as it is filled in, and what is
    still missing comes back on the response rather than blocking the save."""

    invoice_number: Optional[str] = None
    invoice_date: Optional[date] = None
    attention: Optional[str] = None
    fax_number: Optional[str] = None
    reply_to_email: Optional[str] = None
    supplier_name: Optional[str] = None
    supplier_abn: Optional[str] = None
    supplier_acn: Optional[str] = None
    # Normally set by the ABN Lookup endpoint. Settable by hand for a seller
    # with no ABN, or when ABN Lookup is unavailable.
    supplier_abn_status: Optional[Literal["active", "cancelled", "not_found", "none"]] = None
    supplier_address: Optional[str] = None
    supplier_email: Optional[str] = None
    supplier_phone: Optional[str] = None
    supplier_gst_registered: Optional[bool] = None
    abn_withholding_declared: Optional[bool] = None
    buyer_name: Optional[str] = None
    buyer_abn: Optional[str] = None
    buyer_acn: Optional[str] = None
    buyer_address: Optional[str] = None
    delivery_same_as_buyer: Optional[bool] = None
    delivery_name: Optional[str] = None
    delivery_abn: Optional[str] = None
    delivery_acn: Optional[str] = None
    delivery_address: Optional[str] = None
    asset_description: Optional[str] = None
    asset_make: Optional[str] = None
    asset_model: Optional[str] = None
    asset_year: Optional[str] = None
    asset_vin: Optional[str] = None
    asset_registration: Optional[str] = None
    asset_odometer: Optional[int] = None
    asset_condition: Optional[str] = None
    asset_engine_number: Optional[str] = None
    asset_build_date: Optional[str] = None
    asset_compliance_date: Optional[str] = None
    asset_colour: Optional[str] = None
    asset_registration_expiry: Optional[str] = None
    # The financier, from the tenant's lender list. Normally carried over from
    # the lender pricing, but re-selectable if the deal moves lender.
    lender_id: Optional[str] = None
    # Chattel mortgage names the client as Sold To; a lease or hire purchase
    # names the lender. Pulled from the lender pricing, re-selectable here.
    facility_type: Optional[Literal["chattel", "hp", "lease", "novated_lease"]] = None
    sale_price: Optional[float] = None
    buyers_premium: Optional[float] = None
    other_charges: Optional[float] = None
    other_charges_label: Optional[str] = None
    deposit_paid: Optional[float] = None
    trade_in_value: Optional[float] = None
    # Owing on the trade-in (added to the price) and owing on the asset being
    # bought (taken out of it) respectively — see the model.
    payout_amount: Optional[float] = None
    asset_payout_amount: Optional[float] = None
    payout_account_name: Optional[str] = None
    payout_bsb: Optional[str] = None
    payout_account_number: Optional[str] = None
    payout_creditor_name: Optional[str] = None
    payout_creditor_bsb: Optional[str] = None
    payout_creditor_account_number: Optional[str] = None
    licence_name: Optional[str] = None
    registration_name: Optional[str] = None
    payout_letter_name: Optional[str] = None
    valuation_needed: Optional[bool] = None
    ppsr_charge: Optional[bool] = None
    ppsr_all_pap: Optional[bool] = None
    payout_reduced: Optional[bool] = None
    # {document key: received}. Merged into what is stored, so a request only
    # carries the ticks it changes.
    seller_documents: Optional[dict[str, bool]] = None
    valuation_market_value: Optional[float] = None
    valuation_forced_sale_value: Optional[float] = None
    valuer_name: Optional[str] = None
    valuation_date: Optional[date] = None
    notes: Optional[str] = None
