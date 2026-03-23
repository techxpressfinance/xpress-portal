from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.activity_log import ActivityLog
from app.models.user import User
from app.schemas.activity_log import ActivityLogOut, PaginatedActivityLogs

router = APIRouter(prefix="/api/activity-logs", tags=["activity-logs"])


@router.get("", response_model=PaginatedActivityLogs)
def list_activity_logs(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    entity_type: str | None = None,
    action: str | None = None,
    user_id: str | None = None,
    date_range: str | None = None,
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
        from datetime import datetime, timedelta, timezone
        now = datetime.now(timezone.utc)
        if date_range == "this_month":
            start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            query = query.filter(ActivityLog.created_at >= start)
        elif date_range == "last_month":
            first_this_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            start = (first_this_month - timedelta(days=1)).replace(day=1)
            query = query.filter(ActivityLog.created_at >= start, ActivityLog.created_at < first_this_month)
        elif date_range == "this_quarter":
            quarter_month = ((now.month - 1) // 3) * 3 + 1
            start = now.replace(month=quarter_month, day=1, hour=0, minute=0, second=0, microsecond=0)
            query = query.filter(ActivityLog.created_at >= start)
        elif date_range == "last_quarter":
            quarter_month = ((now.month - 1) // 3) * 3 + 1
            start_this_q = now.replace(month=quarter_month, day=1, hour=0, minute=0, second=0, microsecond=0)
            if quarter_month > 3:
                start_last_q = start_this_q.replace(month=quarter_month - 3)
            else:
                start_last_q = start_this_q.replace(year=now.year - 1, month=10)
            query = query.filter(ActivityLog.created_at >= start_last_q, ActivityLog.created_at < start_this_q)
        elif date_range == "this_year":
            start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
            query = query.filter(ActivityLog.created_at >= start)

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
