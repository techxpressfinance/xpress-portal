from __future__ import annotations

import enum
import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog
from app.services.tfn import redact_tfns


def _normalize(value: Any) -> Any:
    """Reduce a value to something comparable across the ORM/JSON boundary."""
    if isinstance(value, enum.Enum):
        return value.value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def values_equal(old: Any, new: Any) -> bool:
    """True when a submitted value doesn't actually change what's stored.

    Request payloads arrive loosely typed — `"30000"` for an int column, an ISO
    string for a date, `""` for a NULL — so a plain `!=` reports edits that never
    happened.
    """
    old, new = _normalize(old), _normalize(new)
    if old == new:
        return True
    # Absent is absent, however it's spelled.
    if old in (None, "") and new in (None, ""):
        return True
    if old is None or new is None:
        return False
    # "30000" and 30000 are the same number. bools skip this so True isn't
    # coerced into matching "1" — Boolean columns only ever hold True/False,
    # which plain equality already handles.
    if not isinstance(old, bool) and not isinstance(new, bool):
        try:
            return float(old) == float(new)
        except (TypeError, ValueError):
            pass
    return False


def snapshot(instance: Any, fields) -> dict[str, Any]:
    """Capture current values of `fields` so they can be diffed after mutation."""
    return {f: getattr(instance, f) for f in fields if hasattr(instance, f)}


#: Longest before/after value we'll store. `notes` is unbounded free text.
_MAX_VALUE_LEN = 80


def _encrypted_columns(instance: Any) -> set[str]:
    """Columns on this model that are encrypted at rest, discovered from the mapping."""
    from app.models.encrypted_type import EncryptedString

    return {c.name for c in instance.__table__.columns if isinstance(c.type, EncryptedString)}


def _display(value: Any) -> Optional[str]:
    """Render a value for the log, or None when the field is empty."""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return "Yes" if value else "No"
    value = _normalize(value)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        as_float = float(value)
        return str(int(as_float)) if as_float.is_integer() else f"{as_float:.2f}"
    text = redact_tfns(str(value))
    return text if len(text) <= _MAX_VALUE_LEN else f"{text[:_MAX_VALUE_LEN - 1]}…"


def field_changes(instance: Any, before: dict[str, Any]) -> list[dict[str, Any]]:
    """What actually changed, in the order the fields were captured.

    Each entry carries the field name plus either its before/after values, or
    `redacted` for columns that are encrypted at rest. `activity_logs.details` is
    plaintext and readable by every tenant admin, so copying decrypted PII into it
    would quietly undo the column encryption.
    """
    encrypted = _encrypted_columns(instance)
    changes: list[dict[str, Any]] = []
    for field, old in before.items():
        new = getattr(instance, field)
        if values_equal(old, new):
            continue
        if field in encrypted:
            changes.append({"field": field, "redacted": True})
        else:
            changes.append({"field": field, "from": _display(old), "to": _display(new)})
    return changes


def log_activity(db: Session, user_id: str, action: str, entity_type: str, entity_id: str, details: Optional[dict] = None, tenant_id: Optional[str] = None):
    log = ActivityLog(
        user_id=user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        details=json.dumps(details) if details else None,
        tenant_id=tenant_id,
    )
    db.add(log)
