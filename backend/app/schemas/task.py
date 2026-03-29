from __future__ import annotations

from datetime import datetime

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
    title: str | None = None
    is_completed: bool | None = None
    sort_order: int | None = None


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
    description: str | None = None
    status: str = "todo"
    priority: str = "medium"
    due_date: datetime | None = None
    assigned_to_id: str | None = None
    application_id: str | None = None
    checklist_items: list[ChecklistItemCreate] | None = None

    @field_validator("title")
    @classmethod
    def title_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Task title cannot be empty")
        return v.strip()


class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    priority: str | None = None
    due_date: datetime | None = None
    assigned_to_id: str | None = None
    application_id: str | None = None


class TaskOut(BaseModel):
    id: str
    title: str
    description: str | None
    status: str
    priority: str
    due_date: datetime | None
    assigned_to_id: str | None
    assigned_to_name: str | None = None
    application_id: str | None
    application_label: str | None = None
    created_by_id: str
    created_by_name: str | None = None
    checklist_items: list[ChecklistItemOut] = []
    checklist_progress: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TaskListOut(BaseModel):
    id: str
    title: str
    status: str
    priority: str
    due_date: datetime | None
    assigned_to_id: str | None
    assigned_to_name: str | None = None
    application_id: str | None
    application_label: str | None = None
    created_by_id: str
    created_by_name: str | None = None
    checklist_total: int = 0
    checklist_completed: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ChecklistReorderRequest(BaseModel):
    item_ids: list[str]


class PaginatedTasks(PaginatedResponse[TaskListOut]):
    pass
