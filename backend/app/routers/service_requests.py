from __future__ import annotations

import os
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.middleware.rate_limit import RateLimiter
from app.models.loan_application import LoanApplication
from app.models.service_request import ServiceRequest, ServiceRequestStatus
from app.models.service_request_attachment import ServiceRequestAttachment
from app.models.service_request_checklist import ServiceRequestChecklistItem
from app.models.service_request_note import ServiceRequestNote
from app.models.service_request_order import ServiceRequestOrder
from app.models.user import User, UserRole
from app.schemas.service_request import (
    PaginatedServiceRequests,
    ServiceRequestCreate,
    ServiceRequestNoteCreate,
    ServiceRequestOrderUpdate,
    ServiceRequestOut,
    ServiceRequestUpdate,
    SRChecklistItemCreate,
    SRChecklistItemUpdate,
    SRChecklistReorderRequest,
    VALID_STATUSES,
)
from app.config import FRONTEND_URL
from app.services.activity_log import log_activity
from app.services.email import send_assignment_notification, send_service_request_notification
from app.services.notification_service import create_notification
from app.services.s3_storage import delete_file, download_file, file_exists, upload_file
from app.services.service_request_reminders import _resolve_notify_recipients
from app.services.tenant_scope import get_tenant_id
from app.services.upload_validation import safe_filename, validate_attachment

router = APIRouter(prefix="/api/service-requests", tags=["service_requests"])

attachment_upload_limiter = RateLimiter(max_requests=20, window_seconds=60)


def _set_assignees(db: Session, sr: ServiceRequest, broker_ids: Optional[list[str]], tenant_id: str) -> None:
    """Replace a request's assignees with the given broker ids.

    Drops blanks/duplicates/unknown ids, keeps active users in the tenant, and
    keeps the legacy ``assigned_broker_id`` synced to the first assignee.
    """
    ids = list(dict.fromkeys(b for b in (broker_ids or []) if b))
    users: list[User] = []
    if ids:
        found = {
            u.id: u
            for u in db.query(User)
            .filter(User.id.in_(ids), User.tenant_id == tenant_id, User.is_active == True)
            .all()
        }
        users = [found[i] for i in ids if i in found]
    sr.assigned_brokers = users
    sr.assigned_broker_id = users[0].id if users else None


def _email_assignment(sr: ServiceRequest, new_assignees: list[User], assigner: User) -> None:
    """Email each newly assigned broker. The assigner performed the action in the UI
    and doesn't need a confirmation email."""
    if not new_assignees:
        return
    item_label = f"service request: {sr.custom_request or sr.request_type}"
    link = f"{FRONTEND_URL}/admin/service-requests"
    for broker in new_assignees:
        if broker.email:
            send_assignment_notification(broker.email, broker.full_name, False, item_label, assigner.full_name, link)


def _default_assignees_for_client(db: Session, client_id: str, tenant_id: str) -> list[str]:
    """Brokers a client's request should default to: the broker(s) on their most
    recent application. Returns [] if they have no application or assigned broker."""
    app = (
        db.query(LoanApplication)
        .filter(LoanApplication.user_id == client_id, LoanApplication.tenant_id == tenant_id)
        .order_by(LoanApplication.created_at.desc())
        .first()
    )
    if not app:
        return []
    if app.brokers:
        return [b.id for b in app.brokers]
    return [app.assigned_broker_id] if app.assigned_broker_id else []


def _user_position(db: Session, user_id: str, sr_id: str, tenant_id: str) -> Optional[int]:
    row = (
        db.query(ServiceRequestOrder)
        .filter(
            ServiceRequestOrder.user_id == user_id,
            ServiceRequestOrder.service_request_id == sr_id,
            ServiceRequestOrder.tenant_id == tenant_id,
        )
        .first()
    )
    return row.position if row else None


