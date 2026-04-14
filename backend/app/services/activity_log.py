from __future__ import annotations

import json
from typing import Optional

from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog


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
