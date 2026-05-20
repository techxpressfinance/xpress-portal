import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.config import EMAIL_ENABLED, EMAIL_VERIFICATION_EXPIRE_HOURS
from app.database import get_db
from app.middleware.auth import _is_token_revoked_by_user, get_current_user
from app.middleware.rate_limit import auth_limiter
from app.models.referral import Referral, ReferralStatus
from app.models.user import User
from app.schemas.user import (
    AccessTokenResponse,
    ChangePasswordRequest,
    ResendVerificationRequest,
    SetupAccountRequest,
    UserLogin,
    UserOut,
    UserRegister,
)
from app.services.activity_log import log_activity
from app.services.auth import (
    blacklist_all_user_tokens,
    blacklist_token,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    is_token_blacklisted,
    verify_password,
)
from app.services.cookie_auth import clear_refresh_cookie as _clear_refresh_cookie, set_refresh_cookie as _set_refresh_cookie
from app.services.email import send_password_reset_email, send_verification_email
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/auth", tags=["auth"])



@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(
    data: UserRegister,
    request: Request,
    db: Session = Depends(get_db),
    ref: Optional[str] = Query(None, description="Referral code"),
    tenant_id: str = Depends(get_tenant_id),
):
    auth_limiter.check(request)

    if db.query(User).filter(User.email == data.email, User.tenant_id == tenant_id).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    if EMAIL_ENABLED:
        token = secrets.token_urlsafe(32)
        token_expires = datetime.now(timezone.utc) + timedelta(hours=EMAIL_VERIFICATION_EXPIRE_HOURS)
    else:
        token = None
        token_expires = None

    user = User(
        email=data.email,
        password_hash=hash_password(data.password),
        full_name=data.full_name,
        phone=data.phone,
        tenant_id=tenant_id,
        email_verified=not EMAIL_ENABLED,
        email_verification_token=token,
        email_verification_token_expires_at=token_expires,
    )
    db.add(user)
    db.flush()
    log_activity(db, user.id, "registered", "user", user.id, {"email": data.email, "full_name": data.full_name}, tenant_id=tenant_id)
    db.commit()
    db.refresh(user)

    if EMAIL_ENABLED and token:
        send_verification_email(data.email, data.full_name, token)

    # Handle referral code if provided
    if ref:
        referral = db.query(Referral).filter(Referral.referral_code == ref).first()
        if referral:
            # If there's a specific invite for this email, update that record
            email_referral = (
                db.query(Referral)
                .filter(
                    Referral.referrer_id == referral.referrer_id,
                    Referral.referred_email == data.email,
                    Referral.referred_user_id == None,  # noqa: E711
                )
                .first()
            )
            target = email_referral or referral
            if not target.referred_user_id:
                target.referred_user_id = user.id
                target.status = ReferralStatus.signed_up
                target.converted_at = datetime.now(timezone.utc)
                db.commit()

    return user


@router.post("/login", response_model=AccessTokenResponse)
def login(data: UserLogin, request: Request, response: Response, db: Session = Depends(get_db), tenant_id: str = Depends(get_tenant_id)):
    auth_limiter.check(request)
    auth_limiter.check_key(data.email)

    _MAX_FAILED = 5
    _LOCKOUT_MINUTES = 15

    user = db.query(User).filter(
        User.email == data.email,
        or_(
            User.tenant_id == tenant_id,
            and_(User.role == "super_admin", User.tenant_id.is_(None)),
        ),
    ).first()

    # Account lockout: still active → reject; expired → clear so the user gets a fresh window
    if user and user.locked_until:
        locked_until = user.locked_until if user.locked_until.tzinfo else user.locked_until.replace(tzinfo=timezone.utc)
        if locked_until > datetime.now(timezone.utc):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Account temporarily locked. Try again later.",
            )
        user.failed_login_attempts = 0
        user.locked_until = None

    # Users still on the setup-link placeholder hash can't log in by password
    if user and user.password_hash in ("!", "!invited"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if not user or not verify_password(data.password, user.password_hash):
        # Increment failed attempts if user exists
        if user:
            user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
            if user.failed_login_attempts >= _MAX_FAILED:
                user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=_LOCKOUT_MINUTES)
            db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")
    if not user.email_verified:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Email not verified")

    # Reset failed attempts on successful login
    user.failed_login_attempts = 0
    user.locked_until = None

    # Blacklist any prior refresh token from a previous session before issuing a new one
    prior_refresh = request.cookies.get("refresh_token")
    if prior_refresh:
        payload = decode_token(prior_refresh)
        if payload and payload.get("type") == "refresh":
            blacklist_token(prior_refresh, db)

    db.commit()

    _set_refresh_cookie(response, create_refresh_token(user.id, tenant_id))
    return AccessTokenResponse(access_token=create_access_token(user.id, user.role.value, tenant_id))


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    """Revoke the refresh token stored in the httpOnly cookie."""
    refresh_token = request.cookies.get("refresh_token")
    if refresh_token:
        payload = decode_token(refresh_token)
        if payload and payload.get("type") == "refresh":
            blacklist_token(refresh_token, db)
            db.commit()
    _clear_refresh_cookie(response)
    return {"message": "Logged out"}


