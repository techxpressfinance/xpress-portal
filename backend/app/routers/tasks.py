from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.middleware.auth import require_role
from app.models.loan_application import LoanApplication
from app.models.task import ChecklistItem, Task, TaskPriority, TaskStatus
from app.models.user import User, UserRole
from app.schemas.task import (
    ChecklistItemCreate,
    ChecklistItemOut,
    ChecklistItemUpdate,
    ChecklistReorderRequest,
    PaginatedTasks,
    TaskCreate,
    TaskListOut,
    TaskOut,
    TaskUpdate,
)
from app.services.activity_log import log_activity

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def _task_to_out(task: Task) -> dict:
    items = task.checklist_items or []
    total = len(items)
    completed = sum(1 for i in items if i.is_completed)
    return {
        "id": task.id,
        "title": task.title,
        "description": task.description,
        "status": task.status.value,
        "priority": task.priority.value,
        "due_date": task.due_date,
        "assigned_to_id": task.assigned_to_id,
        "assigned_to_name": task.assigned_to.full_name if task.assigned_to else None,
        "application_id": task.application_id,
        "application_label": (
            f"{task.application.loan_type.value.title()} Loan - ${task.application.amount:,.2f}"
            if task.application
            else None
        ),
        "created_by_id": task.created_by_id,
        "created_by_name": task.created_by.full_name if task.created_by else None,
        "checklist_items": [
            {
                "id": i.id,
                "task_id": i.task_id,
                "title": i.title,
                "is_completed": i.is_completed,
                "sort_order": i.sort_order,
                "created_at": i.created_at,
            }
            for i in items
        ],
        "checklist_progress": f"{completed}/{total}" if total > 0 else None,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
    }


def _task_to_list_out(task: Task) -> dict:
    items = task.checklist_items or []
    total = len(items)
    completed = sum(1 for i in items if i.is_completed)
    return {
        "id": task.id,
        "title": task.title,
        "status": task.status.value,
        "priority": task.priority.value,
        "due_date": task.due_date,
        "assigned_to_id": task.assigned_to_id,
        "assigned_to_name": task.assigned_to.full_name if task.assigned_to else None,
        "application_id": task.application_id,
        "application_label": (
            f"{task.application.loan_type.value.title()} Loan - ${task.application.amount:,.2f}"
            if task.application
            else None
        ),
        "created_by_id": task.created_by_id,
        "created_by_name": task.created_by.full_name if task.created_by else None,
        "checklist_total": total,
        "checklist_completed": completed,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
    }


def _validate_assignee(db: Session, user_id: str) -> User:
    user = db.query(User).filter(User.id == user_id).first()
    if not user or user.role not in (UserRole.admin, UserRole.broker):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assignee must be an admin or broker")
    return user


