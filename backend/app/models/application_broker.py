from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ApplicationBroker(Base):
    """Many-to-many: multiple brokers can be assigned to one application."""

    __tablename__ = "application_brokers"
    __table_args__ = (UniqueConstraint("application_id", "broker_id", name="uq_app_broker"),)

    application_id: Mapped[str] = mapped_column(String(36), ForeignKey("loan_applications.id", ondelete="CASCADE"), primary_key=True)
    broker_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    assigned_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
