from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ServiceRequestAttachment(Base):
    """A file (e.g. screenshot) attached to a service request."""

    __tablename__ = "service_request_attachments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    service_request_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("service_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    uploaded_by_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    uploaded_by = relationship("User")
