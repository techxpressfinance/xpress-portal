from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.tenant_scoped import TenantScoped

# What a note on an entity is about. Labels live in the frontend
# (lib/entityNotes.ts) — keep the two in step.
ENTITY_NOTE_CATEGORIES = ("general", "financials", "compliance", "relationship")


def _now() -> datetime:
    return datetime.now(timezone.utc)


class EntityNote(TenantScoped, Base):
    """A dated note on an entity (Organization), by a team member — staff-only,
    never shown to a client or referrer. Pinned notes sit at the top.

    Replaces the single free-text ``organizations.notes`` field: a migration
    carried each entity's existing text over as a pinned note with no author."""

    __tablename__ = "entity_notes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # None = carried over from the old notes field.
    author_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    category: Mapped[str] = mapped_column(String(20), default="general", nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
    # Stamped on an edit to the text ("edited" in the feed).
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    updated_by_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    author = relationship("User", foreign_keys=[author_id])
    updated_by = relationship("User", foreign_keys=[updated_by_id])
