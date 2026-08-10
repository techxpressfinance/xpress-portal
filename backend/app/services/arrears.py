"""Arrears ageing buckets and the month-end snapshot sweep.

Day counts are derived, never stored on the live record — a stored count would
be wrong the morning after it was written. `bucket_for` is the single place the
0-29 / 30-59 / … boundaries live; the frontend mirrors these slugs in
frontend/src/lib/arrears.ts.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

from app.database import SessionLocal
from app.models.arrears import ArrearsRecord, ArrearsSnapshot
from app.services.loan_category import LOAN_CATEGORIES

logger = logging.getLogger(__name__)

# "other" covers contracts that predate the three-category split or don't fit it.
ARREARS_FILE_TYPES = (*LOAN_CATEGORIES, "other")

REPAYMENT_FREQUENCIES = ("weekly", "fortnightly", "monthly", "quarterly")

# Age buckets, in order. `delinquent` is not an age band — it's the manual flag,
# and it takes precedence over whichever band a record's day count falls in.
# `over_180` catches contracts past the last band the business named so no row
# ever falls out of the book.
AGE_BUCKETS = ("0_29", "30_59", "60_89", "90_119", "120_180", "over_180")
ARREARS_BUCKETS = (*AGE_BUCKETS, "delinquent")

# Inclusive upper day bound per band; the last band has none.
_BAND_LIMITS = ((29, "0_29"), (59, "30_59"), (89, "60_89"), (119, "90_119"), (180, "120_180"))


def days_in_arrears(since: date, as_of: date | None = None) -> int:
    """Whole days a contract has been in arrears, floored at 0."""
    reference = as_of or datetime.now(timezone.utc).date()
    return max((reference - since).days, 0)


def age_bucket(days: int) -> str:
    for limit, slug in _BAND_LIMITS:
        if days <= limit:
            return slug
    return "over_180"


def bucket_for(record: ArrearsRecord, as_of: date | None = None) -> str:
    """Reporting bucket: the manual delinquent flag wins over the age band."""
    if record.delinquent:
        return "delinquent"
    return age_bucket(days_in_arrears(record.in_arrears_since, as_of))


def month_start(value: date) -> date:
    return value.replace(day=1)


def month_end(month: date) -> date:
    """Last day of the month `month` falls in."""
    first_of_next = (month_start(month) + timedelta(days=32)).replace(day=1)
    return first_of_next - timedelta(days=1)


def previous_month(month: date) -> date:
    return month_start(month_start(month) - timedelta(days=1))


def capture_month(db, month: date) -> int:
    """Freeze every arrears record's state as it stood at the end of `month`.

    Idempotent — the unique (record, month) constraint plus the pre-read of
    existing rows means re-running only fills gaps. A record is snapshotted for
    a month only if it had already fallen into arrears by that month's end, so
    back-filling never invents history for contracts that didn't exist yet.
    """
    month = month_start(month)
    end = month_end(month)

    existing = {
        row[0]
        for row in db.query(ArrearsSnapshot.arrears_record_id).filter(
            ArrearsSnapshot.snapshot_month == month
        )
    }
    records = db.query(ArrearsRecord).filter(ArrearsRecord.in_arrears_since <= end).all()

    captured = 0
    for record in records:
        if record.id in existing:
            continue
        # A record resolved before this month ended has no place in that month's
        # book unless it was still open then; `resolved_at` tells us which.
        if record.resolved and record.resolved_at and record.resolved_at.date() < month:
            continue
        days = days_in_arrears(record.in_arrears_since, end)
        db.add(ArrearsSnapshot(
            tenant_id=record.tenant_id,
            arrears_record_id=record.id,
            snapshot_month=month,
            days_in_arrears=days,
            bucket="delinquent" if record.delinquent else age_bucket(days),
            resolved=record.resolved,
            proof_of_payment_received=record.proof_of_payment_received,
            delinquent=record.delinquent,
            repayment_amount=record.repayment_amount,
            arrears_amount=record.arrears_amount,
        ))
        captured += 1

    if captured:
        db.commit()
    return captured


def capture_completed_months(session_factory=SessionLocal, lookback_months: int = 24) -> None:
    """Scheduler entry point: snapshot every completed month not yet captured.

    Runs on the same short interval as the other pollers in main.py, so a
    freshly-started server (or one that was down over a month boundary) fills
    in the months it missed rather than losing them. The current month is never
    captured — it isn't finished, and the live records already describe it.
    """
    db = session_factory()
    try:
        earliest = db.query(ArrearsRecord.in_arrears_since).order_by(ArrearsRecord.in_arrears_since).first()
        if not earliest:
            return

        month = previous_month(datetime.now(timezone.utc).date())
        floor = max(month_start(earliest[0]), month_start(month - timedelta(days=31 * lookback_months)))

        total = 0
        while month >= floor:
            try:
                total += capture_month(db, month)
            except Exception:
                db.rollback()
                logger.exception("Failed to capture arrears snapshot for %s", month)
            month = previous_month(month)

        if total:
            logger.info("Captured %d arrears snapshot(s)", total)
    finally:
        db.close()
