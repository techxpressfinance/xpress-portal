from __future__ import annotations


def escape_like(value: str) -> str:
    """Escape SQL LIKE wildcards so they are treated as literal characters."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def active_user_clauses():
    """SQLAlchemy filter clauses that exclude soft-deleted users.

    Soft delete sets ``deleted_at`` and rewrites the email to
    ``...@deleted.invalid``; older records may only have the email marker, so
    both are checked (mirrors the canonical filter in the /users endpoint).

    Usage: ``db.query(User).filter(*active_user_clauses())``
    """
    from app.models.user import User

    return (User.deleted_at.is_(None), ~User.email.like("%@deleted.invalid"))
