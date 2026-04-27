from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.loan_application import LoanApplication
from app.models.quote_sheet import QuoteOption, QuoteSheet, QuoteSheetStatus
from app.models.user import User
from app.services.access_control import check_application_access
from app.schemas.quote_sheet import (
    QuoteOptionCreate,
    QuoteOptionUpdate,
    QuoteSheetCreate,
    QuoteSheetUpdate,
)
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/applications/{app_id}/quote-sheets", tags=["quote-sheets"])


def _serialize_option(opt: QuoteOption) -> dict:
    return {
        "id": opt.id,
        "quote_sheet_id": opt.quote_sheet_id,
        "sort_order": opt.sort_order,
        "is_recommended": opt.is_recommended,
        "lender_name": opt.lender_name,
        "lender_product": opt.lender_product,
        "purchase_price": float(opt.purchase_price) if opt.purchase_price is not None else None,
        "deposit": float(opt.deposit) if opt.deposit is not None else None,
        "loan_amount": float(opt.loan_amount) if opt.loan_amount is not None else None,
        "loan_term_months": opt.loan_term_months,
        "balloon_residual": float(opt.balloon_residual) if opt.balloon_residual is not None else None,
        "interest_rate": float(opt.interest_rate) if opt.interest_rate is not None else None,
        "comparison_rate": float(opt.comparison_rate) if opt.comparison_rate is not None else None,
        "establishment_fee": float(opt.establishment_fee) if opt.establishment_fee is not None else None,
        "monthly_account_fee": float(opt.monthly_account_fee) if opt.monthly_account_fee is not None else None,
        "application_fee": float(opt.application_fee) if opt.application_fee is not None else None,
        "brokerage": float(opt.brokerage) if opt.brokerage is not None else None,
        "repayment_monthly": float(opt.repayment_monthly) if opt.repayment_monthly is not None else None,
        "repayment_fortnightly": float(opt.repayment_fortnightly) if opt.repayment_fortnightly is not None else None,
        "repayment_weekly": float(opt.repayment_weekly) if opt.repayment_weekly is not None else None,
        "total_repayments": float(opt.total_repayments) if opt.total_repayments is not None else None,
        "total_interest": float(opt.total_interest) if opt.total_interest is not None else None,
        "total_fees": float(opt.total_fees) if opt.total_fees is not None else None,
        "features": opt.features,
        "notes": opt.notes,
        "created_at": opt.created_at.isoformat(),
    }


def _serialize(sheet: QuoteSheet) -> dict:
    return {
        "id": sheet.id,
        "application_id": sheet.application_id,
        "version": sheet.version,
        "title": sheet.title,
        "status": sheet.status.value,
        "created_by_id": sheet.created_by_id,
        "created_by_name": sheet.created_by.full_name if sheet.created_by else None,
        "broker_notes": sheet.broker_notes,
        "input_parameters": sheet.input_parameters,
        "recipient_name": sheet.recipient_name,
        "recipient_email": sheet.recipient_email,
        "sent_at": sheet.sent_at.isoformat() if sheet.sent_at else None,
        "options": [_serialize_option(o) for o in sheet.options],
        "created_at": sheet.created_at.isoformat(),
        "updated_at": sheet.updated_at.isoformat(),
    }


def _get_application(db: Session, app_id: str) -> LoanApplication:
    app = db.query(LoanApplication).filter(LoanApplication.id == app_id).first()
    if not app:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    return app


def _get_sheet(db: Session, app_id: str, sheet_id: str) -> QuoteSheet:
    sheet = (
        db.query(QuoteSheet)
        .filter(QuoteSheet.id == sheet_id, QuoteSheet.application_id == app_id)
        .first()
    )
    if not sheet:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quote sheet not found")
    return sheet


def _require_draft(sheet: QuoteSheet) -> None:
    if sheet.status != QuoteSheetStatus.draft:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot modify a sent quote sheet",
        )


def _next_version(db: Session, app_id: str) -> int:
    max_ver = (
        db.query(func.max(QuoteSheet.version))
        .filter(QuoteSheet.application_id == app_id)
        .scalar()
    )
    return (max_ver or 0) + 1


# ── List ──────────────────────────────────────────────────────────────

