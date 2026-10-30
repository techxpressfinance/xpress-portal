from __future__ import annotations

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.tenant_scoped import SESSION_TENANT_KEY


def get_tenant_id(request: Request, db: Session = Depends(get_db)) -> str:
    """FastAPI dependency: extract tenant_id from request state (set by
    TenantMiddleware) or, for paths the middleware skips (e.g. /api/auth/*),
    resolve it with the middleware's own rule (Host subdomain; header/query
    only when ALLOW_TENANT_HEADER is on). Inactive tenants are rejected.
    """
    tenant_id = getattr(request.state, "tenant_id", None)
    if tenant_id:
        return _bind(db, tenant_id)

    from app.middleware.tenant import resolve_tenant_slug

    slug = resolve_tenant_slug(request)
    if not slug:
        raise HTTPException(status_code=400, detail="Tenant context required")

    from app.models.tenant import Tenant
    tenant = db.query(Tenant).filter(Tenant.slug == slug, Tenant.is_active.is_(True)).first()
    if not tenant:
        raise HTTPException(status_code=400, detail="Invalid tenant")
    return _bind(db, tenant.id)


def _bind(db: Session, tenant_id: str) -> str:
    """Bind the request's session to its tenant so TenantScoped models are
    filtered automatically (see models/tenant_scoped.py). get_db is cached per
    request, so this is the same session the handler receives."""
    db.info[SESSION_TENANT_KEY] = tenant_id
    return tenant_id


def get_in_tenant(db: Session, model, obj_id: str, tenant_id: str, *criteria, detail: str | None = None):
    """Fetch one tenant-owned row by id, or 404.

    Routers pass ids straight from the URL or body, and admin/broker access is
    walled only by tenant (see check_application_access), so an id lookup that
    forgets the tenant filter is a cross-tenant read or write. Extra SQLAlchemy
    criteria (e.g. ``Model.deleted_at.is_(None)``) are ANDed on.
    """
    obj = db.query(model).filter(model.id == obj_id, model.tenant_id == tenant_id, *criteria).first()
    if not obj:
        raise HTTPException(status_code=404, detail=detail or f"{model.__name__} not found")
    return obj


def get_tenant(request: Request):
    """FastAPI dependency: extract the full Tenant object from request state."""
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    return tenant



