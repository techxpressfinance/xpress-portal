from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator


class BrokerGroupCreate(BaseModel):
    name: str
    description: Optional[str] = None
    member_ids: list[str] = []

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Group name cannot be empty")
        return v.strip()


class BrokerGroupUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class BrokerGroupMemberOut(BaseModel):
    id: str
    full_name: str
    email: str

    model_config = {"from_attributes": True}


class BrokerGroupOut(BaseModel):
    id: str
    name: str
    description: Optional[str]
    created_at: datetime
    members: list[BrokerGroupMemberOut] = []

    model_config = {"from_attributes": True}
