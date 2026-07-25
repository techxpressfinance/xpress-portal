from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.lender import Lender
from app.models.settled_deal_snapshot import SettledDealSnapshot
from app.models.user import User
from app.routers.broker_analytics import _month_keys, _period_end, _period_start
from app.services.loan_category import LOAN_CATEGORIES
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/settled-deals", tags=["settled-deals-analytics"])


def _validate_category(category: str | None) -> None:
    if category and category not in LOAN_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category: {category}")


def _snapshot_query(
    db: Session,
    tenant_id: str,
    start: datetime | None,
    end: datetime | None,
    category: str | None,
):
    q = db.query(SettledDealSnapshot).filter(SettledDealSnapshot.tenant_id == tenant_id)
    if start:
        q = q.filter(SettledDealSnapshot.snapshot_month >= start.date().replace(day=1))
    if end:
        q = q.filter(SettledDealSnapshot.snapshot_month <= end.date())
    if category:
        q = q.filter(SettledDealSnapshot.loan_category == category)
    return q


@router.get("/overview")
def settled_deals_overview(
    period: str = Query("12m", pattern="^(6m|12m|ytd|all|custom)$"),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    category: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    _validate_category(category)
    now = datetime.now()
    start = _period_start(period, date_from)
    end = _period_end(period, date_to)

    rows = _snapshot_query(db, tenant_id, start, end, category).all()

    lender_names = dict(db.query(Lender.id, Lender.name).filter(Lender.tenant_id == tenant_id))
    user_names = dict(db.query(User.id, User.full_name).filter(User.tenant_id == tenant_id))

    total_count = len(rows)
    total_volume = sum(float(r.amount or 0) for r in rows)
    avg_amount = total_volume / total_count if total_count else 0.0

    # ── Monthly buckets, broken down by loan category ──
    if rows:
        earliest = min(r.snapshot_month for r in rows)
    else:
        earliest = now.date().replace(day=1)
    bucket_start = start.replace(tzinfo=None) if start else datetime.combine(earliest, datetime.min.time())
    bucket_end = end.replace(tzinfo=None) if end else now
    keys = _month_keys(bucket_start, bucket_end)
    monthly: dict[str, dict] = {
        k: {"month": k, "count": 0, "volume": 0.0, "categories": {}}
        for k in keys
    }
    for r in rows:
        key = r.snapshot_month.strftime("%Y-%m")
        m = monthly.get(key)
        if m is None:
            continue
        amt = float(r.amount or 0)
        m["count"] += 1
        m["volume"] += amt
        cat = r.loan_category or "uncategorized"
        m["categories"][cat] = m["categories"].get(cat, 0) + 1

    # ── By lender ──
    lender_stats: dict[str, dict] = {}
    for r in rows:
        key = r.lender_id or "__none__"
        st = lender_stats.setdefault(key, {
            "lender_id": None if key == "__none__" else key,
            "lender_name": "Unknown" if key == "__none__" else lender_names.get(key, "Unknown"),
            "count": 0,
            "volume": 0.0,
        })
        st["count"] += 1
        st["volume"] += float(r.amount or 0)
    by_lender = sorted(lender_stats.values(), key=lambda s: s["volume"], reverse=True)

    # ── By referrer ──
    referrer_stats: dict[str, dict] = {}
    for r in rows:
        key = r.referrer_id or "__none__"
        st = referrer_stats.setdefault(key, {
            "referrer_id": None if key == "__none__" else key,
            "referrer_name": "Direct (no referrer)" if key == "__none__" else user_names.get(key, "Unknown"),
            "count": 0,
            "volume": 0.0,
        })
        st["count"] += 1
        st["volume"] += float(r.amount or 0)
    by_referrer = sorted(referrer_stats.values(), key=lambda s: s["volume"], reverse=True)

    # ── By category ──
    category_stats: dict[str, dict] = {}
    for r in rows:
        key = r.loan_category or "uncategorized"
        st = category_stats.setdefault(key, {"category": key, "count": 0, "volume": 0.0})
        st["count"] += 1
        st["volume"] += float(r.amount or 0)

    return {
        "totals": {
            "total_settlements": total_count,
            "total_volume": total_volume,
            "avg_loan_size": avg_amount,
        },
        "monthly": [monthly[k] for k in keys],
        "by_category": list(category_stats.values()),
        "by_lender": by_lender,
        "by_referrer": by_referrer,
    }


@router.get("/deals")
def settled_deals_list(
    month: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"),
    period: str = Query("12m", pattern="^(6m|12m|ytd|all|custom)$"),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    category: str | None = Query(None),
    lender_id: str | None = Query(None),
    referrer_id: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Drill-down list of the settled-deal snapshots behind a chart segment or table row."""
    _validate_category(category)

    q = db.query(SettledDealSnapshot).filter(SettledDealSnapshot.tenant_id == tenant_id)
    if month:
        try:
            m_start = datetime.strptime(month + "-01", "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid month")
        m_end = (m_start + timedelta(days=32)).replace(day=1)
        q = q.filter(SettledDealSnapshot.snapshot_month >= m_start, SettledDealSnapshot.snapshot_month < m_end)
    else:
        start = _period_start(period, date_from)
        end = _period_end(period, date_to)
        if start:
            q = q.filter(SettledDealSnapshot.snapshot_month >= start.date().replace(day=1))
        if end:
            q = q.filter(SettledDealSnapshot.snapshot_month <= end.date())
    if category:
        q = q.filter(SettledDealSnapshot.loan_category == category)
    if lender_id:
        q = q.filter(SettledDealSnapshot.lender_id == lender_id)
    if referrer_id:
        q = q.filter(SettledDealSnapshot.referrer_id == referrer_id)

    rows = q.order_by(SettledDealSnapshot.snapshot_month.desc()).limit(500).all()

    lender_names = dict(db.query(Lender.id, Lender.name).filter(Lender.tenant_id == tenant_id))
    user_names = dict(db.query(User.id, User.full_name).filter(User.tenant_id == tenant_id))

    return [
        {
            "id": r.id,
            "application_id": r.application_id,
            "client_name": user_names.get(r.client_user_id, "Unknown"),
            "loan_type": r.loan_type,
            "loan_category": r.loan_category,
            "amount": float(r.amount or 0),
            "broker_name": user_names.get(r.broker_id, "—") if r.broker_id else "—",
            "lender_name": lender_names.get(r.lender_id, "Unknown") if r.lender_id else "—",
            "referrer_name": user_names.get(r.referrer_id, "Unknown") if r.referrer_id else "—",
            "snapshot_month": r.snapshot_month.isoformat(),
            "archived_at": r.archived_at.isoformat(),
        }
        for r in rows
    ]