def _validate_application(db: Session, app_id: str) -> LoanApplication:
    application = db.query(LoanApplication).filter(LoanApplication.id == app_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    return application


def _get_task(db: Session, task_id: str) -> Task:
    task = (
        db.query(Task)
        .options(
            joinedload(Task.assigned_to),
            joinedload(Task.created_by),
            joinedload(Task.application),
            joinedload(Task.checklist_items),
        )
        .filter(Task.id == task_id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


# ── Task CRUD ───────────────────────────────────────────────────────────────


@router.get("", response_model=PaginatedTasks)
def list_tasks(
    page: int = Query(1, ge=1),
    per_page: int = Query(15, ge=1, le=100),
    status_filter: str | None = Query(None, alias="status"),
    priority: str | None = None,
    assigned_to_id: str | None = None,
    application_id: str | None = None,
    created_by_id: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
):
    query = db.query(Task).options(
        joinedload(Task.assigned_to),
        joinedload(Task.created_by),
        joinedload(Task.application),
        joinedload(Task.checklist_items),
    )

    if status_filter:
        try:
            query = query.filter(Task.status == TaskStatus(status_filter))
        except ValueError:
            pass

    if priority:
        try:
            query = query.filter(Task.priority == TaskPriority(priority))
        except ValueError:
            pass

    if assigned_to_id:
        query = query.filter(Task.assigned_to_id == assigned_to_id)

    if application_id:
        query = query.filter(Task.application_id == application_id)

    if created_by_id:
        query = query.filter(Task.created_by_id == created_by_id)

    if search:
        query = query.filter(Task.title.ilike(f"%{search}%"))

    total = query.with_entities(func.count(Task.id)).scalar()
    tasks = query.order_by(Task.updated_at.desc()).offset((page - 1) * per_page).limit(per_page).all()

    return {
        "items": [_task_to_list_out(t) for t in tasks],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_task(
    data: TaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
):
    # Validate enum values
    try:
        task_status = TaskStatus(data.status)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid status: {data.status}")
    try:
        task_priority = TaskPriority(data.priority)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid priority: {data.priority}")

    if data.assigned_to_id:
        _validate_assignee(db, data.assigned_to_id)

    if data.application_id:
        _validate_application(db, data.application_id)

    task = Task(
        title=data.title,
        description=data.description,
        status=task_status,
        priority=task_priority,
        due_date=data.due_date,
        assigned_to_id=data.assigned_to_id,
        application_id=data.application_id,
        created_by_id=current_user.id,
    )
    db.add(task)
    db.flush()

    if data.checklist_items:
        for idx, item_data in enumerate(data.checklist_items):
            item = ChecklistItem(
                task_id=task.id,
                title=item_data.title,
                is_completed=item_data.is_completed,
                sort_order=item_data.sort_order if item_data.sort_order else idx,
            )
            db.add(item)

    log_activity(db, current_user.id, "task_created", "task", task.id, {"title": task.title})
    db.commit()

    task = _get_task(db, task.id)
    return _task_to_out(task)


@router.get("/{task_id}", response_model=TaskOut)
def get_task(
    task_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
):
    task = _get_task(db, task_id)
    return _task_to_out(task)


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(
    task_id: str,
    data: TaskUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
):
    task = _get_task(db, task_id)
    changes = {}

    if data.title is not None:
        title = data.title.strip()
        if not title:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Title cannot be empty")
        task.title = title
        changes["title"] = title

    if data.description is not None:
        task.description = data.description
        changes["description"] = "updated"

    if data.status is not None:
        try:
            task.status = TaskStatus(data.status)
            changes["status"] = data.status
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid status: {data.status}")

    if data.priority is not None:
        try:
            task.priority = TaskPriority(data.priority)
            changes["priority"] = data.priority
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid priority: {data.priority}")

    if data.due_date is not None:
        task.due_date = data.due_date
        changes["due_date"] = str(data.due_date)

    if data.assigned_to_id is not None:
        if data.assigned_to_id:
            _validate_assignee(db, data.assigned_to_id)
        task.assigned_to_id = data.assigned_to_id or None
        changes["assigned_to_id"] = data.assigned_to_id

    if data.application_id is not None:
        if data.application_id:
            _validate_application(db, data.application_id)
        task.application_id = data.application_id or None
        changes["application_id"] = data.application_id

    log_activity(db, current_user.id, "task_updated", "task", task.id, changes)
    db.commit()

    task = _get_task(db, task_id)
    return _task_to_out(task)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    log_activity(db, current_user.id, "task_deleted", "task", task.id, {"title": task.title})
    db.delete(task)
    db.commit()


# ── Checklist Items ─────────────────────────────────────────────────────────


@router.post("/{task_id}/checklist", response_model=ChecklistItemOut, status_code=status.HTTP_201_CREATED)
def add_checklist_item(
    task_id: str,
    data: ChecklistItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    max_order = (
        db.query(func.max(ChecklistItem.sort_order)).filter(ChecklistItem.task_id == task_id).scalar() or 0
    )

    item = ChecklistItem(
        task_id=task_id,
        title=data.title,
        is_completed=data.is_completed,
        sort_order=max_order + 1,
    )
    db.add(item)
    log_activity(db, current_user.id, "checklist_item_added", "task", task_id, {"item_title": data.title})
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{task_id}/checklist/{item_id}", response_model=ChecklistItemOut)
def update_checklist_item(
    task_id: str,
    item_id: str,
    data: ChecklistItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
):
    item = (
        db.query(ChecklistItem)
        .filter(ChecklistItem.id == item_id, ChecklistItem.task_id == task_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Checklist item not found")

    if data.title is not None:
        title = data.title.strip()
        if not title:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Title cannot be empty")
        item.title = title

    if data.is_completed is not None:
        item.is_completed = data.is_completed

    if data.sort_order is not None:
        item.sort_order = data.sort_order

    db.commit()
    db.refresh(item)
    return item


@router.patch("/{task_id}/checklist/{item_id}/toggle", response_model=ChecklistItemOut)
def toggle_checklist_item(
    task_id: str,
    item_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
):
    item = (
        db.query(ChecklistItem)
        .filter(ChecklistItem.id == item_id, ChecklistItem.task_id == task_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Checklist item not found")

    item.is_completed = not item.is_completed
    log_activity(
        db, current_user.id, "checklist_item_toggled", "task", task_id,
        {"item_title": item.title, "is_completed": item.is_completed},
    )
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{task_id}/checklist/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_checklist_item(
    task_id: str,
    item_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
):
    item = (
        db.query(ChecklistItem)
        .filter(ChecklistItem.id == item_id, ChecklistItem.task_id == task_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Checklist item not found")

    db.delete(item)
    db.commit()


@router.put("/{task_id}/checklist/reorder", response_model=list[ChecklistItemOut])
def reorder_checklist_items(
    task_id: str,
    data: ChecklistReorderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    items = db.query(ChecklistItem).filter(ChecklistItem.task_id == task_id).all()
    item_map = {i.id: i for i in items}

    for idx, item_id in enumerate(data.item_ids):
        if item_id in item_map:
            item_map[item_id].sort_order = idx

    db.commit()

    updated = (
        db.query(ChecklistItem)
        .filter(ChecklistItem.task_id == task_id)
        .order_by(ChecklistItem.sort_order)
        .all()
    )
    return updated
