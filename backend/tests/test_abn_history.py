"""ABN history from the register's XML search: parsing, keeping it on the
entity, and re-reading it when the ABN changes or on refresh."""
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models.contact import Organization
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.services import abr
from app.services.auth import create_access_token, hash_password

NS = 'xmlns="http://abr.business.gov.au/ABRXMLSearch/"'
SOLE_TRADER = f"""<?xml version="1.0" encoding="utf-8"?>
<ABRPayloadSearchResults {NS}>
  <request><identifierSearchRequest><authenticationGUID>secret-guid</authenticationGUID></identifierSearchRequest></request>
  <response>
    <businessEntity202001>
      <recordLastUpdatedDate>2025-03-01</recordLastUpdatedDate>
      <ABN><identifierValue>51824753556</identifierValue></ABN>
      <entityStatus><entityStatusCode>Active</entityStatusCode><effectiveFrom>2019-05-01</effectiveFrom><effectiveTo>0001-01-01</effectiveTo></entityStatus>
      <entityStatus><entityStatusCode>Cancelled</entityStatusCode><effectiveFrom>2017-02-01</effectiveFrom><effectiveTo>2019-05-01</effectiveTo></entityStatus>
      <entityStatus><entityStatusCode>Active</entityStatusCode><effectiveFrom>2014-01-01</effectiveFrom><effectiveTo>2017-02-01</effectiveTo></entityStatus>
      <entityStatus><entityStatusCode>Active</entityStatusCode><effectiveFrom>2012-07-01</effectiveFrom><effectiveTo>2014-01-01</effectiveTo></entityStatus>
      <entityType><entityTypeCode>IND</entityTypeCode><entityDescription>Individual/Sole Trader</entityDescription></entityType>
      <goodsAndServicesTax><effectiveFrom>2020-01-01</effectiveFrom><effectiveTo>0001-01-01</effectiveTo></goodsAndServicesTax>
      <goodsAndServicesTax><effectiveFrom>2013-01-01</effectiveFrom><effectiveTo>2017-02-01</effectiveTo></goodsAndServicesTax>
      <legalName><givenName>JO</givenName><otherGivenName>ANNE</otherGivenName><familyName>SMITH</familyName><effectiveFrom>2018-06-01</effectiveFrom><effectiveTo>0001-01-01</effectiveTo></legalName>
      <legalName><givenName>JO</givenName><familyName>BROWN</familyName><effectiveFrom>2012-07-01</effectiveFrom><effectiveTo>2018-06-01</effectiveTo></legalName>
      <mainBusinessPhysicalAddress><stateCode>QLD</stateCode><postcode>4000</postcode><effectiveFrom>2021-01-01</effectiveFrom><effectiveTo>0001-01-01</effectiveTo></mainBusinessPhysicalAddress>
      <mainBusinessPhysicalAddress><stateCode>NSW</stateCode><postcode>2000</postcode><effectiveFrom>2015-01-01</effectiveFrom><effectiveTo>2021-01-01</effectiveTo></mainBusinessPhysicalAddress>
      <mainBusinessPhysicalAddress><stateCode>NSW</stateCode><postcode>2000</postcode><effectiveFrom>2012-07-01</effectiveFrom><effectiveTo>2015-01-01</effectiveTo></mainBusinessPhysicalAddress>
      <businessName><organisationName>JO SMITH PLUMBING</organisationName><effectiveFrom>2019-06-01</effectiveFrom></businessName>
    </businessEntity202001>
  </response>
</ABRPayloadSearchResults>"""
NOT_FOUND = f"""<?xml version="1.0"?><ABRPayloadSearchResults {NS}><response>
<exception><exceptionDescription>Search text is not a valid ABN or ACN</exceptionDescription></exception></response></ABRPayloadSearchResults>"""


def test_parse_history():
    h = abr.parse_history(SOLE_TRADER)
    assert h["entity_type"] == "Individual/Sole Trader"
    assert h["first_registered"] == "2012-07-01"
    # The register's split Active period (2012–14, 2014–17) reads as one.
    assert [(s["status"], s["from"], s["to"]) for s in h["status_history"]] == [
        ("Active", "2019-05-01", None), ("Cancelled", "2017-02-01", "2019-05-01"), ("Active", "2012-07-01", "2017-02-01")]
    assert [(g["from"], g["to"]) for g in h["gst_history"]] == [("2020-01-01", None), ("2013-01-01", "2017-02-01")]
    assert [n["name"] for n in h["name_history"]] == ["JO ANNE SMITH", "JO BROWN"]
    # Two NSW periods are one stay; then the move to QLD.
    assert [(a["state"], a["from"], a["to"]) for a in h["address_history"]] == [
        ("QLD", "2021-01-01", None), ("NSW", "2012-07-01", "2021-01-01")]
    assert h["business_names"] == [{"name": "JO SMITH PLUMBING", "from": "2019-06-01", "to": None}]
    assert "secret-guid" not in str(h)
    assert abr.parse_history(NOT_FOUND) is None


class _Resp:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


@pytest.fixture()
def register(monkeypatch):
    calls = []

    def fake_get(url, params=None, timeout=None):
        calls.append(params["searchString"])
        if url != abr.ABR_XML_ENDPOINT:
            raise httpx.ConnectError("only the XML search is faked")
        return _Resp(SOLE_TRADER if params["searchString"] == "51824753556" else NOT_FOUND)

    monkeypatch.setattr(abr, "ABR_ENABLED", True)
    monkeypatch.setattr(abr, "ABR_GUID", "test-guid")
    monkeypatch.setattr(abr.httpx, "get", fake_get)
    return calls


def test_history_kept_on_the_entity(register):
    db = SessionLocal()
    slug = f"abn{uuid.uuid4().hex[:8]}"
    tenant = Tenant(name="ABN desk", slug=slug)
    db.add(tenant)
    db.flush()
    broker = User(email=f"b-{uuid.uuid4().hex[:8]}@example.com", password_hash=hash_password("Passw0rdOK"),
                  full_name="Broker", role=UserRole.broker, tenant_id=tenant.id, email_verified=True)
    org = Organization(tenant_id=tenant.id, name="Jo Smith Plumbing", abn="51 824 753 556", abr_checked_at=None)
    db.add_all([broker, org])
    db.commit()
    h = {"Authorization": f"Bearer {create_access_token(broker.id, 'broker', tenant.id)}", "X-Tenant-Slug": slug}
    org_id = org.id
    db.close()

    with TestClient(app) as tc:
        first = tc.get(f"/api/organizations/{org_id}/abn-history", headers=h).json()
        assert first["state"] == "ok" and first["history"]["first_registered"] == "2012-07-01"
        # Kept: the second view doesn't ask the register again.
        tc.get(f"/api/organizations/{org_id}/abn-history", headers=h)
        assert register.count("51824753556") == 1
        tc.get(f"/api/organizations/{org_id}/abn-history", params={"refresh": True}, headers=h)
        assert register.count("51824753556") == 2

    db = SessionLocal()
    try:
        o = db.get(Organization, org_id)
        o.abn = "53004085616"  # a different ABN makes the kept history stale
        db.commit()
    finally:
        db.close()
    with TestClient(app) as tc:
        assert tc.get(f"/api/organizations/{org_id}/abn-history", headers=h).json()["state"] == "not_on_register"
