from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import Date, DateTime, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SettledDealSnapshot(Base):
    """Immutable per-deal record captured when a settled application is archived.

    Deliberately not FK-linked to loan_applications/users/lenders — the 60-day
    soft-delete purge (main.py) and other hard-deletes must never cascade into
    historical settlement records used for monthly/quarterly reporting. No PII
    is denormalized here; display names are resolved by joining to User/Lender
    at query time (see routers/settled_deals_analytics.py), same as elsewhere
    in the app.
    """

    __tablename__ = "settled_deal_snapshots"
    __table_args__ = (UniqueConstraint("application_id", name="uq_settled_snapshot_application"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), index=True, nullable=True)
    application_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)

    snapshot_month: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    archived_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    loan_category: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    loan_type: Mapped[str] = mapped_column(String(30), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    client_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    broker_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    referrer_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    lender_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
