from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.models.user import User
from app.services.auth import generate_login_code

LOGIN_CODE_EXPIRE_MINUTES = 10


def set_login_code(user: User) -> str:
    """Generate a login code, set it on the user, and return the plain code.

    Sets login_code (hashed), login_code_expires_at, and resets login_code_attempts.
    Caller is responsible for committing the session.
    """
    plain, hashed = generate_login_code()
    user.login_code = hashed
    user.login_code_expires_at = datetime.now(timezone.utc) + timedelta(minutes=LOGIN_CODE_EXPIRE_MINUTES)
    user.login_code_attempts = 0
    return plain
