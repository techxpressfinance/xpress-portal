"""Shared schema helpers."""
from __future__ import annotations


def normalize_email(v):
    """Lowercase-trim an email so DB lookups and uniqueness checks behave consistently.

    Use as: `_normalize_email = field_validator("email", mode="before")(normalize_email)`.
    """
    if isinstance(v, str):
        return v.strip().lower()
    return v
