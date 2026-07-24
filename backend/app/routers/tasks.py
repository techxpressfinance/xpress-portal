from __future__ import annotations

import os
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import Response
from typing import Optional
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.middleware.auth import require_role
from app.middleware.rate_limit import RateLimiter
from app.models.loan_application import LoanApplication
from app.models.task import ChecklistItem, Task, TaskPriority, TaskStatus
from app.models.task_attachment import TaskAttachment
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
from app.config import FRONTEND_URL
from app.services.activity_log import log_activity
from app.services.email import send_assignment_notification
from app.services.s3_storage import delete_file, download_file, file_exists, upload_file
from app.services.tenant_scope import get_tenant_id
from app.services.upload_validation import safe_filename, validate_attachment

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

attachment_upload_limiter = RateLimiter(max_requests=20, window_seconds=60)


def _email_task_assignment(task: Task, assignee: User, assigner: User) -> None:
    """Email a broker who was newly assigned to a task. The assigner performed the
    action in the UI and doesn't need a confirmation, and self-assignment is silent."""
    if not assignee.email or assignee.id == assigner.id:
        return
    item_label = f"task: {task.title}"
    link = f"{FRONTEND_URL}/admin/tasks/{task.id}"
    send_assignment_notification(assignee.email, assignee.full_name, False, item_label, assigner.full_name, link)


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
        "attachments": [
            {
                "id": a.id,
                "task_id": a.task_id,
                "original_filename": a.original_filename,
                "uploaded_by_id": a.uploaded_by_id,
                "uploaded_by_name": a.uploaded_by.full_name if a.uploaded_by else None,
                "uploaded_at": a.uploaded_at,
            }
            for a in (task.attachments or [])
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


def _validate_assignee(db: Session, user_id: str, tenant_id: str) -> User:
    user = db.query(User).filter(User.id == user_id, User.tenant_id == tenant_id).first()
    if not user or user.role != UserRole.broker:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assignee must be a broker")
    return user


def _validate_application(db: Session, app_id: str, tenant_id: str) -> LoanApplication:
    application = db.query(LoanApplication).filter(LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    return application


def _get_task(db: Session, task_id: str, tenant_id: str) -> Task:
    task = (
        db.query(Task)
        .options(
            joinedload(Task.assigned_to),
            joinedload(Task.created_by),
            joinedload(Task.application),
            joinedload(Task.checklist_items),
            joinedload(Task.attachments),
        )
        .filter(Task.id == task_id, Task.tenant_id == tenant_id)
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
    status_filter: Optional[str] = Query(None, alias="status"),
    priority: Optional[str] = None,
    assigned_to_id: Optional[str] = None,
    application_id: Optional[str] = None,
    created_by_id: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    query = db.query(Task).filter(Task.tenant_id == tenant_id).options(
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
    tenant_id: str = Depends(get_tenant_id),
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

    assignee: Optional[User] = None
    if data.assigned_to_id:
        assignee = _validate_assignee(db, data.assigned_to_id, tenant_id)

    if data.application_id:
        _validate_application(db, data.application_id, tenant_id)

    task = Task(
        title=data.title,
        description=data.description,
        status=task_status,
        priority=task_priority,
        due_date=data.due_date,
        assigned_to_id=data.assigned_to_id,
        application_id=data.application_id,
        created_by_id=current_user.id,
        tenant_id=tenant_id,
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
                tenant_id=tenant_id,
            )
            db.add(item)

    log_activity(db, current_user.id, "task_created", "task", task.id, {"title": task.title}, tenant_id=tenant_id)
    db.commit()

    if assignee:
        _email_task_assignment(task, assignee, current_user)

    task = _get_task(db, task.id, tenant_id)
    return _task_to_out(task)


@router.get("/{task_id}", response_model=TaskOut)
def get_task(
    task_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    task = _get_task(db, task_id, tenant_id)
    return _task_to_out(task)


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(
    task_id: str,
    data: TaskUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    task = _get_task(db, task_id, tenant_id)
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
        if data.due_date != task.due_date:
            # Re-arm both reminders so the new due date triggers a fresh midpoint /
            # due-soon notification (mirrors the service-request update behaviour).
            task.reminder_midpoint_sent_at = None
            task.reminder_due_soon_sent_at = None
        task.due_date = data.due_date
        changes["due_date"] = str(data.due_date)

    new_assignee: Optional[User] = None
    if data.assigned_to_id is not None:
        if data.assigned_to_id:
            validated = _validate_assignee(db, data.assigned_to_id, tenant_id)
            # Only notify when the assignee actually changes to a new broker.
            if data.assigned_to_id != task.assigned_to_id:
                new_assignee = validated
        task.assigned_to_id = data.assigned_to_id or None
        changes["assigned_to_id"] = data.assigned_to_id

    if data.application_id is not None:
        if data.application_id:
            _validate_application(db, data.application_id, tenant_id)
        task.application_id = data.application_id or None
        changes["application_id"] = data.application_id

    log_activity(db, current_user.id, "task_updated", "task", task.id, changes, tenant_id=tenant_id)
    db.commit()

    if new_assignee:
        _email_task_assignment(task, new_assignee, current_user)

    task = _get_task(db, task_id, tenant_id)
    return _task_to_out(task)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    task = db.query(Task).filter(Task.id == task_id, Task.tenant_id == tenant_id).first()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    log_activity(db, current_user.id, "task_deleted", "task", task.id, {"title": task.title}, tenant_id=tenant_id)
    db.delete(task)
    db.commit()


# ── Checklist Items ─────────────────────────────────────────────────────────


@router.post("/{task_id}/checklist", response_model=ChecklistItemOut, status_code=status.HTTP_201_CREATED)
def add_checklist_item(
    task_id: str,
    data: ChecklistItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    task = db.query(Task).filter(Task.id == task_id, Task.tenant_id == tenant_id).first()
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
        tenant_id=tenant_id,
    )
    db.add(item)
    log_activity(db, current_user.id, "checklist_item_added", "task", task_id, {"item_title": data.title}, tenant_id=tenant_id)
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
    tenant_id: str = Depends(get_tenant_id),
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
    tenant_id: str = Depends(get_tenant_id),
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
        tenant_id=tenant_id,
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
    tenant_id: str = Depends(get_tenant_id),
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
    tenant_id: str = Depends(get_tenant_id),
):
    task = db.query(Task).filter(Task.id == task_id, Task.tenant_id == tenant_id).first()
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


# ── Attachments ──────────────────────────────────────────────────────────────


@router.post("/{task_id}/attachments", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def upload_task_attachment(
    task_id: str,
    request: Request,
    file: UploadFile,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    task = db.query(Task).filter(Task.id == task_id, Task.tenant_id == tenant_id).first()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    attachment_upload_limiter.check(request)

    contents = file.file.read()
    ext = validate_attachment(file.filename or "file", contents)
    stored_name = f"{uuid4()}{ext}"
    file_path = upload_file(contents, stored_name)

    attachment = TaskAttachment(
        tenant_id=tenant_id,
        task_id=task.id,
        file_path=file_path,
        original_filename=safe_filename(file.filename or "unknown"),
        uploaded_by_id=current_user.id,
    )
    db.add(attachment)
    log_activity(
        db, current_user.id, "attachment_uploaded", "task", task.id,
        {"filename": attachment.original_filename}, tenant_id=tenant_id,
    )
    db.commit()

    task = _get_task(db, task_id, tenant_id)
    return _task_to_out(task)


@router.get("/{task_id}/attachments/{attachment_id}/download")
def download_task_attachment(
    task_id: str,
    attachment_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    task = db.query(Task).filter(Task.id == task_id, Task.tenant_id == tenant_id).first()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    attachment = (
        db.query(TaskAttachment)
        .filter(TaskAttachment.id == attachment_id, TaskAttachment.task_id == task.id)
        .first()
    )
    if not attachment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    if not file_exists(attachment.file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found in storage")

    file_bytes = download_file(attachment.file_path)
    ext = os.path.splitext(attachment.original_filename or "file")[1].lower()
    media_types = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}
    media_type = media_types.get(ext, "application/octet-stream")

    safe_name = (attachment.original_filename or "file").replace("\r", "").replace("\n", "").replace('"', "'")
    safe_name = os.path.basename(safe_name)

    return Response(
        content=file_bytes,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


@router.delete("/{task_id}/attachments/{attachment_id}", response_model=TaskOut)
def delete_task_attachment(
    task_id: str,
    attachment_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    task = db.query(Task).filter(Task.id == task_id, Task.tenant_id == tenant_id).first()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    attachment = (
        db.query(TaskAttachment)
        .filter(TaskAttachment.id == attachment_id, TaskAttachment.task_id == task.id)
        .first()
    )
    if not attachment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")

    delete_file(attachment.file_path)
    log_activity(
        db, current_user.id, "attachment_deleted", "task", task.id,
        {"filename": attachment.original_filename}, tenant_id=tenant_id,
    )
    db.delete(attachment)
    db.commit()

    task = _get_task(db, task_id, tenant_id)
    return _task_to_out(task)
