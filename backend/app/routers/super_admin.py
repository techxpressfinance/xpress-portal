from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.config import ENVIRONMENT, REFRESH_TOKEN_EXPIRE_DAYS
from app.constants import DEFAULT_KANBAN_COLUMNS
from app.database import get_db
from app.middleware.auth import require_super_admin
from app.models.kanban import KanbanBoard, KanbanColumn
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.schemas.super_admin import SuperAdminLogin, TenantUpdate
from app.schemas.tenant import TenantOut, TenantSignup
from app.services.auth import (
    create_access_token,
    create_refresh_token,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/api/super-admin", tags=["super-admin"])


# ── Login ──────────────────────────────────────────────────────────────

def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="refresh_token",
        value=token,
        httponly=True,
        secure=ENVIRONMENT != "development",
        samesite="lax",
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/api/auth",
    )


@router.post("/login")
def super_admin_login(data: SuperAdminLogin, response: Response, db: Session = Depends(get_db)):
    user = (
        db.query(User)
        .filter(User.email == data.email, User.role == UserRole.super_admin, User.is_active == True)  # noqa: E712
        .first()
    )
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    access_token = create_access_token(user.id, user.role.value, "")
    _set_refresh_cookie(response, create_refresh_token(user.id, ""))
    return {"access_token": access_token, "token_type": "bearer"}


# ── Tenant CRUD ────────────────────────────────────────────────────────

@router.get("/tenants")
def list_tenants(
    is_active: bool | None = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    _admin: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    query = db.query(Tenant)
    if is_active is not None:
        query = query.filter(Tenant.is_active == is_active)
    total = query.count()
    tenants = query.order_by(Tenant.created_at.desc()).offset((page - 1) * per_page).limit(per_page).all()

    return {
        "items": [
            {
                "id": t.id,
                "name": t.name,
                "slug": t.slug,
                "logo_url": t.logo_url,
                "primary_color": t.primary_color,
                "support_email": t.support_email,
                "is_active": t.is_active,
                "created_at": t.created_at.isoformat(),
            }
            for t in tenants
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.post("/tenants", response_model=TenantOut, status_code=status.HTTP_201_CREATED)
def create_tenant(
    data: TenantSignup,
    _admin: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    if db.query(Tenant).filter(Tenant.slug == data.slug).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Slug already taken")

    tenant = Tenant(name=data.tenant_name, slug=data.slug)
    db.add(tenant)
    db.flush()

    admin = User(
        email=data.admin_email,
        password_hash=hash_password(data.admin_password),
        full_name=data.admin_full_name,
        phone=data.admin_phone,
        role=UserRole.admin,
        tenant_id=tenant.id,
        email_verified=True,
    )
    db.add(admin)
    db.flush()

    now = datetime.now(timezone.utc)
    board = KanbanBoard(
        id=str(uuid.uuid4()),
        tenant_id=tenant.id,
        name="Default Pipeline",
        description="Default application pipeline board",
        created_by_id=admin.id,
        is_default=True,
        created_at=now,
        updated_at=now,
    )
    db.add(board)
    for col_def in DEFAULT_KANBAN_COLUMNS:
        db.add(
            KanbanColumn(
                id=str(uuid.uuid4()),
                tenant_id=tenant.id,
                board_id=board.id,
                title=col_def["title"],
                mapped_status=col_def.get("mapped_status"),
                position=col_def["position"],
                color=col_def.get("color"),
                created_at=now,
            )
        )

    db.commit()
    db.refresh(tenant)
    return tenant


@router.get("/tenants/{tenant_id}", response_model=TenantOut)
def get_tenant(
    tenant_id: str,
    _admin: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    return tenant


@router.patch("/tenants/{tenant_id}", response_model=TenantOut)
def update_tenant(
    tenant_id: str,
    data: TenantUpdate,
    _admin: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")

    updates = data.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(tenant, key, value)

    db.commit()
    db.refresh(tenant)
    return tenant
