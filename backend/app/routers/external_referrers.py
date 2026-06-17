from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.config import FRONTEND_URL
from app.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.external_referral import ClientEngagementModel, ExternalReferral, ExternalReferralStatus
from app.models.user import User, UserRole
from app.schemas.external_referrer import (
    ExternalReferralInvite,
    ExternalReferralOut,
    ExternalReferrerStats,
    ReferrerCreate,
)
from app.schemas.user import InvitedUserOut, UserOut
from app.services.email import (
    notify_admins_new_account,
    send_referral_notification_email,
    send_setup_account_email,
)
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/external-referrers", tags=["external-referrers"])


# --- Admin endpoints ---


@router.post("", response_model=InvitedUserOut, status_code=status.HTTP_201_CREATED)
def create_referrer(
    data: ReferrerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Create a new external referrer account. Admin or broker."""
    existing = db.query(User).filter(User.email == data.email, User.tenant_id == tenant_id).first()
    if existing:
        role_label = existing.role.value.capitalize()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A {role_label} account already exists with this email",
        )

    setup_token = secrets.token_urlsafe(32)

    user = User(
        email=data.email,
        full_name=data.full_name,
        phone=data.phone,
        password_hash="!",
        auth_method="password",
        role="referrer",
        is_active=True,
        email_verified=True,
        organization_name=data.organization_name,
        invited_by_id=current_user.id,
        tenant_id=tenant_id,
        email_verification_token=setup_token,
        email_verification_token_expires_at=datetime.now(timezone.utc) + timedelta(hours=48),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    setup_url = f"{FRONTEND_URL}/setup-account?token={setup_token}"
    send_setup_account_email(data.email, data.full_name, setup_url, current_user.full_name, role="referrer")

    notify_admins_new_account(
        db, tenant_id, "referrer", data.full_name, data.email, current_user.full_name or current_user.email,
        f"{FRONTEND_URL}/admin/referrers", exclude_user_id=current_user.id,
    )
    user.invite_url = setup_url
    return user


@router.get("", response_model=list[UserOut])
def list_referrers(
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """List external referrers across the tenant. Admins and brokers."""
    from app.services.query_utils import active_user_clauses
    return (
        db.query(User)
        .filter(User.role == UserRole.referrer, User.tenant_id == tenant_id, *active_user_clauses())
        .order_by(User.created_at.desc())
        .all()
    )


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

    # Check if client exists
    existing_user = db.query(User).filter(User.email == email, User.tenant_id == tenant_id).first()
    if existing_user and existing_user.role.value != "client":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account exists for this email but is not a client account",
        )

    engagement = ClientEngagementModel(data.client_engagement_model) if data.client_engagement_model else None
    referral = ExternalReferral(
        referrer_id=current_user.id,
        referred_email=email,
        referred_client_id=existing_user.id if existing_user else None,
        status=ExternalReferralStatus.signed_up if existing_user else ExternalReferralStatus.pending,
        converted_at=datetime.now(timezone.utc) if existing_user else None,
        client_engagement_model=engagement,
        tenant_id=tenant_id,
    )
    db.add(referral)

    if existing_user:
        db.commit()
        send_referral_notification_email(
            email,
            existing_user.full_name,
            current_user.full_name,
            current_user.organization_name,
        )
    else:
        # New user — create invited client account with a setup link
        name = data.full_name or email.split("@")[0]
        setup_token = secrets.token_urlsafe(32)
        new_user = User(
            email=email,
            full_name=name,
            password_hash="!",
            auth_method="password",
            role="client",
            is_active=True,
            email_verified=True,
            invited_by_id=current_user.id,
            tenant_id=tenant_id,
            email_verification_token=setup_token,
            email_verification_token_expires_at=datetime.now(timezone.utc) + timedelta(hours=48),
        )
        db.add(new_user)
        db.flush()
        referral.referred_client_id = new_user.id
        referral.status = ExternalReferralStatus.signed_up
        referral.converted_at = datetime.now(timezone.utc)
        db.commit()
        setup_url = f"{FRONTEND_URL}/setup-account?token={setup_token}"
        send_setup_account_email(email, name, setup_url, current_user.full_name, role="client")

    client_name = (existing_user.full_name if existing_user else name) or email
    notify_admins_new_account(
        db, tenant_id, "client", client_name, email, current_user.full_name or current_user.email,
        f"{FRONTEND_URL}/admin/contacts", exclude_user_id=current_user.id,
    )

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
        "client_engagement_model": referral.client_engagement_model.value if referral.client_engagement_model else None,
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
            "client_engagement_model": r.client_engagement_model.value if r.client_engagement_model else None,
            "created_at": r.created_at,
            "converted_at": r.converted_at,
        })
    return result
