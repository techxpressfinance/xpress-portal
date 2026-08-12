from __future__ import annotations

import os
import secrets
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
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
    ReferrerBusinessProfile,
    ReferrerBusinessProfileOut,
    ReferrerCreate,
)
from app.schemas.user import InvitedUserOut, UserOut
from app.services.email import (
    notify_admins_new_account,
    send_referral_notification_email,
    send_setup_account_email,
)
from app.services.s3_storage import delete_file, download_file, file_exists, upload_file
from app.services.tenant_scope import get_tenant_id
from app.services.upload_validation import safe_filename, validate_attachment

router = APIRouter(prefix="/api/external-referrers", tags=["external-referrers"])

# Fields that must all be present before we can raise a tax invoice for a referrer.
# Logo and letterhead are deliberately excluded — they are "if applicable".
_REQUIRED_BUSINESS_FIELDS = (
    "business_abn",
    "business_gst_registered",
    "business_director_name",
    "business_address",
    "bank_account_name",
    "bank_bsb",
    "bank_account_number",
    "phone",
)

_BUSINESS_ASSETS = {
    "logo": ("business_logo_path", "business_logo_filename"),
    "letterhead": ("business_letterhead_path", "business_letterhead_filename"),
}


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
        # Whatever billing detail the inviter already knows — the referrer completes
        # the rest on the business-details page after setting their password.
        business_abn=data.business_abn,
        business_gst_registered=data.business_gst_registered,
        business_director_name=data.business_director_name,
        business_address=data.business_address,
        bank_account_name=data.bank_account_name,
        bank_bsb=data.bank_bsb,
        bank_account_number=data.bank_account_number,
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


# --- Business (tax invoice) profile ---
#
# Route order matters: "/me/..." must be declared before "/{referrer_id}/..."
# or "me" would be swallowed by the path parameter.


@router.get("/me/business-profile", response_model=ReferrerBusinessProfileOut)
def get_my_business_profile(current_user: User = Depends(require_role("referrer"))):
    """The signed-in referrer's own billing details."""
    return _business_profile_out(current_user)


@router.put("/me/business-profile", response_model=ReferrerBusinessProfileOut)
def update_my_business_profile(
    data: ReferrerBusinessProfile,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("referrer")),
):
    return _apply_business_profile(db, current_user, data)


@router.post("/me/business-profile/{asset}", response_model=ReferrerBusinessProfileOut)
def upload_my_business_asset(
    asset: str,
    file: UploadFile,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("referrer")),
):
    """Upload the referrer's own logo or letterhead."""
    return _store_business_asset(db, current_user, asset, file)


@router.delete("/me/business-profile/{asset}", response_model=ReferrerBusinessProfileOut)
def delete_my_business_asset(
    asset: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("referrer")),
):
    return _clear_business_asset(db, current_user, asset)


@router.get("/me/business-profile/{asset}/file")
def download_my_business_asset(
    asset: str,
    current_user: User = Depends(require_role("referrer")),
):
    return _serve_business_asset(current_user, asset)


