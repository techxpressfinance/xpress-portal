from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.config import FRONTEND_URL
from app.database import get_db
from app.middleware.auth import require_role
from app.models.referral import Referral
from app.models.user import User
from app.schemas.referral import ReferralOut
from app.services.tenant_scope import get_tenant_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/referrals", tags=["referrals"])


@router.get("/my-link")
def get_my_invite_link(
    role: str = Query("client"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Personal standing invite link — exists before any details are known.

    Backed by an evergreen Referral row (referred_email=None) that the register
    flow never consumes; each signup through it records its own referral row.
    ``role=broker`` links grant the broker role on signup — admins only.
    """
    if role not in ("client", "broker"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")
    if role == "broker" and current_user.role.value != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can issue broker invite links")

    invited_role = None if role == "client" else role
    query = db.query(Referral).filter(
        Referral.referrer_id == current_user.id,
        Referral.referred_email.is_(None),
        Referral.referred_user_id.is_(None),
    )
    if invited_role is None:
        query = query.filter(Referral.invited_role.is_(None))
    else:
        query = query.filter(Referral.invited_role == invited_role)
    referral = query.first()
    if not referral:
        referral = Referral(referrer_id=current_user.id, tenant_id=tenant_id, invited_role=invited_role)
        db.add(referral)
        db.commit()
        db.refresh(referral)
    return {
        "code": referral.referral_code,
        "link": f"{FRONTEND_URL}/register?ref={referral.referral_code}",
    }


@router.get("/validate/{code}")
def validate_referral_code(code: str, db: Session = Depends(get_db)):
    """Validate a referral code. Public endpoint for registration page."""
    referral = db.query(Referral).filter(Referral.referral_code == code).first()
    if not referral:
        return {"valid": False, "referrer_name": None, "invited_role": None}
    referrer = db.query(User).filter(User.id == referral.referrer_id).first()
    return {
        "valid": True,
        "referrer_name": referrer.full_name if referrer else "A referrer",
        "invited_role": referral.invited_role,
    }


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
