from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Valid visibility targets
VALID_VISIBILITY = {"broker", "client", "referrer"}


class ApplicationNote(Base):
    __tablename__ = "application_notes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    application_id: Mapped[str] = mapped_column(String(36), ForeignKey("loan_applications.id"), nullable=False, index=True)
    author_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # Legacy column — kept with default so existing NOT NULL constraint doesn't break inserts
    is_internal: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Comma-separated list of roles that can see this note (e.g. "broker,client,referrer")
    # Admins always see all notes. "broker" implies broker+admin visibility.
    visibility: Mapped[str] = mapped_column(String(100), default="broker", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    application = relationship("LoanApplication", backref="application_notes")
    author = relationship("User")
