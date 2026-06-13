from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.rate_limit import RateLimiter
from app.models.loan_applicant import LoanApplicant
from app.models.loan_application import ApplicationStatus, LoanApplication
from app.services.activity_log import log_activity
from app.services.tenant_scope import get_tenant_id

_INVITE_TOKEN_TTL_DAYS = 7

router = APIRouter(prefix="/api/public/apply", tags=["public-apply"])

_public_apply_limiter = RateLimiter(max_requests=10, window_seconds=60)


class PublicApplyOut(BaseModel):
    id: str
    applicant_first_name: Optional[str] = None
    applicant_last_name: Optional[str] = None
    applicant_mobile: Optional[str] = None
    loan_type: str
    amount: Decimal
    notes: Optional[str] = None
    client_invite_email: Optional[str] = None
    # True when the token belongs to an additional director (not the primary applicant)
    is_director: bool = False
    business_name: Optional[str] = None


class PublicApplySubmit(BaseModel):
    applicant_first_name: Optional[str] = None
    applicant_middle_name: Optional[str] = None
    applicant_last_name: Optional[str] = None
    applicant_dob: Optional[str] = None
    applicant_gender: Optional[str] = None
    applicant_marital_status: Optional[str] = None
    applicant_mobile: Optional[str] = None
    applicant_address: Optional[str] = None
    applicant_suburb: Optional[str] = None
    applicant_state: Optional[str] = None
    applicant_postcode: Optional[str] = None
    applicant_residency_status: Optional[str] = None
    id_type: Optional[str] = None
    id_number: Optional[str] = None
    id_issuing_state_country: Optional[str] = None
    id_expiry_date: Optional[str] = None
    residential_status: Optional[str] = None
    employment_category: Optional[str] = None
    employer_name: Optional[str] = None
    employer_industry: Optional[str] = None
    job_title: Optional[str] = None
    income_frequency: Optional[str] = None
    gross_income: Optional[Decimal] = None
    previously_declined: Optional[bool] = None
    change_of_circumstances: Optional[bool] = None
    signature_name: Optional[str] = None
    notes: Optional[str] = None
    lend_extra_data: Optional[str] = None


def _check_token_age(sent_at: Optional[datetime]) -> None:
    if not sent_at:
        return
    if sent_at.tzinfo is None:
        sent_at = sent_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) - sent_at > timedelta(days=_INVITE_TOKEN_TTL_DAYS):
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This invite link has expired. Please request a new one.",
        )


def _resolve_token(
    token: str, tenant_id: str, db: Session
) -> Union[LoanApplication, LoanApplicant]:
    """Resolve a magic-link token to either the primary application or a director row."""
    app = db.query(LoanApplication).filter(
        LoanApplication.client_invite_token == token,
        LoanApplication.tenant_id == tenant_id,
    ).first()
    if app:
        _check_token_age(app.client_invite_sent_at)
        return app

    applicant = db.query(LoanApplicant).filter(
        LoanApplicant.invite_token == token,
        LoanApplicant.tenant_id == tenant_id,
    ).first()
    if applicant:
        _check_token_age(applicant.invite_sent_at)
        return applicant

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid or expired link")


# Fields a director may submit on their own block (subset of PublicApplySubmit
# that exists on the LoanApplicant model).
_APPLICANT_SUBMIT_FIELDS = {
    "applicant_first_name", "applicant_middle_name", "applicant_last_name",
    "applicant_dob", "applicant_gender", "applicant_marital_status",
    "applicant_mobile", "applicant_address", "applicant_suburb",
    "applicant_state", "applicant_postcode", "applicant_residency_status",
    "employment_category", "employer_name", "employer_industry", "job_title",
    "income_frequency", "gross_income", "previously_declined",
    "change_of_circumstances", "signature_name", "lend_extra_data",
}

