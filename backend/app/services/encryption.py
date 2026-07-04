"""Field-level encryption for PII data using Fernet symmetric encryption.

Key rotation: FIELD_ENCRYPTION_KEY may hold a comma-separated ring of keys,
NEWEST FIRST. Writes always use the first key; reads try every key in the
ring. The startup migration in main.py rewrites rows encrypted under older
keys to the first key, so an old key may be dropped from the ring once a
startup has completed with the new ring in place.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

import app.config as config

logger = logging.getLogger(__name__)

_fernets: Optional[list[Fernet]] = None
_warned_no_key = False

# Fernet tokens are urlsafe-base64 with version byte 0x80, so they always
# start with "gAAAAA". Used to tell "ciphertext under a missing key" apart
# from legacy plaintext — no real PII value matches this shape.
_FERNET_TOKEN_SHAPE = re.compile(r"^gAAAAA[A-Za-z0-9_\-]{20,}={0,2}$")


def _get_fernets() -> list[Fernet]:
    global _fernets
    if _fernets is None:
        if not config.FIELD_ENCRYPTION_KEY:
            raise RuntimeError("FIELD_ENCRYPTION_KEY is not configured")
        _fernets = [
            Fernet(key.strip().encode())
            for key in config.FIELD_ENCRYPTION_KEY.split(",")
            if key.strip()
        ]
    return _fernets


def _get_fernet() -> MultiFernet:
    return MultiFernet(_get_fernets())


def encrypt_value(value: str) -> str:
    """Encrypt a plaintext string with the newest ring key. Returns Fernet token (base64)."""
    if value == "":
        return value  # empty carries no PII; keep it distinguishable from ciphertext
    if not config.FIELD_ENCRYPTION_KEY:
        if config.ENVIRONMENT == "production":
            # config.py enforces the key in production; this is a second line of
            # defence so PII can never be written plaintext under that flag.
            raise RuntimeError("FIELD_ENCRYPTION_KEY is required in production — refusing to write plaintext PII")
        global _warned_no_key
        if not _warned_no_key:
            _warned_no_key = True
            logger.warning("FIELD_ENCRYPTION_KEY not set — PII fields are being stored as PLAINTEXT (dev only)")
        return value
    return _get_fernet().encrypt(value.encode()).decode()


def decrypt_value(value: str) -> str:
    """Decrypt a Fernet token, trying every key in the ring. Falls back to raw
    value for pre-encryption data."""
    if value == "" or not config.FIELD_ENCRYPTION_KEY:
        return value
    try:
        return _get_fernet().decrypt(value.encode()).decode()
    except InvalidToken:
        # Either legacy plaintext that predates encryption (should be gone after
        # the startup re-encryption migration) or a wrong key / tampered value.
        logger.warning(
            "Field decryption failed (InvalidToken) — returning stored value verbatim. "
            "If this appears after the re-encryption migration, verify FIELD_ENCRYPTION_KEY."
        )
        return value


def is_encrypted(value: str) -> bool:
    """True if the value is a Fernet token decryptable with any configured ring key."""
    if not config.FIELD_ENCRYPTION_KEY:
        return False
    try:
        _get_fernet().decrypt(value.encode())
        return True
    except (InvalidToken, ValueError):
        return False


def looks_like_fernet_token(value: str) -> bool:
    """Structural check only: True for anything shaped like a Fernet token,
    whether or not any configured key can decrypt it."""
    return bool(_FERNET_TOKEN_SHAPE.match(value))


def rotate_token(value: str) -> Optional[str]:
    """Re-encrypt a token under the newest (first) ring key.

    Returns the rewritten token, or None when no rewrite is needed: single-key
    ring, token already under the newest key, or value not decryptable at all.
    """
    fernets = _get_fernets()
    if len(fernets) == 1:
        return None
    try:
        fernets[0].decrypt(value.encode())
        return None  # already on the newest key
    except (InvalidToken, ValueError):
        pass
    try:
        return MultiFernet(fernets).rotate(value.encode()).decode()
    except (InvalidToken, ValueError):
        return None  # not ours to rewrite (legacy plaintext)
