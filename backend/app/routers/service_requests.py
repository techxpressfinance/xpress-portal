from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.loan_application import LoanApplication
from app.models.service_request import ServiceRequest, ServiceRequestStatus
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
    VALID_STATUSES,
)
from app.config import FRONTEND_URL
from app.services.activity_log import log_activity
from app.services.email import send_assignment_notification, send_service_request_notification
from app.services.notification_service import create_notification
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/service-requests", tags=["service_requests"])


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
    """Email each newly assigned broker plus a confirmation to the assigner."""
    if not new_assignees:
        return
    item_label = f"service request: {sr.custom_request or sr.request_type}"
    link = f"{FRONTEND_URL}/admin/service-requests"
    for broker in new_assignees:
        if broker.email:
            send_assignment_notification(broker.email, broker.full_name, False, item_label, assigner.full_name, link)
    if assigner.email:
        names = ", ".join(b.full_name for b in new_assignees)
        send_assignment_notification(assigner.email, assigner.full_name, True, item_label, names, link)


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


def _resolve_notify_recipients(db: Session, sr: ServiceRequest, tenant_id: str) -> list[User]:
    """Who should be emailed/notified about a request.

    The assigned brokers if any; otherwise the broker on the client's most recent
    application; otherwise active admins so the request isn't silently dropped.
    """
    if sr.assigned_brokers:
        return list(sr.assigned_brokers)

    app = (
        db.query(LoanApplication)
        .filter(
            LoanApplication.user_id == sr.client_id,
            LoanApplication.tenant_id == tenant_id,
            LoanApplication.assigned_broker_id.isnot(None),
        )
        .order_by(LoanApplication.created_at.desc())
        .first()
    )
    if app and app.assigned_broker_id:
        broker = (
            db.query(User)
            .filter(User.id == app.assigned_broker_id, User.tenant_id == tenant_id, User.is_active == True)
            .first()
        )
        if broker:
            return [broker]

    return (
        db.query(User)
        .filter(User.tenant_id == tenant_id, User.role == UserRole.admin.value, User.is_active == True)
        .all()
    )


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
        request_type=data.request_type,
        custom_request=data.custom_request,
        description=data.description,
        status=ServiceRequestStatus.pending.value,
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

    # When staff create-and-assign, send the assigner a confirmation. The assignees
    # already get the "request received" email above, which serves as their notice.
    if is_staff and sr.assigned_brokers and current_user.email:
        item_label = f"service request: {sr.custom_request or sr.request_type}"
        names = ", ".join(b.full_name for b in sr.assigned_brokers)
        send_assignment_notification(
            current_user.email, current_user.full_name, True, item_label, names,
            f"{FRONTEND_URL}/admin/service-requests",
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
