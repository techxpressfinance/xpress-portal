from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.referral import Referral
from app.models.user import User
from app.schemas.referral import ReferralOut
from app.services.tenant_scope import get_tenant_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/referrals", tags=["referrals"])


@router.get("/validate/{code}")
def validate_referral_code(code: str, db: Session = Depends(get_db)):
    """Validate a referral code. Public endpoint for registration page."""
    referral = db.query(Referral).filter(Referral.referral_code == code).first()
    if not referral:
        return {"valid": False, "referrer_name": None}
    referrer = db.query(User).filter(User.id == referral.referrer_id).first()
    return {"valid": True, "referrer_name": referrer.full_name if referrer else "A referrer"}


def _referral_to_out(ref: Referral) -> dict:
    return {
        "id": ref.id,
        "referrer_id": ref.referrer_id,
        "referral_code": ref.referral_code,
        "referred_email": ref.referred_email,
        "referred_user_id": ref.referred_user_id,
        "referred_user_name": ref.referred_user.full_name if ref.referred_user else None,
        "status": ref.status,
        "created_at": ref.created_at,
        "converted_at": ref.converted_at,
    }


@router.get("/admin/all", response_model=list[ReferralOut])
def admin_list_referrals(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    """List all referrals system-wide (admin only)."""
    referrals = (
        db.query(Referral)
        .filter(Referral.referred_email != None, Referral.tenant_id == tenant_id)  # noqa: E711
        .order_by(Referral.created_at.desc())
        .all()
    )
    return [_referral_to_out(r) for r in referrals]
