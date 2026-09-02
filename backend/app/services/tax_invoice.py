"""Totals, prefill and validation for a tax invoice.

Totals are always derived here, never taken from the client — a document that
claims a GST figure the line items don't support is worse than no document.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from sqlalchemy.orm import Session

from app.models.contact import Organization
from app.models.loan_application import LoanApplication
from app.models.tax_invoice import BUYER_IDENTITY_THRESHOLD, SupplierType, TaxInvoice
from app.models.user import User
from app.services import acn as acn_service
from app.services.activity_log import log_activity
from app.services.loan_category import application_asset_details, application_loan_category

# GST is 1/11th of a GST-inclusive amount.
GST_DIVISOR = Decimal("11")

# Entity types whose ABN is issued against an ACN, so the ACN is the ABN's last
# nine digits. A trust, partnership or sole trader has no ACN to derive.
_ACN_ENTITY_TYPES = acn_service.ACN_BEARING_ENTITY_TYPES


def _money(value: Optional[Decimal]) -> Decimal:
    return Decimal(value or 0)


def _round(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def totals(invoice: TaxInvoice) -> dict:
    """Cost of the goods, GST, and what is actually payable on settlement.

    Amounts are treated as GST-inclusive, which is how prices are quoted and
    written on Australian invoices. A supplier who is not registered for GST
    (typically a private seller) charges none, so the GST line is zero and the
    document must not present itself as a tax invoice.

    The payable figure follows the desk's request sheet: cash price, less any
    trade-in, plus the payout still owing on that trade-in, less the cash
    deposit already handed over."""
    subtotal = _money(invoice.sale_price) + _money(invoice.buyers_premium) + _money(invoice.other_charges)
    gst = _round(subtotal / GST_DIVISOR) if invoice.supplier_gst_registered else Decimal("0")
    trade_in = _money(invoice.trade_in_value)
    payout = _money(invoice.payout_amount)
    deposit = _money(invoice.deposit_paid)
    payable = subtotal - trade_in + payout - deposit
    return {
        "subtotal": float(_round(subtotal)),
        "gst": float(gst),
        "total": float(_round(subtotal)),
        "trade_in": float(_round(trade_in)),
        "payout": float(_round(payout)),
        "deposit_paid": float(_round(deposit)),
        # What the financier is asked to pay. Named balance_due since the
        # invoice documents also print it as the balance owing.
        "balance_due": float(_round(payable)),
        # The heading the document may legally carry.
        "is_tax_invoice": invoice.supplier_gst_registered,
        "buyer_identity_required": _round(subtotal) >= BUYER_IDENTITY_THRESHOLD,
    }


def completeness(invoice: TaxInvoice) -> list[str]:
    """What still has to be filled in before this can be issued. Returned rather
    than raised so the form can show every gap at once.

    A dealer document is a *request* — we are asking the dealer to send their
    tax invoice, so their ABN and invoice number are what comes back, not what
    we supply. What it must carry instead is enough to identify the goods, the
    buyer taking delivery, the money, and where to reply."""
    missing: list[str] = []
    sums = totals(invoice)

    if not invoice.supplier_name:
        missing.append("Supplier name")
    if not invoice.invoice_date:
        missing.append("Invoice date")
    if not invoice.asset_description and not (invoice.asset_make or invoice.asset_model):
        missing.append("Description of what is being sold")
    if not invoice.sale_price:
        missing.append("Sale price")

    if invoice.supplier_type == SupplierType.dealer:
        if not invoice.attention and not invoice.supplier_email:
            missing.append("Who at the dealership this is addressed to (attention or email)")
        if not invoice.buyer_name:
            missing.append("Sold To name")
        if not invoice.buyer_address:
            missing.append("Sold To address")
        if not invoice.delivery_same_as_buyer and not invoice.delivery_address:
            missing.append("Delivery To address")
        if not invoice.asset_vin:
            missing.append("VIN or chassis number")
        if not invoice.reply_to_email:
            missing.append("Email address for the dealer to send the tax invoice back to")
    else:
        if invoice.supplier_gst_registered and not invoice.supplier_abn:
            missing.append("Supplier ABN (required to charge GST)")
        if (
            invoice.supplier_type == SupplierType.private
            and not invoice.supplier_abn
            and not invoice.abn_withholding_declared
        ):
            missing.append("Supplier has no ABN — record their 'statement by a supplier' declaration")
        if sums["buyer_identity_required"] and not (invoice.buyer_name or invoice.buyer_abn):
            missing.append("Buyer name or ABN (required at $1,000 or more)")
        if invoice.supplier_type == SupplierType.auction and invoice.buyers_premium is None:
            missing.append("Buyer's premium")
    return missing


def acn_from_abn(abn: Optional[str], entity_type: Optional[str]) -> Optional[str]:
    """A company's ABN is two check digits followed by its nine-digit ACN, so
    the ACN can be read straight off it. Only for entities that have one — a
    trust or sole trader's ABN is not built from an ACN. A malformed ABN yields
    nothing rather than a plausible-looking wrong ACN on the invoice."""
    if entity_type not in _ACN_ENTITY_TYPES:
        return None
    return acn_service.acn_from_abn(abn)


def _text(value) -> Optional[str]:
    """Blank strings are recorded by the form when a field was skipped — they
    are absence, not an answer."""
    text = str(value).strip() if value is not None else ""
    return text or None


def _decimal(value) -> Optional[Decimal]:
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except (ArithmeticError, ValueError):
        return None


def _applicant_address(application: LoanApplication) -> Optional[str]:
    """Street on one line, suburb/state/postcode on the next — the shape the
    request sheet's address blocks are laid out in."""
    street = _text(application.applicant_address)
    locality = " ".join(
        p for p in [_text(application.applicant_suburb), _text(application.applicant_state)] if p
    )
    postcode = _text(application.applicant_postcode)
    second = ", ".join(p for p in [locality, postcode] if p) if locality else postcode
    return "\n".join(p for p in [street, second] if p) or None