@router.get("/business-profiles", response_model=list[ReferrerBusinessProfileOut])
def list_business_profiles(
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Billing details for every referrer — the month-end invoicing view. Admin only."""
    from app.services.query_utils import active_user_clauses
    referrers = (
        db.query(User)
        .filter(User.role == UserRole.referrer, User.tenant_id == tenant_id, *active_user_clauses())
        .order_by(User.created_at.desc())
        .all()
    )
    return [_business_profile_out(r) for r in referrers]


@router.get("/{referrer_id}/business-profile", response_model=ReferrerBusinessProfileOut)
def get_referrer_business_profile(
    referrer_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """A referrer's billing details, for raising their monthly tax invoice."""
    return _business_profile_out(_load_referrer(db, referrer_id, tenant_id))


@router.put("/{referrer_id}/business-profile", response_model=ReferrerBusinessProfileOut)
def update_referrer_business_profile(
    referrer_id: str,
    data: ReferrerBusinessProfile,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    return _apply_business_profile(db, _load_referrer(db, referrer_id, tenant_id), data)


@router.post("/{referrer_id}/business-profile/{asset}", response_model=ReferrerBusinessProfileOut)
def upload_referrer_business_asset(
    referrer_id: str,
    asset: str,
    file: UploadFile,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    return _store_business_asset(db, _load_referrer(db, referrer_id, tenant_id), asset, file)


@router.delete("/{referrer_id}/business-profile/{asset}", response_model=ReferrerBusinessProfileOut)
def delete_referrer_business_asset(
    referrer_id: str,
    asset: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    return _clear_business_asset(db, _load_referrer(db, referrer_id, tenant_id), asset)


@router.get("/{referrer_id}/business-profile/{asset}/file")
def download_referrer_business_asset(
    referrer_id: str,
    asset: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    return _serve_business_asset(_load_referrer(db, referrer_id, tenant_id), asset)


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


def _load_referrer(db: Session, referrer_id: str, tenant_id: str) -> User:
    referrer = (
        db.query(User)
        .filter(User.id == referrer_id, User.tenant_id == tenant_id, User.role == UserRole.referrer)
        .first()
    )
    if not referrer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Referrer not found")
    return referrer


def _business_profile_out(user: User) -> dict:
    return {
        "id": user.id,
        "full_name": user.full_name,
        "email": user.email,
        "phone": user.phone,
        "organization_name": user.organization_name,
        "business_abn": user.business_abn,
        "business_gst_registered": user.business_gst_registered,
        "business_director_name": user.business_director_name,
        "business_address": user.business_address,
        "bank_account_name": user.bank_account_name,
        "bank_bsb": user.bank_bsb,
        "bank_account_number": user.bank_account_number,
        "business_logo_filename": user.business_logo_filename,
        "business_letterhead_filename": user.business_letterhead_filename,
        "business_details_updated_at": user.business_details_updated_at,
        "is_complete": all(getattr(user, field) is not None for field in _REQUIRED_BUSINESS_FIELDS),
    }


def _apply_business_profile(db: Session, user: User, data: ReferrerBusinessProfile) -> dict:
    """Write the submitted billing fields.

    Only fields present in the request body are touched, so a partial PUT can't
    silently wipe bank details; sending an explicit null clears that one field.
    """
    for field in data.model_fields_set:
        setattr(user, field, getattr(data, field))
    user.business_details_updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return _business_profile_out(user)


def _asset_columns(asset: str) -> tuple[str, str]:
    columns = _BUSINESS_ASSETS.get(asset)
    if not columns:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown asset")
    return columns


def _store_business_asset(db: Session, user: User, asset: str, file: UploadFile) -> dict:
    path_col, name_col = _asset_columns(asset)
    contents = file.file.read()
    ext = validate_attachment(file.filename or "file", contents)
    stored_path = upload_file(contents, f"{uuid4()}{ext}")

    previous = getattr(user, path_col)
    setattr(user, path_col, stored_path)
    setattr(user, name_col, safe_filename(file.filename or f"{asset}{ext}"))
    user.business_details_updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    if previous:
        _remove_stored_file(previous)
    return _business_profile_out(user)


def _clear_business_asset(db: Session, user: User, asset: str) -> dict:
    path_col, name_col = _asset_columns(asset)
    previous = getattr(user, path_col)
    setattr(user, path_col, None)
    setattr(user, name_col, None)
    user.business_details_updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    if previous:
        _remove_stored_file(previous)
    return _business_profile_out(user)


def _remove_stored_file(path: str) -> None:
    """Best-effort cleanup — a missing file must not fail the request."""
    try:
        delete_file(path)
    except Exception:  # noqa: BLE001 — storage cleanup is not worth failing on
        pass


_ASSET_MEDIA_TYPES = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}


def _serve_business_asset(user: User, asset: str) -> Response:
    path_col, name_col = _asset_columns(asset)
    stored_path = getattr(user, path_col)
    if not stored_path or not file_exists(stored_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No {asset} on file")

    filename = os.path.basename((getattr(user, name_col) or f"{asset}").replace("\r", "").replace("\n", "").replace('"', "'"))
    ext = os.path.splitext(filename)[1].lower() or os.path.splitext(stored_path)[1].lower()
    return Response(
        content=download_file(stored_path),
        media_type=_ASSET_MEDIA_TYPES.get(ext, "application/octet-stream"),
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


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