def _to_out(sr: ServiceRequest, position: Optional[int] = None) -> dict:
    return {
        "sort_position": position,
        "id": sr.id,
        "request_type": sr.request_type,
        "custom_request": sr.custom_request,
        "description": sr.description,
        "status": sr.status,
        "is_urgent": sr.is_urgent,
        "due_at": sr.due_at,
        "client_id": sr.client_id,
        "client_name": sr.client.full_name if sr.client else None,
        "client_email": sr.client.email if sr.client else None,
        "assigned_broker_id": sr.assigned_broker_id,
        "assigned_broker_name": sr.assigned_broker.full_name if sr.assigned_broker else None,
        "assigned_brokers": [{"id": b.id, "full_name": b.full_name} for b in sr.assigned_brokers],
        "broker_notes": sr.broker_notes,
        "notes": [
            {
                "id": n.id,
                "author_id": n.author_id,
                "author_name": n.author.full_name if n.author else None,
                "content": n.content,
                "created_at": n.created_at,
            }
            for n in sr.notes
        ],
        "checklist_items": [
            {
                "id": c.id,
                "service_request_id": c.service_request_id,
                "title": c.title,
                "is_completed": c.is_completed,
                "sort_order": c.sort_order,
                "created_at": c.created_at,
            }
            for c in sr.checklist_items
        ],
        "attachments": [
            {
                "id": a.id,
                "service_request_id": a.service_request_id,
                "original_filename": a.original_filename,
                "uploaded_by_id": a.uploaded_by_id,
                "uploaded_by_name": a.uploaded_by.full_name if a.uploaded_by else None,
                "uploaded_at": a.uploaded_at,
            }
            for a in sr.attachments
        ],
        "created_at": sr.created_at,
        "updated_at": sr.updated_at,
    }