def prefill_from_application(
    db: Session,
    application: LoanApplication,
    supplier_type: SupplierType,
    actor_id: Optional[str] = None,
) -> dict:
    """Everything about the invoice the application already answers.

    The buyer is the entity being financed where there is one — a dealer
    releases goods to the company on the contract, not to the director. The
    asset block lives in the encrypted lend_extra_data JSON, not in columns."""
    organization: Optional[Organization] = None
    if application.business_organization_id:
        organization = (
            db.query(Organization).filter(Organization.id == application.business_organization_id).first()
        )

    buyer_name = (
        (organization.name if organization else None)
        or _text(application.business_name)
        or " ".join(
            p for p in [application.applicant_first_name, application.applicant_last_name] if p
        ).strip()
        or None
    )
    buyer_abn = _text(organization.abn if organization else None) or _text(application.business_abn)
    buyer_address = _text(organization.address if organization else None) or _applicant_address(application)

    asset = application_asset_details(application)

    # Where the dealer replies. The broker carrying the file, falling back to
    # whoever moved the application to approval.
    reply_to = None
    for user_id in (application.assigned_broker_id, actor_id):
        if not user_id:
            continue
        user = db.query(User).filter(User.id == user_id).first()
        if user and user.email:
            reply_to = user.email
            break

    condition = (_text(asset.get("condition")) or "").lower() or None

    return {
        "invoice_date": date.today(),
        "reply_to_email": reply_to,
        "supplier_gst_registered": supplier_type != SupplierType.private,
        "buyer_name": buyer_name,
        "buyer_abn": buyer_abn,
        # A recorded ACN (from the ABR) beats one inferred from the ABN, which
        # depends on entity_type being set and is silent when it is not.
        "buyer_acn": (
            (organization.acn if organization else None)
            or acn_from_abn(buyer_abn, organization.entity_type if organization else None)
        ),
        "buyer_address": buyer_address,
        "delivery_same_as_buyer": True,
        "asset_description": _text(asset.get("description")),
        "asset_make": _text(asset.get("make")),
        "asset_model": _text(asset.get("model")),
        "asset_year": (_text(asset.get("year")) or "")[:4] or None,
        "asset_vin": _text(asset.get("vin")),
        "asset_condition": condition if condition in ("new", "used") else None,
        "sale_price": _decimal(asset.get("price")),
        "deposit_paid": _decimal(asset.get("deposit")),
    }


