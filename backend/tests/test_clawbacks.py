"""Clawbacks recorded on a file by the team: the client alert they raise, the
ledger row in the month they happened, and the ledger's category downloads."""
import io
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from app.database import SessionLocal
from app.main import app
from app.models.application_clawback import ApplicationClawback
from app.models.client_alert import ClientAlert
from app.models.contact import Contact
from app.models.ledger import LedgerDeal, LedgerSettings
from app.models.loan_application import ApplicationStatus, LoanApplication, LoanType
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.services.auth import create_access_token, hash_password

TODAY = date.today()
MONTH_START = TODAY.replace(day=1)
# Settled in an earlier month than the clawback.
EARLIER = (MONTH_START - timedelta(days=40)).replace(day=5)


def _user(db, tid, role, name):
    u = User(email=f"{role.value}-{uuid.uuid4().hex[:8]}@example.com", password_hash=hash_password("Passw0rdOK"),
             full_name=name, role=role, tenant_id=tid, email_verified=True)
    db.add(u)
    db.flush()
    return u


def _app(db, tid, user_id, status, loan_type=LoanType.vehicle, **kw):
    a = LoanApplication(tenant_id=tid, user_id=user_id, loan_type=loan_type, amount=50000, status=status,
                        created_at=datetime.now(timezone.utc), **kw)
    db.add(a)
    db.flush()
    return a


@pytest.fixture(scope="module")
def desk():
    db = SessionLocal()
    slug = f"claw{uuid.uuid4().hex[:8]}"
    tenant = Tenant(name="Clawback desk", slug=slug)
    db.add(tenant)
    db.flush()
    tid = tenant.id
    owner = _user(db, tid, UserRole.admin, "Owner Admin")
    broker = _user(db, tid, UserRole.broker, "Team Broker")
    client = _user(db, tid, UserRole.client, "Client Login")
    referrer = _user(db, tid, UserRole.referrer, "Ref Partner")
    db.add(LedgerSettings(tenant_id=tid, owner_user_id=owner.id))
    contact = Contact(tenant_id=tid, first_name="Jane", last_name="Citizen", email=f"jane-{uuid.uuid4().hex[:6]}@example.com")
    db.add(contact)
    db.flush()
    settled_at = datetime.combine(EARLIER, datetime.min.time())
    car = _app(db, tid, client.id, ApplicationStatus.settled, applicant_first_name="Jane", applicant_last_name="Citizen",
               settled_at=settled_at, contact_id=contact.id, approval_lender_name="Macquarie")
    home = _app(db, tid, client.id, ApplicationStatus.settled, loan_type=LoanType.home_loan,
                applicant_first_name="Home", applicant_last_name="Buyer", settled_at=datetime.combine(MONTH_START, datetime.min.time()))
    open_app = _app(db, tid, client.id, ApplicationStatus.submitted, applicant_first_name="Not", applicant_last_name="Settled")
    db.commit()
    out = {"slug": slug, "tid": tid, "owner": owner.id, "broker": broker.id, "client": client.id, "referrer": referrer.id,
           "car": car.id, "home": home.id, "open": open_app.id, "contact": contact.id}
    db.close()
    return out


def _h(slug, user_id):
    db = SessionLocal()
    try:
        u = db.get(User, user_id)
        token = create_access_token(u.id, u.role.value, u.tenant_id)
    finally:
        db.close()
    return {"Authorization": f"Bearer {token}", "X-Tenant-Slug": slug}


def _month():
    return {"date_from": MONTH_START.isoformat(), "date_to": TODAY.isoformat()}


