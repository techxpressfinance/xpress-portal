from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.lender import Lender
from app.models.lender_submission import LenderSubmission, SubmissionStatus
from app.models.loan_application import LoanApplication
from app.models.user import User
from app.schemas.lender_submission import LenderSubmissionCreate, LenderSubmissionOut, LenderSubmissionUpdate
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/applications/{app_id}/submissions", tags=["lender-submissions"])


def _serialize(sub: LenderSubmission) -> dict:
    return {
        "id": sub.id,
        "application_id": sub.application_id,
        "lender_id": sub.lender_id,
        "lender_name": sub.lender.name if sub.lender else None,
        "submitted_by_id": sub.submitted_by_id,
        "submitted_by_name": sub.submitted_by.full_name if sub.submitted_by else None,
        "status": sub.status.value,
        "submitted_at": sub.submitted_at.isoformat() if sub.submitted_at else None,
        "responded_at": sub.responded_at.isoformat() if sub.responded_at else None,
        "offered_rate": float(sub.offered_rate) if sub.offered_rate is not None else None,
        "offered_amount": float(sub.offered_amount) if sub.offered_amount is not None else None,
        "conditions": sub.conditions,
        "notes": sub.notes,
        "created_at": sub.created_at.isoformat(),
        "updated_at": sub.updated_at.isoformat(),
    }


@router.get("")
def list_submissions(
    app_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    app = db.query(LoanApplication).filter(LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id).first()
    if not app:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    subs = (
        db.query(LenderSubmission)
        .filter(LenderSubmission.application_id == app_id)
        .order_by(LenderSubmission.submitted_at.desc())
        .all()
    )
    return [_serialize(s) for s in subs]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_submission(
    app_id: str,
    data: LenderSubmissionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    app = db.query(LoanApplication).filter(LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id).first()
    if not app:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    lender = db.query(Lender).filter(Lender.id == data.lender_id, Lender.is_active.is_(True)).first()
    if not lender:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lender not found")

    existing = (
        db.query(LenderSubmission)
        .filter(LenderSubmission.application_id == app_id, LenderSubmission.lender_id == data.lender_id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already submitted to this lender")

    try:
        sub_status = SubmissionStatus(data.status)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid status: {data.status}")

    sub = LenderSubmission(
        application_id=app_id,
        lender_id=data.lender_id,
        submitted_by_id=current_user.id,
        tenant_id=tenant_id,
        status=sub_status,
        submitted_at=data.submitted_at or datetime.now(timezone.utc),
        offered_rate=data.offered_rate,
        offered_amount=data.offered_amount,
        conditions=data.conditions,
        notes=data.notes,
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return _serialize(sub)


@router.patch("/{sub_id}")
def update_submission(
    app_id: str,
    sub_id: str,
    data: LenderSubmissionUpdate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    sub = (
        db.query(LenderSubmission)
        .filter(LenderSubmission.id == sub_id, LenderSubmission.application_id == app_id)
        .first()
    )
    if not sub:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    update_data = data.model_dump(exclude_unset=True)
    if "status" in update_data:
        try:
            update_data["status"] = SubmissionStatus(update_data["status"])
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid status: {update_data['status']}")

    for field, value in update_data.items():
        setattr(sub, field, value)
    db.commit()
    db.refresh(sub)
    return _serialize(sub)


@router.delete("/{sub_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_submission(
    app_id: str,
    sub_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    sub = (
        db.query(LenderSubmission)
        .filter(LenderSubmission.id == sub_id, LenderSubmission.application_id == app_id)
        .first()
    )
    if not sub:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    db.delete(sub)
    db.commit()