def ensure_request_for_approval(
    db: Session,
    application: LoanApplication,
    actor_id: Optional[str],
    tenant_id: Optional[str],
) -> Optional[TaxInvoice]:
    """Raise the dealer tax invoice request an approved asset-finance deal needs.

    An approval is the point the desk goes back to the dealer for their tax
    invoice, so the draft is waiting for the broker rather than being started
    from scratch. Only asset finance, only when the application has no invoice
    yet — an application can re-enter Approval (see change_application_status),
    and a second draft would be a second document to reconcile."""
    if application_loan_category(application) != "asset_finance":
        return None
    if db.query(TaxInvoice).filter(TaxInvoice.application_id == application.id).first():
        return None

    invoice = TaxInvoice(
        application_id=application.id,
        tenant_id=tenant_id,
        supplier_type=SupplierType.dealer,
        created_by_id=actor_id,
        **prefill_from_application(db, application, SupplierType.dealer, actor_id=actor_id),
    )
    db.add(invoice)
    db.flush()
    if actor_id:
        log_activity(
            db,
            actor_id,
            "tax_invoice_created",
            "application",
            application.id,
            {"supplier_type": SupplierType.dealer.value, "auto": "approval"},
            tenant_id=tenant_id,
        )
    return invoice


def serialize(invoice: TaxInvoice) -> dict:
    data = {
        "id": invoice.id,
        "application_id": invoice.application_id,
        "supplier_type": invoice.supplier_type.value,
        "status": invoice.status.value,
        "invoice_number": invoice.invoice_number,
        "invoice_date": invoice.invoice_date.isoformat() if invoice.invoice_date else None,
        "attention": invoice.attention,
        "fax_number": invoice.fax_number,
        "reply_to_email": invoice.reply_to_email,
        "supplier_name": invoice.supplier_name,
        "supplier_abn": invoice.supplier_abn,
        "supplier_address": invoice.supplier_address,
        "supplier_email": invoice.supplier_email,
        "supplier_phone": invoice.supplier_phone,
        "supplier_gst_registered": invoice.supplier_gst_registered,
        "abn_withholding_declared": invoice.abn_withholding_declared,
        "buyer_name": invoice.buyer_name,
        "buyer_abn": invoice.buyer_abn,
        "buyer_acn": invoice.buyer_acn,
        "buyer_address": invoice.buyer_address,
        "delivery_same_as_buyer": invoice.delivery_same_as_buyer,
        "delivery_name": invoice.delivery_name,
        "delivery_abn": invoice.delivery_abn,
        "delivery_acn": invoice.delivery_acn,
        "delivery_address": invoice.delivery_address,
        "asset_description": invoice.asset_description,
        "asset_make": invoice.asset_make,
        "asset_model": invoice.asset_model,
        "asset_year": invoice.asset_year,
        "asset_vin": invoice.asset_vin,
        "asset_registration": invoice.asset_registration,
        "asset_odometer": invoice.asset_odometer,
        "asset_condition": invoice.asset_condition,
        "asset_engine_number": invoice.asset_engine_number,
        "asset_build_date": invoice.asset_build_date,
        "asset_compliance_date": invoice.asset_compliance_date,
        "asset_colour": invoice.asset_colour,
        "asset_registration_expiry": invoice.asset_registration_expiry,
        "sale_price": float(invoice.sale_price) if invoice.sale_price is not None else None,
        "buyers_premium": float(invoice.buyers_premium) if invoice.buyers_premium is not None else None,
        "other_charges": float(invoice.other_charges) if invoice.other_charges is not None else None,
        "other_charges_label": invoice.other_charges_label,
        "deposit_paid": float(invoice.deposit_paid) if invoice.deposit_paid is not None else None,
        "trade_in_value": float(invoice.trade_in_value) if invoice.trade_in_value is not None else None,
        "payout_amount": float(invoice.payout_amount) if invoice.payout_amount is not None else None,
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
