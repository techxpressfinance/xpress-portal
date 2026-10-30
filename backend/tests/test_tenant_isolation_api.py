"""Cross-tenant id lookups through the real router stack.

Admin/broker access is walled only by tenant (see check_application_access), so
a handler that looks a row up by id alone lets one desk read or write another's
data. Each case here is a tenant-A admin aimed at a tenant-B row: it must 404
and leave the row untouched.
"""
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models.contact import Contact, ContactOrganization, Organization
from app.models.kanban import KanbanBoard, KanbanColumn
from app.models.lender import Lender
from app.models.lender_submission import LenderSubmission, SubmissionStatus
from app.models.loan_application import ApplicationStatus, LoanApplication, LoanType
from app.models.quote_sheet import QuoteSheet, QuoteSheetStatus
from app.models.task import ChecklistItem, Task
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.services.auth import create_access_token, create_refresh_token, hash_password

PASSWORD = "Passw0rdOK"


def _tenant(db, label: str) -> dict:
    slug = f"{label}{uuid.uuid4().hex[:8]}"
    tenant = Tenant(name=f"Desk {label}", slug=slug)
    db.add(tenant)
    db.flush()
    admin = User(email=f"admin-{slug}@example.com", password_hash=hash_password(PASSWORD), full_name="Admin",
                 role=UserRole.admin, tenant_id=tenant.id, email_verified=True)
    client = User(email=f"client-{slug}@example.com", password_hash=hash_password(PASSWORD), full_name="Client",
                  role=UserRole.client, tenant_id=tenant.id, email_verified=True)
    db.add_all([admin, client])
    db.flush()
    return {"slug": slug, "tenant_id": tenant.id, "admin": admin, "client": client}


@pytest.fixture(scope="module")
def seeded():
    db = SessionLocal()
    a = _tenant(db, "a")
    b = _tenant(db, "b")
    tid, admin_b, client_b = b["tenant_id"], b["admin"], b["client"]

    app_a = LoanApplication(tenant_id=a["tenant_id"], user_id=a["client"].id, loan_type=LoanType.vehicle,
                            amount=10000, status=ApplicationStatus.draft, created_at=datetime.now(timezone.utc))
    app_b = LoanApplication(tenant_id=tid, user_id=client_b.id, loan_type=LoanType.vehicle,
                            amount=20000, status=ApplicationStatus.draft, created_at=datetime.now(timezone.utc))
    contact_a = Contact(tenant_id=a["tenant_id"], first_name="Ann", last_name="A")
    contact_b = Contact(tenant_id=tid, first_name="Bob", last_name="B")
    org_b = Organization(tenant_id=tid, name="B Pty Ltd")
    lender_b = Lender(tenant_id=tid, name="B Bank")
    sheet_b = QuoteSheet(tenant_id=tid, created_by_id=admin_b.id, status=QuoteSheetStatus.draft)
    board_b = KanbanBoard(tenant_id=tid, name="B Board", created_by_id=admin_b.id)
    task_b = Task(tenant_id=tid, title="B task", created_by_id=admin_b.id)
    db.add_all([app_a, app_b, contact_a, contact_b, org_b, lender_b, sheet_b, board_b, task_b])
    db.flush()
    column_b = KanbanColumn(tenant_id=tid, board_id=board_b.id, title="B Stage", card_kind="application",
                            mapped_status="draft", position=0)
    link_b = ContactOrganization(tenant_id=tid, contact_id=contact_b.id, organization_id=org_b.id)
    sub_b = LenderSubmission(tenant_id=tid, application_id=app_b.id, lender_id=lender_b.id,
                             submitted_by_id=admin_b.id, status=SubmissionStatus.pending)
    item_b = ChecklistItem(tenant_id=tid, task_id=task_b.id, title="B item")
    db.add_all([column_b, link_b, sub_b, item_b])
    db.commit()
    ids = {
        "slug_a": a["slug"], "admin_a": a["admin"].email, "client_a": a["client"].email,
        "slug_b": b["slug"], "admin_b": admin_b.email,
        "tenant_a": a["tenant_id"], "tenant_b": tid, "admin_a_id": a["admin"].id,
        "app_a": app_a.id, "app_b": app_b.id, "contact_a": contact_a.id, "contact_b": contact_b.id,
        "org_b": org_b.id, "lender_b": lender_b.id, "sheet_b": sheet_b.id, "board_b": board_b.id,
        "column_b": column_b.id, "sub_b": sub_b.id, "task_b": task_b.id, "item_b": item_b.id,
        "client_b": client_b.id,
    }
    db.close()
    return ids


