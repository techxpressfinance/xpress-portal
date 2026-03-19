from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class ApplicationNoteCreate(BaseModel):
    content: str
    is_internal: bool = True


class ApplicationNoteOut(BaseModel):
    id: str
    application_id: str
    author_id: str
    author_name: str | None = None
    content: str
    is_internal: bool
    created_at: datetime

    model_config = {"from_attributes": True}
