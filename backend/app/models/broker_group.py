from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Column, DateTime, ForeignKey, String, Table, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Association table for broker group members
broker_group_members = Table(
    "broker_group_members",
    Base.metadata,
    Column("group_id", String(36), ForeignKey("broker_groups.id", ondelete="CASCADE"), primary_key=True),
    Column("broker_id", String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("added_at", DateTime, default=lambda: datetime.now(timezone.utc)),
    UniqueConstraint("group_id", "broker_id", name="uq_group_broker"),
)


class BrokerGroup(Base):
    __tablename__ = "broker_groups"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: __import__("uuid").uuid4().hex[:36])
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    created_by_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)

    members = relationship(
        "User",
        secondary=broker_group_members,
        backref="broker_groups",
        lazy="selectin",
    )