def test_clawback_flow(desk):
    with TestClient(app) as tc:
        team = _h(desk["slug"], desk["broker"])
        owner = _h(desk["slug"], desk["owner"])

        # Only a settled loan, never in the future, never by a client or referrer.
        assert tc.post(f"/api/applications/{desk['open']}/clawbacks",
                       json={"clawback_date": TODAY.isoformat(), "amount": 100}, headers=team).status_code == 400
        assert tc.post(f"/api/applications/{desk['car']}/clawbacks",
                       json={"clawback_date": (TODAY + timedelta(days=1)).isoformat(), "amount": 100}, headers=team).status_code == 400
        for who in ("client", "referrer"):
            assert tc.post(f"/api/applications/{desk['car']}/clawbacks", json={"clawback_date": TODAY.isoformat(), "amount": 100},
                           headers=_h(desk["slug"], desk[who])).status_code == 403

        res = tc.post(f"/api/applications/{desk['car']}/clawbacks",
                      json={"clawback_date": TODAY.isoformat(), "amount": "500.00", "reason": "Paid out in month 3"}, headers=team)
        assert res.status_code == 201, res.text
        [cb] = res.json()
        assert cb["amount"] == 500.0 and cb["created_by_name"] == "Team Broker"
        assert cb["alert_high_priority"] is True

        # The whole team sees it — on the file, and against the client.
        assert tc.get(f"/api/applications/{desk['car']}/clawbacks", headers=owner).json()[0]["id"] == cb["id"]
        assert [c["id"] for c in tc.get("/api/clawbacks", params={"contact_id": desk["contact"]}, headers=team).json()] == [cb["id"]]

        # It raised a high-priority client alert on the loan's client.
        alerts = tc.get(f"/api/clients/{desk['client']}/alerts", headers=team).json()
        [alert] = [a for a in alerts if a["id"] == cb["client_alert_id"]]
        assert alert["is_high_priority"]
        assert "$500.00" in alert["content"] and "Paid out in month 3" in alert["content"]

        # Ledger: a red row in THIS month (not the settlement month), at the
        # bottom in its own section, brokerage reversed, not counted as a deal.
        data = tc.get("/api/ledger/deals", params=_month(), headers=owner).json()
        rows = {d["application_id"]: d for d in data["deals"]}
        row = rows[cb["id"]]
        assert row["is_clawback"] and row["deal_status"] == "Clawback" and row["half"] == 3
        assert row["clawback_of"] == desk["car"] and row["customer_name"] == "Jane Citizen"
        assert row["brokerage"] == -500.0 and row["finance_amount"] == 0
        assert row["lender_name"] == "Macquarie"
        assert desk["car"] not in rows  # the loan itself settled in an earlier month
        month = data["months"][-1]
        assert [h["half"] for h in month["halves"]][-1] == 3
        assert month["halves"][-1]["label"] == "Clawbacks"
        assert data["totals"]["clawbacks"] == 1
        assert data["totals"]["count"] == len(rows) - 1

        # The team changes the amount: the alert and the ledger's prefill follow.
        tc.patch(f"/api/applications/{desk['car']}/clawbacks/{cb['id']}", json={"amount": 650}, headers=team)
        alerts = tc.get(f"/api/clients/{desk['client']}/alerts", headers=team).json()
        assert "$650.00" in next(a for a in alerts if a["id"] == cb["client_alert_id"])["content"]
        assert tc.get("/api/ledger/deals", params=_month(), headers=owner).json()["deals"]
        row = next(d for d in tc.get("/api/ledger/deals", params=_month(), headers=owner).json()["deals"] if d["application_id"] == cb["id"])
        assert row["brokerage"] == -650.0

        # The owner can enter over the clawback's figures like any deal's.
        res = tc.patch(f"/api/ledger/deals/{cb['id']}", json={"brokerage": -600, "doc_fee": -50}, headers=owner)
        assert res.status_code == 200, res.text
        assert res.json()["income_ex_gst"] == -650.0
        # …but not turn it into a ledger-only deal.
        assert tc.patch(f"/api/ledger/deals/{cb['id']}", json={"manual_customer_name": "X"}, headers=owner).status_code == 400

        # Deleting it takes its alert and the owner's entry with it.
        assert tc.delete(f"/api/applications/{desk['car']}/clawbacks/{cb['id']}", headers=team).json() == []
    db = SessionLocal()
    try:
        assert db.get(ClientAlert, cb["client_alert_id"]) is None
        assert db.query(LedgerDeal).filter(LedgerDeal.application_id == cb["id"]).count() == 0
        assert db.query(ApplicationClawback).filter(ApplicationClawback.id == cb["id"]).count() == 0
    finally:
        db.close()


def test_alert_deleted_by_hand_is_not_brought_back(desk):
    with TestClient(app) as tc:
        team = _h(desk["slug"], desk["broker"])
        [cb] = tc.post(f"/api/applications/{desk['car']}/clawbacks",
                       json={"clawback_date": TODAY.isoformat(), "amount": 100, "high_priority": False}, headers=team).json()
        assert cb["alert_high_priority"] is False
        tc.delete(f"/api/clients/{desk['client']}/alerts/{cb['client_alert_id']}", headers=team)
        tc.patch(f"/api/applications/{desk['car']}/clawbacks/{cb['id']}", json={"reason": "Refinanced"}, headers=team)
        alerts = tc.get(f"/api/clients/{desk['client']}/alerts", headers=team).json()
        assert not [a for a in alerts if "Refinanced" in a["content"]]
        tc.delete(f"/api/applications/{desk['car']}/clawbacks/{cb['id']}", headers=team)


def test_category_filter_and_split_download(desk):
    with TestClient(app) as tc:
        owner = _h(desk["slug"], desk["owner"])
        team = _h(desk["slug"], desk["broker"])
        [cb] = tc.post(f"/api/applications/{desk['car']}/clawbacks",
                       json={"clawback_date": TODAY.isoformat(), "amount": 200}, headers=team).json()
        params = _month()

        home = tc.get("/api/ledger/deals", params={**params, "category": "home_loan"}, headers=owner).json()
        assert [d["application_id"] for d in home["deals"]] == [desk["home"]]
        # A slice of the books has no month-level volume bonus received.
        assert home["totals"].get("vb_received_inc_gst") is None
        asset = tc.get("/api/ledger/deals", params={**params, "category": "asset_finance"}, headers=owner).json()
        assert [d["application_id"] for d in asset["deals"]] == [cb["id"]]
        assert tc.get("/api/ledger/deals", params={**params, "category": "boats"}, headers=owner).status_code == 400

        res = tc.get("/api/ledger/export.xlsx", params={**params, "split_categories": "true"}, headers=owner)
        assert res.status_code == 200, res.text
        wb = load_workbook(io.BytesIO(res.content))
        assert wb.sheetnames[:3] == ["Asset finance", "Home loans", "Commercial"]
        asset_text = " ".join(str(c.value) for r in wb["Asset finance"].iter_rows() for c in r if c.value)
        assert "Clawbacks" in asset_text and "Jane Citizen" in asset_text
        assert "Home Buyer" not in asset_text

        one = tc.get("/api/ledger/export.xlsx", params={**params, "category": "home_loan"}, headers=owner)
        title = load_workbook(io.BytesIO(one.content)).active["A1"].value
        assert "Home loans" in title
        tc.delete(f"/api/applications/{desk['car']}/clawbacks/{cb['id']}", headers=team)
