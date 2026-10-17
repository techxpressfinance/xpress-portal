from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SettlementChecklist(Base):
    """A checklist a broker works through before a deal may move on — one per
    application per `purpose`:

    settlement_pack   — the pack that goes to the lender; `kind` says which:
                        consumer deal, dealer sale or private sale.
    lender_submission — the desk's checks before those docs go to the lender.
    loan_settled      — what must be done when the loan settles.

    The items themselves live in code (services/settlement_checklist.py), so only
    the answers are stored. `completed_at` is set while every item is answered;
    the move is refused until it is."""

    __tablename__ = "settlement_checklists"
    __table_args__ = (UniqueConstraint("application_id", "purpose", name="uq_settlement_checklist_app_purpose"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    application_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("loan_applications.id", ondelete="CASCADE"), nullable=False, index=True
    )
    purpose: Mapped[str] = mapped_column(String(20), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    # JSON {item_key: {"state": "done" | "na" | null, "subs": [sub_key, ...]}}.
    answers: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # The pack's "Prepared By" — whoever last saved it, denormalised like the
    # stage-transition record so a later rename doesn't rewrite it.
    prepared_by_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    prepared_by_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
