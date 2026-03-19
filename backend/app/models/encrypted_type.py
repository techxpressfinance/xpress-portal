"""Custom SQLAlchemy type that transparently encrypts/decrypts column values."""
from __future__ import annotations

from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator


class EncryptedString(TypeDecorator):
    """Stores encrypted string data. Encrypts on write, decrypts on read."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None:
            from app.services.encryption import encrypt_value

            return encrypt_value(value)
        return value

    def process_result_value(self, value, dialect):
        if value is not None:
            from app.services.encryption import decrypt_value

            return decrypt_value(value)
        return value
