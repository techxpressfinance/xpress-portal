from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ExternalReferralStatus(str, enum.Enum):
    pending = "pending"
    signed_up = "signed_up"
    applied = "applied"


class ClientEngagementModel(str, enum.Enum):
    self_managed = "self_managed"
    direct_engagement = "direct_engagement"


class ExternalReferral(Base):
    __tablename__ = "external_referrals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    referrer_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    referred_email: Mapped[str] = mapped_column(String(255), nullable=False)
    referred_client_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    status: Mapped[ExternalReferralStatus] = mapped_column(
        Enum(ExternalReferralStatus), default=ExternalReferralStatus.pending, nullable=False
    )
    client_engagement_model: Mapped[Optional[ClientEngagementModel]] = mapped_column(
        Enum(ClientEngagementModel), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    converted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    referrer = relationship("User", foreign_keys=[referrer_id])
    referred_client = relationship("User", foreign_keys=[referred_client_id])
