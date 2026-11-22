"""The private ledger through the real router stack: what a deal row carries,
the asset-finance pipeline, staff commission, extra payments, the report's
roll-ups and the Excel layouts."""
import io
import json
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from app.database import SessionLocal
from app.main import app
from app.models.contact import Organization
from app.models.ledger import LedgerSettings
from app.models.loan_applicant import LoanApplicant
from app.models.loan_application import ApplicationStatus, LoanApplication, LoanType
from app.models.quote_sheet import QuoteSheet, QuoteSheetStatus, QuoteSheetType
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.services import ledger as svc
from app.services.auth import create_access_token, hash_password

PASSWORD = "Passw0rdOK"
TODAY = date.today()
MONTH_START = TODAY.replace(day=1)
SETTLED_AT = datetime.combine(MONTH_START, datetime.min.time())


def _user(db, tenant_id, role, name):
    u = User(email=f"{role.value}-{uuid.uuid4().hex[:8]}@example.com", password_hash=hash_password(PASSWORD),
             full_name=name, role=role, tenant_id=tenant_id, email_verified=True)
    db.add(u)
    db.flush()
    return u


def _app(db, tenant_id, user_id, status, loan_type=LoanType.vehicle, **kw):
    a = LoanApplication(tenant_id=tenant_id, user_id=user_id, loan_type=loan_type, amount=50000, status=status,
                        created_at=datetime.now(timezone.utc), **kw)
    db.add(a)
    db.flush()
    return a


@pytest.fixture(scope="module")
def desk():
    db = SessionLocal()
    slug = f"led{uuid.uuid4().hex[:8]}"
    tenant = Tenant(name="Ledger desk", slug=slug)
    db.add(tenant)
    db.flush()
    tid = tenant.id
    owner = _user(db, tid, UserRole.admin, "Owner Admin")
    other_admin = _user(db, tid, UserRole.admin, "Other Admin")
    broker = _user(db, tid, UserRole.broker, "Staff Broker")
    client = _user(db, tid, UserRole.client, "Client Login")
    db.add(LedgerSettings(tenant_id=tid, owner_user_id=owner.id))

    org = Organization(tenant_id=tid, name="Charun Group Pty Ltd")
    db.add(org)
    db.flush()
    settled = _app(db, tid, client.id, ApplicationStatus.settled, applicant_first_name="Harpreet",
                   applicant_last_name="Toor", business_organization_id=org.id, settled_at=SETTLED_AT)
    company = _app(db, tid, broker.id, ApplicationStatus.settled, applicant_type="company",
                   business_name="EZYGO Pty Ltd", settled_at=SETTLED_AT)
    db.add_all([
        LoanApplicant(tenant_id=tid, application_id=company.id, applicant_first_name="Mihir", applicant_last_name="Patel", is_primary=True),
        LoanApplicant(tenant_id=tid, application_id=company.id, applicant_first_name="Purav", applicant_last_name="Patel"),
    ])
    in_pipeline = _app(db, tid, client.id, ApplicationStatus.approval, applicant_first_name="Pipe", applicant_last_name="Line")
    draft = _app(db, tid, client.id, ApplicationStatus.draft, applicant_first_name="Still", applicant_last_name="Started")
    home = _app(db, tid, client.id, ApplicationStatus.submitted, loan_type=LoanType.home_loan,
                applicant_first_name="Home", applicant_last_name="Loan")
    # Lender pricing with the establishment fee typed inc GST ($440 → $400 ex GST).
    db.add(QuoteSheet(
        tenant_id=tid, application_id=settled.id, created_by_id=owner.id, status=QuoteSheetStatus.draft,
        sheet_type=QuoteSheetType.lender_pricing, amount_borrowed=40000,
        input_parameters=json.dumps({"brokerage_amount": 1000, "establishment_fee": 440,
                                     "fee_gst_inclusive": {"establishment_fee": True}}),
    ))
    db.commit()
    out = {"slug": slug, "owner": owner.email, "other_admin": other_admin.email, "broker_id": broker.id,
           "settled": settled.id, "company": company.id, "pipeline": in_pipeline.id, "draft": draft.id, "home": home.id}
    db.close()
    return out


def _login(tc, slug, email):
    """Bearer headers minted directly — the suite's real logins share one
    login rate limit, and these tests aren't about logging in."""
    db = SessionLocal()
    try:
        u = db.query(User).filter(User.email == email).one()
        token = create_access_token(u.id, u.role.value, u.tenant_id)
    finally:
        db.close()
    return {"Authorization": f"Bearer {token}", "X-Tenant-Slug": slug}


