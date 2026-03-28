from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class ApplicationNoteCreate(BaseModel):
    content: str
    visibility: list[str] = ["broker"]


class ApplicationNoteOut(BaseModel):
    id: str
    application_id: str
    author_id: str
    author_name: str | None = None
    author_role: str | None = None
    content: str
    visibility: list[str]
    created_at: datetime

    model_config = {"from_attributes": True}
