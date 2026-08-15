from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class ApplicationNoteCreate(BaseModel):
    content: str
    visibility: list[str] = ["broker"]


class ApplicationNoteUpdate(BaseModel):
    content: Optional[str] = None
    visibility: Optional[list[str]] = None


class ApplicationNoteOut(BaseModel):
    id: str
    application_id: str
    author_id: str
    author_name: Optional[str] = None
    author_role: Optional[str] = None
    content: str
    visibility: list[str]
    created_at: datetime

    model_config = {"from_attributes": True}
