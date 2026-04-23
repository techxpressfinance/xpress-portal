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
    sr = ServiceRequest(
        tenant_id=tenant_id,
        client_id=current_user.id,
        request_type=data.request_type,
        custom_request=data.custom_request,
        description=data.description,
        status=ServiceRequestStatus.pending.value,
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

    return _to_out(sr)


@router.get("", response_model=PaginatedServiceRequests)
def list_service_requests(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    q = (
        db.query(ServiceRequest)
        .options(joinedload(ServiceRequest.client))
        .filter(ServiceRequest.tenant_id == tenant_id)
    )
    if current_user.role == UserRole.client.value:
        q = q.filter(ServiceRequest.client_id == current_user.id)
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
        .options(joinedload(ServiceRequest.client))
        .filter(ServiceRequest.id == id, ServiceRequest.tenant_id == tenant_id)
        .first()
    )
    if not sr:
        raise HTTPException(status_code=404, detail="Service request not found")
    if data.status is not None:
        if data.status not in VALID_STATUSES:
            raise HTTPException(status_code=422, detail=f"Invalid status: {data.status}")
        sr.status = data.status
    log_activity(
        db, current_user.id, "updated", "service_request", sr.id,
        {"status": sr.status}, tenant_id,
    )
    db.commit()
    db.refresh(sr)
    return _to_out(sr)
