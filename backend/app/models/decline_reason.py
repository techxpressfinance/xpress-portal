from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# Seeded into a tenant's list the first time it is read. Admins can rename,
# reorder, retire and add to it from there.
DEFAULT_DECLINE_REASONS = (
    "Serviceability",
    "Credit history",
    "Security / asset",
    "Lender policy",
    "Documentation",
    "Employment / ABN tenure",
    "Other",
)


class DeclineReason(Base):
    """A tenant's decline-reason tag, picked on decline notes.

    Retired rather than deleted: old decline notes keep pointing at the tag they
    were filed under, so the notes-history counts stay true to what was recorded.
    """

    __tablename__ = "decline_reasons"
    __table_args__ = (UniqueConstraint("tenant_id", "label", name="uq_decline_reason_label"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
