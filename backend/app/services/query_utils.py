from __future__ import annotations


def escape_like(value: str) -> str:
    """Escape SQL LIKE wildcards so they are treated as literal characters."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
