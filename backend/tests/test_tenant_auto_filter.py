"""The TenantScoped backstop (models/tenant_scoped.py) at the session level.

These queries deliberately leave out the hand-written tenant filter: a session
bound to tenant A must still not see tenant B's root rows through an id lookup,
a join, a bulk UPDATE/DELETE or a lazy load. Unbound sessions and opted-out
queries see everything.
"""
import uuid
from datetime import datetime, timezone

import pytest

import app.main  # noqa: F401 — runs create_all on the test database
from app.database import SessionLocal
from app.models.contact import Contact
from app.models.loan_application import ApplicationStatus, LoanApplication, LoanType
from app.models.tenant import Tenant
from app.models.tenant_scoped import SESSION_TENANT_KEY, SKIP_TENANT_FILTER
from app.models.user import User, UserRole


@pytest.fixture(scope="module")
def two_tenants():
    db = SessionLocal()
    ids = {}
    for label in ("a", "b"):
        slug = f"f{label}{uuid.uuid4().hex[:8]}"
        tenant = Tenant(name=slug, slug=slug)
        db.add(tenant)
        db.flush()
        client = User(email=f"c-{slug}@example.com", password_hash="!", full_name=f"Client {label}",
                      role=UserRole.client, tenant_id=tenant.id)
        contact = Contact(tenant_id=tenant.id, first_name=label.upper(), last_name="Contact")
        db.add_all([client, contact])
        db.flush()
        application = LoanApplication(tenant_id=tenant.id, user_id=client.id, contact_id=contact.id,
                                       loan_type=LoanType.vehicle, amount=1000, status=ApplicationStatus.draft,
                                       created_at=datetime.now(timezone.utc))
        db.add(application)
        db.flush()
        ids[label] = {"tenant": tenant.id, "user": client.id, "contact": contact.id, "app": application.id}
    db.commit()
    db.close()
    return ids


def _session(tenant_id=None):
    db = SessionLocal()
    if tenant_id:
        db.info[SESSION_TENANT_KEY] = tenant_id
    return db


def test_bound_session_hides_other_tenant_by_id(two_tenants):
    a, b = two_tenants["a"], two_tenants["b"]
    db = _session(a["tenant"])
    try:
        assert db.query(LoanApplication).filter(LoanApplication.id == b["app"]).first() is None
        assert db.get(Contact, b["contact"]) is None
        assert db.query(LoanApplication).filter(LoanApplication.id == a["app"]).first() is not None
    finally:
        db.close()


def test_bound_session_filters_joined_entities(two_tenants):
    a, b = two_tenants["a"], two_tenants["b"]
    db = _session(a["tenant"])
    try:
        rows = (
            db.query(LoanApplication.id)
            .join(Contact, LoanApplication.contact_id == Contact.id)
            .filter(Contact.id.in_([a["contact"], b["contact"]]))
            .all()
        )
        assert [r.id for r in rows] == [a["app"]]
    finally:
        db.close()


def test_bound_session_bulk_update_skips_other_tenant(two_tenants):
    b = two_tenants["b"]
    db = _session(two_tenants["a"]["tenant"])
    try:
        n = db.query(LoanApplication).filter(LoanApplication.id == b["app"]).update(
            {"amount": 999999}, synchronize_session=False
        )
        db.commit()
        assert n == 0
    finally:
        db.close()
    db = _session()
    try:
        assert db.get(LoanApplication, b["app"]).amount == 1000
    finally:
        db.close()


def test_lazy_load_of_scoped_row_is_filtered(two_tenants):
    # A tenant-A row pointing at a tenant-B contact (corrupt link) must not
    # surface B's contact through the relationship.
    a, b = two_tenants["a"], two_tenants["b"]
    db = _session()
    try:
        db.get(LoanApplication, a["app"]).contact_id = b["contact"]
        db.commit()
    finally:
        db.close()
    db = _session(a["tenant"])
    try:
        assert db.get(LoanApplication, a["app"]).contact is None
    finally:
        db.close()
    db = _session()
    try:
        db.get(LoanApplication, a["app"]).contact_id = a["contact"]
        db.commit()
    finally:
        db.close()


def test_unbound_session_and_opt_out_see_all_tenants(two_tenants):
    a, b = two_tenants["a"], two_tenants["b"]
    db = _session()
    try:
        assert db.get(LoanApplication, b["app"]) is not None
    finally:
        db.close()
    db = _session(a["tenant"])
    try:
        found = (
            db.query(User)
            .execution_options(**{SKIP_TENANT_FILTER: True})
            .filter(User.id == b["user"])
            .first()
        )
        assert found is not None
    finally:
        db.close()
