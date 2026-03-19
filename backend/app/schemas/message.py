from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.models.user import UserRole


class MessageCreate(BaseModel):
    recipient_id: str
    subject: str
    content: str


class MessageOut(BaseModel):
    id: str
    sender_id: str
    sender_name: str | None = None
    recipient_id: str
    recipient_name: str | None = None
    subject: str
    content: str
    is_read: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class MessageRecipientOut(BaseModel):
    id: str
    full_name: str
    email: str
    role: UserRole

    model_config = {"from_attributes": True}


class ApplicationNoteMessageOut(BaseModel):
    id: str
    application_id: str
    loan_type: str
    author_id: str
    author_name: str | None = None
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


from app.schemas.pagination import PaginatedResponse


class PaginatedMessages(PaginatedResponse[MessageOut]):
    pass
