"""End-to-end check for S-02 through the real router stack.

A client fetching their own application must not receive the underwriting
assessment, approving lender or approval conditions; the tenant admin must.
"""
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models.loan_application import ApplicationStatus, LoanApplication, LoanType
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.services.auth import hash_password

PASSWORD = "Passw0rdOK"


@pytest.fixture(scope="module")
def seeded():
    db = SessionLocal()
    slug = f"t{uuid.uuid4().hex[:8]}"
    tenant = Tenant(name="Test Desk", slug=slug)
    db.add(tenant)
    db.flush()
    admin = User(email=f"admin-{slug}@example.com", password_hash=hash_password(PASSWORD), full_name="Admin",
                 role=UserRole.admin, tenant_id=tenant.id, email_verified=True)
    client = User(email=f"client-{slug}@example.com", password_hash=hash_password(PASSWORD), full_name="Client",
                  role=UserRole.client, tenant_id=tenant.id, email_verified=True)
    db.add_all([admin, client])
    db.flush()
    application = LoanApplication(
        tenant_id=tenant.id, user_id=client.id, loan_type=LoanType.vehicle, amount=25000,
        status=ApplicationStatus.approval, analysis_result='{"recommendation": {"decision": "reject"}}',
        analysis_status="completed", approval_lender_name="Big Bank",
        reconciliation_note="Possible duplicate", needs_reconciliation=True,
        created_at=datetime.now(timezone.utc),
    )
    db.add(application)
    db.commit()
    ids = {"slug": slug, "app_id": application.id, "admin_email": admin.email, "client_email": client.email}
    db.close()
    return ids


def _login(tc: TestClient, slug: str, email: str) -> dict:
    r = tc.post("/api/auth/login", json={"email": email, "password": PASSWORD}, headers={"X-Tenant-Slug": slug})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}", "X-Tenant-Slug": slug}


def test_client_detail_and_list_hide_staff_only_fields(seeded):
    with TestClient(app) as tc:
        headers = _login(tc, seeded["slug"], seeded["client_email"])
        detail = tc.get(f"/api/applications/{seeded['app_id']}", headers=headers)
        assert detail.status_code == 200, detail.text
        body = detail.json()
        assert body["analysis_result"] is None
        assert body["analysis_status"] is None
        assert body["approval_lender_name"] is None
        assert body["approval_conditions"] == []
        assert body["reconciliation_note"] is None
        assert body["needs_reconciliation"] is False

        listing = tc.get("/api/applications", headers=headers)
        assert listing.status_code == 200, listing.text
        item = next(i for i in listing.json()["items"] if i["id"] == seeded["app_id"])
        assert item["analysis_result"] is None
        assert item["approval_lender_name"] is None


def test_admin_detail_keeps_staff_only_fields(seeded):
    with TestClient(app) as tc:
        headers = _login(tc, seeded["slug"], seeded["admin_email"])
        detail = tc.get(f"/api/applications/{seeded['app_id']}", headers=headers)
        assert detail.status_code == 200, detail.text
        body = detail.json()
        assert body["analysis_result"].startswith("{")
        assert body["approval_lender_name"] == "Big Bank"
        assert body["reconciliation_note"] == "Possible duplicate"
