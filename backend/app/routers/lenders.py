from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.lender import Lender
from app.models.lender_submission import LenderSubmission, SubmissionStatus
from app.models.loan_application import LoanApplication
from app.models.user import User
from app.schemas.lender import LenderCreate, LenderOut, LenderUpdate

router = APIRouter(prefix="/api/lenders", tags=["lenders"])


@router.get("", response_model=list[LenderOut])
def list_lenders(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
):
    query = db.query(Lender).order_by(Lender.name)
    if current_user.role.value != "admin":
        query = query.filter(Lender.is_active.is_(True))
    return query.all()


@router.post("", response_model=LenderOut, status_code=status.HTTP_201_CREATED)
def create_lender(
    data: LenderCreate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
):
    existing = db.query(Lender).filter(Lender.name == data.name).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A lender with this name already exists")
    lender = Lender(**data.model_dump())
    db.add(lender)
    db.commit()
    db.refresh(lender)
    return lender


@router.patch("/{lender_id}", response_model=LenderOut)
def update_lender(
    lender_id: str,
    data: LenderUpdate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
):
    lender = db.query(Lender).filter(Lender.id == lender_id).first()
    if not lender:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lender not found")
    if data.name is not None:
        dup = db.query(Lender).filter(Lender.name == data.name, Lender.id != lender_id).first()
        if dup:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A lender with this name already exists")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(lender, field, value)
    db.commit()
    db.refresh(lender)
    return lender


@router.delete("/{lender_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_lender(
    lender_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
):
    lender = db.query(Lender).filter(Lender.id == lender_id).first()
    if not lender:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lender not found")
    lender.is_active = False
    db.commit()


@router.get("/analytics")
def lender_analytics(
    period: str = Query("all", pattern="^(30d|90d|6m|1y|all)$"),
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
):
    # Determine date cutoff
    now = datetime.now(timezone.utc)
    cutoff = None
    if period == "30d":
        cutoff = now - timedelta(days=30)
    elif period == "90d":
        cutoff = now - timedelta(days=90)
    elif period == "6m":
        cutoff = now - timedelta(days=182)
    elif period == "1y":
        cutoff = now - timedelta(days=365)

    base_query = db.query(LenderSubmission).join(Lender)
    if cutoff:
        base_query = base_query.filter(LenderSubmission.submitted_at >= cutoff)

    submissions = base_query.all()

    # --- by_lender ---
    lender_stats: dict[str, dict] = {}
    for s in submissions:
        lid = s.lender_id
        if lid not in lender_stats:
            lender_stats[lid] = {
                "lender_id": lid,
                "lender_name": s.lender.name if s.lender else "Unknown",
                "total_submissions": 0,
                "approved": 0,
                "declined": 0,
                "conditional": 0,
                "pending": 0,
                "withdrawn": 0,
                "turnaround_days": [],
            }
        st = lender_stats[lid]
        st["total_submissions"] += 1
        st[s.status.value] += 1
        if s.responded_at and s.submitted_at:
            delta = (s.responded_at - s.submitted_at).total_seconds() / 86400
            st["turnaround_days"].append(delta)

    by_lender = []
    for st in lender_stats.values():
        td = st.pop("turnaround_days")
        decided = st["approved"] + st["declined"] + st["conditional"]
        st["approval_rate"] = round(st["approved"] / decided * 100, 1) if decided > 0 else 0
        st["avg_turnaround_days"] = round(sum(td) / len(td), 1) if td else None
        by_lender.append(st)

    # --- by_loan_type ---
    loan_type_stats: dict[tuple[str, str], dict] = {}
    for s in submissions:
        app = s.application
        lt = app.loan_type.value if app else "unknown"
        ln = s.lender.name if s.lender else "Unknown"
        key = (lt, ln)
        if key not in loan_type_stats:
            loan_type_stats[key] = {"loan_type": lt, "lender_name": ln, "count": 0, "approved": 0}
        loan_type_stats[key]["count"] += 1
        if s.status == SubmissionStatus.approved:
            loan_type_stats[key]["approved"] += 1
    by_loan_type = list(loan_type_stats.values())

    # --- monthly_trend ---
    monthly: dict[str, dict] = {}
    for s in submissions:
        month_key = s.submitted_at.strftime("%Y-%m")
        if month_key not in monthly:
            monthly[month_key] = {"month": month_key, "submissions": 0, "approvals": 0}
        monthly[month_key]["submissions"] += 1
        if s.status == SubmissionStatus.approved:
            monthly[month_key]["approvals"] += 1
    monthly_trend = sorted(monthly.values(), key=lambda x: x["month"])

    # --- totals ---
    total = len(submissions)
    total_approved = sum(1 for s in submissions if s.status == SubmissionStatus.approved)
    total_declined = sum(1 for s in submissions if s.status == SubmissionStatus.declined)
    decided_total = total_approved + total_declined + sum(1 for s in submissions if s.status == SubmissionStatus.conditional)
    all_turnaround = [
        (s.responded_at - s.submitted_at).total_seconds() / 86400
        for s in submissions
        if s.responded_at and s.submitted_at
    ]

    return {
        "by_lender": by_lender,
        "by_loan_type": by_loan_type,
        "monthly_trend": monthly_trend,
        "totals": {
            "total_submissions": total,
            "total_approved": total_approved,
            "total_declined": total_declined,
            "overall_approval_rate": round(total_approved / decided_total * 100, 1) if decided_total > 0 else 0,
            "avg_turnaround_days": round(sum(all_turnaround) / len(all_turnaround), 1) if all_turnaround else None,
        },
    }
