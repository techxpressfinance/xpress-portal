from __future__ import annotations

import secrets
import string
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.external_referral import ExternalReferral, ExternalReferralStatus
from app.models.user import User, UserRole
from app.schemas.external_referrer import (
    ExternalReferralInvite,
    ExternalReferralOut,
    ExternalReferrerStats,
    ReferrerCreate,
)
from app.schemas.user import UserOut
from app.services.auth import hash_password
from app.services.email import send_invitation_email, send_referrer_welcome_email
from app.services.login_code import set_login_code
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/external-referrers", tags=["external-referrers"])


def _generate_temp_password(length: int = 12) -> str:
    alphabet = string.ascii_letters + string.digits
    while True:
        password = "".join(secrets.choice(alphabet) for _ in range(length))
        if any(c.isupper() for c in password) and any(c.isdigit() for c in password):
            return password


# --- Admin endpoints ---


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_referrer(
    data: ReferrerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Create a new external referrer account. Admin only."""
    existing = db.query(User).filter(User.email == data.email, User.tenant_id == tenant_id).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        )

    temp_password = _generate_temp_password()

    user = User(
        email=data.email,
        full_name=data.full_name,
        phone=data.phone,
        password_hash=hash_password(temp_password),
        auth_method="password",
        role="referrer",
        is_active=True,
        email_verified=True,
        organization_name=data.organization_name,
        invited_by_id=current_user.id,
        tenant_id=tenant_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    send_referrer_welcome_email(data.email, data.full_name, temp_password)
    return user


@router.get("", response_model=list[UserOut])
def list_referrers(
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    """List all external referrers. Admin only."""
    return db.query(User).filter(User.role == UserRole.referrer, User.tenant_id == tenant_id).order_by(User.created_at.desc()).all()


@router.get("/admin/all-referrals", response_model=list[ExternalReferralOut])
def list_all_external_referrals(
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    """List all external referrals across all referrers. Admin only."""
    referrals = (
        db.query(ExternalReferral)
        .filter(ExternalReferral.tenant_id == tenant_id)
        .order_by(ExternalReferral.created_at.desc())
        .limit(500)
        .all()
    )
    return _serialize_referrals(referrals, db)


# --- Referrer endpoints ---


@router.post("/refer", response_model=ExternalReferralOut)
def refer_client(
    data: ExternalReferralInvite,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Send a referral to a client (new or existing). Referrer only."""
    email = data.email.lower().strip()

    if email == current_user.email.lower():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot refer yourself")

    # Check if this referrer already referred this email
    existing_referral = (
        db.query(ExternalReferral)
        .filter(
            ExternalReferral.referrer_id == current_user.id,
            ExternalReferral.referred_email == email,
        )
        .first()
    )
    if existing_referral:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already referred this email",
        )

    # Check if client exists
    existing_user = db.query(User).filter(User.email == email, User.tenant_id == tenant_id).first()

    referral = ExternalReferral(
        referrer_id=current_user.id,
        referred_email=email,
        referred_client_id=existing_user.id if existing_user else None,
        status=ExternalReferralStatus.signed_up if existing_user else ExternalReferralStatus.pending,
        converted_at=datetime.now(timezone.utc) if existing_user else None,
        tenant_id=tenant_id,
    )
    db.add(referral)

    # Send invitation email
    if existing_user:
        # Existing user — send them an invitation/login code if code-auth
        if existing_user.auth_method == "code":
            plain = set_login_code(existing_user)
            db.commit()
            send_invitation_email(email, existing_user.full_name, plain, current_user.full_name)
        else:
            db.commit()
            # For password-auth users, send a simpler notification
            from app.services.email import send_referral_notification_email
            send_referral_notification_email(email, existing_user.full_name, current_user.full_name, current_user.organization_name)
    else:
        # New user — create invited client account
        name = data.full_name or email.split("@")[0]
        new_user = User(
            email=email,
            full_name=name,
            password_hash="!invited",
            auth_method="code",
            role="client",
            is_active=True,
            email_verified=True,
            login_code_attempts=0,
            invited_by_id=current_user.id,
            tenant_id=tenant_id,
        )
        plain = set_login_code(new_user)
        db.add(new_user)
        db.flush()
        referral.referred_client_id = new_user.id
        referral.status = ExternalReferralStatus.signed_up
        referral.converted_at = datetime.now(timezone.utc)
        db.commit()
        send_invitation_email(email, name, plain, current_user.full_name)

    db.refresh(referral)
    return _serialize_referral(referral, db)


@router.get("/my-referrals", response_model=list[ExternalReferralOut])
def list_my_referrals(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    """List all referrals made by the current referrer."""
    referrals = (
        db.query(ExternalReferral)
        .filter(ExternalReferral.referrer_id == current_user.id)
        .order_by(ExternalReferral.created_at.desc())
        .all()
    )
    return _serialize_referrals(referrals, db)


@router.get("/stats", response_model=ExternalReferrerStats)
def get_my_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Get referral stats for the current referrer."""
    referrals = (
        db.query(ExternalReferral)
        .filter(ExternalReferral.referrer_id == current_user.id)
        .all()
    )
    return ExternalReferrerStats(
        total_referred=len(referrals),
        signed_up=sum(1 for r in referrals if r.status in (ExternalReferralStatus.signed_up, ExternalReferralStatus.applied)),
        applied=sum(1 for r in referrals if r.status == ExternalReferralStatus.applied),
    )


# --- Helpers ---


def _serialize_referral(referral: ExternalReferral, db: Session) -> dict:
    referrer = db.query(User).filter(User.id == referral.referrer_id).first()
    client = db.query(User).filter(User.id == referral.referred_client_id).first() if referral.referred_client_id else None
    return {
        "id": referral.id,
        "referrer_id": referral.referrer_id,
        "referrer_name": referrer.full_name if referrer else None,
        "referred_email": referral.referred_email,
        "referred_client_id": referral.referred_client_id,
        "referred_client_name": client.full_name if client else None,
        "status": referral.status.value,
        "created_at": referral.created_at,
        "converted_at": referral.converted_at,
    }


def _serialize_referrals(referrals: list[ExternalReferral], db: Session) -> list[dict]:
    # Batch load users for efficiency
    user_ids = set()
    for r in referrals:
        user_ids.add(r.referrer_id)
        if r.referred_client_id:
            user_ids.add(r.referred_client_id)
    users_map = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}

    result = []
    for r in referrals:
        referrer = users_map.get(r.referrer_id)
        client = users_map.get(r.referred_client_id) if r.referred_client_id else None
        result.append({
            "id": r.id,
            "referrer_id": r.referrer_id,
            "referrer_name": referrer.full_name if referrer else None,
            "referred_email": r.referred_email,
            "referred_client_id": r.referred_client_id,
            "referred_client_name": client.full_name if client else None,
            "status": r.status.value,
            "created_at": r.created_at,
            "converted_at": r.converted_at,
        })
    return result
