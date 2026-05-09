from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, desc, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.application_broker import ApplicationBroker
from app.models.loan_application import ApplicationStatus, LoanApplication
from app.models.user import User, UserRole
from app.models.task import Task, TaskStatus
from app.models.lender_submission import LenderSubmission, SubmissionStatus
from app.models.lender import Lender
from app.models.referral import Referral
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
            referrer_ids = db.query(User.id).filter(
                User.role == UserRole.referrer, User.tenant_id == tenant_id
            )
            return q.filter(
                or_(
                    LoanApplication.id.in_(
                        db.query(ApplicationBroker.application_id).filter(
                            ApplicationBroker.broker_id == current_user.id
                        )
                    ),
                    LoanApplication.user_id.in_(referrer_ids),
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
            LoanApplication.status.in_([ApplicationStatus.settled, ApplicationStatus.rejected])
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
            
    # ── 30-Day Daily Trend ──
    day_keys: list[str] = []
    d_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    for _ in range(30):
        day_keys.insert(0, d_day.strftime("%Y-%m-%d"))
        d_day = d_day - timedelta(days=1)
        
    start_day = datetime.strptime(day_keys[0], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    day_rows = scoped(
        db.query(LoanApplication.created_at).filter(LoanApplication.created_at >= start_day)
    ).all()
    
    day_counts = {k: 0 for k in day_keys}
    for (created_at,) in day_rows:
        key = created_at.strftime("%Y-%m-%d")
        if key in day_counts:
            day_counts[key] += 1

    # ── Action Items (Tasks) ──
    tasks_query = db.query(Task).filter(
        Task.tenant_id == tenant_id,
        Task.status.in_([TaskStatus.todo, TaskStatus.in_progress])
    )
    if current_user.role == UserRole.broker:
        tasks_query = tasks_query.filter(Task.assigned_to_id == current_user.id)
    
    action_items = tasks_query.order_by(Task.due_date.asc().nullslast(), Task.created_at.desc()).limit(5).all()
    
    action_items_list = []
    for t in action_items:
        action_items_list.append({
            "id": t.id,
            "title": t.title,
            "status": t.status.value,
            "priority": t.priority.value,
            "due_date": t.due_date.isoformat() if t.due_date else None,
            "application_id": t.application_id
        })

    # ── Lender Insights ──
    lender_query = db.query(
        Lender.name,
        func.count(LenderSubmission.id).label("approvals")
    ).select_from(LenderSubmission).join(Lender, LenderSubmission.lender_id == Lender.id)\
    .filter(LenderSubmission.tenant_id == tenant_id, LenderSubmission.status == SubmissionStatus.approved)
    
    top_lenders_rows = lender_query.group_by(Lender.id).order_by(desc("approvals")).limit(3).all()
    top_lenders = [{"name": r[0], "approvals": r[1]} for r in top_lenders_rows]
    
    # ── Referral Leaderboard ──
    referral_query = db.query(
        User.full_name,
        func.count(Referral.id).label("count")
    ).select_from(Referral).join(User, Referral.referrer_id == User.id)\
    .filter(Referral.tenant_id == tenant_id)
    
    top_referrers_rows = referral_query.group_by(User.id).order_by(desc("count")).limit(3).all()
    top_referrers = [{"name": r[0], "count": r[1]} for r in top_referrers_rows]

    return {
        "status_counts": status_counts,
        "volume_by_status": volume_by_status,
        "count_by_loan_type": count_by_loan_type,
        "volume_by_loan_type": volume_by_loan_type,
        "apps_this_week": apps_this_week,
        "apps_last_week": apps_last_week,
        "avg_turnaround_days": avg_turnaround_days,
        "monthly_trend": [{"month": k, "count": v} for k, v in month_counts.items()],
        "daily_trend": [{"date": k, "count": v} for k, v in day_counts.items()],
        "action_items": action_items_list,
        "top_lenders": top_lenders,
        "top_referrers": top_referrers,
    }
