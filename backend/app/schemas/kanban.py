from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class KanbanColumnCreate(BaseModel):
    mapped_status: str
    title: Optional[str] = None
    position: int = 0
    color: Optional[str] = None


class KanbanColumnUpdate(BaseModel):
    title: Optional[str] = None
    mapped_status: Optional[str] = None
    color: Optional[str] = None


class KanbanColumnOut(BaseModel):
    id: str
    board_id: str
    title: str
    mapped_status: Optional[str]
    position: int
    color: Optional[str]
    application_count: int = 0

    model_config = {"from_attributes": True}


class KanbanBoardCreate(BaseModel):
    name: str
    description: Optional[str] = None
    loan_category: Optional[str] = None
    columns: Optional[list[KanbanColumnCreate]] = None


class KanbanBoardUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    loan_category: Optional[str] = None


class KanbanBoardOut(BaseModel):
    id: str
    name: str
    description: Optional[str]
    loan_category: Optional[str] = None
    is_default: bool
    created_by_id: str
    created_by_name: Optional[str] = None
    columns: list[KanbanColumnOut] = []
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


class KanbanBoardListOut(BaseModel):
    id: str
    name: str
    description: Optional[str]
    loan_category: Optional[str] = None
    is_default: bool
    column_count: int = 0
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


class ColumnReorderRequest(BaseModel):
    column_ids: list[str]
