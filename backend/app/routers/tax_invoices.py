from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.loan_application import LoanApplication
from app.models.tax_invoice import AbnStatus, SupplierType, TaxInvoice, TaxInvoiceStatus
from app.models.user import User
from app.schemas.tax_invoice import TaxInvoiceCreate, TaxInvoiceUpdate
from app.services.access_control import check_application_access
from app.services.abr import AbrUnavailable, lookup_abn
from app.services.activity_log import log_activity
from app.services.email import send_tax_invoice_document
from app.services.lender_pricing import latest_for_application as latest_lender_pricing, resolve_lender
from app.services.tax_invoice import (
    SELLER_DOCUMENT_KEYS,
    apply_abn_lookup,
    document_title,
    seller_documents_received,
    blockers,
    buyer_from_application,
    pricing_facility,
    classify_condition,
    completeness,
    desk_recipients,
    prefill_from_application,
    serialize,
)
from app.services.tenant_scope import get_tenant_id
from app.services.upload_validation import validate_attachment

router = APIRouter(prefix="/api/applications/{app_id}/tax-invoices", tags=["tax-invoices"])

# Amounts arrive as floats from JSON; store them as Decimal so the totals never
# inherit binary-float error.
_MONEY_FIELDS = {
    "sale_price", "buyers_premium", "other_charges", "deposit_paid",
    "trade_in_value", "payout_amount", "asset_payout_amount",
    "valuation_market_value", "valuation_forced_sale_value",
}


def _get_application(db: Session, app_id: str, tenant_id: str, current_user: User) -> LoanApplication:
    app = db.query(LoanApplication).filter(
        LoanApplication.id == app_id,
        LoanApplication.tenant_id == tenant_id,
        LoanApplication.deleted_at.is_(None),
    ).first()
    if not app:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(app, current_user, db=db)
    return app


def _get_invoice(db: Session, app_id: str, invoice_id: str) -> TaxInvoice:
    invoice = db.query(TaxInvoice).filter(
        TaxInvoice.id == invoice_id, TaxInvoice.application_id == app_id
    ).first()
    if not invoice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tax invoice not found")
    return invoice


def _sync_buyer(db: Session, application: LoanApplication, invoice: TaxInvoice) -> None:
    """Keep a draft's client block on the application's applicant.

    The client is always the applicant — change it on the application and every
    draft follows. An issued document keeps the party it was issued to."""
    if invoice.status != TaxInvoiceStatus.draft:
        return
    for field, value in buyer_from_application(db, application).items():
        setattr(invoice, field, value)


def _require_draft(invoice: TaxInvoice) -> None:
    if invoice.status != TaxInvoiceStatus.draft:
        raise HTTPException(status_code=400, detail="An issued invoice cannot be edited")


