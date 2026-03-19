from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class ActivityLogOut(BaseModel):
    id: str
    user_id: str
    user_name: str | None = None
    action: str
    entity_type: str
    entity_id: str
    details: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


from app.schemas.pagination import PaginatedResponse


class PaginatedActivityLogs(PaginatedResponse[ActivityLogOut]):
    pass
