from __future__ import annotations

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db


def get_tenant_id(request: Request, db: Session = Depends(get_db)) -> str:
    """FastAPI dependency: extract tenant_id from request state (set by
    TenantMiddleware) or, for paths the middleware skips (e.g. /api/auth/*),
    resolve it with the middleware's own rule (Host subdomain; header/query
    only when ALLOW_TENANT_HEADER is on). Inactive tenants are rejected.
    """
    tenant_id = getattr(request.state, "tenant_id", None)
    if tenant_id:
        return tenant_id

    from app.middleware.tenant import resolve_tenant_slug

    slug = resolve_tenant_slug(request)
    if not slug:
        raise HTTPException(status_code=400, detail="Tenant context required")

    from app.models.tenant import Tenant
    tenant = db.query(Tenant).filter(Tenant.slug == slug, Tenant.is_active.is_(True)).first()
    if not tenant:
        raise HTTPException(status_code=400, detail="Invalid tenant")
    return tenant.id


def get_tenant(request: Request):
    """FastAPI dependency: extract the full Tenant object from request state."""
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    return tenant



