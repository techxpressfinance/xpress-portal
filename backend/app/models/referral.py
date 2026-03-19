from __future__ import annotations

import enum
import uuid
import secrets
import string
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ReferralStatus(str, enum.Enum):
    pending = "pending"
    signed_up = "signed_up"
    applied = "applied"


def _generate_referral_code() -> str:
    """Generate a unique 8-character alphanumeric referral code."""
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(8))


class Referral(Base):
    __tablename__ = "referrals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    referrer_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    referral_code: Mapped[str] = mapped_column(String(20), unique=True, index=True, default=_generate_referral_code)
    referred_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    referred_user_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    status: Mapped[ReferralStatus] = mapped_column(Enum(ReferralStatus), default=ReferralStatus.pending, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    converted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    referrer = relationship("User", foreign_keys=[referrer_id])
    referred_user = relationship("User", foreign_keys=[referred_user_id])