def _month_range():
    return {"date_from": MONTH_START.isoformat(), "date_to": TODAY.isoformat()}


def test_rows_names_pipeline_and_prefill(desk):
    with TestClient(app) as tc:
        h = _login(tc, desk["slug"], desk["owner"])
        data = tc.get("/api/ledger/deals", params=_month_range(), headers=h).json()
    deals = {d["application_id"]: d for d in data["deals"]}
    assert deals[desk["settled"]]["customer_name"] == "Harpreet Toor"
    assert deals[desk["settled"]]["entity_name"] == "Charun Group Pty Ltd"
    # The company's directors are the customer.
    assert deals[desk["company"]]["customer_name"] == "Mihir Patel & Purav Patel"
    # A fee typed inc GST on the pricing arrives ex GST; brokerage as typed.
    assert deals[desk["settled"]]["brokerage"] == 1000.0
    assert deals[desk["settled"]]["brokerage_inc_gst"] == 1100.0
    assert deals[desk["settled"]]["doc_fee"] == 400.0
    assert deals[desk["settled"]]["deal_status"] == "Settled"

    # Only the asset-finance deal past "Started" is in the pipeline, and it is
    # in no settled total.
    assert [p["application_id"] for p in data["pipeline"]] == [desk["pipeline"]]
    assert data["pipeline"][0]["settled_on"] is None
    assert data["pipeline"][0]["deal_status"]
    assert data["totals"]["count"] == 2


def test_staff_share_and_extra_payment_roll_up(desk):
    with TestClient(app) as tc:
        h = _login(tc, desk["slug"], desk["owner"])
        staff_key = f"u:{desk['broker_id']}"
        payees = tc.get("/api/ledger/payees", headers=h).json()
        assert any(p["key"] == staff_key and p["kind"] == "staff" for p in payees)

        r = tc.put(f"/api/ledger/deals/{desk['settled']}/shares", headers=h,
                   json={"shares": [{"payee_key": staff_key, "share_amount": 200}]})
        assert r.status_code == 200, r.text
        row = r.json()
        assert row["staff_comms_ex_gst"] == 200.0
        assert row["referrer_comms_ex_gst"] == 0.0
        assert row["net_profit"] == 1400.0 - 200.0

        r = tc.post("/api/ledger/payments", headers=h, json={
            "payee_key": staff_key, "payment_date": TODAY.isoformat(), "category": "staff_bonus",
            "amount": 150, "gst": True, "deal_key": desk["settled"], "notes": "for the rush settlement",
        })
        assert r.status_code == 201, r.text
        payment = r.json()
        assert payment["amount_inc_gst"] == 165.0
        assert payment["deal_name"].startswith("Harpreet Toor")

        data = tc.get("/api/ledger/deals", params=_month_range(), headers=h).json()
        month = data["months"][-1]
        assert month["totals"]["extra_payments_ex_gst"] == 150.0
        assert month["totals"]["final_profit"] == month["totals"]["net_profit"] - 150.0
        assert data["extra_payments"][0]["notes"] == "for the rush settlement"

        summary = tc.get("/api/ledger/referrers", params=_month_range(), headers=h).json()
        staff = next(s for s in summary if s["referrer_id"] == staff_key)
        assert staff["payee_kind"] == "staff"
        assert staff["extra_payments_inc_gst"] == 165.0
        assert staff["unpaid_comms_inc_gst"] == 200.0 + 165.0

        inv = tc.post("/api/ledger/invoices", headers=h, json={
            "referrer_id": staff_key, "application_ids": [desk["settled"]], "payment_ids": [payment["id"]],
        })
        assert inv.status_code == 201, inv.text
        assert inv.json()["total_ex_gst"] == 350.0
        assert len(inv.json()["lines"]) == 2

        paid = tc.post("/api/ledger/deals/mark-paid", headers=h, json={
            "payment_ids": [payment["id"]], "payee_key": staff_key, "status": "paid", "paid_on": TODAY.isoformat(),
        })
        assert paid.status_code == 200 and paid.json()["updated"] == 1


