from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.application_broker import ApplicationBroker
from app.models.loan_application import ApplicationStatus, LoanApplication
from app.models.user import User, UserRole
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/stats")
def get_dashboard_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    now = datetime.now(timezone.utc)

    def scoped(q):
        q = q.filter(LoanApplication.tenant_id == tenant_id)
        if current_user.role == UserRole.broker:
            return q.filter(
                LoanApplication.id.in_(
                    db.query(ApplicationBroker.application_id).filter(
                        ApplicationBroker.broker_id == current_user.id
                    )
                )
            )
        return q

    # ── Counts & volume by status ──
    status_rows = scoped(
        db.query(
            LoanApplication.status,
            func.count(LoanApplication.id),
            func.coalesce(func.sum(LoanApplication.amount), 0),
        )
    ).group_by(LoanApplication.status).all()

    status_counts: dict[str, int] = {}
    volume_by_status: dict[str, float] = {}
    for s, count, volume in status_rows:
        status_counts[s.value] = count
        volume_by_status[s.value] = float(volume)

    # ── Count & volume by loan type ──
    type_rows = scoped(
        db.query(
            LoanApplication.loan_type,
            func.count(LoanApplication.id),
            func.coalesce(func.sum(LoanApplication.amount), 0),
        )
    ).group_by(LoanApplication.loan_type).all()

    count_by_loan_type: dict[str, int] = {}
    volume_by_loan_type: dict[str, float] = {}
    for lt, count, volume in type_rows:
        count_by_loan_type[lt.value] = count
        volume_by_loan_type[lt.value] = float(volume)

    # ── This week vs last week (Monday-based) ──
    today = now.date()
    monday_this = today - timedelta(days=today.weekday())
    monday_last = monday_this - timedelta(weeks=1)
    start_this = datetime.combine(monday_this, datetime.min.time()).replace(tzinfo=timezone.utc)
    start_last = datetime.combine(monday_last, datetime.min.time()).replace(tzinfo=timezone.utc)

    apps_this_week = scoped(
        db.query(func.count(LoanApplication.id)).filter(LoanApplication.created_at >= start_this)
    ).scalar() or 0
    apps_last_week = scoped(
        db.query(func.count(LoanApplication.id)).filter(
            LoanApplication.created_at >= start_last,
            LoanApplication.created_at < start_this,
        )
    ).scalar() or 0

    # ── Average turnaround (created → updated for approved/rejected) ──
    completed = scoped(
        db.query(LoanApplication.created_at, LoanApplication.updated_at).filter(
            LoanApplication.status.in_([ApplicationStatus.approved, ApplicationStatus.rejected])
        )
    ).all()
    if completed:
        total_secs = sum((r.updated_at - r.created_at).total_seconds() for r in completed)
        avg_turnaround_days = round(total_secs / len(completed) / 86400, 1)
    else:
        avg_turnaround_days = None

    # ── Monthly trend (last 6 months) ──
    month_keys: list[str] = []
    d = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    for _ in range(6):
        month_keys.insert(0, d.strftime("%Y-%m"))
        d = (d - timedelta(days=1)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    start_month = datetime.strptime(month_keys[0] + "-01", "%Y-%m-%d").replace(tzinfo=timezone.utc)
    rows = scoped(
        db.query(LoanApplication.created_at).filter(LoanApplication.created_at >= start_month)
    ).all()

    month_counts = {k: 0 for k in month_keys}
    for (created_at,) in rows:
        key = created_at.strftime("%Y-%m")
        if key in month_counts:
            month_counts[key] += 1

    return {
        "status_counts": status_counts,
        "volume_by_status": volume_by_status,
        "count_by_loan_type": count_by_loan_type,
        "volume_by_loan_type": volume_by_loan_type,
        "apps_this_week": apps_this_week,
        "apps_last_week": apps_last_week,
        "avg_turnaround_days": avg_turnaround_days,
        "monthly_trend": [{"month": k, "count": v} for k, v in month_counts.items()],
    }
