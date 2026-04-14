from __future__ import annotations

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session


def get_tenant_id(request: Request) -> str:
    """FastAPI dependency: extract tenant_id from request state (set by TenantMiddleware)."""
    tenant_id = getattr(request.state, "tenant_id", None)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    return tenant_id


def get_tenant(request: Request):
    """FastAPI dependency: extract the full Tenant object from request state."""
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    return tenant


def tenant_query(db: Session, model, tenant_id: str):
    """Return a query pre-filtered by tenant_id."""
    return db.query(model).filter(model.tenant_id == tenant_id)
