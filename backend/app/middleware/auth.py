from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.tenant_scoped import SKIP_TENANT_FILTER
from app.models.user import User, UserRole
from app.services.auth import decode_token, is_token_blacklisted

bearer_scheme = HTTPBearer()


def _is_token_revoked_by_user(user: User, payload: dict) -> bool:
    """Check if the token was issued before the user's bulk revocation timestamp."""
    if not user.tokens_revoked_at:
        return False
    iat = payload.get("iat")
    if iat is None:
        return True  # tokens without iat are treated as revoked
    issued_at = datetime.fromtimestamp(iat, tz=timezone.utc)
    revoked_at = user.tokens_revoked_at
    if revoked_at.tzinfo is None:
        revoked_at = revoked_at.replace(tzinfo=timezone.utc)
    return issued_at < revoked_at


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    payload = decode_token(credentials.credentials)
    if payload is None or payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    # Check if token has been revoked
    jti = payload.get("jti")
    if jti and is_token_blacklisted(jti, db):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has been revoked")

    # Impersonation tokens (admin viewing as another user) are strictly read-only
    if payload.get("imp") and request.method not in ("GET", "HEAD", "OPTIONS"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Impersonation sessions are view-only")

    # Unfiltered: the tenant wall below checks this user's tenant itself, and a
    # super admin (no tenant) must still resolve on a tenant-bound session.
    user = (
        db.query(User)
        .execution_options(**{SKIP_TENANT_FILTER: True})
        .filter(User.id == payload["sub"])
        .first()
    )
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    # Tenant wall, fail-closed. The super-admin bypass is decided by the stored
    # role, not the token's claim, so a demoted super admin's old token can't
    # skip it. Every other token must name the user's own tenant and, when the
    # request resolved one (auth paths don't), that tenant too.
    if user.role != UserRole.super_admin:
        token_tenant = payload.get("tenant_id") or ""
        request_tenant = getattr(request.state, "tenant_id", None)
        if not token_tenant or token_tenant != user.tenant_id or (request_tenant and token_tenant != request_tenant):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token does not match tenant")

    # Check bulk token revocation (e.g. after password change)
    if _is_token_revoked_by_user(user, payload):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has been revoked")

    return user


def require_role(*roles: str):
    def dependency(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role.value not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return current_user

    return dependency


def require_super_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role.value != "super_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin access required")
    return current_user
