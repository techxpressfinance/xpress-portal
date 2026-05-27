from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.service_request import ServiceRequest, ServiceRequestStatus
from app.models.user import User, UserRole
from app.schemas.service_request import (
    PaginatedServiceRequests,
    ServiceRequestCreate,
    ServiceRequestOut,
    ServiceRequestUpdate,
    VALID_STATUSES,
)
from app.services.activity_log import log_activity
from app.services.email import send_service_request_notification
from app.services.notification_service import create_notification
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/service-requests", tags=["service_requests"])


def _to_out(sr: ServiceRequest) -> dict:
    return {
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
        "broker_notes": sr.broker_notes,
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
        assigned_broker_id=data.assigned_broker_id if is_staff else None,
    )
    db.add(sr)
    db.flush()
    log_activity(
        db, current_user.id, "created", "service_request", sr.id,
        {"request_type": data.request_type}, tenant_id,
    )
    db.commit()
    db.refresh(sr)

    # Notify all active brokers and admins in this tenant
    brokers = (
        db.query(User)
        .filter(
            User.tenant_id == tenant_id,
            User.role.in_([UserRole.broker.value, UserRole.admin.value]),
            User.is_active == True,
        )
        .all()
    )
    for broker in brokers:
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
    return {"items": [_to_out(sr) for sr in items], "total": total, "page": page, "per_page": per_page}


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
    if data.assigned_broker_id is not None:
        sr.assigned_broker_id = data.assigned_broker_id or None
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
    return _to_out(sr)
