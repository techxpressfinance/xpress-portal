"""The tenant a request acts on must come from server-side config, never the caller.

Production resolves it from the Host subdomain, or from DEFAULT_TENANT_SLUG on a
host that carries none (an apex domain). The X-Tenant-Slug header and ?tenant=
are honoured only when ALLOW_TENANT_HEADER is on, because login, registration
and password reset run on routes the middleware skips.
"""
import pytest
from starlette.requests import Request

from app.middleware import tenant as tenant_mw


def make_request(host: str, header: str | None = None, query: str = "") -> Request:
    headers = [(b"host", host.encode())]
    if header:
        headers.append((b"x-tenant-slug", header.encode()))
    return Request({
        "type": "http",
        "method": "GET",
        "path": "/api/auth/login",
        "query_string": query.encode(),
        "headers": headers,
    })


@pytest.fixture
def prod(monkeypatch):
    """Production posture: header off, apex deployment names its tenant."""
    monkeypatch.setattr(tenant_mw, "ALLOW_TENANT_HEADER", False)
    monkeypatch.setattr(tenant_mw, "DEFAULT_TENANT_SLUG", "default")


def test_apex_host_falls_back_to_default_tenant(prod):
    assert tenant_mw.resolve_tenant_slug(make_request("xpresstech.ai")) == "default"


def test_www_falls_back_to_default_tenant(prod):
    assert tenant_mw.resolve_tenant_slug(make_request("www.xpresstech.ai")) == "default"


def test_tenant_subdomain_wins_over_default(prod):
    assert tenant_mw.resolve_tenant_slug(make_request("acme.xpresstech.ai")) == "acme"


def test_caller_cannot_name_the_tenant_in_production(prod):
    """The header and ?tenant= are ignored — the apex default answers instead."""
    assert tenant_mw.resolve_tenant_slug(make_request("xpresstech.ai", header="victim")) == "default"
    assert tenant_mw.resolve_tenant_slug(make_request("xpresstech.ai", query="tenant=victim")) == "default"


def test_unresolvable_host_is_rejected_when_no_default(monkeypatch):
    """A multi-tenant host leaves DEFAULT_TENANT_SLUG empty, so a bare apex 400s."""
    monkeypatch.setattr(tenant_mw, "ALLOW_TENANT_HEADER", False)
    monkeypatch.setattr(tenant_mw, "DEFAULT_TENANT_SLUG", "")
    assert tenant_mw.resolve_tenant_slug(make_request("xpresstech.ai")) is None


def test_header_is_honoured_in_development(monkeypatch):
    monkeypatch.setattr(tenant_mw, "ALLOW_TENANT_HEADER", True)
    monkeypatch.setattr(tenant_mw, "DEFAULT_TENANT_SLUG", "")
    req = make_request("localhost", header="Xpress ")
    assert tenant_mw.resolve_tenant_slug(req) == "xpress"


def test_login_and_branding_work_on_an_apex_host(monkeypatch):
    """The prod shape: no tenant subdomain, header off, DEFAULT_TENANT_SLUG set.

    Login runs on a path TenantMiddleware skips, so it resolves the tenant
    through services.tenant_scope — this covers that second path as well as the
    branding endpoint the login page loads its logo from.
    """
    import uuid

    from fastapi.testclient import TestClient

    from app.database import SessionLocal
    from app.main import app
    from app.models.tenant import Tenant
    from app.models.user import User, UserRole
    from app.services.auth import hash_password

    slug = f"t{uuid.uuid4().hex[:8]}"
    db = SessionLocal()
    try:
        tenant = Tenant(name="Apex Desk", slug=slug)
        db.add(tenant)
        db.flush()
        db.add(User(email=f"admin-{slug}@example.com", password_hash=hash_password("Passw0rdOK"),
                    full_name="Admin", role=UserRole.admin, tenant_id=tenant.id, email_verified=True))
        db.commit()
    finally:
        db.close()

    monkeypatch.setattr(tenant_mw, "ALLOW_TENANT_HEADER", False)
    monkeypatch.setattr(tenant_mw, "DEFAULT_TENANT_SLUG", slug)
    monkeypatch.setattr("app.routers.tenants.DEFAULT_TENANT_SLUG", slug)

    client = TestClient(app, headers={"host": "xpresstech.ai"})

    branding = client.get("/api/tenants/branding")
    assert branding.status_code == 200, branding.text
    assert branding.json()["slug"] == slug

    login = client.post("/api/auth/login", json={"email": f"admin-{slug}@example.com", "password": "Passw0rdOK"})
    assert login.status_code == 200, login.text
    assert login.json()["access_token"]