@router.get("")
def list_tax_invoices(
    app_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    application = _get_application(db, app_id, tenant_id, current_user)
    invoices = (
        db.query(TaxInvoice)
        .filter(TaxInvoice.application_id == app_id, TaxInvoice.tenant_id == tenant_id)
        .order_by(TaxInvoice.created_at.desc())
        .all()
    )
    for invoice in invoices:
        _sync_buyer(db, application, invoice)
    if db.dirty:
        db.commit()
    return [serialize(i, db) for i in invoices]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_tax_invoice(
    app_id: str,
    data: TaxInvoiceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Start an invoice, pre-filled from the application where we already know
    the answer. A private seller is not assumed to be registered for GST."""
    application = _get_application(db, app_id, tenant_id, current_user)
    supplier_type = SupplierType(data.supplier_type)

    prefill = prefill_from_application(db, application, supplier_type, actor_id=current_user.id)
    # An explicit date on the request wins over today's.
    if data.invoice_date:
        prefill["invoice_date"] = data.invoice_date

    invoice = TaxInvoice(
        application_id=app_id,
        tenant_id=tenant_id,
        supplier_type=supplier_type,
        invoice_number=data.invoice_number,
        created_by_id=current_user.id,
        **prefill,
    )
    db.add(invoice)
    db.flush()
    log_activity(db, current_user.id, "tax_invoice_created", "application", app_id, {"supplier_type": data.supplier_type}, tenant_id=tenant_id)
    db.commit()
    db.refresh(invoice)
    return serialize(invoice, db)


@router.patch("/{invoice_id}")
def update_tax_invoice(
    app_id: str,
    invoice_id: str,
    data: TaxInvoiceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    application = _get_application(db, app_id, tenant_id, current_user)
    invoice = _get_invoice(db, app_id, invoice_id)
    _require_draft(invoice)
    _sync_buyer(db, application, invoice)

    updates = data.model_dump(exclude_unset=True)
    if updates.get("lender_id"):
        resolve_lender(db, updates["lender_id"], tenant_id)

    documents = updates.pop("seller_documents", None)
    if documents is not None:
        unknown = set(documents) - SELLER_DOCUMENT_KEYS
        if unknown:
            raise HTTPException(status_code=400, detail=f"Unknown seller documents: {', '.join(sorted(unknown))}")
        invoice.seller_documents = json.dumps({**seller_documents_received(invoice), **documents})

    # A different ABN has not been checked. Clear the previous lookup so it can
    # not vouch for a number it never saw — on a private sale that verdict is
    # what decides whether GST is charged.
    abn_changed = "supplier_abn" in updates and (updates["supplier_abn"] or None) != invoice.supplier_abn
    for field, value in updates.items():
        if field in _MONEY_FIELDS and value is not None:
            value = Decimal(str(value))
        setattr(invoice, field, value)

    # The odometer decides what the asset is sold as, so a corrected reading
    # re-decides it — leaving a stale "new" beside 40,000km would misstate the
    # goods on the document and the policy the deal was priced under. An
    # explicit condition sent in the same request is the broker overriding it.
    if "asset_odometer" in updates and "asset_condition" not in updates:
        invoice.asset_condition = classify_condition(invoice.asset_odometer) or invoice.asset_condition

    if abn_changed and "supplier_abn_status" not in updates:
        invoice.supplier_abn_status = None
        invoice.supplier_abn_name = None
        invoice.supplier_abn_checked_at = None
        if invoice.supplier_type == SupplierType.private:
            invoice.supplier_gst_registered = False
    elif "supplier_abn_status" in updates:
        # Recorded by hand: whatever ABN Lookup said before no longer applies.
        invoice.supplier_abn_checked_at = None
        invoice.supplier_abn_name = None
    # Only an active ABN can be GST-registered.
    if invoice.supplier_abn_status and invoice.supplier_abn_status != AbnStatus.active.value:
        invoice.supplier_gst_registered = False

    changed = sorted(updates) + (["seller_documents"] if documents is not None else [])
    log_activity(db, current_user.id, "tax_invoice_updated", "application", app_id, {"fields": changed}, tenant_id=tenant_id)
    db.commit()
    db.refresh(invoice)
    return serialize(invoice, db)


@router.post("/{invoice_id}/abn-lookup")
def check_supplier_abn(
    app_id: str,
    invoice_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Check the seller's ABN on ABN Lookup and let the answer decide the GST
    treatment: not found, cancelled, or active without GST makes the sale
    GST-free and the document a plain invoice; active and GST-registered makes
    it a tax invoice. An outage is a 503, never a "not found"."""
    application = _get_application(db, app_id, tenant_id, current_user)
    invoice = _get_invoice(db, app_id, invoice_id)
    _require_draft(invoice)
    _sync_buyer(db, application, invoice)

    digits = "".join(ch for ch in (invoice.supplier_abn or "") if ch.isdigit())
    if len(digits) != 11:
        raise HTTPException(status_code=400, detail="Enter the seller's 11-digit ABN first")
    try:
        record = lookup_abn(digits, raise_errors=True)
    except AbrUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))

    apply_abn_lookup(invoice, record)
    log_activity(db, current_user.id, "tax_invoice_abn_checked", "application", app_id,
                 {"status": invoice.supplier_abn_status, "gst": invoice.supplier_gst_registered},
                 tenant_id=tenant_id)
    db.commit()
    db.refresh(invoice)
    return serialize(invoice, db)


