"""Clients and referrers must never receive the desk's internal application state.

Guards the fix for S-02: app_with_user serialises every model column, so the
allow/deny decision lives in one place (STAFF_ONLY_KEYS + redact_for_viewer).
"""
from types import SimpleNamespace

import pytest

from app.models.loan_application import LoanApplication
from app.models.user import UserRole
from app.schemas.loan_application import LoanApplicationOut
from app.services.serialization import STAFF_ONLY_KEYS, is_staff_viewer, redact_for_viewer


def _viewer(role):
    return SimpleNamespace(role=role)


def _full_payload() -> dict:
    data = {c.name: None for c in LoanApplication.__table__.columns}
    data.update({
        "analysis_result": '{"recommendation": {"decision": "reject"}}',
        "approval_lender_name": "Big Bank",
        "approval_conditions": [{"id": "c1", "text": "Payslips"}],
        "reconciliation_note": "Duplicate ABN",
        "pending_business_link": {"organization_name": "Acme"},
        "client_account_pending": True,
        "assigned_broker_name": "Sam Broker",
        "user_name": "Applicant",
    })
    return data


@pytest.mark.parametrize("role", [UserRole.client, UserRole.referrer])
def test_non_staff_lose_every_staff_only_key(role):
    data = redact_for_viewer(_full_payload(), _viewer(role))
    leaked = STAFF_ONLY_KEYS & data.keys()
    assert not leaked, f"{role.value} payload still carries {sorted(leaked)}"
    # Fields the applicant legitimately sees survive.
    assert data["assigned_broker_name"] == "Sam Broker"
    assert data["user_name"] == "Applicant"


@pytest.mark.parametrize("role", [UserRole.admin, UserRole.broker, UserRole.super_admin])
def test_staff_keep_the_full_payload(role):
    before = _full_payload()
    after = redact_for_viewer(dict(before), _viewer(role))
    assert after == before


def test_missing_viewer_is_treated_as_non_staff():
    assert not is_staff_viewer(None)
    data = redact_for_viewer(_full_payload(), None)
    assert "analysis_result" not in data


def test_response_schema_defaults_every_staff_only_key():
    """Popping a key is only safe if LoanApplicationOut does not require it."""
    required = {name for name, f in LoanApplicationOut.model_fields.items() if f.is_required()}
    assert not (STAFF_ONLY_KEYS & required)


def test_every_staff_only_key_is_a_real_field():
    """Catch typos: each key must be a model column or a serializer-added key."""
    columns = {c.name for c in LoanApplication.__table__.columns}
    serializer_added = {"pending_business_link", "client_account_pending", "approval_conditions"}
    unknown = STAFF_ONLY_KEYS - columns - serializer_added
    assert not unknown, unknown
