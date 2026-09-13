"""Lender pricing rules the server has to own.

The sheet itself is calculated in the browser (frontend/src/lib/lenderPricing.ts)
and stored as a JSON blob, but two things cannot live only there:

  * the amount borrowed and the figures behind it, because the tax invoice
    prefills its cost build-up from the pricing the lender actually approved;
  * the shortfall gate, because "don't allow the system to move ahead" is not a
    rule if the next caller can POST straight past it.

Both are mirrored onto columns of ``quote_sheets`` on every write, and the
thresholds below are the same ones the editor draws its red alerts from.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.lender import Lender
from app.models.quote_sheet import QuoteSheet, QuoteSheetType

# Negative equity beyond this share of the asset price needs the lender's
# blessing, as does borrowing beyond the second.
NEGATIVE_EQUITY_LIMIT = Decimal("0.10")
AMOUNT_BORROWED_LIMIT = Decimal("1.10")

ZERO = Decimal("0")


def _money(value: Any) -> Decimal:
    """A JSON number as Decimal. Anything unreadable counts as nothing."""
    if value is None or value is True or value is False:
        return ZERO
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return ZERO


def derive_figures(params: dict) -> dict:
    """The loan-setup figures, straight off the editor's inputs.

    Amount borrowed = asset price − deposit − trade-in + payout figure. The
    deposit is the dollar override where one is set, else the percentage of the
    asset price, which is exactly what computeLenderPricing does.
    """
    asset_price = _money(params.get("asset_price"))
    deposit = (
        _money(params.get("deposit_amount"))
        if params.get("deposit_amount") is not None
        else asset_price * _money(params.get("deposit_percent")) / Decimal("100")
    )
    trade_in = _money(params.get("trade_in_amount"))
    payout = _money(params.get("payout_amount"))
    return {
        "asset_price": asset_price,
        "deposit_amount": deposit,
        "trade_in_amount": trade_in,
        "payout_amount": payout,
        "amount_borrowed": asset_price - deposit - trade_in + payout,
        # What is still owing on the trade-in beyond what it is worth.
        "negative_equity": max(ZERO, payout - trade_in),
    }


def alerts(figures: dict) -> list[str]:
    """The lending-policy breaches, in the words the desk uses for them."""
    price = figures["asset_price"]
    if price <= ZERO:
        return []
    found = []
    if figures["negative_equity"] > price * NEGATIVE_EQUITY_LIMIT:
        found.append("negative equity above 10% of the asset price")
    if figures["amount_borrowed"] > price * AMOUNT_BORROWED_LIMIT:
        found.append("amount borrowed above 110% of the asset price")
    return found


def shortfall_block_reason(params: dict, figures: Optional[dict] = None) -> Optional[str]:
    """Why this pricing may not be saved, or None when it may.

    Mirrors shortfallBlockReason in lib/lenderPricing.ts: a lender "no" stops
    the deal, and only a broker/admin bypass carrying written reasons gets past
    it. An unanswered question blocks too — silence is not consent.
    """
    figures = figures or derive_figures(params)
    if not alerts(figures):
        return None
    if params.get("shortfall_bypassed") or params.get("lender_accepts_shortfall") == "no":
        if params.get("shortfall_bypassed"):
            if str(params.get("shortfall_bypass_notes") or "").strip():
                return None
            return "Bypass notes are required before this pricing can be saved."
        return (
            "The lender will not accept the shortfall and negative equity. "
            "Record a temporary bypass with notes to continue."
        )
    if params.get("lender_accepts_shortfall") == "yes":
        return None
    return "Confirm whether the lender accepts the shortfall and negative equity before saving."


def decision_notes(params: dict) -> Optional[str]:
    """The notes that explain whichever decision was recorded."""
    if params.get("shortfall_bypassed"):
        notes = str(params.get("shortfall_bypass_notes") or "").strip()
    elif params.get("lender_accepts_shortfall") == "yes":
        notes = str(params.get("lender_acceptance_notes") or "").strip()
    else:
        notes = ""
    return notes or None


def resolve_lender(db: Session, lender_id: Optional[str], tenant_id: Optional[str]) -> Optional[Lender]:
    """The lender from the tenant's own book, or a 400 naming why not."""
    if not lender_id:
        return None
    lender = db.query(Lender).filter(Lender.id == lender_id, Lender.tenant_id == tenant_id).first()
    if not lender:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That lender is not in this tenant's lender list",
        )
    return lender


def apply_lender_pricing(
    db: Session,
    sheet: QuoteSheet,
    params: dict,
    lender_id: Optional[str],
    tenant_id: Optional[str],
) -> None:
    """Validate a lender pricing sheet and mirror its figures onto columns.

    Raises 400 when the lender is not in the book, when none was picked, or when
    the shortfall gate is not satisfied.
    """
    lender = resolve_lender(db, lender_id or params.get("lender_id"), tenant_id)
    if lender is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Select the lender this pricing was approved by",
        )

    figures = derive_figures(params)
    blocked = shortfall_block_reason(params, figures)
    if blocked:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=blocked)

    sheet.lender_id = lender.id
    sheet.asset_price = figures["asset_price"]
    sheet.deposit_amount = figures["deposit_amount"]
    sheet.trade_in_amount = figures["trade_in_amount"]
    sheet.payout_amount = figures["payout_amount"]
    sheet.amount_borrowed = figures["amount_borrowed"]
    sheet.shortfall_accepted = params.get("lender_accepts_shortfall") or None
    sheet.shortfall_bypassed = bool(params.get("shortfall_bypassed"))
    sheet.shortfall_notes = decision_notes(params)


def latest_for_application(db: Session, application_id: str) -> Optional[QuoteSheet]:
    """The newest lender pricing on a file — what the desk priced last."""
    return (
        db.query(QuoteSheet)
        .filter(
            QuoteSheet.application_id == application_id,
            QuoteSheet.sheet_type == QuoteSheetType.lender_pricing,
        )
        .order_by(QuoteSheet.version.desc())
        .first()
    )