# ID details are folded into lend_extra_data.identification rather than set as
# columns, so they're handled separately from the generic field copy.
_IDENTIFICATION_KEYS = {"id_type", "id_number", "id_issuing_state_country"}


def _apply_identification(target, data: "PublicApplySubmit") -> None:
    """Fold the applicant's ID details into ``target.lend_extra_data.identification``.

    Mirrors how NewApplication stores identification (a single-entry list) and
    preserves any other keys already present in lend_extra_data.
    """
    if not (data.id_number or data.id_type):
        return
    try:
        extra = json.loads(target.lend_extra_data) if target.lend_extra_data else {}
    except (ValueError, TypeError):
        extra = {}
    if not isinstance(extra, dict):
        extra = {}

    is_license = (data.id_type or "").lower() in ("license", "licence")
    entry: dict = {
        "type": "Drivers Licence" if is_license else "Passport",
        "number": data.id_number or "",
    }
    if data.id_issuing_state_country:
        entry["state" if is_license else "country"] = data.id_issuing_state_country
    if data.id_expiry_date:
        entry["expiry_date"] = data.id_expiry_date
    extra["identification"] = [entry]
    target.lend_extra_data = json.dumps(extra)


@router.get("/{token}", response_model=PublicApplyOut)
def get_public_application(
    token: str,
    request: Request,
    db: Session = Depends(get_db),
    tenant_id: str = Depends(get_tenant_id),
):
    _public_apply_limiter.check(request)
    resolved = _resolve_token(token, tenant_id, db)

    if isinstance(resolved, LoanApplicant):
        app = resolved.application
        return PublicApplyOut(
            id=resolved.id,
            applicant_first_name=resolved.applicant_first_name,
            applicant_last_name=resolved.applicant_last_name,
            applicant_mobile=resolved.applicant_mobile,
            loan_type=app.loan_type.value,
            amount=app.amount,
            notes=app.notes,
            client_invite_email=resolved.invite_email,
            is_director=True,
            business_name=app.business_name,
        )

    return PublicApplyOut(
        id=resolved.id,
        applicant_first_name=resolved.applicant_first_name,
        applicant_last_name=resolved.applicant_last_name,
        applicant_mobile=resolved.applicant_mobile,
        loan_type=resolved.loan_type.value,
        amount=resolved.amount,
        notes=resolved.notes,
        client_invite_email=resolved.client_invite_email,
        is_director=False,
        business_name=resolved.business_name,
    )


@router.post("/{token}")
def submit_public_application(
    token: str,
    data: PublicApplySubmit,
    request: Request,
    db: Session = Depends(get_db),
    tenant_id: str = Depends(get_tenant_id),
):
    _public_apply_limiter.check(request)
    resolved = _resolve_token(token, tenant_id, db)

    if isinstance(resolved, LoanApplicant):
        if resolved.completed_at:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Your details have already been submitted",
            )
        payload = data.model_dump(exclude_none=True)
        for key, value in payload.items():
            if key in _APPLICANT_SUBMIT_FIELDS:
                setattr(resolved, key, value)
        _apply_identification(resolved, data)
        resolved.completed_at = datetime.now(timezone.utc)
        if resolved.signature_name:
            resolved.signed_at = datetime.now(timezone.utc)
        log_activity(
            db, resolved.application.user_id, "director_completed_form",
            "application", resolved.application_id, tenant_id=tenant_id,
        )
        db.commit()
        return {"success": True}

    # Primary applicant on the application itself
    if resolved.status != ApplicationStatus.draft:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This application has already been submitted",
        )
    for key, value in data.model_dump(exclude_none=True).items():
        if key in _IDENTIFICATION_KEYS:
            continue
        setattr(resolved, key, value)
    _apply_identification(resolved, data)
    resolved.status = ApplicationStatus.application_received
    log_activity(db, resolved.user_id, "submitted_public_form", "application", resolved.id, tenant_id=tenant_id)
    db.commit()
    return {"success": True}
