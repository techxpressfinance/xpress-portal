from __future__ import annotations

from pydantic import BaseModel


class KanbanColumnCreate(BaseModel):
    title: str
    mapped_status: str | None = None
    position: int
    color: str | None = None


class KanbanColumnUpdate(BaseModel):
    title: str | None = None
    mapped_status: str | None = None
    color: str | None = None


class KanbanColumnOut(BaseModel):
    id: str
    board_id: str
    title: str
    mapped_status: str | None
    position: int
    color: str | None
    application_count: int = 0

    model_config = {"from_attributes": True}


class KanbanBoardCreate(BaseModel):
    name: str
    description: str | None = None
    columns: list[KanbanColumnCreate] | None = None


class KanbanBoardUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class KanbanBoardOut(BaseModel):
    id: str
    name: str
    description: str | None
    is_default: bool
    created_by_id: str
    created_by_name: str | None = None
    columns: list[KanbanColumnOut] = []
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


class KanbanBoardListOut(BaseModel):
    id: str
    name: str
    description: str | None
    is_default: bool
    column_count: int = 0
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


class ColumnReorderRequest(BaseModel):
    column_ids: list[str]
