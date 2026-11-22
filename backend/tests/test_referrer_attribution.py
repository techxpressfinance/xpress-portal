"""Per-application referrer credit: the default at creation, staff changes with
history and the activity log, who may see what, and the client / entity pages."""
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models.activity_log import ActivityLog
from app.models.contact import Contact, Organization
from app.models.external_referral import ExternalReferral, ExternalReferralStatus
from app.models.lead import Lead
from app.models.loan_application import ApplicationStatus, LoanApplication, LoanType
from app.models.referral import Referral
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.services import referrer_attribution as attribution
from app.services import tracking_links
from app.services.auth import create_access_token, hash_password


def _user(db, tenant_id, role, name, **kw):
    u = User(email=f"{role.value}-{uuid.uuid4().hex[:8]}@example.com", password_hash=hash_password("Passw0rdOK"),
             full_name=name, role=role, tenant_id=tenant_id, email_verified=True, **kw)
    db.add(u)
    db.flush()
    return u


def _headers(db_user_id, slug):
    db = SessionLocal()
    try:
        u = db.get(User, db_user_id)
        token = create_access_token(u.id, u.role.value, u.tenant_id)
    finally:
        db.close()
    return {"Authorization": f"Bearer {token}", "X-Tenant-Slug": slug}


@pytest.fixture(scope="module")
def desk():
    db = SessionLocal()
    slug = f"ref{uuid.uuid4().hex[:8]}"
    tenant = Tenant(name="Referrer desk", slug=slug)
    db.add(tenant)
    db.flush()
    tid = tenant.id
    admin = _user(db, tid, UserRole.admin, "Desk Admin")
    ref_a = _user(db, tid, UserRole.referrer, "Alice Referrer")
    ref_b = _user(db, tid, UserRole.referrer, "Bob Referrer")
    contact = Contact(tenant_id=tid, first_name="Casey", last_name="Client", email=f"casey-{uuid.uuid4().hex[:6]}@example.com")
    db.add(contact)
    db.flush()
    client = _user(db, tid, UserRole.client, "Casey Client", contact_id=contact.id)
    # Alice introduced Casey.
    db.add(ExternalReferral(tenant_id=tid, referrer_id=ref_a.id, referred_email=client.email,
                            referred_client_id=client.id, status=ExternalReferralStatus.applied))
    org = Organization(tenant_id=tid, name="Casey Holdings Pty Ltd")
    db.add(org)
    db.commit()
    out = {"slug": slug, "tenant_id": tid, "admin": admin.id, "a": ref_a.id, "b": ref_b.id, "client": client.id,
           "contact": contact.id, "org": org.id}
    db.close()
    return out


def test_default_referrer_precedence(desk):
    db = SessionLocal()
    try:
        client = db.get(User, desk["client"])
        ref_b = db.get(User, desk["b"])
        # The client's link is the default…
        assert attribution.default_referrer_id(db, client) == desk["a"]
        # …a lead's referrer wins over it…
        assert attribution.default_referrer_id(db, client, Lead(referrer_id=desk["b"])) == desk["b"]
        # …and a referrer submitting in their own name is credited themselves.
        assert attribution.default_referrer_id(db, ref_b) == desk["b"]
        # Referral rows are also written for staff invite links — those don't count.
        stranger = _user(db, desk["tenant_id"], UserRole.client, "Invited By Admin")
        db.add(Referral(tenant_id=desk["tenant_id"], referrer_id=desk["admin"], referred_user_id=stranger.id))
        db.flush()
        assert attribution.default_referrer_id(db, stranger) is None
        db.rollback()
    finally:
        db.close()


