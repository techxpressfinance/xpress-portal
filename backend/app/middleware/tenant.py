from __future__ import annotations

import logging
from typing import Optional

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import ALLOW_TENANT_HEADER, DEFAULT_TENANT_SLUG
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


def resolve_tenant_slug(request: Request) -> Optional[str]:
    """Resolve the tenant slug from the request.

    Header and query-param sources are only consulted when ALLOW_TENANT_HEADER
    is set (default: development only); otherwise the Host subdomain decides,
    falling back to DEFAULT_TENANT_SLUG when the Host carries no tenant
    subdomain (apex domain, www, api). Shared with services.tenant_scope so the
    auth routes the middleware skips resolve the tenant by exactly the same rule.
    """
    if ALLOW_TENANT_HEADER:
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

    # 4. Single-tenant deployment on a host with no tenant subdomain
    return DEFAULT_TENANT_SLUG or None


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

        slug = resolve_tenant_slug(request)
        if not slug:
            return JSONResponse(
                status_code=400,
                content={"detail": "Could not resolve tenant from the request host."},
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
