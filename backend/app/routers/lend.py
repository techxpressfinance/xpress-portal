from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from typing import Optional
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import LEND_ENABLED
from app.database import SessionLocal, get_db
from app.middleware.auth import get_current_user, require_role
from app.models.document import Document
from app.models.loan_application import LoanApplication
from app.models.user import User
from app.services.access_control import check_application_access
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/lend", tags=["lend"])


class LendConfigOut(BaseModel):
    enabled: bool


class LendDocTypeUpdate(BaseModel):
    lend_document_type: Optional[str] = None


@router.get("/config", response_model=LendConfigOut)
def get_lend_config(
    current_user: User = Depends(get_current_user),
):
    return {"enabled": LEND_ENABLED}


@router.get("/picklists/{name}")
def get_picklist(
    name: str,
    current_user: User = Depends(require_role("admin", "broker")),
):
    if not LEND_ENABLED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Lend integration is not configured")

    from app.services.lend import get_picklist as fetch_picklist

    try:
        data = fetch_picklist(name)
        return data
    except Exception:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Failed to fetch picklist. Please try again later.")


@router.post("/sync/{app_id}")
def trigger_sync(
    app_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
    force_new: bool = Query(False, description="Clear existing Lend ref and create a fresh lead"),
):
    if not LEND_ENABLED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Lend integration is not configured")

    application = db.query(LoanApplication).filter(LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user, db=db)

    if application.lend_sync_status == "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Sync is already in progress")

    # Auto-force when previous sync failed (stale ref likely)
    should_force = force_new or application.lend_sync_status == "failed"

    from app.services.lend import sync_to_lend_background

    background_tasks.add_task(
        sync_to_lend_background,
        application_id=app_id,
        session_factory=SessionLocal,
        force_new=should_force,
    )

    return {"status": "sync_started", "application_id": app_id}


@router.get("/status/{app_id}")
def get_sync_status(
    app_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    application = db.query(LoanApplication).filter(LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user, db=db)

    return {
        "lend_ref": application.lend_ref,
        "lend_sync_status": application.lend_sync_status,
        "lend_sync_error": application.lend_sync_error,
        "lend_synced_at": application.lend_synced_at.isoformat() if application.lend_synced_at else None,
    }


@router.patch("/documents/{doc_id}")
def update_document_lend_type(
    doc_id: str,
    data: LendDocTypeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    doc = db.query(Document).filter(Document.id == doc_id, Document.tenant_id == tenant_id).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    application = db.query(LoanApplication).filter(LoanApplication.id == doc.application_id, LoanApplication.tenant_id == tenant_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user, db=db)

    doc.lend_document_type = data.lend_document_type
    db.commit()
    db.refresh(doc)

    return {
        "id": doc.id,
        "lend_document_type": doc.lend_document_type,
        "lend_uploaded": doc.lend_uploaded,
    }
