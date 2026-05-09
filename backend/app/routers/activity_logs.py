from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.activity_log import ActivityLog
from app.models.loan_application import LoanApplication
from app.models.user import User
from app.schemas.activity_log import ActivityLogOut, PaginatedActivityLogs
from app.services.date_filter import apply_date_range_filter
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/activity-logs", tags=["activity-logs"])


@router.get("", response_model=PaginatedActivityLogs)
def list_activity_logs(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    entity_type: Optional[str] = None,
    action: Optional[str] = None,
    user_id: Optional[str] = None,
    date_range: Optional[Literal["this_month", "last_month", "this_quarter", "last_quarter", "this_year"]] = None,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    query = db.query(ActivityLog).filter(ActivityLog.tenant_id == tenant_id)

    if entity_type:
        query = query.filter(ActivityLog.entity_type == entity_type)
    if action:
        query = query.filter(ActivityLog.action == action)
    if user_id:
        query = query.filter(ActivityLog.user_id == user_id)

    if date_range:
        query = apply_date_range_filter(query, ActivityLog.created_at, date_range)

    total = query.count()
    logs = query.order_by(ActivityLog.created_at.desc()).offset((page - 1) * per_page).limit(per_page).all()

    # Enrich with user names
    user_ids = {log.user_id for log in logs}
    users = {u.id: u.full_name for u in db.query(User).filter(User.id.in_(user_ids)).all()}

    items = []
    for log in logs:
        item = ActivityLogOut.model_validate(log)
        item.user_name = users.get(log.user_id)
        items.append(item)

    return PaginatedActivityLogs(items=items, total=total, page=page, per_page=per_page)


@router.get("/application/{application_id}", response_model=list[ActivityLogOut])
def list_application_activity(
    application_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Return all activity logs for a specific application. Clients may only see their own."""
    if current_user.role.value == "client":
        app = db.query(LoanApplication).filter(
            LoanApplication.id == application_id,
            LoanApplication.user_id == current_user.id,
            LoanApplication.tenant_id == tenant_id,
        ).first()
        if not app:
            raise HTTPException(status_code=404, detail="Application not found")

    logs = (
        db.query(ActivityLog)
        .filter(
            ActivityLog.entity_type == "application",
            ActivityLog.entity_id == application_id,
            ActivityLog.tenant_id == tenant_id,
        )
        .order_by(ActivityLog.created_at.desc())
        .limit(200)
        .all()
    )

    user_ids = {log.user_id for log in logs}
    users = {u.id: u.full_name for u in db.query(User).filter(User.id.in_(user_ids)).all()}

    items = []
    for log in logs:
        item = ActivityLogOut.model_validate(log)
        item.user_name = users.get(log.user_id)
        items.append(item)

    return items
