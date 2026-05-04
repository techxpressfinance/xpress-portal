from __future__ import annotations

from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.loan_application import ApplicationStatus, LoanApplication

router = APIRouter(prefix="/api/public/apply", tags=["public-apply"])


class PublicApplyOut(BaseModel):
    id: str
    applicant_first_name: Optional[str] = None
    applicant_last_name: Optional[str] = None
    applicant_mobile: Optional[str] = None
    loan_type: str
    amount: Decimal
    notes: Optional[str] = None
    client_invite_email: Optional[str] = None


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


def _get_draft_by_token(token: str, db: Session) -> LoanApplication:
    app = db.query(LoanApplication).filter(
        LoanApplication.client_invite_token == token
    ).first()
    if not app:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid or expired link")
    return app


@router.get("/{token}", response_model=PublicApplyOut)
def get_public_application(token: str, db: Session = Depends(get_db)):
    app = _get_draft_by_token(token, db)
    return PublicApplyOut(
        id=app.id,
        applicant_first_name=app.applicant_first_name,
        applicant_last_name=app.applicant_last_name,
        applicant_mobile=app.applicant_mobile,
        loan_type=app.loan_type.value,
        amount=app.amount,
        notes=app.notes,
        client_invite_email=app.client_invite_email,
    )


@router.post("/{token}")
def submit_public_application(
    token: str,
    data: PublicApplySubmit,
    db: Session = Depends(get_db),
):
    app = _get_draft_by_token(token, db)
    if app.status != ApplicationStatus.draft:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This application has already been submitted",
        )

    for key, value in data.model_dump(exclude_none=True).items():
        setattr(app, key, value)
    app.status = ApplicationStatus.application_received
    db.commit()
    return {"success": True}
