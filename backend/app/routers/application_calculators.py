from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.middleware.auth import require_role
from app.models.application_calculator import ApplicationCalculator
from app.models.loan_application import LoanApplication
from app.models.user import User

router = APIRouter(prefix="/api/applications", tags=["application-calculators"])

VALID_TYPES = {"bas", "pay", "ratios"}


class CalcCreate(BaseModel):
    calc_type: str
    title: Optional[str] = None
    data: dict = {}


class CalcUpdate(BaseModel):
    title: Optional[str] = None
    data: Optional[dict] = None


def _serialize(calc: ApplicationCalculator) -> dict:
    return {
        "id": calc.id,
        "application_id": calc.application_id,
        "calc_type": calc.calc_type,
        "title": calc.title,
        "data": json.loads(calc.data) if calc.data else {},
        "created_by_id": calc.created_by_id,
        "created_by_name": calc.created_by.full_name if calc.created_by else None,
        "created_at": calc.created_at,
        "updated_at": calc.updated_at,
    }


def _get_app(app_id: str, current_user: User, db: Session) -> LoanApplication:
    app = (
        db.query(LoanApplication)
        .filter(
            LoanApplication.id == app_id,
            LoanApplication.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    return app


@router.get("/{app_id}/calculators")
def list_calculators(
    app_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
):
    _get_app(app_id, current_user, db)
    calcs = (
        db.query(ApplicationCalculator)
        .options(joinedload(ApplicationCalculator.created_by))
        .filter(ApplicationCalculator.application_id == app_id)
        .order_by(ApplicationCalculator.created_at.desc())
        .all()
    )
    return [_serialize(c) for c in calcs]


@router.post("/{app_id}/calculators", status_code=201)
def create_calculator(
    app_id: str,
    body: CalcCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
):
    _get_app(app_id, current_user, db)
    if body.calc_type not in VALID_TYPES:
        raise HTTPException(status_code=422, detail="calc_type must be 'bas', 'pay', or 'ratios'")

    calc = ApplicationCalculator(
        id=str(uuid.uuid4()),
        tenant_id=current_user.tenant_id,
        application_id=app_id,
        calc_type=body.calc_type,
        title=body.title,
        data=json.dumps(body.data),
        created_by_id=current_user.id,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(calc)
    db.commit()
    db.refresh(calc)
    db.refresh(calc, ["created_by"])
    return _serialize(calc)


@router.patch("/{app_id}/calculators/{calc_id}")
def update_calculator(
    app_id: str,
    calc_id: str,
    body: CalcUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
):
    calc = (
        db.query(ApplicationCalculator)
        .options(joinedload(ApplicationCalculator.created_by))
        .filter(
            ApplicationCalculator.id == calc_id,
            ApplicationCalculator.application_id == app_id,
        )
        .first()
    )
    if not calc:
        raise HTTPException(status_code=404, detail="Calculator not found")

    if body.title is not None:
        calc.title = body.title or None
    if body.data is not None:
        calc.data = json.dumps(body.data)
    calc.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(calc)
    return _serialize(calc)


@router.delete("/{app_id}/calculators/{calc_id}", status_code=204)
def delete_calculator(
    app_id: str,
    calc_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
):
    calc = (
        db.query(ApplicationCalculator)
        .filter(
            ApplicationCalculator.id == calc_id,
            ApplicationCalculator.application_id == app_id,
        )
        .first()
    )
    if not calc:
        raise HTTPException(status_code=404, detail="Calculator not found")
    db.delete(calc)
    db.commit()
