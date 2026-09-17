from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.config import DEFAULT_TENANT_SLUG
from app.database import get_db
from app.models.tenant import Tenant
from app.schemas.tenant import TenantBranding

router = APIRouter(prefix="/api/tenants", tags=["tenants"])


@router.get("/branding", response_model=TenantBranding)
def get_tenant_branding(slug: str | None = Query(None), db: Session = Depends(get_db)):
    """Public endpoint: get tenant branding by slug (used by frontend on page load).

    The slug is optional: on a host with no tenant subdomain the frontend cannot
    name the tenant, so DEFAULT_TENANT_SLUG answers instead. Read-only branding,
    so an explicit slug stays public — it is the login page's own logo.
    """
    slug = (slug or DEFAULT_TENANT_SLUG).lower().strip()
    if not slug:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    tenant = db.query(Tenant).filter(Tenant.slug == slug, Tenant.is_active == True).first()  # noqa: E712
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    return tenant