def _login(tc: TestClient, slug: str, email: str) -> dict:
    r = tc.post("/api/auth/login", json={"email": email, "password": PASSWORD}, headers={"X-Tenant-Slug": slug})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}", "X-Tenant-Slug": slug}


def _cross_tenant_requests(s: dict) -> list[tuple[str, str, dict | None]]:
    return [
        ("POST", f"/api/contacts/{s['contact_b']}/organizations", {"organization_id": s["org_b"]}),
        ("POST", f"/api/contacts/{s['contact_a']}/organizations", {"organization_id": s["org_b"]}),
        ("DELETE", f"/api/contacts/{s['contact_b']}/organizations/{s['org_b']}", None),
        ("GET", f"/api/quote-sheets/{s['sheet_b']}", None),
        ("DELETE", f"/api/quote-sheets/{s['sheet_b']}", None),
        ("PATCH", f"/api/kanban/boards/{s['board_b']}/columns/{s['column_b']}", {"title": "Hijacked"}),
        ("POST", f"/api/applications/{s['app_a']}/submissions", {"lender_id": s["lender_b"]}),
        ("PATCH", f"/api/applications/{s['app_b']}/submissions/{s['sub_b']}", {"status": "declined"}),
        ("DELETE", f"/api/applications/{s['app_b']}/submissions/{s['sub_b']}", None),
        ("PATCH", f"/api/tasks/{s['task_b']}/checklist/{s['item_b']}", {"title": "Hijacked"}),
        ("PATCH", f"/api/tasks/{s['task_b']}/checklist/{s['item_b']}/toggle", None),
        ("DELETE", f"/api/tasks/{s['task_b']}/checklist/{s['item_b']}", None),
        ("GET", f"/api/users/{s['client_b']}/referrer", None),
        ("POST", f"/api/clients/{s['client_b']}/alerts", {"content": "Hijacked"}),
    ]


def test_tenant_a_admin_cannot_touch_tenant_b_rows(seeded):
    with TestClient(app) as tc:
        headers = _login(tc, seeded["slug_a"], seeded["admin_a"])
        for method, url, body in _cross_tenant_requests(seeded):
            r = tc.request(method, url, json=body, headers=headers)
            assert r.status_code == 404, f"{method} {url} -> {r.status_code} {r.text}"

    db = SessionLocal()
    try:
        assert db.get(KanbanColumn, seeded["column_b"]).title == "B Stage"
        assert db.get(QuoteSheet, seeded["sheet_b"]) is not None
        assert db.get(LenderSubmission, seeded["sub_b"]).status == SubmissionStatus.pending
        item = db.get(ChecklistItem, seeded["item_b"])
        assert item is not None and item.title == "B item" and not item.is_completed
        assert db.query(ContactOrganization).filter(ContactOrganization.contact_id == seeded["contact_b"]).count() == 1
        assert db.query(ContactOrganization).filter(ContactOrganization.contact_id == seeded["contact_a"]).count() == 0
    finally:
        db.close()


def test_client_cannot_read_user_referrer(seeded):
    with TestClient(app) as tc:
        headers = _login(tc, seeded["slug_a"], seeded["client_a"])
        r = tc.get(f"/api/users/{seeded['client_b']}/referrer", headers=headers)
        assert r.status_code == 403, r.text


def test_tenant_b_admin_still_reaches_own_rows(seeded):
    # Control: the 404s above come from the tenant wall, not a bad route.
    with TestClient(app) as tc:
        headers = _login(tc, seeded["slug_b"], seeded["admin_b"])
        assert tc.get(f"/api/quote-sheets/{seeded['sheet_b']}", headers=headers).status_code == 200
        assert tc.get(f"/api/users/{seeded['client_b']}/referrer", headers=headers).status_code == 200
        r = tc.patch(f"/api/tasks/{seeded['task_b']}/checklist/{seeded['item_b']}/toggle", headers=headers)
        assert r.status_code == 200, r.text
        r = tc.patch(f"/api/kanban/boards/{seeded['board_b']}/columns/{seeded['column_b']}",
                     json={"title": "B Stage"}, headers=headers)
        assert r.status_code == 200, r.text


