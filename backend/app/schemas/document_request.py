from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class DocumentRequestCreate(BaseModel):
    description: str


class DocumentRequestOut(BaseModel):
    id: str
    application_id: str
    requested_by_id: str
    requested_by_name: Optional[str] = None
    description: str
    status: str
    created_at: datetime
    fulfilled_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
