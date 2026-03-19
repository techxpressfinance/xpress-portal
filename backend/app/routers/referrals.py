from __future__ import annotations

import logging
import os
import threading

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.config import EMAIL_ENABLED
from app.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.referral import Referral, ReferralStatus, _generate_referral_code
from app.models.user import User
from app.schemas.referral import ReferralCodeOut, ReferralInvite, ReferralOut, ReferralStats
from app.services.email import _send_email

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/referrals", tags=["referrals"])

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")


@router.get("/validate/{code}")
def validate_referral_code(code: str, db: Session = Depends(get_db)):
    """Validate a referral code and return the referrer's name. Public endpoint for registration page."""
    referral = db.query(Referral).filter(Referral.referral_code == code).first()
    if not referral:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid referral code")
    referrer = db.query(User).filter(User.id == referral.referrer_id).first()
    return {"referrer_name": referrer.full_name if referrer else "Someone"}


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


@router.get("/my-code", response_model=ReferralCodeOut)
def get_my_code(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("client")),
):
    """Get or create the client's referral code."""
    # Look for an existing referral record with no referred_email (the 'master' code)
    referral = (
        db.query(Referral)
        .filter(Referral.referrer_id == current_user.id, Referral.referred_email == None)  # noqa: E711
        .first()
    )
    if not referral:
        referral = Referral(referrer_id=current_user.id)
        db.add(referral)
        db.commit()
        db.refresh(referral)

    return ReferralCodeOut(
        code=referral.referral_code,
        link=f"{FRONTEND_URL}/register?ref={referral.referral_code}",
    )


@router.get("/my-referrals", response_model=list[ReferralOut])
def get_my_referrals(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("client")),
):
    """List all referrals made by this client."""
    referrals = (
        db.query(Referral)
        .filter(Referral.referrer_id == current_user.id, Referral.referred_email != None)  # noqa: E711
        .order_by(Referral.created_at.desc())
        .all()
    )
    return [_referral_to_out(r) for r in referrals]


@router.get("/stats", response_model=ReferralStats)
def get_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("client")),
):
    """Get referral statistics for the current client."""
    base = db.query(Referral).filter(
        Referral.referrer_id == current_user.id,
        Referral.referred_email != None,  # noqa: E711
    )
    total = base.count()
    signed_up = base.filter(Referral.status.in_([ReferralStatus.signed_up, ReferralStatus.applied])).count()
    applied = base.filter(Referral.status == ReferralStatus.applied).count()

    return ReferralStats(total_referred=total, signed_up=signed_up, applied=applied)


@router.post("/invite", response_model=ReferralOut, status_code=status.HTTP_201_CREATED)
def send_invite(
    data: ReferralInvite,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("client")),
):
    """Send an email invite to a prospective user."""
    # Get or create the client's master referral code
    master = (
        db.query(Referral)
        .filter(Referral.referrer_id == current_user.id, Referral.referred_email == None)  # noqa: E711
        .first()
    )
    if not master:
        master = Referral(referrer_id=current_user.id)
        db.add(master)
        db.commit()
        db.refresh(master)

    # Create a referral record for this specific invite
    referral = Referral(
        referrer_id=current_user.id,
        referral_code=_generate_referral_code(),
        referred_email=data.email,
    )
    db.add(referral)
    db.commit()
    db.refresh(referral)

    # Send email invite in background
    link = f"{FRONTEND_URL}/register?ref={master.referral_code}"
    recipient_name = data.name or "there"
    body = (
        f"Hi {recipient_name},\n\n"
        f"{current_user.full_name} has invited you to join Xpress Tech Portal!\n\n"
        f"Click the link below to get started:\n{link}\n\n"
        f"Best regards,\nXpress Tech Team"
    )

    if EMAIL_ENABLED:
        thread = threading.Thread(
            target=_send_email,
            args=(data.email, f"{current_user.full_name} invited you to Xpress Tech Portal", body),
            daemon=True,
        )
        thread.start()
    else:
        logger.debug("Email not configured, skipping referral invite to %s", data.email)

    return _referral_to_out(referral)


@router.get("/admin/all", response_model=list[ReferralOut])
def admin_list_referrals(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """List all referrals system-wide (admin only)."""
    referrals = (
        db.query(Referral)
        .filter(Referral.referred_email != None)  # noqa: E711
        .order_by(Referral.created_at.desc())
        .all()
    )
    return [_referral_to_out(r) for r in referrals]
