from __future__ import annotations

import hashlib
import hmac
import secrets
import string
import uuid
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    JWT_ALGORITHM,
    JWT_SECRET_KEY,
    REFRESH_TOKEN_EXPIRE_DAYS,
)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": user_id, "role": role, "exp": expire, "type": "access", "jti": str(uuid.uuid4())},
        JWT_SECRET_KEY,
        algorithm=JWT_ALGORITHM,
    )


def create_refresh_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    return jwt.encode(
        {"sub": user_id, "exp": expire, "type": "refresh", "jti": str(uuid.uuid4())},
        JWT_SECRET_KEY,
        algorithm=JWT_ALGORITHM,
    )


def decode_token(token: str) -> dict | None:
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
    """Revoke all active refresh tokens for a user by adding a blanket revocation marker."""
    from app.models.token_blacklist import TokenBlacklist

    # Add a special marker that invalidates all tokens issued before now
    entry = TokenBlacklist(
        token_jti=f"all:{user_id}:{uuid.uuid4()}",
        user_id=user_id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(entry)


def generate_login_code() -> tuple[str, str]:
    """Returns (plain_code, hashed_code). Uses 8-char alphanumeric code with HMAC-SHA256."""
    alphabet = string.ascii_uppercase + string.digits
    code = "".join(secrets.choice(alphabet) for _ in range(8))
    hashed = hmac.HMAC(JWT_SECRET_KEY.encode(), code.encode(), hashlib.sha256).hexdigest()
    return code, hashed


def verify_login_code(plain_code: str, hashed_code: str) -> bool:
    candidate = hmac.HMAC(JWT_SECRET_KEY.encode(), plain_code.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(candidate, hashed_code)
