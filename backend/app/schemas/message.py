from __future__ import annotations

from pydantic import BaseModel

from app.models.user import UserRole


class MessageRecipientOut(BaseModel):
    id: str
    full_name: str
    email: str
    role: UserRole

    model_config = {"from_attributes": True}
