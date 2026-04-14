from __future__ import annotations

import logging
from typing import Optional

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.database import SessionLocal
from app.models.tenant import Tenant

_logger = logging.getLogger(__name__)

# Paths that don't require tenant context
_SKIP_PATHS = {
    "/api/health",
    "/docs",
    "/openapi.json",
}

_SKIP_PREFIXES = (
    "/api/tenants/branding",
    "/api/super-admin",
    "/api/auth",
)


def _resolve_tenant_slug(request: Request) -> Optional[str]:
    """Resolve tenant slug from header, query param, or subdomain."""
    # 1. X-Tenant-Slug header (local dev fallback)
    header_slug = request.headers.get("x-tenant-slug")
    if header_slug:
        return header_slug.lower().strip()

    # 2. ?tenant= query param (local dev fallback)
    tenant_param = request.query_params.get("tenant")
    if tenant_param:
        return tenant_param.lower().strip()

    # 3. Extract from subdomain
    host = request.headers.get("host", "")
    host = host.split(":")[0]  # strip port
    parts = host.split(".")

    # {slug}.xpresstech.com or {slug}.example.com (3+ parts)
    if len(parts) >= 3:
        slug = parts[0].lower()
        if slug not in ("www", "api"):
            return slug

    # {slug}.localhost for local testing
    if len(parts) == 2 and parts[1] == "localhost":
        slug = parts[0].lower()
        if slug != "www":
            return slug

    return None


class TenantMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Skip tenant resolution for certain paths
        if path in _SKIP_PATHS or any(path.startswith(p) for p in _SKIP_PREFIXES):
            request.state.tenant = None
            request.state.tenant_id = None
            return await call_next(request)

        # Skip for OPTIONS (CORS preflight)
        if request.method == "OPTIONS":
            return await call_next(request)

        slug = _resolve_tenant_slug(request)
        if not slug:
            return JSONResponse(
                status_code=400,
                content={"detail": "Could not resolve tenant. Use a tenant subdomain or set X-Tenant-Slug header."},
            )

        db = SessionLocal()
        try:
            tenant = db.query(Tenant).filter(Tenant.slug == slug, Tenant.is_active == True).first()  # noqa: E712
        finally:
            db.close()

        if not tenant:
            return JSONResponse(
                status_code=404,
                content={"detail": f"Tenant '{slug}' not found"},
            )

        request.state.tenant = tenant
        request.state.tenant_id = tenant.id
        return await call_next(request)
