"""The Entities list's type filters and the counts behind its chips."""
import uuid

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models.contact import Organization
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.services.auth import create_access_token, hash_password


def test_entity_type_filters_and_counts():
    db = SessionLocal()
    slug = f"ent{uuid.uuid4().hex[:8]}"
    tenant = Tenant(name="Entity desk", slug=slug)
    db.add(tenant)
    db.flush()
    broker = User(email=f"b-{uuid.uuid4().hex[:8]}@example.com", password_hash=hash_password("Passw0rdOK"),
                  full_name="Broker", role=UserRole.broker, tenant_id=tenant.id, email_verified=True)
    db.add(broker)
    for name, kind in [("Acme Pty Ltd", "company"), ("Acme Trustee Pty Ltd", "trustee"), ("Smith Family Trust", "trust"),
                       ("Smith & Jones", "partnership"), ("Jo Smith Plumbing", "sole_trader"), ("Unknown Co", None)]:
        db.add(Organization(tenant_id=tenant.id, name=name, entity_type=kind))
    db.commit()
    token = create_access_token(broker.id, broker.role.value, tenant.id)
    db.close()
    h = {"Authorization": f"Bearer {token}", "X-Tenant-Slug": slug}

    def names(**params):
        data = tc.get("/api/organizations", params={"per_page": 100, **params}, headers=h).json()
        return sorted(o["name"] for o in data["items"]), data

    with TestClient(app) as tc:
        everything, data = names()
        assert len(everything) == 6
        assert data["type_counts"] == {"all": 6, "none": 1, "sole_trader": 1, "company": 2, "trust": 1,
                                       "partnership": 1, "trustee": 1}
        # Companies include the corporate trustee.
        assert names(entity_type="company")[0] == ["Acme Pty Ltd", "Acme Trustee Pty Ltd"]
        assert names(entity_type="trust")[0] == ["Smith Family Trust"]
        assert names(entity_type="partnership")[0] == ["Smith & Jones"]
        assert names(entity_type="sole_trader")[0] == ["Jo Smith Plumbing"]
        assert names(entity_type="none")[0] == ["Unknown Co"]
        # Counts follow the search, not the type filter.
        filtered, data = names(entity_type="trust", search="Smith")
        assert filtered == ["Smith Family Trust"]
        assert data["type_counts"]["all"] == 3 and data["type_counts"]["partnership"] == 1
        assert tc.get("/api/organizations", params={"entity_type": "llc"}, headers=h).status_code == 400
