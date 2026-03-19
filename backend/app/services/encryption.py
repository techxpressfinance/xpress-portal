"""Field-level encryption for PII data using Fernet symmetric encryption."""
from __future__ import annotations

import logging

from cryptography.fernet import Fernet, InvalidToken

import app.config as config

logger = logging.getLogger(__name__)

_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        if not config.FIELD_ENCRYPTION_KEY:
            raise RuntimeError("FIELD_ENCRYPTION_KEY is not configured")
        _fernet = Fernet(config.FIELD_ENCRYPTION_KEY.encode())
    return _fernet


def encrypt_value(value: str) -> str:
    """Encrypt a plaintext string. Returns Fernet token (base64)."""
    if not config.FIELD_ENCRYPTION_KEY:
        return value  # Pass-through when encryption is not configured (dev only)
    return _get_fernet().encrypt(value.encode()).decode()


def decrypt_value(value: str) -> str:
    """Decrypt a Fernet token. Falls back to raw value for pre-encryption data."""
    if not config.FIELD_ENCRYPTION_KEY:
        return value
    try:
        return _get_fernet().decrypt(value.encode()).decode()
    except (InvalidToken, Exception):
        # Value is likely plaintext from before encryption was enabled
        return value
