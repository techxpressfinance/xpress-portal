"""Clawbacks on settled loans — recorded and seen by the whole team (admins and
brokers). See services/clawbacks.py."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.application_clawback import ApplicationClawback
from app.models.loan_application import ApplicationStatus, LoanApplication
from app.models.user import User
from app.services import clawbacks as svc
from app.services.access_control import check_application_access
from app.services.activity_log import log_activity
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api", tags=["clawbacks"])


class ClawbackIn(BaseModel):
    clawback_date: date
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    reason: Optional[str] = Field(None, max_length=2000)
    high_priority: bool = True


class ClawbackUpdate(BaseModel):
    clawback_date: Optional[date] = None
    amount: Optional[Decimal] = Field(None, gt=0, max_digits=12, decimal_places=2)
    reason: Optional[str] = Field(None, max_length=2000)
    high_priority: Optional[bool] = None


def _application(db: Session, app_id: str, tenant_id: str, user: User) -> LoanApplication:
    app = db.query(LoanApplication).filter(
        LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None),
    ).first()
    if not app:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(app, user, db=db)
    return app


def _clawback(db: Session, app: LoanApplication, clawback_id: str) -> ApplicationClawback:
    cb = db.query(ApplicationClawback).filter(
        ApplicationClawback.id == clawback_id, ApplicationClawback.application_id == app.id,
        ApplicationClawback.tenant_id == app.tenant_id,
    ).first()
    if not cb:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clawback not found")
    return cb


def _check_date(value: Optional[date]) -> None:
    if value is not None and value > date.today():
        raise HTTPException(status_code=400, detail="A clawback can't be dated in the future")


@router.get("/applications/{app_id}/clawbacks")
def list_application_clawbacks(
    app_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    app = _application(db, app_id, tenant_id, current_user)
    return svc.list_for(db, tenant_id, application_ids=[app.id])


@router.post("/applications/{app_id}/clawbacks", status_code=status.HTTP_201_CREATED)
def create_clawback(
    app_id: str,
    data: ClawbackIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    app = _application(db, app_id, tenant_id, current_user)
    if app.status != ApplicationStatus.settled:
        raise HTTPException(status_code=400, detail="Only a settled loan can have a clawback")
    _check_date(data.clawback_date)
    cb = svc.create(db, app, current_user, clawback_date=data.clawback_date, amount=data.amount,
                    reason=data.reason, high_priority=data.high_priority)
    log_activity(db, current_user.id, "clawback_recorded", "application", app.id,
                 {"clawback_id": cb.id, "amount": str(cb.amount), "date": cb.clawback_date.isoformat()},
                 tenant_id=tenant_id)
    db.commit()
    return svc.list_for(db, tenant_id, application_ids=[app.id])


@router.patch("/applications/{app_id}/clawbacks/{clawback_id}")
def update_clawback(
    app_id: str,
    clawback_id: str,
    data: ClawbackUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    app = _application(db, app_id, tenant_id, current_user)
    cb = _clawback(db, app, clawback_id)
    changes = data.model_dump(exclude_unset=True)
    _check_date(changes.get("clawback_date"))
    svc.update(db, app, cb, current_user, changes)
    log_activity(db, current_user.id, "clawback_updated", "application", app.id,
                 {"clawback_id": cb.id, "fields": sorted(changes)}, tenant_id=tenant_id)
    db.commit()
    return svc.list_for(db, tenant_id, application_ids=[app.id])


@router.delete("/applications/{app_id}/clawbacks/{clawback_id}")
def delete_clawback(
    app_id: str,
    clawback_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    app = _application(db, app_id, tenant_id, current_user)
    cb = _clawback(db, app, clawback_id)
    log_activity(db, current_user.id, "clawback_deleted", "application", app.id,
                 {"clawback_id": cb.id, "amount": str(cb.amount), "date": cb.clawback_date.isoformat()},
                 tenant_id=tenant_id)
    svc.delete(db, cb)
    db.commit()
    return svc.list_for(db, tenant_id, application_ids=[app.id])


@router.get("/clawbacks")
def list_clawbacks(
    contact_id: Optional[str] = Query(None, max_length=36),
    organization_id: Optional[str] = Query(None, max_length=36),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Clawbacks across a client's (contact_id) or an entity's
    (organization_id) loans."""
    if not contact_id and not organization_id:
        raise HTTPException(status_code=400, detail="Give a contact or an entity")
    return svc.list_for(db, tenant_id, contact_id=contact_id, organization_id=organization_id)