def test_report_shows_only_the_rollups_the_range_spans():
    rows = [{"application_id": "a", "month": "2026-08", "half": 1, "net_profit": 10.0, "is_pipeline": False}]
    one_month = svc.report(rows, {}, date_from=date(2026, 8, 1), date_to=date(2026, 8, 31))
    assert one_month["show"] == {"quarters": False, "half_years": False, "years": False}
    quarter = svc.report(rows, {}, date_from=date(2026, 7, 1), date_to=date(2026, 9, 30))
    assert quarter["show"] == {"quarters": True, "half_years": False, "years": False}
    half = svc.report(rows, {}, date_from=date(2026, 7, 1), date_to=date(2026, 12, 31))
    assert half["show"]["half_years"] and not half["show"]["years"]
    assert half["half_years"][0]["label"] == "H1 FY 2026–27 · Jul–Dec 2026"
    year = svc.report(rows, {}, date_from=date(2026, 7, 1), date_to=date(2027, 6, 30))
    assert year["show"] == {"quarters": True, "half_years": True, "years": True}


def test_excel_detailed_and_summary(desk):
    cols = "customer_name,finance_amount,brokerage,brokerage_gst,brokerage_inc_gst,net_profit,extra_payments_ex_gst,final_profit"
    with TestClient(app) as tc:
        h = _login(tc, desk["slug"], desk["owner"])
        detailed = tc.get("/api/ledger/export.xlsx", headers=h,
                          params={**_month_range(), "columns": cols, "include_pipeline": True})
        summary = tc.get("/api/ledger/export.xlsx", headers=h,
                         params={**_month_range(), "columns": cols, "layout": "summary", "title": "Management"})
    assert detailed.status_code == 200, detailed.text
    wb = load_workbook(io.BytesIO(detailed.content))
    assert {"Settled deals", "Extra payments", "Pipeline"} <= set(wb.sheetnames)
    values = [c.value for row in wb["Settled deals"].iter_rows() for c in row if c.value is not None]
    assert "Harpreet Toor" in values

    wb = load_workbook(io.BytesIO(summary.content))
    ws = wb["Summary"]
    assert ws.cell(row=1, column=1).value.startswith("Management")
    labels = [ws.cell(row=r, column=1).value for r in range(4, ws.max_row + 1)]
    assert labels[-1] == "TOTAL"
    # No deal rows in the management copy.
    assert "Harpreet Toor" not in [c.value for row in ws.iter_rows() for c in row]


def test_ledger_stays_closed_to_other_admins(desk):
    with TestClient(app) as tc:
        h = _login(tc, desk["slug"], desk["other_admin"])
        assert tc.get("/api/ledger/payments", headers=h).status_code == 404
        assert tc.get("/api/ledger/deals", headers=h).status_code == 404


def test_one_off_payments_link_to_any_month_or_none(desk):
    """An extra payment needn't belong to a deal, and can be linked to a deal
    from an earlier month — it counts in the month it was made."""
    last_month = MONTH_START - timedelta(days=1)  # last day of the month before
    with TestClient(app) as tc:
        h = _login(tc, desk["slug"], desk["owner"])
        staff_key = f"u:{desk['broker_id']}"

        options = tc.get("/api/ledger/deal-options", headers=h)
        assert options.status_code == 200, options.text
        keys = [o["key"] for o in options.json()]
        assert desk["settled"] in keys and desk["pipeline"] in keys
        # Still-open deals first, then settled newest first.
        assert options.json()[0]["is_pipeline"] is True
        assert tc.get("/api/ledger/deal-options", headers=_login(tc, desk["slug"], desk["other_admin"])).status_code == 404

        unlinked = tc.post("/api/ledger/payments", headers=h, json={
            "payee_key": staff_key, "payment_date": last_month.isoformat(), "category": "other", "amount": 80,
        })
        assert unlinked.status_code == 201, unlinked.text
        assert unlinked.json()["deal_key"] is None and unlinked.json()["month"] == last_month.strftime("%Y-%m")

        linked = tc.post("/api/ledger/payments", headers=h, json={
            "payee_key": staff_key, "payment_date": last_month.isoformat(), "category": "extra_service",
            "amount": 50, "deal_key": desk["settled"],
        })
        assert linked.status_code == 201, linked.text

        # Every payment against the deal, whichever month it was made in.
        against = tc.get("/api/ledger/payments", headers=h, params={"deal_key": desk["settled"]}).json()["payments"]
        assert linked.json()["id"] in {p["id"] for p in against}
        assert unlinked.json()["id"] not in {p["id"] for p in against}

        # Both land in last month's report, as rows of their own.
        data = tc.get("/api/ledger/deals", headers=h, params={
            "date_from": last_month.replace(day=1).isoformat(), "date_to": last_month.isoformat()}).json()
        month = next(m for m in data["months"] if m["month"] == last_month.strftime("%Y-%m"))
        assert {unlinked.json()["id"], linked.json()["id"]} <= set(month["payment_ids"])
        assert month["totals"]["extra_payments_ex_gst"] == 130.0
