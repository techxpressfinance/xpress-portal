from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class DocumentRequestCreate(BaseModel):
    items: list[str]


class DocumentRequestOut(BaseModel):
    id: str
    application_id: str
    requested_by_id: str
    requested_by_name: Optional[str] = None
    description: str
    status: str
    document_id: Optional[str] = None
    document_filename: Optional[str] = None
    created_at: datetime
    fulfilled_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
