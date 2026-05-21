import secrets
import uuid

from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.config import FRONTEND_URL
from app.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.external_referral import ExternalReferral
from app.models.referral import Referral
from app.models.user import User
from app.schemas.user import BrokerCreate, UserActiveUpdate, UserOut, UserProfileUpdate, UserRoleUpdate, UserUpdate
from app.services.activity_log import log_activity
from app.services.auth import blacklist_all_user_tokens, hash_password
from app.services.email import send_password_reset_email, send_setup_account_email
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    return db.query(User).filter(User.tenant_id == tenant_id).order_by(User.created_at.desc()).limit(500).all()


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
    if changes:
        log_activity(db, current_user.id, "profile_updated", "user", current_user.id, {"fields": list(changes.keys())}, tenant_id=current_user.tenant_id)
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/brokers", response_model=UserOut, status_code=status.HTTP_201_CREATED)
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
    only reset clients they invited.
    """
    user = db.query(User).filter(User.id == user_id, User.tenant_id == tenant_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.role.value not in ("client", "broker", "referrer"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password reset can only be sent to clients, brokers, and referrers")

    if current_user.role.value == "broker":
        if user.role.value != "client" or user.invited_by_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only reset clients you invited")

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
    referral = db.query(Referral).filter(
        Referral.referred_user_id == user_id,
    ).first()
    if not referral:
        return {"referrer": None}
    referrer = db.query(User).filter(User.id == referral.referrer_id).first()
    if not referrer:
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
    if data.full_name is not None:
        user.full_name = data.full_name.strip()
    if data.phone is not None:
        user.phone = data.phone.strip() or None
    if data.employee_id is not None:
        user.employee_id = data.employee_id.strip() or None
    if data.department is not None:
        user.department = data.department.strip() or None
    if data.license_number is not None:
        user.license_number = data.license_number.strip() or None
    if data.organization_name is not None:
        user.organization_name = data.organization_name.strip() or None
    log_activity(db, current_user.id, "user_updated", "user", user_id, {"fields": list(data.model_dump(exclude_unset=True).keys())}, tenant_id=tenant_id)
    db.commit()
    db.refresh(user)
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
    original_role = user.role.value

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
    user.organization_name = None

    blacklist_all_user_tokens(user.id, db)
    log_activity(db, current_user.id, "user_deleted", "user", user_id, {"email": original_email, "role": original_role}, tenant_id=tenant_id)
    db.commit()