def test_credit_change_history_visibility_and_pages(desk):
    with TestClient(app) as tc:
        admin = _headers(desk["admin"], desk["slug"])

        # A staff-made card for Casey is credited to whoever introduced Casey.
        r = tc.post(f"/api/contacts/{desk['contact']}/pipeline", headers=admin,
                    json={"loan_type": "vehicle", "amount": 30000})
        assert r.status_code == 201, r.text
        first_id = r.json()["id"]
        r = tc.post(f"/api/contacts/{desk['contact']}/pipeline", headers=admin,
                    json={"loan_type": "vehicle", "amount": 45000})
        second_id = r.json()["id"]
        detail = tc.get(f"/api/applications/{second_id}", headers=admin).json()
        assert detail["referrer_id"] == desk["a"]
        assert detail["referrer"]["full_name"] == "Alice Referrer"

        # Casey came back through Bob for the second loan.
        r = tc.put(f"/api/applications/{second_id}/referrer", headers=admin,
                   json={"referrer_id": desk["b"], "note": "came back via Bob"})
        assert r.status_code == 200, r.text
        assert r.json()["referrer"]["full_name"] == "Bob Referrer"

        history = tc.get(f"/api/applications/{second_id}/referrer-history", headers=admin).json()
        assert [h["source"] for h in history] == ["changed", "created"]
        assert history[0]["from_referrer"]["id"] == desk["a"]
        assert history[0]["to_referrer"]["id"] == desk["b"]
        assert history[0]["note"] == "came back via Bob"
        assert history[0]["changed_by_name"] == "Desk Admin"

        # Only a referrer can be credited.
        bad = tc.put(f"/api/applications/{second_id}/referrer", headers=admin, json={"referrer_id": desk["client"]})
        assert bad.status_code == 404

        # Each referrer sees only the application credited to them.
        alice = _headers(desk["a"], desk["slug"])
        bob = _headers(desk["b"], desk["slug"])
        assert tc.get(f"/api/applications/{first_id}", headers=alice).status_code == 200
        assert tc.get(f"/api/applications/{second_id}", headers=alice).status_code == 403
        assert tc.get(f"/api/applications/{second_id}", headers=bob).status_code == 200
        assert tc.get(f"/api/applications/{first_id}", headers=bob).status_code == 403

        # The client's page shows each loan's referrer, who introduced them, and the trail.
        contact = tc.get(f"/api/contacts/{desk['contact']}", headers=admin).json()
        by_app = {a["id"]: a["referrer"] for a in contact["applications"]}
        assert by_app[first_id]["full_name"] == "Alice Referrer"
        assert by_app[second_id]["full_name"] == "Bob Referrer"
        assert contact["introduced_by"]["id"] == desk["a"]
        assert any(h["source"] == "changed" and h["note"] == "came back via Bob" for h in contact["referrer_history"])

    db = SessionLocal()
    try:
        # Logged, and the stage emails / tracking links follow the application.
        logged = db.query(ActivityLog).filter(ActivityLog.action == "application_referrer_changed",
                                              ActivityLog.entity_id == second_id).all()
        assert len(logged) == 1
        second = db.get(LoanApplication, second_id)
        assert tracking_links.application_referrer(db, second).id == desk["b"]
        alice_apps, _ = tracking_links.referrer_deals(db, desk["tenant_id"], desk["a"])
        assert first_id in {a.id for a in alice_apps} and second_id not in {a.id for a in alice_apps}
        # Bob can now message Casey; he never introduced them.
        assert desk["client"] in attribution.referrer_client_ids(db, desk["b"])
    finally:
        db.close()


def test_entity_page_shows_each_applications_referrer(desk):
    db = SessionLocal()
    try:
        a = LoanApplication(tenant_id=desk["tenant_id"], user_id=desk["client"], loan_type=LoanType.business,
                            amount=80000, status=ApplicationStatus.draft, business_organization_id=desk["org"],
                            created_at=datetime.now(timezone.utc))
        db.add(a)
        db.flush()
        attribution.stamp_initial_referrer(db, a)
        db.commit()
        app_id = a.id
    finally:
        db.close()
    with TestClient(app) as tc:
        admin = _headers(desk["admin"], desk["slug"])
        tc.put(f"/api/applications/{app_id}/referrer", headers=admin, json={"referrer_id": None, "note": "direct"})
        org = tc.get(f"/api/organizations/{desk['org']}", headers=admin).json()
    row = next(x for x in org["applications"] if x["id"] == app_id)
    assert row["referrer"] is None
    sources = [h["source"] for h in org["referrer_history"] if h["application_id"] == app_id]
    assert sources == ["changed", "created"]
