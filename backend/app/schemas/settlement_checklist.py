from __future__ import annotations

from pydantic import BaseModel, Field


class SettlementChecklistUpdate(BaseModel):
    kind: str = Field(..., max_length=20)
    # {item_key: {"state": "done" | "na" | null, "subs": [sub_key, ...]}}
    answers: dict = Field(default_factory=dict)
