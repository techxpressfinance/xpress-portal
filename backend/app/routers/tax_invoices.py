from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.loan_application import LoanApplication
from app.models.tax_invoice import SupplierType, TaxInvoice, TaxInvoiceStatus
from app.models.user import User
from app.schemas.tax_invoice import TaxInvoiceCreate, TaxInvoiceUpdate
from app.services.access_control import check_application_access
from app.services.activity_log import log_activity
from app.services.lender_pricing import latest_for_application as latest_lender_pricing, resolve_lender
from app.services.tax_invoice import (
    blockers,
    buyer_from_application,
    classify_condition,
    completeness,
    prefill_from_application,
    serialize,
)
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/applications/{app_id}/tax-invoices", tags=["tax-invoices"])

# Amounts arrive as floats from JSON; store them as Decimal so the totals never
# inherit binary-float error.
_MONEY_FIELDS = {
    "sale_price", "buyers_premium", "other_charges", "deposit_paid",
    "trade_in_value", "payout_amount", "asset_payout_amount",
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
    _get_application(db, app_id, tenant_id, current_user)
    invoices = (
        db.query(TaxInvoice)
        .filter(TaxInvoice.application_id == app_id, TaxInvoice.tenant_id == tenant_id)
        .order_by(TaxInvoice.created_at.desc())
        .all()
    )
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
    _get_application(db, app_id, tenant_id, current_user)
    invoice = _get_invoice(db, app_id, invoice_id)
    _require_draft(invoice)

    updates = data.model_dump(exclude_unset=True)
    if updates.get("lender_id"):
        resolve_lender(db, updates["lender_id"], tenant_id)
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

    log_activity(db, current_user.id, "tax_invoice_updated", "application", app_id, {"fields": sorted(updates)}, tenant_id=tenant_id)
    db.commit()
    db.refresh(invoice)
    return serialize(invoice, db)


@router.post("/{invoice_id}/refresh-buyer")
def refresh_tax_invoice_buyer(
    app_id: str,
    invoice_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Re-derive the Sold To block from the application.

    The draft is raised automatically at approval, so a broker who afterwards
    corrects who the applicant is (the business rather than the director, or the
    other way round) would otherwise have to retype the party. Only the buyer
    block is touched — everything the broker has typed into the rest of the
    document stands.
    """
    application = _get_application(db, app_id, tenant_id, current_user)
    invoice = _get_invoice(db, app_id, invoice_id)
    _require_draft(invoice)

    for field, value in buyer_from_application(db, application).items():
        setattr(invoice, field, value)

    log_activity(db, current_user.id, "tax_invoice_buyer_refreshed", "application", app_id,
                 {"applicant_type": application.applicant_type}, tenant_id=tenant_id)
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
    broker has typed stands, as with refresh-buyer.
    """
    _get_application(db, app_id, tenant_id, current_user)
    invoice = _get_invoice(db, app_id, invoice_id)
    _require_draft(invoice)

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
    _get_application(db, app_id, tenant_id, current_user)
    invoice = _get_invoice(db, app_id, invoice_id)
    _require_draft(invoice)

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
