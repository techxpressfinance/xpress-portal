from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class ApplicationCalculator(Base):
    __tablename__ = "application_calculators"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=True)
    application_id = Column(String(36), ForeignKey("loan_applications.id"), nullable=False)
    calc_type = Column(String(20), nullable=False)  # 'bas' | 'pay' | 'ratios'
    title = Column(String(200), nullable=True)
    data = Column(Text, nullable=False, default="{}")
    created_by_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    created_by = relationship("User", foreign_keys=[created_by_id])
