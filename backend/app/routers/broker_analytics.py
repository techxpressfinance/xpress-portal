from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.application_broker import ApplicationBroker
from app.models.loan_application import ApplicationStatus, LoanApplication
from app.models.user import User, UserRole
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/broker-analytics", tags=["broker-analytics"])

# Statuses with a final outcome — the denominator for conversion rate.
DECIDED_STATUSES = {
    ApplicationStatus.settled,
    ApplicationStatus.rejected,
    ApplicationStatus.not_proceeding,
}


def _period_start(period: str, date_from: str | None) -> datetime | None:
    now = datetime.now(timezone.utc)
    first_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if period == "custom":
        if not date_from:
            return None
        try:
            return datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date_from")
    if period == "6m":
        d = first_of_month
        for _ in range(5):
            d = (d - timedelta(days=1)).replace(day=1)
        return d
    if period == "12m":
        d = first_of_month
        for _ in range(11):
            d = (d - timedelta(days=1)).replace(day=1)
        return d
    if period == "ytd":
        return now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    return None  # "all"


def _period_end(period: str, date_to: str | None) -> datetime | None:
    if period == "custom" and date_to:
        try:
            return datetime.fromisoformat(date_to).replace(
                tzinfo=timezone.utc, hour=23, minute=59, second=59
            )
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date_to")
    return None


def _month_keys(start: datetime, end: datetime) -> list[str]:
    keys: list[str] = []
    d = start.replace(day=1)
    end_key = end.strftime("%Y-%m")
    while True:
        key = d.strftime("%Y-%m")
        keys.append(key)
        if key >= end_key or len(keys) >= 120:
            break
        # advance one month
        d = (d + timedelta(days=32)).replace(day=1)
    return keys


def _broker_filter(db: Session, broker_id: str):
    """Apps attributed to a broker: m2m assignment or the legacy single-broker FK."""
    return or_(
        LoanApplication.id.in_(
            db.query(ApplicationBroker.application_id).filter(
                ApplicationBroker.broker_id == broker_id
            )
        ),
        LoanApplication.assigned_broker_id == broker_id,
    )


def _effective_broker_id(current_user: User, broker_id: str | None) -> str | None:
    # Brokers only ever see their own numbers; admins can filter to any broker.
    if current_user.role == UserRole.broker:
        return current_user.id
    return broker_id


def _attribution_map(db: Session, tenant_id: str) -> dict[str, set[str]]:
    """application_id -> set of broker user ids (m2m + legacy FK)."""
    app_brokers: dict[str, set[str]] = {}
    for app_id, b_id in db.query(
        ApplicationBroker.application_id, ApplicationBroker.broker_id
    ).filter(ApplicationBroker.tenant_id == tenant_id):
        app_brokers.setdefault(app_id, set()).add(b_id)
    for app_id, b_id in (
        db.query(LoanApplication.id, LoanApplication.assigned_broker_id)
        .filter(
            LoanApplication.tenant_id == tenant_id,
            LoanApplication.assigned_broker_id.isnot(None),
        )
    ):
        app_brokers.setdefault(app_id, set()).add(b_id)
    return app_brokers


