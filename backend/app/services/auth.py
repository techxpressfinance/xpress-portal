from __future__ import annotations

import hashlib
import hmac
import secrets
import string
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from jose import JWTError, jwt

from app.config import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    JWT_ALGORITHM,
    JWT_SECRET_KEY,
    LOGIN_CODE_SECRET,
    REFRESH_TOKEN_EXPIRE_DAYS,
)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user_id: str, role: str, tenant_id: str = "") -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": user_id, "role": role, "tenant_id": tenant_id, "exp": expire, "iat": now, "type": "access", "jti": str(uuid.uuid4())},
        JWT_SECRET_KEY,
        algorithm=JWT_ALGORITHM,
    )


def create_refresh_token(user_id: str, tenant_id: str = "") -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    return jwt.encode(
        {"sub": user_id, "tenant_id": tenant_id, "exp": expire, "iat": now, "type": "refresh", "jti": str(uuid.uuid4())},
        JWT_SECRET_KEY,
        algorithm=JWT_ALGORITHM,
    )


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    except JWTError:
        return None


def is_token_blacklisted(jti: str, db) -> bool:
    """Check if a token's JTI has been revoked."""
    from app.models.token_blacklist import TokenBlacklist

    return db.query(TokenBlacklist).filter(TokenBlacklist.token_jti == jti).first() is not None


def blacklist_token(token: str, db) -> None:
    """Add a token to the blacklist."""
    from app.models.token_blacklist import TokenBlacklist

    payload = decode_token(token)
    if not payload or "jti" not in payload:
        return
    entry = TokenBlacklist(
        token_jti=payload["jti"],
        user_id=payload["sub"],
        expires_at=datetime.fromtimestamp(payload["exp"], tz=timezone.utc),
    )
    db.add(entry)


def blacklist_all_user_tokens(user_id: str, db) -> None:
    """Revoke all tokens for a user by setting tokens_revoked_at on the user record.

    Any token issued before this timestamp will be rejected by get_current_user/refresh.
    """
    from app.models.user import User

    user = db.query(User).filter(User.id == user_id).first()
    if user:
        user.tokens_revoked_at = datetime.now(timezone.utc)


def generate_login_code() -> tuple[str, str]:
    """Returns (plain_code, hashed_code). Uses 8-char alphanumeric code with HMAC-SHA256."""
    alphabet = string.ascii_uppercase + string.digits
    code = "".join(secrets.choice(alphabet) for _ in range(8))
    hashed = hmac.HMAC(LOGIN_CODE_SECRET.encode(), code.encode(), hashlib.sha256).hexdigest()
    return code, hashed


def verify_login_code(plain_code: str, hashed_code: str) -> bool:
    candidate = hmac.HMAC(LOGIN_CODE_SECRET.encode(), plain_code.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(candidate, hashed_code)
