from __future__ import annotations

import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.quote_sheet import QuoteOption, QuoteSheet, QuoteSheetStatus
from app.models.user import User
from app.schemas.quote_sheet import (
    QuoteOptionCreate,
    QuoteOptionUpdate,
    QuoteSheetCreate,
    QuoteSheetEmailRequest,
    QuoteSheetUpdate,
)
from app.services.email import send_quote_sheet_email
from app.services.quote_serializers import serialize_quote_option as _serialize_option, serialize_quote_sheet as _serialize
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/quote-sheets", tags=["standalone-quote-sheets"])


def _get_sheet(db: Session, sheet_id: str) -> QuoteSheet:
    sheet = (
        db.query(QuoteSheet)
        .filter(QuoteSheet.id == sheet_id, QuoteSheet.application_id.is_(None))
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


def _next_version(db: Session) -> int:
    max_ver = (
        db.query(func.max(QuoteSheet.version))
        .filter(QuoteSheet.application_id.is_(None))
        .scalar()
    )
    return (max_ver or 0) + 1


# ── List ──────────────────────────────────────────────────────────────

@router.get("")
def list_standalone_quote_sheets(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker", "referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    sheets = (
        db.query(QuoteSheet)
        .filter(QuoteSheet.application_id.is_(None), QuoteSheet.tenant_id == tenant_id)
        .order_by(QuoteSheet.created_at.desc())
        .all()
    )
    return [_serialize(s) for s in sheets]


# ── Create ────────────────────────────────────────────────────────────

@router.post("", status_code=status.HTTP_201_CREATED)
def create_standalone_quote_sheet(
    data: QuoteSheetCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker", "referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    sheet = QuoteSheet(
        application_id=None,
        version=_next_version(db),
        title=data.title,
        broker_notes=data.broker_notes,
        input_parameters=data.input_parameters,
        recipient_name=data.recipient_name,
        recipient_email=data.recipient_email,
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
def get_standalone_quote_sheet(
    sheet_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker", "referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    sheet = _get_sheet(db, sheet_id)
    return _serialize(sheet)


# ── Update ────────────────────────────────────────────────────────────

@router.patch("/{sheet_id}")
def update_standalone_quote_sheet(
    sheet_id: str,
    data: QuoteSheetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker", "referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    sheet = _get_sheet(db, sheet_id)
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
def delete_standalone_quote_sheet(
    sheet_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker", "referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    sheet = _get_sheet(db, sheet_id)
    _require_draft(sheet)
    db.delete(sheet)
    db.commit()


# ── Duplicate ─────────────────────────────────────────────────────────

@router.post("/{sheet_id}/duplicate", status_code=status.HTTP_201_CREATED)
def duplicate_standalone_quote_sheet(
    sheet_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker", "referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    source = _get_sheet(db, sheet_id)

    new_sheet = QuoteSheet(
        application_id=None,
        version=_next_version(db),
        title=source.title,
        broker_notes=source.broker_notes,
        input_parameters=source.input_parameters,
        recipient_name=source.recipient_name,
        recipient_email=source.recipient_email,
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
def add_standalone_option(
    sheet_id: str,
    data: QuoteOptionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker", "referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    sheet = _get_sheet(db, sheet_id)
    _require_draft(sheet)

    opt = QuoteOption(quote_sheet_id=sheet.id, **data.model_dump())
    db.add(opt)
    db.commit()
    db.refresh(opt)
    return _serialize_option(opt)


@router.patch("/{sheet_id}/options/{opt_id}")
def update_standalone_option(
    sheet_id: str,
    opt_id: str,
    data: QuoteOptionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker", "referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    sheet = _get_sheet(db, sheet_id)
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
def delete_standalone_option(
    sheet_id: str,
    opt_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker", "referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    sheet = _get_sheet(db, sheet_id)
    _require_draft(sheet)

    opt = db.query(QuoteOption).filter(QuoteOption.id == opt_id, QuoteOption.quote_sheet_id == sheet.id).first()
    if not opt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Option not found")

    db.delete(opt)
    db.commit()


# ── Send Email ────────────────────────────────────────────────────────

@router.post("/{sheet_id}/send-email")
def send_standalone_quote_email(
    sheet_id: str,
    data: QuoteSheetEmailRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker", "referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    sheet = _get_sheet(db, sheet_id)

    if not sheet.options:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Quote sheet has no options to send",
        )

    # Build the quote summary for the email
    import json
    input_params = None
    if sheet.input_parameters:
        try:
            input_params = json.loads(sheet.input_parameters)
        except (json.JSONDecodeError, TypeError):
            pass

    asset_description = "Asset"
    if input_params and "asset_description" in input_params:
        asset_description = input_params["asset_description"]

    # Filter options by selected terms if specified
    options = sheet.options
    if data.include_terms:
        options = [o for o in options if (o.loan_term_months or 0) in data.include_terms]

    # Build summary rows for the email
    summary_rows = []
    for opt in sorted(options, key=lambda o: (o.loan_term_months or 0, o.sort_order)):
        months = opt.loan_term_months or 0
        term_label = f"{months // 12} Year" if months % 12 == 0 else f"{months} Month"
        has_balloon = (opt.balloon_residual or 0) > 0
        # lender_name is "5 Year (28.13% Balloon)" — keep only the balloon part
        # so the row doesn't repeat the term.
        balloon_label = ""
        if has_balloon:
            match = re.search(r"\(([^)]*Balloon[^)]*)\)", opt.lender_name or "")
            balloon_label = f" ({match.group(1)})" if match else " (Balloon)"
        summary_rows.append({
            "term": f"{term_label}{balloon_label}",
            "loan_amount": float(opt.loan_amount) if opt.loan_amount else 0,
            "monthly": float(opt.repayment_monthly) if opt.repayment_monthly else 0,
            "weekly": float(opt.repayment_weekly) if opt.repayment_weekly else 0,
            "balloon": float(opt.balloon_residual) if opt.balloon_residual else 0,
        })

    send_quote_sheet_email(
        to_email=data.to_email,
        to_name=data.to_name or sheet.recipient_name or "",
        sender_name=current_user.full_name,
        sheet_title=sheet.title or f"Quote Sheet v{sheet.version}",
        asset_description=asset_description,
        summary_rows=summary_rows,
    )

    # Update recipient info on the sheet
    sheet.recipient_email = data.to_email
    if data.to_name:
        sheet.recipient_name = data.to_name
    db.commit()

    return {"detail": "Quote sheet email sent"}