@router.get("/overview")
def broker_analytics_overview(
    period: str = Query("12m", pattern="^(6m|12m|ytd|all|custom)$"),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    broker_id: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    now = datetime.now(timezone.utc)
    start = _period_start(period, date_from)
    end = _period_end(period, date_to)
    broker_id = _effective_broker_id(current_user, broker_id)

    q = db.query(
        LoanApplication.id,
        LoanApplication.status,
        LoanApplication.loan_type,
        LoanApplication.amount,
        LoanApplication.created_at,
    ).filter(
        LoanApplication.tenant_id == tenant_id,
        LoanApplication.deleted_at.is_(None),
    )
    if start:
        q = q.filter(LoanApplication.created_at >= start.replace(tzinfo=None))
    if end:
        q = q.filter(LoanApplication.created_at <= end.replace(tzinfo=None))
    if broker_id:
        q = q.filter(_broker_filter(db, broker_id))
    rows = q.all()

    app_brokers = _attribution_map(db, tenant_id)
    broker_names = dict(
        db.query(User.id, User.full_name).filter(User.tenant_id == tenant_id)
    )

    # ── Totals ──
    total_volume = 0.0
    settled_count = 0
    settled_volume = 0.0
    decided_count = 0
    active_count = 0
    active_volume = 0.0
    by_status: dict[str, dict[str, float | int]] = {}
    by_loan_type: dict[str, dict[str, float | int]] = {}

    for _id, status, loan_type, amount, _created in rows:
        amt = float(amount or 0)
        total_volume += amt
        st = by_status.setdefault(status.value, {"count": 0, "volume": 0.0})
        st["count"] += 1
        st["volume"] += amt
        lt = by_loan_type.setdefault(loan_type.value, {"count": 0, "volume": 0.0})
        lt["count"] += 1
        lt["volume"] += amt
        if status == ApplicationStatus.settled:
            settled_count += 1
            settled_volume += amt
        if status in DECIDED_STATUSES:
            decided_count += 1
        else:
            active_count += 1
            active_volume += amt

    # ── Monthly buckets ──
    if rows:
        earliest = min(r.created_at for r in rows)
    else:
        earliest = now
    bucket_start = start or earliest.replace(tzinfo=timezone.utc)
    keys = _month_keys(bucket_start.replace(tzinfo=None), (end or now).replace(tzinfo=None))
    monthly: dict[str, dict] = {
        k: {
            "month": k,
            "count": 0,
            "volume": 0.0,
            "settled_count": 0,
            "settled_volume": 0.0,
            "statuses": {},
        }
        for k in keys
    }
    for _id, status, _lt, amount, created_at in rows:
        key = created_at.strftime("%Y-%m")
        m = monthly.get(key)
        if m is None:
            continue
        amt = float(amount or 0)
        m["count"] += 1
        m["volume"] += amt
        m["statuses"][status.value] = m["statuses"].get(status.value, 0) + 1
        if status == ApplicationStatus.settled:
            m["settled_count"] += 1
            m["settled_volume"] += amt

    # ── Per-broker breakdown (admin top-down; brokers just see their own row) ──
    broker_stats: dict[str, dict] = {}
    for _id, status, _lt, amount, _created in rows:
        assigned = app_brokers.get(_id) or {"__unassigned__"}
        if broker_id:
            # Rows are already filtered to this broker; show only their bucket.
            assigned = {broker_id}
        for b_id in assigned:
            st = broker_stats.setdefault(
                b_id,
                {
                    "broker_id": None if b_id == "__unassigned__" else b_id,
                    "broker_name": "Unassigned"
                    if b_id == "__unassigned__"
                    else broker_names.get(b_id, "Unknown"),
                    "total": 0,
                    "volume": 0.0,
                    "settled": 0,
                    "settled_volume": 0.0,
                    "active": 0,
                    "decided": 0,
                },
            )
            amt = float(amount or 0)
            st["total"] += 1
            st["volume"] += amt
            if status == ApplicationStatus.settled:
                st["settled"] += 1
                st["settled_volume"] += amt
            if status in DECIDED_STATUSES:
                st["decided"] += 1
            else:
                st["active"] += 1

    by_broker = []
    for st in broker_stats.values():
        decided = st.pop("decided")
        st["conversion_rate"] = round(st["settled"] / decided * 100, 1) if decided else None
        by_broker.append(st)
    by_broker.sort(key=lambda s: s["volume"], reverse=True)

    return {
        "totals": {
            "total_deals": len(rows),
            "total_volume": total_volume,
            "settled_deals": settled_count,
            "settled_volume": settled_volume,
            "active_deals": active_count,
            "active_volume": active_volume,
            "conversion_rate": round(settled_count / decided_count * 100, 1)
            if decided_count
            else None,
        },
        "monthly": [monthly[k] for k in keys],
        "by_status": by_status,
        "by_loan_type": by_loan_type,
        "by_broker": by_broker,
    }


@router.get("/applications")
def broker_analytics_applications(
    month: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"),
    period: str = Query("12m", pattern="^(6m|12m|ytd|all|custom)$"),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    broker_id: str | None = Query(None),
    status: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Drill-down list of the deals behind a chart segment (month / broker / status)."""
    broker_id = _effective_broker_id(current_user, broker_id)

    q = (
        db.query(LoanApplication)
        .filter(
            LoanApplication.tenant_id == tenant_id,
            LoanApplication.deleted_at.is_(None),
        )
        .order_by(LoanApplication.created_at.desc())
    )

    if month:
        try:
            m_start = datetime.strptime(month + "-01", "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid month")
        m_end = (m_start + timedelta(days=32)).replace(day=1)
        q = q.filter(
            LoanApplication.created_at >= m_start,
            LoanApplication.created_at < m_end,
        )
    else:
        start = _period_start(period, date_from)
        end = _period_end(period, date_to)
        if start:
            q = q.filter(LoanApplication.created_at >= start.replace(tzinfo=None))
        if end:
            q = q.filter(LoanApplication.created_at <= end.replace(tzinfo=None))

    if broker_id:
        q = q.filter(_broker_filter(db, broker_id))
    if status:
        try:
            q = q.filter(LoanApplication.status == ApplicationStatus(status))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid status")

    apps = q.limit(500).all()
    app_brokers = _attribution_map(db, tenant_id)
    broker_names = dict(
        db.query(User.id, User.full_name).filter(User.tenant_id == tenant_id)
    )

    results = []
    for a in apps:
        client_name = " ".join(
            p for p in [a.applicant_first_name, a.applicant_last_name] if p
        ).strip()
        if not client_name and a.user:
            client_name = a.user.full_name
        results.append(
            {
                "id": a.id,
                "client_name": client_name or "—",
                "business_name": a.business_name,
                "loan_type": a.loan_type.value,
                "amount": float(a.amount or 0),
                "status": a.status.value,
                "created_at": a.created_at.isoformat(),
                "updated_at": a.updated_at.isoformat(),
                "brokers": [
                    broker_names.get(b, "Unknown") for b in sorted(app_brokers.get(a.id, set()))
                ],
            }
        )
    return results
