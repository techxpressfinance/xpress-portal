"""Entity notes: the feed, who may change what, the carry-over of the old
notes field, and merges/deletes."""
import uuid

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models.contact import Organization
from app.models.entity_note import EntityNote
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.services.auth import create_access_token, hash_password


def _user(db, tid, role):
    u = User(email=f"{role.value}-{uuid.uuid4().hex[:8]}@example.com", password_hash=hash_password("Passw0rdOK"),
             full_name=f"{role.value.title()} Person", role=role, tenant_id=tid, email_verified=True)
    db.add(u)
    db.flush()
    return u


def test_entity_notes_feed():
    db = SessionLocal()
    slug = f"note{uuid.uuid4().hex[:8]}"
    tenant = Tenant(name="Notes desk", slug=slug)
    db.add(tenant)
    db.flush()
    admin, broker, other, referrer = (_user(db, tenant.id, r) for r in
                                      (UserRole.admin, UserRole.broker, UserRole.broker, UserRole.referrer))
    org = Organization(tenant_id=tenant.id, name="Acme Pty Ltd")
    db.add(org)
    db.commit()
    hdr = {u.id: {"Authorization": f"Bearer {create_access_token(u.id, u.role.value, tenant.id)}", "X-Tenant-Slug": slug}
           for u in (admin, broker, other, referrer)}
    ids = {"admin": admin.id, "broker": broker.id, "other": other.id, "referrer": referrer.id, "org": org.id}
    db.close()
    url = f"/api/organizations/{ids['org']}/notes"

    with TestClient(app) as tc:
        assert tc.get(url, headers=hdr[ids["referrer"]]).status_code == 403
        tc.post(url, json={"content": "Accountant is Jane at Smith & Co", "category": "financials"}, headers=hdr[ids["broker"]])
        notes = tc.post(url, json={"content": "  Prefers email  ", "category": "relationship", "is_pinned": True},
                        headers=hdr[ids["broker"]]).json()
        # Pinned first, text trimmed, author named.
        assert [n["content"] for n in notes] == ["Prefers email", "Accountant is Jane at Smith & Co"]
        assert notes[0]["author_name"] == "Broker Person" and notes[0]["can_edit"]
        note_id = notes[1]["id"]

        # Another broker can pin but not rewrite or delete someone else's note.
        assert tc.patch(f"{url}/{note_id}", json={"content": "x"}, headers=hdr[ids["other"]]).status_code == 403
        assert tc.delete(f"{url}/{note_id}", headers=hdr[ids["other"]]).status_code == 403
        pinned = tc.patch(f"{url}/{note_id}", json={"is_pinned": True}, headers=hdr[ids["other"]]).json()
        assert all(n["is_pinned"] for n in pinned)
        # The author edits (stamped), an admin may delete.
        edited = tc.patch(f"{url}/{note_id}", json={"content": "Accountant: Jane, Smith & Co"}, headers=hdr[ids["broker"]]).json()
        assert next(n for n in edited if n["id"] == note_id)["updated_at"]
        assert len(tc.delete(f"{url}/{note_id}", headers=hdr[ids["admin"]]).json()) == 1
        assert tc.post(url, json={"content": "x", "category": "gossip"}, headers=hdr[ids["broker"]]).status_code == 422

        # Notes typed when creating an entity start its feed.
        created = tc.post("/api/organizations", json={"name": "New Co", "notes": "Met at expo"}, headers=hdr[ids["broker"]]).json()
        assert [n["content"] for n in tc.get(f"/api/organizations/{created['id']}/notes", headers=hdr[ids["broker"]]).json()] == ["Met at expo"]

        # Merging carries the duplicate's notes across; deleting removes them.
        res = tc.post("/api/organizations/merge", json={"primary_id": ids["org"], "duplicate_ids": [created["id"]]},
                      headers=hdr[ids["admin"]])
        assert res.status_code == 200, res.text
        assert "Met at expo" in [n["content"] for n in tc.get(url, headers=hdr[ids["admin"]]).json()]
        assert tc.delete(f"/api/organizations/{ids['org']}", headers=hdr[ids["admin"]]).status_code == 204
    db = SessionLocal()
    try:
        assert db.query(EntityNote).filter(EntityNote.organization_id == ids["org"]).count() == 0
    finally:
        db.close()