# ── Token tenant wall ─────────────────────────────────────────
# get_current_user and /auth/refresh fail closed: a non-super-admin token must
# name the user's own tenant, and the request's tenant where one is resolved.

def _bearer(token: str, slug: str) -> dict:
    return {"Authorization": f"Bearer {token}", "X-Tenant-Slug": slug}


def _refresh_headers(tc: TestClient, slug: str) -> dict:
    # Refresh is cookie-authenticated, so it needs the double-submit CSRF pair.
    tc.cookies.set("csrf_token", "test-csrf")
    return {"X-Tenant-Slug": slug, "X-CSRF-Token": "test-csrf"}


def test_token_from_one_tenant_is_refused_on_another(seeded):
    with TestClient(app) as tc:
        headers = _login(tc, seeded["slug_a"], seeded["admin_a"])
        headers["X-Tenant-Slug"] = seeded["slug_b"]
        assert tc.get("/api/contacts", headers=headers).status_code == 401


def test_token_without_tenant_claim_is_refused(seeded):
    token = create_access_token(seeded["admin_a_id"], "admin", "")
    with TestClient(app) as tc:
        r = tc.get("/api/contacts", headers=_bearer(token, seeded["slug_a"]))
        assert r.status_code == 401, r.text
        # Auth paths skip tenant resolution, so the claim alone has to hold the wall.
        r = tc.get("/api/auth/me", headers=_bearer(token, seeded["slug_a"]))
        assert r.status_code == 401, r.text


def test_token_naming_a_tenant_the_user_is_not_in_is_refused(seeded):
    # Tenant claim matches the request, but the user belongs to tenant A.
    token = create_access_token(seeded["admin_a_id"], "admin", seeded["tenant_b"])
    with TestClient(app) as tc:
        r = tc.get("/api/contacts", headers=_bearer(token, seeded["slug_b"]))
        assert r.status_code == 401, r.text


def test_refresh_without_tenant_claim_is_refused(seeded):
    with TestClient(app) as tc:
        tc.cookies.set("refresh_token", create_refresh_token(seeded["admin_a_id"], ""))
        r = tc.post("/api/auth/refresh", headers=_refresh_headers(tc, seeded["slug_a"]))
        assert r.status_code == 401, r.text


def test_refresh_with_own_tenant_still_works(seeded):
    with TestClient(app) as tc:
        tc.cookies.set("refresh_token", create_refresh_token(seeded["admin_a_id"], seeded["tenant_a"]))
        r = tc.post("/api/auth/refresh", headers=_refresh_headers(tc, seeded["slug_a"]))
        assert r.status_code == 200, r.text
        token = r.json()["access_token"]
        assert tc.get("/api/contacts", headers=_bearer(token, seeded["slug_a"])).status_code == 200


def test_super_admin_still_works_on_a_tenant_host(seeded):
    # Super admins have no tenant: the stored role (not the claim) lets them past
    # the token wall, and their own User row must resolve on a tenant-bound session.
    db = SessionLocal()
    try:
        sa = User(email=f"sa-{uuid.uuid4().hex[:8]}@example.com", password_hash=hash_password(PASSWORD),
                  full_name="Platform", role=UserRole.super_admin, tenant_id=None, email_verified=True)
        db.add(sa)
        db.commit()
        sa_id, sa_email = sa.id, sa.email
    finally:
        db.close()
    with TestClient(app) as tc:
        r = tc.get("/api/applications/analytics",
                   headers=_bearer(create_access_token(sa_id, "super_admin", ""), seeded["slug_b"]))
        assert r.status_code == 200, r.text
        # And password login on a tenant host still finds the tenant-less account.
        headers = _login(tc, seeded["slug_b"], sa_email)
        assert tc.get("/api/auth/me", headers=headers).status_code == 200
