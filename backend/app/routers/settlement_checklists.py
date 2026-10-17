from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.loan_application import LoanApplication
from app.models.user import User
from app.schemas.settlement_checklist import SettlementChecklistUpdate
from app.services import settlement_checklist as checklists
from app.services.access_control import check_application_access
from app.services.activity_log import log_activity
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/applications/{app_id}/settlement-checklist", tags=["settlement-checklist"])


def _get_application(app_id: str, tenant_id: str, db: Session, user: User) -> LoanApplication:
    application = db.query(LoanApplication).filter(
        LoanApplication.id == app_id,
        LoanApplication.tenant_id == tenant_id,
        LoanApplication.deleted_at.is_(None),
    ).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, user, db=db)
    return application


@router.get("")
def get_settlement_checklist(
    app_id: str,
    purpose: str = Query(..., max_length=20),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    application = _get_application(app_id, tenant_id, db, current_user)
    return checklists.serialize(db, application, purpose)


@router.put("")
def save_settlement_checklist(
    app_id: str,
    payload: SettlementChecklistUpdate,
    purpose: str = Query(..., max_length=20),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    application = _get_application(app_id, tenant_id, db, current_user)
    before = checklists.serialize(db, application, purpose)
    checklist = checklists.save(
        db, application, purpose, payload.kind, payload.answers,
        current_user.id, current_user.full_name, tenant_id,
    )
    db.flush()
    # Logged once, when the pack is first finished — not on every later save.
    if checklist.completed_at is not None and before["completed_at"] is None:
        log_activity(
            db, current_user.id, "settlement_checklist_completed", "application", application.id,
            {"checklist": checklists.TEMPLATES[payload.kind]["title"]},
            tenant_id=tenant_id,
        )
    db.commit()
    return checklists.serialize(db, application, purpose)
