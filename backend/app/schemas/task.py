from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator

from app.schemas.pagination import PaginatedResponse


class ChecklistItemCreate(BaseModel):
    title: str
    is_completed: bool = False
    sort_order: int = 0

    @field_validator("title")
    @classmethod
    def title_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Checklist item title cannot be empty")
        return v.strip()


class ChecklistItemUpdate(BaseModel):
    title: Optional[str] = None
    is_completed: Optional[bool] = None
    sort_order: Optional[int] = None


class ChecklistItemOut(BaseModel):
    id: str
    task_id: str
    title: str
    is_completed: bool
    sort_order: int
    created_at: datetime

    model_config = {"from_attributes": True}


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    status: str = "todo"
    priority: str = "medium"
    due_date: Optional[datetime] = None
    assigned_to_id: Optional[str] = None
    application_id: Optional[str] = None
    checklist_items: Optional[list[ChecklistItemCreate]] = None

    @field_validator("title")
    @classmethod
    def title_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Task title cannot be empty")
        return v.strip()


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    due_date: Optional[datetime] = None
    assigned_to_id: Optional[str] = None
    application_id: Optional[str] = None


class TaskOut(BaseModel):
    id: str
    title: str
    description: Optional[str]
    status: str
    priority: str
    due_date: Optional[datetime]
    assigned_to_id: Optional[str]
    assigned_to_name: Optional[str] = None
    application_id: Optional[str]
    application_label: Optional[str] = None
    created_by_id: str
    created_by_name: Optional[str] = None
    checklist_items: list[ChecklistItemOut] = []
    checklist_progress: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TaskListOut(BaseModel):
    id: str
    title: str
    status: str
    priority: str
    due_date: Optional[datetime]
    assigned_to_id: Optional[str]
    assigned_to_name: Optional[str] = None
    application_id: Optional[str]
    application_label: Optional[str] = None
    created_by_id: str
    created_by_name: Optional[str] = None
    checklist_total: int = 0
    checklist_completed: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ChecklistReorderRequest(BaseModel):
    item_ids: list[str]


class PaginatedTasks(PaginatedResponse[TaskListOut]):
    pass
