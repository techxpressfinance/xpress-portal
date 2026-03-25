from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.activity_log import ActivityLog
from app.models.user import User
from app.schemas.activity_log import ActivityLogOut, PaginatedActivityLogs
from app.services.date_filter import apply_date_range_filter

router = APIRouter(prefix="/api/activity-logs", tags=["activity-logs"])


@router.get("", response_model=PaginatedActivityLogs)
def list_activity_logs(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    entity_type: str | None = None,
    action: str | None = None,
    user_id: str | None = None,
    date_range: Literal["this_month", "last_month", "this_quarter", "last_quarter", "this_year"] | None = None,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
):
    query = db.query(ActivityLog)

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
