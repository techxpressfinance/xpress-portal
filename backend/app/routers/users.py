import json
import secrets
import uuid

from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import FRONTEND_URL
from app.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.external_referral import ExternalReferral, ExternalReferralStatus
from app.models.loan_application import LoanApplication
from app.models.referral import Referral
from app.models.user import User, UserRole
from app.schemas.user import AdminCreate, BrokerCreate, ClientProfile, DeletedClientOut, InvitedUserOut, ReferrerAttach, UserActiveUpdate, UserOut, UserProfileUpdate, UserRoleUpdate, UserUpdate
from app.services.activity_log import log_activity
from app.services.auth import blacklist_all_user_tokens, create_access_token
from app.services.email import send_email_changed_email, send_password_reset_email, send_setup_account_email
from app.services.loan_category import serialize_categories
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=list[UserOut])
def list_users(
    role: str | None = Query(None),
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    query = db.query(User).filter(
        User.tenant_id == tenant_id,
        ~User.email.like('%@deleted.invalid'),
        User.deleted_at.is_(None),
    )
    if role:
        try:
            query = query.filter(User.role == UserRole(role))
        except ValueError:
            pass
    return query.order_by(User.created_at.desc()).limit(500).all()


@router.get("/deleted", response_model=list[DeletedClientOut])
def list_deleted_clients(
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Admin-only: returns all soft-deleted clients with application counts."""
    rows = (
        db.query(
            User,
            func.count(LoanApplication.id).label("application_count"),
        )
        .outerjoin(LoanApplication, LoanApplication.user_id == User.id)
        .filter(
            User.tenant_id == tenant_id,
            User.role == UserRole.client,
            User.deleted_at.isnot(None),
        )
        .group_by(User.id)
        .order_by(User.deleted_at.desc())
        .all()
    )
    return [
        DeletedClientOut(
            id=user.id,
            original_email=user.deleted_original_email or user.email,
            original_name=user.deleted_original_name or user.full_name,
            deleted_at=user.deleted_at,
            application_count=count,
        )
        for user, count in rows
    ]


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=UserOut)
def update_profile(
    data: UserProfileUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    changes = data.model_dump(exclude_unset=True)
    if data.full_name is not None:
        current_user.full_name = data.full_name
    if data.phone is not None:
        current_user.phone = data.phone
    if data.specialties is not None:
        if current_user.role not in (UserRole.broker, UserRole.admin):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only brokers and admins have loan specialties")
        current_user.specialties = serialize_categories(data.specialties)
    if changes:
        log_activity(db, current_user.id, "profile_updated", "user", current_user.id, {"fields": list(changes.keys())}, tenant_id=current_user.tenant_id)
    db.commit()
    db.refresh(current_user)
    return current_user


@router.get("/me/profile", response_model=ClientProfile)
def get_client_profile(current_user: User = Depends(get_current_user)):
    """Returns the caller's saved application-autofill details (empty if none set)."""
    if not current_user.client_profile:
        return ClientProfile()
    try:
        return ClientProfile(**json.loads(current_user.client_profile))
    except (ValueError, TypeError):
        return ClientProfile()


@router.put("/me/profile", response_model=ClientProfile)
def update_client_profile(
    data: ClientProfile,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Saves the caller's constant personal details used to autofill new applications."""
    current_user.client_profile = json.dumps(data.model_dump())
    log_activity(db, current_user.id, "profile_details_updated", "user", current_user.id, None, tenant_id=current_user.tenant_id)
    db.commit()
    return data


@router.post("/brokers", response_model=InvitedUserOut, status_code=status.HTTP_201_CREATED)
def create_broker(
    data: BrokerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Create a new broker account. Admin only. Sends login credentials via email."""
    existing = db.query(User).filter(User.email == data.email, User.tenant_id == tenant_id).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        )

    setup_token = secrets.token_urlsafe(32)

    user = User(
        email=data.email,
        full_name=data.full_name,
        phone=data.phone,
        password_hash="!",
        auth_method="password",
        role="broker",
        is_active=True,
        email_verified=True,
        employee_id=data.employee_id,
        department=data.department,
        license_number=data.license_number,
        specialties=serialize_categories(data.specialties),
        invited_by_id=current_user.id,
        tenant_id=tenant_id,
        email_verification_token=setup_token,
        email_verification_token_expires_at=datetime.now(timezone.utc) + timedelta(hours=48),
    )
    db.add(user)
    db.flush()
    log_activity(db, current_user.id, "broker_created", "user", user.id, {"email": data.email, "full_name": data.full_name}, tenant_id=tenant_id)
    db.commit()
    db.refresh(user)

    setup_url = f"{FRONTEND_URL}/setup-account?token={setup_token}"
    send_setup_account_email(data.email, data.full_name, setup_url, role="broker")
    user.invite_url = setup_url
    return user


@router.post("/admins", response_model=InvitedUserOut, status_code=status.HTTP_201_CREATED)
def create_admin(
    data: AdminCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Create a new admin account. Admin only. Sends an account-setup link via email."""
    existing = db.query(User).filter(User.email == data.email, User.tenant_id == tenant_id).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        )

    setup_token = secrets.token_urlsafe(32)

    user = User(
        email=data.email,
        full_name=data.full_name,
        phone=data.phone,
        password_hash="!",
        auth_method="password",
        role="admin",
        is_active=True,
        email_verified=True,
        invited_by_id=current_user.id,
        tenant_id=tenant_id,
        email_verification_token=setup_token,
        email_verification_token_expires_at=datetime.now(timezone.utc) + timedelta(hours=48),
    )
    db.add(user)
    db.flush()
    log_activity(db, current_user.id, "admin_created", "user", user.id, {"email": data.email, "full_name": data.full_name}, tenant_id=tenant_id)
    db.commit()
    db.refresh(user)

    setup_url = f"{FRONTEND_URL}/setup-account?token={setup_token}"
    send_setup_account_email(data.email, data.full_name, setup_url, current_user.full_name, role="admin")
    user.invite_url = setup_url
    return user


@router.post("/{user_id}/send-password-reset", status_code=status.HTTP_204_NO_CONTENT)
def send_password_reset(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Send a password reset link.

    Admins can reset clients, brokers, and referrers in their tenant. Brokers can
    reset any client or referrer in their tenant.
    """
    user = db.query(User).filter(User.id == user_id, User.tenant_id == tenant_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.role.value not in ("client", "broker", "referrer", "admin"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password reset can only be sent to clients, brokers, referrers, and admins")

    if current_user.role.value == "broker":
        if user.role.value not in ("client", "referrer"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Brokers can only reset clients and referrers")

    token = secrets.token_urlsafe(32)
    user.password_reset_token = token
    user.password_reset_token_expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
    log_activity(db, current_user.id, "password_reset_sent", "user", user_id, {"email": user.email}, tenant_id=tenant_id)
    db.commit()

    send_password_reset_email(user.email, user.full_name, token)


@router.get("/{user_id}/referrer")
def get_user_referrer(
    user_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Get the referrer of a user, if any."""
    ext_ref = db.query(ExternalReferral).filter(
        ExternalReferral.referred_client_id == user_id,
    ).first()
    if ext_ref and ext_ref.referrer:
        return {
            "referrer": {
                "id": ext_ref.referrer.id,
                "full_name": ext_ref.referrer.full_name,
                "email": ext_ref.referrer.email,
                "phone": ext_ref.referrer.phone,
                "organization_name": getattr(ext_ref.referrer, "organization_name", None),
            }
        }
    # Referral rows are also written for admin/broker invite links — only a
    # referrer-role user counts as an actual referrer.
    referral = db.query(Referral).filter(
        Referral.referred_user_id == user_id,
    ).first()
    if not referral:
        return {"referrer": None}
    referrer = db.query(User).filter(User.id == referral.referrer_id).first()
    if not referrer or referrer.role != UserRole.referrer:
        return {"referrer": None}
    return {
        "referrer": {
            "id": referrer.id,
            "full_name": referrer.full_name,
            "email": referrer.email,
            "phone": referrer.phone,
            "organization_name": getattr(referrer, "organization_name", None),
        }
    }


@router.post("/{user_id}/referrer")
def set_user_referrer(
    user_id: str,
    data: ReferrerAttach,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Credit a referrer for a client who has none — for leads that arrived
    outside the portal (e.g. via WhatsApp) and were entered by staff."""
    client = db.query(User).filter(
        User.id == user_id,
        User.tenant_id == tenant_id,
        User.deleted_at.is_(None),
    ).first()
    if not client or client.role != UserRole.client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")
    referrer = db.query(User).filter(
        User.id == data.referrer_id,
        User.tenant_id == tenant_id,
        User.role == UserRole.referrer,
        User.deleted_at.is_(None),
    ).first()
    if not referrer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Referrer not found")
    existing = (
        db.query(ExternalReferral).filter(ExternalReferral.referred_client_id == user_id).first()
        or db.query(Referral).filter(Referral.referred_user_id == user_id).first()
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This client already has a referrer")
    has_applied = db.query(LoanApplication.id).filter(LoanApplication.user_id == user_id).first() is not None
    db.add(ExternalReferral(
        tenant_id=tenant_id,
        referrer_id=referrer.id,
        referred_email=client.email,
        referred_client_id=client.id,
        status=ExternalReferralStatus.applied if has_applied else ExternalReferralStatus.signed_up,
        converted_at=datetime.now(timezone.utc) if has_applied else None,
    ))
    log_activity(db, current_user.id, "referrer_attached", "user", client.id, {"referrer_id": referrer.id}, tenant_id=tenant_id)
    db.commit()
    return {
        "referrer": {
            "id": referrer.id,
            "full_name": referrer.full_name,
            "email": referrer.email,
            "phone": referrer.phone,
            "organization_name": getattr(referrer, "organization_name", None),
        }
    }


@router.delete("/{user_id}/referrer")
def unlink_user_referrer(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Remove a client's referrer attribution. The referrer stops being credited
    for the client (and their applications) and loses the client from their lists."""
    client = db.query(User).filter(
        User.id == user_id,
        User.tenant_id == tenant_id,
        User.deleted_at.is_(None),
    ).first()
    if not client or client.role != UserRole.client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")
    removed_referrer_ids: set[str] = set()
    for ext_ref in db.query(ExternalReferral).filter(ExternalReferral.referred_client_id == user_id).all():
        removed_referrer_ids.add(ext_ref.referrer_id)
        db.delete(ext_ref)
    # Referral rows also record admin/broker invite-link signups — those aren't
    # referrer attributions, so leave them as signup history.
    referrals = (
        db.query(Referral)
        .join(User, User.id == Referral.referrer_id)
        .filter(Referral.referred_user_id == user_id, User.role == UserRole.referrer)
        .all()
    )
    for referral in referrals:
        removed_referrer_ids.add(referral.referrer_id)
        db.delete(referral)
    if not removed_referrer_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This client has no referrer linked")
    log_activity(db, current_user.id, "referrer_detached", "user", client.id,
                 {"referrer_ids": sorted(removed_referrer_ids)}, tenant_id=tenant_id)
    db.commit()
    return {"referrer": None}


@router.get("/{user_id}", response_model=UserOut)
def get_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    if current_user.role.value == "client" and current_user.id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot view other users")
    if current_user.role.value == "referrer" and current_user.id != user_id:
        # Referrers can only view clients they've referred
        ref = db.query(ExternalReferral).filter(
            ExternalReferral.referrer_id == current_user.id,
            ExternalReferral.referred_client_id == user_id,
        ).first()
        if not ref:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot view this user")
    user = db.query(User).filter(User.id == user_id, User.tenant_id == tenant_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: str,
    data: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    user = db.query(User).filter(User.id == user_id, User.tenant_id == tenant_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    old_email: str | None = None
    if data.full_name is not None:
        user.full_name = data.full_name.strip()
    if data.email is not None and data.email != user.email:
        # Email is the login identity — admins only, and it must stay unique per tenant.
        if current_user.role.value != "admin":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can change a user's email")
        clash = db.query(User).filter(
            User.email == data.email,
            User.tenant_id == tenant_id,
            User.id != user_id,
        ).first()
        if clash:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user with this email already exists")
        old_email = user.email
        user.email = data.email
        log_activity(db, current_user.id, "user_email_changed", "user", user_id,
                     {"from": old_email, "to": data.email}, tenant_id=tenant_id)
    if data.phone is not None:
        user.phone = data.phone.strip() or None
    if data.employee_id is not None:
        user.employee_id = data.employee_id.strip() or None
    if data.department is not None:
        user.department = data.department.strip() or None
    if data.license_number is not None:
        user.license_number = data.license_number.strip() or None
    if data.specialties is not None:
        user.specialties = serialize_categories(data.specialties)
    if data.organization_name is not None:
        user.organization_name = data.organization_name.strip() or None
    log_activity(db, current_user.id, "user_updated", "user", user_id, {"fields": list(data.model_dump(exclude_unset=True).keys())}, tenant_id=tenant_id)
    db.commit()
    db.refresh(user)
    if old_email:
        # Only after the change is committed — tell them at the new address which one to sign in with.
        send_email_changed_email(user.email, user.full_name, old_email, changed_by_name=current_user.full_name)
    return user


@router.patch("/{user_id}/role", response_model=UserOut)
def update_user_role(
    user_id: str,
    data: UserRoleUpdate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    if user_id == _current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot change your own role")
    user = db.query(User).filter(User.id == user_id, User.tenant_id == tenant_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Clients cannot be promoted directly to admin — must go through broker first
    if user.role.value == "client" and data.role.value == "admin":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot promote a client directly to admin. Promote to broker first.",
        )

    old_role = user.role.value
    user.role = data.role
    log_activity(db, _current_user.id, "role_changed", "user", user_id, {"from": old_role, "to": data.role.value}, tenant_id=tenant_id)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}/active", response_model=UserOut)
def toggle_user_active(
    user_id: str,
    data: UserActiveUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot deactivate yourself")
    user = db.query(User).filter(User.id == user_id, User.tenant_id == tenant_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    user.is_active = data.is_active
    action = "user_activated" if data.is_active else "user_deactivated"
    log_activity(db, current_user.id, action, "user", user_id, {"email": user.email}, tenant_id=tenant_id)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Soft-delete a user. Admin only.

    The user is deactivated, their PII is scrambled, credentials are wiped, and
    active sessions are revoked. Historical rows (applications, notes, messages,
    activity log) remain intact to preserve audit history. The original email
    address is freed for re-use.
    """
    if user_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete yourself")

    user = db.query(User).filter(User.id == user_id, User.tenant_id == tenant_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    original_email = user.email
    original_name = user.full_name
    original_role = user.role.value

    # Preserve original info for deleted-clients retrieval before scrambling.
    user.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
    user.deleted_original_email = original_email
    user.deleted_original_name = original_name

    # Scramble identifying fields so the email/phone can be reused for a fresh signup.
    user.email = f"deleted-{uuid.uuid4().hex}@deleted.invalid"
    user.full_name = "Deleted user"
    user.phone = None
    user.password_hash = "!"
    user.auth_method = "password"
    user.is_active = False
    user.email_verified = False
    user.email_verification_token = None
    user.email_verification_token_expires_at = None
    user.password_reset_token = None
    user.password_reset_token_expires_at = None
    user.login_code = None
    user.login_code_expires_at = None
    user.login_code_attempts = 0
    user.failed_login_attempts = 0
    user.locked_until = None
    user.employee_id = None
    user.license_number = None
    user.specialties = None
    user.organization_name = None

    blacklist_all_user_tokens(user.id, db)
    log_activity(db, current_user.id, "user_deleted", "user", user_id, {"email": original_email, "role": original_role}, tenant_id=tenant_id)
    db.commit()


@router.post("/{user_id}/impersonate")
def impersonate_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Issue a short-lived, view-only access token for another user in the same tenant.

    The token carries an `imp` claim with the admin's id; the auth middleware
    rejects all state-changing requests made with it. The session lasts one
    access-token lifetime and cannot be refreshed.
    """
    if user_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot impersonate yourself")

    target = db.query(User).filter(
        User.id == user_id,
        User.tenant_id == tenant_id,
        User.deleted_at.is_(None),
    ).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if not target.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot impersonate an inactive user")
    if target.role == UserRole.super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot impersonate a super admin")

    access_token = create_access_token(target.id, target.role.value, tenant_id, impersonator_id=current_user.id)
    log_activity(
        db,
        current_user.id,
        "impersonation_started",
        "user",
        target.id,
        {"target_email": target.email, "target_role": target.role.value},
        tenant_id=tenant_id,
    )
    db.commit()
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": target.id,
            "full_name": target.full_name,
            "email": target.email,
            "role": target.role.value,
        },
    }
