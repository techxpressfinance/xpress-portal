from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.tenant_scoped import TenantScoped


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ApplicationClawback(TenantScoped, Base):
    """Brokerage a lender took back on a settled loan (the file).

    Visible to the whole team on the application, the client and the entity.
    Recording one raises a client alert, and the private ledger shows it as a
    negative row in the month of ``clawback_date`` — not the month the loan
    settled — at the bottom of that month."""

    __tablename__ = "application_clawbacks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    application_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("loan_applications.id", ondelete="CASCADE"), index=True, nullable=False
    )
    clawback_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    # The brokerage clawed back, ex GST, as a positive figure.
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # The client alert raised for it — kept in step with the clawback, and
    # removed with it unless someone has already deleted it.
    client_alert_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("client_alerts.id", ondelete="SET NULL"), nullable=True
    )
    created_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now, nullable=False)

    application = relationship("LoanApplication")
    created_by = relationship("User", foreign_keys=[created_by_id])
    updated_by = relationship("User", foreign_keys=[updated_by_id])