@router.post("", response_model=ServiceRequestOut, status_code=201)
def create_service_request(
    data: ServiceRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    is_staff = current_user.role in (UserRole.broker.value, UserRole.admin.value)
    client_id = (data.client_id or current_user.id) if is_staff else current_user.id
    sr = ServiceRequest(
        tenant_id=tenant_id,
        client_id=client_id,
        created_by_id=current_user.id,
        request_type=data.request_type,
        custom_request=data.custom_request,
        description=data.description,
        status=ServiceRequestStatus.pending.value,
        is_urgent=data.is_urgent,
        due_at=data.due_at,
    )
    db.add(sr)
    db.flush()
    if is_staff:
        # Prefer the explicit list; fall back to the legacy single-broker field.
        broker_ids = data.assigned_broker_ids
        if broker_ids is None and data.assigned_broker_id:
            broker_ids = [data.assigned_broker_id]
        _set_assignees(db, sr, broker_ids, tenant_id)
    else:
        # Client/referrer request: default-assign to the broker(s) on their application.
        _set_assignees(db, sr, _default_assignees_for_client(db, client_id, tenant_id), tenant_id)
    log_activity(
        db, current_user.id, "created", "service_request", sr.id,
        {"request_type": data.request_type}, tenant_id,
    )
    db.commit()
    db.refresh(sr)

    # Notify every assigned broker. If none are assigned, fall back to the client's
    # application broker, then active admins, so the request isn't silently dropped.
    recipients = _resolve_notify_recipients(db, sr, tenant_id)
    for broker in recipients:
        send_service_request_notification(
            to_email=broker.email,
            broker_name=broker.full_name,
            client_name=current_user.full_name,
            request_type=data.request_type,
            custom_request=data.custom_request,
            description=data.description,
        )
        request_label = data.custom_request or data.request_type
        create_notification(
            db,
            user_id=broker.id,
            type="status_change",
            title="Service request received",
            body=f"{current_user.full_name} submitted a service request: {request_label}",
            link="/admin/service-requests",
            tenant_id=tenant_id,
        )

    db.commit()

    return _to_out(sr)


@router.put("/order", status_code=204)
def set_service_request_order(
    data: ServiceRequestOrderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Save this staff user's manual ordering. Replaces their existing positions."""
    db.query(ServiceRequestOrder).filter(
        ServiceRequestOrder.user_id == current_user.id,
        ServiceRequestOrder.tenant_id == tenant_id,
    ).delete(synchronize_session=False)
    for position, sr_id in enumerate(dict.fromkeys(data.ordered_ids)):
        db.add(ServiceRequestOrder(
            tenant_id=tenant_id,
            user_id=current_user.id,
            service_request_id=sr_id,
            position=position,
        ))
    db.commit()


@router.get("", response_model=PaginatedServiceRequests)
def list_service_requests(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status: Optional[str] = Query(None),
    client_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    q = (
        db.query(ServiceRequest)
        .options(joinedload(ServiceRequest.client), joinedload(ServiceRequest.assigned_broker))
        .filter(ServiceRequest.tenant_id == tenant_id)
    )
    if current_user.role in (UserRole.client.value, UserRole.referrer.value):
        q = q.filter(ServiceRequest.client_id == current_user.id)
    elif client_id and current_user.role in (UserRole.broker.value, UserRole.admin.value):
        q = q.filter(ServiceRequest.client_id == client_id)
    if status:
        q = q.filter(ServiceRequest.status == status)
    total = q.count()
    items = (
        q.order_by(ServiceRequest.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    # Attach this staff user's manual ordering positions (drag-and-drop priority).
    order_map: dict[str, int] = {}
    if current_user.role in (UserRole.broker.value, UserRole.admin.value):
        order_map = {
            o.service_request_id: o.position
            for o in db.query(ServiceRequestOrder).filter(
                ServiceRequestOrder.user_id == current_user.id,
                ServiceRequestOrder.tenant_id == tenant_id,
            )
        }
    return {
        "items": [_to_out(sr, order_map.get(sr.id)) for sr in items],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.get("/{id}", response_model=ServiceRequestOut)
def get_service_request(
    id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    sr = (
        db.query(ServiceRequest)
        .options(joinedload(ServiceRequest.client), joinedload(ServiceRequest.assigned_broker))
        .filter(ServiceRequest.id == id, ServiceRequest.tenant_id == tenant_id)
        .first()
    )
    if not sr:
        raise HTTPException(status_code=404, detail="Service request not found")
    # Clients/referrers may only view their own requests.
    if current_user.role in (UserRole.client.value, UserRole.referrer.value) and sr.client_id != current_user.id:
        raise HTTPException(status_code=404, detail="Service request not found")
    position = _user_position(db, current_user.id, sr.id, tenant_id) if current_user.role in (UserRole.broker.value, UserRole.admin.value) else None
    return _to_out(sr, position)


@router.patch("/{id}", response_model=ServiceRequestOut)
def update_service_request(
    id: str,
    data: ServiceRequestUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    sr = (
        db.query(ServiceRequest)
        .options(joinedload(ServiceRequest.client), joinedload(ServiceRequest.assigned_broker))
        .filter(ServiceRequest.id == id, ServiceRequest.tenant_id == tenant_id)
        .first()
    )
    if not sr:
        raise HTTPException(status_code=404, detail="Service request not found")
    is_completed = sr.status in ("resolved", "closed")
    if data.status is not None:
        if data.status not in VALID_STATUSES:
            raise HTTPException(status_code=422, detail=f"Invalid status: {data.status}")
        sr.status = data.status
    if data.is_urgent is not None:
        sr.is_urgent = data.is_urgent
    # due_at is nullable: a present field (even null) clears or sets it.
    # Re-arm reminders whenever the due date changes/clears.
    if "due_at" in data.model_fields_set:
        sr.due_at = data.due_at
        sr.reminder_midpoint_sent_at = None
        sr.reminder_due_soon_sent_at = None
    assignment_changed = data.assigned_broker_ids is not None or data.assigned_broker_id is not None
    prev_assignee_ids = {b.id for b in sr.assigned_brokers}
    if data.assigned_broker_ids is not None:
        _set_assignees(db, sr, data.assigned_broker_ids, tenant_id)
    elif data.assigned_broker_id is not None:
        _set_assignees(db, sr, [data.assigned_broker_id] if data.assigned_broker_id else [], tenant_id)
    new_assignees = [b for b in sr.assigned_brokers if b.id not in prev_assignee_ids] if assignment_changed else []
    if data.client_id:
        client = (
            db.query(User)
            .filter(User.id == data.client_id, User.tenant_id == tenant_id)
            .first()
        )
        if not client:
            raise HTTPException(status_code=404, detail="Client not found")
        sr.client_id = data.client_id
    content_edit = data.request_type is not None or data.custom_request is not None or data.description is not None
    if content_edit and is_completed:
        raise HTTPException(status_code=422, detail="Cannot edit a completed service request")
    if data.request_type is not None:
        sr.request_type = data.request_type.strip()
    if data.custom_request is not None:
        sr.custom_request = data.custom_request.strip() or None
    if data.description is not None:
        sr.description = data.description.strip() or None
    if data.broker_notes is not None:
        sr.broker_notes = data.broker_notes.strip() or None
    log_activity(
        db, current_user.id, "updated", "service_request", sr.id,
        {"status": sr.status}, tenant_id,
    )
    db.commit()
    db.refresh(sr)
    _email_assignment(sr, new_assignees, current_user)
    return _to_out(sr, _user_position(db, current_user.id, sr.id, tenant_id))


@router.post("/{id}/notes", response_model=ServiceRequestOut, status_code=201)
def add_service_request_note(
    id: str,
    data: ServiceRequestNoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    sr = (
        db.query(ServiceRequest)
        .options(joinedload(ServiceRequest.client), joinedload(ServiceRequest.assigned_broker))
        .filter(ServiceRequest.id == id, ServiceRequest.tenant_id == tenant_id)
        .first()
    )
    if not sr:
        raise HTTPException(status_code=404, detail="Service request not found")
    note = ServiceRequestNote(
        tenant_id=tenant_id,
        service_request_id=sr.id,
        author_id=current_user.id,
        content=data.content,
    )
    db.add(note)
    log_activity(
        db, current_user.id, "noted", "service_request", sr.id, {}, tenant_id,
    )
    db.commit()
    db.refresh(sr)
    return _to_out(sr, _user_position(db, current_user.id, sr.id, tenant_id))


# ── Checklist Items ──────────────────────────────────────────────────────────


def _load_sr(db: Session, id: str, tenant_id: str) -> ServiceRequest:
    sr = (
        db.query(ServiceRequest)
        .options(joinedload(ServiceRequest.client), joinedload(ServiceRequest.assigned_broker))
        .filter(ServiceRequest.id == id, ServiceRequest.tenant_id == tenant_id)
        .first()
    )
    if not sr:
        raise HTTPException(status_code=404, detail="Service request not found")
    return sr


@router.post("/{id}/checklist", response_model=ServiceRequestOut, status_code=201)
def add_checklist_item(
    id: str,
    data: SRChecklistItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    sr = _load_sr(db, id, tenant_id)
    max_order = (
        db.query(func.max(ServiceRequestChecklistItem.sort_order))
        .filter(ServiceRequestChecklistItem.service_request_id == sr.id)
        .scalar()
        or 0
    )
    item = ServiceRequestChecklistItem(
        tenant_id=tenant_id,
        service_request_id=sr.id,
        title=data.title,
        is_completed=data.is_completed,
        sort_order=max_order + 1,
    )
    db.add(item)
    log_activity(
        db, current_user.id, "checklist_item_added", "service_request", sr.id,
        {"item_title": data.title}, tenant_id,
    )
    db.commit()
    db.refresh(sr)
    return _to_out(sr, _user_position(db, current_user.id, sr.id, tenant_id))


@router.patch("/{id}/checklist/{item_id}", response_model=ServiceRequestOut)
def update_checklist_item(
    id: str,
    item_id: str,
    data: SRChecklistItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    sr = _load_sr(db, id, tenant_id)
    item = (
        db.query(ServiceRequestChecklistItem)
        .filter(
            ServiceRequestChecklistItem.id == item_id,
            ServiceRequestChecklistItem.service_request_id == sr.id,
        )
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Checklist item not found")
    if data.title is not None:
        title = data.title.strip()
        if not title:
            raise HTTPException(status_code=400, detail="Title cannot be empty")
        item.title = title
    if data.is_completed is not None:
        item.is_completed = data.is_completed
    if data.sort_order is not None:
        item.sort_order = data.sort_order
    db.commit()
    db.refresh(sr)
    return _to_out(sr, _user_position(db, current_user.id, sr.id, tenant_id))


@router.patch("/{id}/checklist/{item_id}/toggle", response_model=ServiceRequestOut)
def toggle_checklist_item(
    id: str,
    item_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    sr = _load_sr(db, id, tenant_id)
    item = (
        db.query(ServiceRequestChecklistItem)
        .filter(
            ServiceRequestChecklistItem.id == item_id,
            ServiceRequestChecklistItem.service_request_id == sr.id,
        )
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Checklist item not found")
    item.is_completed = not item.is_completed
    log_activity(
        db, current_user.id, "checklist_item_toggled", "service_request", sr.id,
        {"item_title": item.title, "is_completed": item.is_completed}, tenant_id,
    )
    db.commit()
    db.refresh(sr)
    return _to_out(sr, _user_position(db, current_user.id, sr.id, tenant_id))


@router.delete("/{id}/checklist/{item_id}", response_model=ServiceRequestOut)
def delete_checklist_item(
    id: str,
    item_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    sr = _load_sr(db, id, tenant_id)
    item = (
        db.query(ServiceRequestChecklistItem)
        .filter(
            ServiceRequestChecklistItem.id == item_id,
            ServiceRequestChecklistItem.service_request_id == sr.id,
        )
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Checklist item not found")
    db.delete(item)
    db.commit()
    db.refresh(sr)
    return _to_out(sr, _user_position(db, current_user.id, sr.id, tenant_id))


@router.put("/{id}/checklist/reorder", response_model=ServiceRequestOut)
def reorder_checklist_items(
    id: str,
    data: SRChecklistReorderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    sr = _load_sr(db, id, tenant_id)
    items = (
        db.query(ServiceRequestChecklistItem)
        .filter(ServiceRequestChecklistItem.service_request_id == sr.id)
        .all()
    )
    item_map = {i.id: i for i in items}
    for idx, item_id in enumerate(data.item_ids):
        if item_id in item_map:
            item_map[item_id].sort_order = idx
    db.commit()
    db.refresh(sr)
    return _to_out(sr, _user_position(db, current_user.id, sr.id, tenant_id))


# ── Attachments ──────────────────────────────────────────────────────────────


@router.post("/{id}/attachments", response_model=ServiceRequestOut, status_code=201)
def upload_service_request_attachment(
    id: str,
    request: Request,
    file: UploadFile,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    sr = _load_sr(db, id, tenant_id)
    # Clients/referrers may only attach to their own requests.
    if current_user.role in (UserRole.client.value, UserRole.referrer.value) and sr.client_id != current_user.id:
        raise HTTPException(status_code=404, detail="Service request not found")

    attachment_upload_limiter.check(request)

    contents = file.file.read()
    ext = validate_attachment(file.filename or "file", contents)
    stored_name = f"{uuid4()}{ext}"
    file_path = upload_file(contents, stored_name)

    attachment = ServiceRequestAttachment(
        tenant_id=tenant_id,
        service_request_id=sr.id,
        file_path=file_path,
        original_filename=safe_filename(file.filename or "unknown"),
        uploaded_by_id=current_user.id,
    )
    db.add(attachment)
    log_activity(
        db, current_user.id, "attachment_uploaded", "service_request", sr.id,
        {"filename": attachment.original_filename}, tenant_id,
    )
    db.commit()
    db.refresh(sr)
    position = _user_position(db, current_user.id, sr.id, tenant_id) if current_user.role in (UserRole.broker.value, UserRole.admin.value) else None
    return _to_out(sr, position)


@router.get("/{id}/attachments/{attachment_id}/download")
def download_service_request_attachment(
    id: str,
    attachment_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    sr = _load_sr(db, id, tenant_id)
    if current_user.role in (UserRole.client.value, UserRole.referrer.value) and sr.client_id != current_user.id:
        raise HTTPException(status_code=404, detail="Service request not found")

    attachment = (
        db.query(ServiceRequestAttachment)
        .filter(ServiceRequestAttachment.id == attachment_id, ServiceRequestAttachment.service_request_id == sr.id)
        .first()
    )
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if not file_exists(attachment.file_path):
        raise HTTPException(status_code=404, detail="File not found in storage")

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


@router.delete("/{id}/attachments/{attachment_id}", response_model=ServiceRequestOut)
def delete_service_request_attachment(
    id: str,
    attachment_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    sr = _load_sr(db, id, tenant_id)
    attachment = (
        db.query(ServiceRequestAttachment)
        .filter(ServiceRequestAttachment.id == attachment_id, ServiceRequestAttachment.service_request_id == sr.id)
        .first()
    )
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    delete_file(attachment.file_path)
    log_activity(
        db, current_user.id, "attachment_deleted", "service_request", sr.id,
        {"filename": attachment.original_filename}, tenant_id,
    )
    db.delete(attachment)
    db.commit()
    db.refresh(sr)
    return _to_out(sr, _user_position(db, current_user.id, sr.id, tenant_id))