@router.post("/{invoice_id}/refresh-pricing")
def refresh_tax_invoice_pricing(
    app_id: str,
    invoice_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Re-pull the cost build-up from the latest lender pricing.

    The draft is raised at approval, which is often before the pricing is
    finalised — and a deal can be re-priced or move lender afterwards. This
    pulls the lender and the four figures the pricing owns; everything else the
    broker has typed stands.
    """
    application = _get_application(db, app_id, tenant_id, current_user)
    invoice = _get_invoice(db, app_id, invoice_id)
    _require_draft(invoice)
    _sync_buyer(db, application, invoice)

    pricing = latest_lender_pricing(db, app_id)
    if pricing is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This application has no lender pricing to pull from",
        )

    invoice.lender_id = pricing.lender_id
    invoice.sale_price = pricing.asset_price
    invoice.deposit_paid = pricing.deposit_amount
    invoice.trade_in_value = pricing.trade_in_amount or None
    invoice.payout_amount = pricing.payout_amount or None
    # A novated lease is only ever chosen on the invoice — the pricing editor
    # has no such option — so re-pulling a plain "lease" must not undo it.
    facility = pricing_facility(pricing)
    if facility and not (facility == "lease" and invoice.facility_type == "novated_lease"):
        invoice.facility_type = facility

    log_activity(db, current_user.id, "tax_invoice_pricing_refreshed", "application", app_id,
                 {"quote_sheet_id": pricing.id, "version": pricing.version}, tenant_id=tenant_id)
    db.commit()
    db.refresh(invoice)
    return serialize(invoice, db)


@router.post("/{invoice_id}/issue")
def issue_tax_invoice(
    app_id: str,
    invoice_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Mark the invoice final. Refuses while anything the document legally needs
    is still blank — an invoice missing an ABN or a buyer is not one you want a
    financier to receive."""
    application = _get_application(db, app_id, tenant_id, current_user)
    invoice = _get_invoice(db, app_id, invoice_id)
    _require_draft(invoice)
    _sync_buyer(db, application, invoice)

    stop = blockers(invoice)
    if stop:
        raise HTTPException(status_code=400, detail=f"Totals do not reconcile: {'; '.join(stop)}")

    missing = completeness(invoice)
    if missing:
        raise HTTPException(status_code=400, detail=f"Still needed: {'; '.join(missing)}")

    invoice.status = TaxInvoiceStatus.issued
    invoice.issued_at = datetime.now(timezone.utc).replace(tzinfo=None)
    log_activity(db, current_user.id, "tax_invoice_issued", "application", app_id, {"invoice_number": invoice.invoice_number}, tenant_id=tenant_id)
    db.commit()
    db.refresh(invoice)
    return serialize(invoice, db)


@router.post("/{invoice_id}/email")
def email_tax_invoice(
    app_id: str,
    invoice_id: str,
    file: UploadFile,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Email the issued document to the broker on the file and the tenant's
    admins.

    The PDF is rendered in the browser (the same markup the Download button
    captures), so the client uploads it here rather than the server
    re-rendering a second copy that could drift from the one on screen. Only an
    issued document is sent — a draft is still being argued over."""
    application = _get_application(db, app_id, tenant_id, current_user)
    invoice = _get_invoice(db, app_id, invoice_id)
    if invoice.status != TaxInvoiceStatus.issued:
        raise HTTPException(status_code=400, detail="Issue the document before emailing it")

    contents = file.file.read()
    if validate_attachment(file.filename or "document.pdf", contents) != ".pdf":
        raise HTTPException(status_code=400, detail="Only a PDF can be sent")

    recipients = desk_recipients(db, application, current_user.id)
    if not recipients:
        raise HTTPException(status_code=400, detail="There is no broker or admin email to send to")

    label = document_title(invoice)
    sent = send_tax_invoice_document(
        recipients,
        document_label=label,
        client_name=invoice.buyer_name or "the client",
        dealer_name=invoice.supplier_name,
        sent_by=current_user.full_name,
        filename=file.filename or "tax-invoice.pdf",
        pdf=contents,
    )
    if not sent:
        raise HTTPException(status_code=503, detail="Email is not configured on this server")

    invoice.emailed_at = datetime.now(timezone.utc).replace(tzinfo=None)
    log_activity(db, current_user.id, "tax_invoice_emailed", "application", app_id,
                 {"recipients": recipients}, tenant_id=tenant_id)
    db.commit()
    db.refresh(invoice)
    return {**serialize(invoice, db), "emailed_to": recipients}


@router.delete("/{invoice_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tax_invoice(
    app_id: str,
    invoice_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    _get_application(db, app_id, tenant_id, current_user)
    invoice = _get_invoice(db, app_id, invoice_id)
    _require_draft(invoice)
    log_activity(db, current_user.id, "tax_invoice_deleted", "application", app_id, {"invoice_number": invoice.invoice_number}, tenant_id=tenant_id)
    db.delete(invoice)
    db.commit()
