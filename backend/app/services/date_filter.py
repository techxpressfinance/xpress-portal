from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Query

VALID_DATE_RANGES = {"this_month", "last_month", "this_quarter", "last_quarter", "this_year"}


def apply_date_range_filter(query: Query, column, date_range: str) -> Query:
    """Apply a standard date range filter to a SQLAlchemy query."""
    if date_range not in VALID_DATE_RANGES:
        raise ValueError(f"Invalid date_range: {date_range!r}. Must be one of {sorted(VALID_DATE_RANGES)}")
    now = datetime.now(timezone.utc)

    if date_range == "this_month":
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        query = query.filter(column >= start)
    elif date_range == "last_month":
        first_this_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        start = (first_this_month - timedelta(days=1)).replace(day=1)
        query = query.filter(column >= start, column < first_this_month)
    elif date_range == "this_quarter":
        quarter_month = ((now.month - 1) // 3) * 3 + 1
        start = now.replace(month=quarter_month, day=1, hour=0, minute=0, second=0, microsecond=0)
        query = query.filter(column >= start)
    elif date_range == "last_quarter":
        quarter_month = ((now.month - 1) // 3) * 3 + 1
        start_this_q = now.replace(month=quarter_month, day=1, hour=0, minute=0, second=0, microsecond=0)
        if quarter_month > 3:
            start_last_q = start_this_q.replace(month=quarter_month - 3)
        else:
            start_last_q = start_this_q.replace(year=now.year - 1, month=10)
        query = query.filter(column >= start_last_q, column < start_this_q)
    elif date_range == "this_year":
        start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
        query = query.filter(column >= start)

    return query