@router.get("")
def list_quote_sheets(
    app_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    app = _get_application(db, app_id)
    check_application_access(app, current_user, db=db)
    query = db.query(QuoteSheet).filter(QuoteSheet.application_id == app_id)

    # Clients only see sent sheets
    if current_user.role.value == "client":
        query = query.filter(QuoteSheet.status == QuoteSheetStatus.sent)

    sheets = query.order_by(QuoteSheet.version.desc()).all()
    result = [_serialize(s) for s in sheets]

    # Strip internal fields for clients
    if current_user.role.value == "client":
        for r in result:
            r["broker_notes"] = None
            r["input_parameters"] = None

    return result


# ── Create ────────────────────────────────────────────────────────────

@router.post("", status_code=status.HTTP_201_CREATED)
def create_quote_sheet(
    app_id: str,
    data: QuoteSheetCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker", "referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    app = _get_application(db, app_id)
    check_application_access(app, current_user, db=db)

    sheet = QuoteSheet(
        application_id=app_id,
        version=_next_version(db, app_id),
        title=data.title,
        broker_notes=data.broker_notes,
        input_parameters=data.input_parameters,
        created_by_id=current_user.id,
        tenant_id=tenant_id,
    )
    db.add(sheet)
    db.flush()

    for opt_data in data.options:
        opt = QuoteOption(
            quote_sheet_id=sheet.id,
            **opt_data.model_dump(),
        )
        db.add(opt)

    db.commit()
    db.refresh(sheet)
    return _serialize(sheet)


# ── Get One ───────────────────────────────────────────────────────────

@router.get("/{sheet_id}")
def get_quote_sheet(
    app_id: str,
    sheet_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    app = _get_application(db, app_id)
    check_application_access(app, current_user, db=db)
    sheet = _get_sheet(db, app_id, sheet_id)

    if current_user.role.value == "client" and sheet.status != QuoteSheetStatus.sent:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quote sheet not found")

    result = _serialize(sheet)
    if current_user.role.value == "client":
        result["broker_notes"] = None
        result["input_parameters"] = None
    return result


# ── Update ────────────────────────────────────────────────────────────

@router.patch("/{sheet_id}")
def update_quote_sheet(
    app_id: str,
    sheet_id: str,
    data: QuoteSheetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker", "referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    app = _get_application(db, app_id)
    check_application_access(app, current_user, db=db)
    sheet = _get_sheet(db, app_id, sheet_id)
    _require_draft(sheet)

    update_data = data.model_dump(exclude_unset=True)

    if "status" in update_data:
        try:
            new_status = QuoteSheetStatus(update_data["status"])
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status: {update_data['status']}",
            )
        update_data["status"] = new_status
        if new_status == QuoteSheetStatus.sent:
            update_data["sent_at"] = datetime.now(timezone.utc)

    for field, value in update_data.items():
        setattr(sheet, field, value)

    db.commit()
    db.refresh(sheet)
    return _serialize(sheet)


# ── Delete ────────────────────────────────────────────────────────────

@router.delete("/{sheet_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_quote_sheet(
    app_id: str,
    sheet_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker", "referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    app = _get_application(db, app_id)
    check_application_access(app, current_user, db=db)
    sheet = _get_sheet(db, app_id, sheet_id)
    _require_draft(sheet)
    db.delete(sheet)
    db.commit()


# ── Duplicate ─────────────────────────────────────────────────────────

@router.post("/{sheet_id}/duplicate", status_code=status.HTTP_201_CREATED)
def duplicate_quote_sheet(
    app_id: str,
    sheet_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker", "referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    app = _get_application(db, app_id)
    check_application_access(app, current_user, db=db)
    source = _get_sheet(db, app_id, sheet_id)

    new_sheet = QuoteSheet(
        application_id=app_id,
        version=_next_version(db, app_id),
        title=source.title,
        broker_notes=source.broker_notes,
        input_parameters=source.input_parameters,
        created_by_id=current_user.id,
        tenant_id=tenant_id,
    )
    db.add(new_sheet)
    db.flush()

    for opt in source.options:
        new_opt = QuoteOption(
            quote_sheet_id=new_sheet.id,
            sort_order=opt.sort_order,
            is_recommended=opt.is_recommended,
            lender_name=opt.lender_name,
            lender_product=opt.lender_product,
            purchase_price=opt.purchase_price,
            deposit=opt.deposit,
            loan_amount=opt.loan_amount,
            loan_term_months=opt.loan_term_months,
            balloon_residual=opt.balloon_residual,
            interest_rate=opt.interest_rate,
            comparison_rate=opt.comparison_rate,
            establishment_fee=opt.establishment_fee,
            monthly_account_fee=opt.monthly_account_fee,
            application_fee=opt.application_fee,
            brokerage=opt.brokerage,
            repayment_monthly=opt.repayment_monthly,
            repayment_fortnightly=opt.repayment_fortnightly,
            repayment_weekly=opt.repayment_weekly,
            total_repayments=opt.total_repayments,
            total_interest=opt.total_interest,
            total_fees=opt.total_fees,
            features=opt.features,
            notes=opt.notes,
        )
        db.add(new_opt)

    db.commit()
    db.refresh(new_sheet)
    return _serialize(new_sheet)


# ── Option CRUD ───────────────────────────────────────────────────────

@router.post("/{sheet_id}/options", status_code=status.HTTP_201_CREATED)
def add_option(
    app_id: str,
    sheet_id: str,
    data: QuoteOptionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker", "referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    app = _get_application(db, app_id)
    check_application_access(app, current_user, db=db)
    sheet = _get_sheet(db, app_id, sheet_id)
    _require_draft(sheet)

    opt = QuoteOption(quote_sheet_id=sheet.id, **data.model_dump())
    db.add(opt)
    db.commit()
    db.refresh(opt)
    return _serialize_option(opt)


@router.patch("/{sheet_id}/options/{opt_id}")
def update_option(
    app_id: str,
    sheet_id: str,
    opt_id: str,
    data: QuoteOptionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker", "referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    app = _get_application(db, app_id)
    check_application_access(app, current_user, db=db)
    sheet = _get_sheet(db, app_id, sheet_id)
    _require_draft(sheet)

    opt = db.query(QuoteOption).filter(QuoteOption.id == opt_id, QuoteOption.quote_sheet_id == sheet.id).first()
    if not opt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Option not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(opt, field, value)

    db.commit()
    db.refresh(opt)
    return _serialize_option(opt)


@router.delete("/{sheet_id}/options/{opt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_option(
    app_id: str,
    sheet_id: str,
    opt_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker", "referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    app = _get_application(db, app_id)
    check_application_access(app, current_user, db=db)
    sheet = _get_sheet(db, app_id, sheet_id)
    _require_draft(sheet)

    opt = db.query(QuoteOption).filter(QuoteOption.id == opt_id, QuoteOption.quote_sheet_id == sheet.id).first()
    if not opt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Option not found")

    db.delete(opt)
    db.commit()
