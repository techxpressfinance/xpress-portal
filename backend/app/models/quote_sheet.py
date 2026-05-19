from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class QuoteSheetStatus(str, enum.Enum):
    draft = "draft"
    sent = "sent"


class QuoteSheet(Base):
    __tablename__ = "quote_sheets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    application_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("loan_applications.id", ondelete="CASCADE"), nullable=True
    )
    recipient_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    recipient_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    title: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    status: Mapped[QuoteSheetStatus] = mapped_column(
        Enum(QuoteSheetStatus), default=QuoteSheetStatus.draft, nullable=False
    )
    created_by_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False
    )
    broker_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    input_parameters: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON blob of shared inputs
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    options = relationship(
        "QuoteOption",
        back_populates="quote_sheet",
        cascade="all, delete-orphan",
        order_by="QuoteOption.sort_order",
        lazy="selectin",
    )
    created_by = relationship("User", lazy="selectin")


class QuoteOption(Base):
    __tablename__ = "quote_options"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    quote_sheet_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("quote_sheets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_recommended: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Lender info
    lender_name: Mapped[str] = mapped_column(String(200), nullable=False)
    lender_product: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    # Loan structure
    purchase_price: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    deposit: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    loan_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    loan_term_months: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    balloon_residual: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)

    # Rates
    interest_rate: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2), nullable=True)
    comparison_rate: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2), nullable=True)
    client_interest_rate: Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 4), nullable=True)

    # Fees
    establishment_fee: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    monthly_account_fee: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    application_fee: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    brokerage: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)

    # Repayments
    repayment_monthly: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    repayment_fortnightly: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    repayment_weekly: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)

    # Totals
    total_repayments: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    total_interest: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    total_fees: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)

    # Text fields
    features: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )

    quote_sheet = relationship("QuoteSheet", back_populates="options")
