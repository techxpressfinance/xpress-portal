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
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
):
    query = db.query(ActivityLog)

    if entity_type:
        query = query.filter(ActivityLog.entity_type == entity_type)
    if action:
        query = query.filter(ActivityLog.action == action)

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
