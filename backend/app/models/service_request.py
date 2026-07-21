from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class ServiceRequestStatus(str, enum.Enum):
    pending = "pending"
    in_progress = "in_progress"
    resolved = "resolved"
    closed = "closed"


class ServiceRequest(Base):
    __tablename__ = "service_requests"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=True)
    client_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    request_type = Column(String(100), nullable=False)
    custom_request = Column(String(500), nullable=True)
    description = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default=ServiceRequestStatus.pending.value)
    is_urgent = Column(Boolean, nullable=False, default=False)
    # Optional due date/time (naive local datetime as set by staff).
    due_at = Column(DateTime, nullable=True)
    # When each due-date reminder was sent (null = not yet sent / re-armed on due edit).
    reminder_midpoint_sent_at = Column(DateTime, nullable=True)
    reminder_due_soon_sent_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    assigned_broker_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    broker_notes = Column(Text, nullable=True)

    client = relationship("User", foreign_keys=[client_id], backref="service_requests")
    # Retained as the "primary" assignee (first of assigned_brokers) for backward compatibility.
    assigned_broker = relationship("User", foreign_keys=[assigned_broker_id])
    # Many-to-many: a request can be assigned to multiple brokers.
    assigned_brokers = relationship(
        "User",
        secondary="service_request_brokers",
        lazy="selectin",
    )
    # Attributed, timestamped internal notes (oldest first).
    notes = relationship(
        "ServiceRequestNote",
        order_by="ServiceRequestNote.created_at",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    # Internal checklist items (manual sort order).
    checklist_items = relationship(
        "ServiceRequestChecklistItem",
        back_populates="service_request",
        order_by="ServiceRequestChecklistItem.sort_order",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    # Attached files (e.g. screenshots), oldest first.
    attachments = relationship(
        "ServiceRequestAttachment",
        order_by="ServiceRequestAttachment.uploaded_at",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
