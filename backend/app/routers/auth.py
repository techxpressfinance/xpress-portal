import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.config import EMAIL_ENABLED, EMAIL_VERIFICATION_EXPIRE_HOURS, ENVIRONMENT, REFRESH_TOKEN_EXPIRE_DAYS
from app.database import get_db
from app.middleware.auth import get_current_user
from app.middleware.rate_limit import auth_limiter
from app.models.referral import Referral, ReferralStatus
from app.models.user import User
from app.schemas.user import (
    AccessTokenResponse,
    ChangePasswordRequest,
    CodeRequest,
    CodeVerify,
    ResendVerificationRequest,
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
    verify_login_code,
    verify_password,
)
from app.services.email import send_login_code_email, send_verification_email
from app.services.login_code import set_login_code

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _set_refresh_cookie(response: Response, token: str) -> None:
    """Set refresh token as an httpOnly cookie."""
    response.set_cookie(
        key="refresh_token",
        value=token,
        httponly=True,
        secure=ENVIRONMENT != "development",
        samesite="lax",
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/api/auth",
    )


def _clear_refresh_cookie(response: Response) -> None:
    """Remove the refresh token cookie."""
    response.delete_cookie(
        key="refresh_token",
        httponly=True,
        secure=ENVIRONMENT != "development",
        samesite="lax",
        path="/api/auth",
    )


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(
    data: UserRegister,
    request: Request,
    db: Session = Depends(get_db),
    ref: Optional[str] = Query(None, description="Referral code"),
):
    auth_limiter.check(request)

    if db.query(User).filter(User.email == data.email).first():
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
        email_verified=not EMAIL_ENABLED,
        email_verification_token=token,
        email_verification_token_expires_at=token_expires,
    )
    db.add(user)
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
def login(data: UserLogin, request: Request, response: Response, db: Session = Depends(get_db)):
    auth_limiter.check(request)
    auth_limiter.check_key(data.email)

    _MAX_FAILED = 5
    _LOCKOUT_MINUTES = 15

    user = db.query(User).filter(User.email == data.email).first()

    # Check account lockout before verifying password
    if user and user.locked_until and user.locked_until > datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Account temporarily locked. Try again later.",
        )

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
    db.commit()

    _set_refresh_cookie(response, create_refresh_token(user.id))
    return AccessTokenResponse(access_token=create_access_token(user.id, user.role.value))


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

    # Blacklist the old refresh token (rotation)
    blacklist_token(refresh_token, db)
    db.commit()

    _set_refresh_cookie(response, create_refresh_token(user.id))
    return AccessTokenResponse(access_token=create_access_token(user.id, user.role.value))


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
    log_activity(db, current_user.id, "password_changed", "user", current_user.id)
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
def resend_verification(data: ResendVerificationRequest, request: Request, db: Session = Depends(get_db)):
    auth_limiter.check(request)

    user = db.query(User).filter(User.email == data.email).first()
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


@router.post("/request-code")
def request_code(data: CodeRequest, request: Request, db: Session = Depends(get_db)):
    auth_limiter.check(request)

    user = db.query(User).filter(User.email == data.email).first()
    if user and user.auth_method == "code" and user.is_active:
        plain = set_login_code(user)
        db.commit()
        send_login_code_email(user.email, user.full_name, plain)

    return {"message": "If an account exists with that email, a login code has been sent"}


@router.post("/verify-code", response_model=AccessTokenResponse)
def verify_code(data: CodeVerify, request: Request, response: Response, db: Session = Depends(get_db)):
    auth_limiter.check(request)

    user = db.query(User).filter(User.email == data.email).first()
    if not user or user.auth_method != "code":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")
    if not user.login_code or not user.login_code_expires_at:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No active code. Request a new one.")
    if user.login_code_attempts >= 5:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many attempts. Request a new code.")
    expires_at = user.login_code_expires_at.replace(tzinfo=timezone.utc) if user.login_code_expires_at.tzinfo is None else user.login_code_expires_at
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Code expired. Request a new one.")

    if not verify_login_code(data.code, user.login_code):
        user.login_code_attempts += 1
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid code")

    # Success — clear code and return tokens
    user.login_code = None
    user.login_code_expires_at = None
    user.login_code_attempts = 0
    db.commit()

    _set_refresh_cookie(response, create_refresh_token(user.id))
    return AccessTokenResponse(access_token=create_access_token(user.id, user.role.value))


@router.get("/csrf-token")
def csrf_token():
    """Initialize the CSRF cookie. The CSRF middleware sets it on the response."""
    return {"status": "ok"}
