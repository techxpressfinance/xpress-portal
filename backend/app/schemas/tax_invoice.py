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
    sale_price: Optional[float] = None
    buyers_premium: Optional[float] = None
    other_charges: Optional[float] = None
    other_charges_label: Optional[str] = None
    deposit_paid: Optional[float] = None
    trade_in_value: Optional[float] = None
    payout_amount: Optional[float] = None
    payout_account_name: Optional[str] = None
    payout_bsb: Optional[str] = None
    payout_account_number: Optional[str] = None
    notes: Optional[str] = None
