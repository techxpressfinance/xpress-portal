"""Shared validation for small file uploads (attachments on service requests/tasks).

Mirrors the extension allowlist + magic-byte + size-cap checks used for loan
application documents (see routers/documents.py's _process_upload).
"""
from __future__ import annotations

import os

from fastapi import HTTPException, status

ALLOWED_ATTACHMENT_TYPES = {".pdf", ".jpg", ".jpeg", ".png"}
MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024

_MAGIC = {
    b"\x25\x50\x44\x46": {".pdf"},
    b"\xff\xd8\xff": {".jpg", ".jpeg"},
    b"\x89\x50\x4e\x47": {".png"},
}


def validate_attachment(filename: str, contents: bytes) -> str:
    """Validate extension allowlist, magic bytes, and size cap.

    Returns the lowercase file extension. Raises HTTPException(400) on failure.
    """
    ext = os.path.splitext(filename or "file")[1].lower()
    if ext not in ALLOWED_ATTACHMENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type '{ext}' not allowed. Allowed: {', '.join(ALLOWED_ATTACHMENT_TYPES)}",
        )

    content_valid = any(
        contents[: len(magic)] == magic and ext in valid_exts
        for magic, valid_exts in _MAGIC.items()
    )
    if not content_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File content does not match its extension",
        )

    if len(contents) > MAX_ATTACHMENT_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File size exceeds 10MB limit",
        )

    return ext


def safe_filename(raw_name: str) -> str:
    """Strip path components and dangerous characters from an uploaded filename."""
    name = os.path.basename(raw_name or "unknown").replace("\r", "").replace("\n", "").replace("\x00", "")
    return name or "unknown"
