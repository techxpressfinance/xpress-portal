from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.tenant_scoped import TenantScoped

# How a credit came about: stamped when the application was created, changed by
# staff, or filled in when per-application referrers went live.
REFERRER_CHANGE_SOURCES = ("created", "changed", "backfill")


class ApplicationReferrerChange(TenantScoped, Base):
    """One step in an application's referrer history — who was credited, who
    it moved to, who moved it and why. The application's current referrer is
    ``loan_applications.referrer_id``; this is the trail behind it."""

    __tablename__ = "application_referrer_changes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    application_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("loan_applications.id", ondelete="CASCADE"), index=True, nullable=False
    )
    from_referrer_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    to_referrer_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # None = done by the system (at creation without a signed-in actor, or the backfill).
    changed_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    source: Mapped[str] = mapped_column(String(20), default="changed", nullable=False)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    from_referrer = relationship("User", foreign_keys=[from_referrer_id])
    to_referrer = relationship("User", foreign_keys=[to_referrer_id])
    changed_by = relationship("User", foreign_keys=[changed_by_id])