@router.post("/refresh", response_model=AccessTokenResponse)
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    """Issue a new access token using the refresh token from the httpOnly cookie."""
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No refresh token")

    payload = decode_token(refresh_token)
    if payload is None or payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    # Check if this refresh token has been revoked
    jti = payload.get("jti")
    if jti and is_token_blacklisted(jti, db):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has been revoked")

    user = db.query(User).filter(User.id == payload["sub"]).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    # Check bulk token revocation (e.g. after password change)
    if _is_token_revoked_by_user(user, payload):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has been revoked")

    # Blacklist the old refresh token (rotation)
    blacklist_token(refresh_token, db)
    db.commit()

    _tenant_id = payload.get("tenant_id", user.tenant_id or "")
    _set_refresh_cookie(response, create_refresh_token(user.id, _tenant_id))
    return AccessTokenResponse(access_token=create_access_token(user.id, user.role.value, _tenant_id))


@router.post("/change-password")
def change_password(
    data: ChangePasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Change password for the currently authenticated user. Revokes all existing tokens."""
    auth_limiter.check(request)
    if not verify_password(data.current_password, current_user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")

    if data.current_password == data.new_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New password must be different")

    current_user.password_hash = hash_password(data.new_password)
    blacklist_all_user_tokens(current_user.id, db)
    log_activity(db, current_user.id, "password_changed", "user", current_user.id, tenant_id=current_user.tenant_id)
    db.commit()

    return {"message": "Password changed. Please log in again."}


@router.get("/verify-email")
def verify_email(token: str = Query(...), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email_verification_token == token).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid verification token")
    if user.email_verified:
        return {"message": "Email already verified"}
    expires_at = user.email_verification_token_expires_at
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Verification token has expired")

    user.email_verified = True
    user.email_verification_token = None
    user.email_verification_token_expires_at = None
    db.commit()
    return {"message": "Email verified successfully"}


@router.post("/resend-verification")
def resend_verification(data: ResendVerificationRequest, request: Request, db: Session = Depends(get_db), tenant_id: str = Depends(get_tenant_id)):
    auth_limiter.check(request)
    auth_limiter.check_key(data.email)

    user = db.query(User).filter(User.email == data.email, User.tenant_id == tenant_id).first()
    if user and not user.email_verified and EMAIL_ENABLED:
        token = secrets.token_urlsafe(32)
        user.email_verification_token = token
        user.email_verification_token_expires_at = datetime.now(timezone.utc) + timedelta(hours=EMAIL_VERIFICATION_EXPIRE_HOURS)
        db.commit()
        send_verification_email(user.email, user.full_name, token)

    return {"message": "If an account exists with that email, a verification link has been sent"}


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user


_SETUP_PLACEHOLDER_HASHES = ("!", "!invited")


@router.get("/validate-setup-token")
def validate_setup_token(token: str = Query(...), db: Session = Depends(get_db)):
    """Check if an account setup token is valid. Returns user details if valid."""
    user = db.query(User).filter(User.email_verification_token == token).first()
    # Only accept tokens for accounts that haven't completed setup. A self-registered
    # user's verify-email token must not be usable to reset their password.
    if not user or user.password_hash not in _SETUP_PLACEHOLDER_HASHES:
        return {"valid": False, "reason": "Invalid or expired link"}
    expires_at = user.email_verification_token_expires_at
    if expires_at:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            return {"valid": False, "reason": "This link has expired. Request a new invitation."}
    return {"valid": True, "full_name": user.full_name, "email": user.email, "role": user.role.value}


@router.post("/setup-account", response_model=AccessTokenResponse)
def setup_account(data: SetupAccountRequest, response: Response, db: Session = Depends(get_db)):
    """Set password from an invitation token and auto-login."""
    user = db.query(User).filter(User.email_verification_token == data.token).first()
    if not user or user.password_hash not in _SETUP_PLACEHOLDER_HASHES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired setup link")
    expires_at = user.email_verification_token_expires_at
    if expires_at:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Setup link has expired. Request a new invitation.")
    user.password_hash = hash_password(data.password)
    user.auth_method = "password"
    user.email_verification_token = None
    user.email_verification_token_expires_at = None
    user.password_reset_token = None
    user.password_reset_token_expires_at = None
    blacklist_all_user_tokens(user.id, db)
    db.commit()
    tenant_id = user.tenant_id or ""
    _set_refresh_cookie(response, create_refresh_token(user.id, tenant_id))
    return AccessTokenResponse(access_token=create_access_token(user.id, user.role.value, tenant_id))


@router.post("/forgot-password", status_code=status.HTTP_204_NO_CONTENT)
def forgot_password(data: ResendVerificationRequest, request: Request, db: Session = Depends(get_db), tenant_id: str = Depends(get_tenant_id)):
    auth_limiter.check(request)
    user = db.query(User).filter(User.email == data.email, User.tenant_id == tenant_id).first()
    if user and user.is_active:
        token = secrets.token_urlsafe(32)
        user.password_reset_token = token
        user.password_reset_token_expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
        db.commit()
        send_password_reset_email(user.email, user.full_name, token)


class PasswordResetRequest(SetupAccountRequest):
    pass


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(data: PasswordResetRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.password_reset_token == data.token).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset link")
    expires_at = user.password_reset_token_expires_at
    if expires_at:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reset link has expired. Please request a new one.")
    user.password_hash = hash_password(data.password)
    user.auth_method = "password"
    user.login_code = None
    user.login_code_expires_at = None
    user.login_code_attempts = 0
    user.password_reset_token = None
    user.password_reset_token_expires_at = None
    user.email_verification_token = None
    user.email_verification_token_expires_at = None
    blacklist_all_user_tokens(user.id, db)
    db.commit()


@router.get("/csrf-token")
def csrf_token():
    """Initialize the CSRF cookie. The CSRF middleware sets it on the response."""
    return {"status": "ok"}
