from __future__ import annotations

# NOTE: frontend copy at frontend/src/lib/constants.ts — keep in sync
VALID_TRANSITIONS: dict[str, list[str]] = {
    "draft": ["application_received", "rejected", "not_proceeding"],
    "application_received": ["application_assessed", "submitted", "settled", "rejected", "not_proceeding", "draft"],
    "application_assessed": ["submitted", "approval", "settled", "rejected", "not_proceeding", "application_received", "draft"],
    "submitted": ["approval", "settled", "rejected", "not_proceeding", "application_assessed", "application_received", "draft"],
    "approval": ["settled", "rejected", "not_proceeding", "submitted"],
    "settled": [],
    "rejected": ["draft", "application_received", "application_assessed", "submitted"],
    "not_proceeding": ["draft", "application_received"],
}

# Legal structure of an Organization. Ordered as presented in the entity picker.
ENTITY_TYPES: list[str] = [
    "trust",
    "trustee",
    "company",
    "partnership",
    "sole_trader",
]

# Kind of trust, captured on Organizations with entity_type == "trust".
TRUST_TYPES: list[str] = [
    "discretionary",
    "unit",
    "hybrid",
    "smsf",
    "testamentary",
    "fixed",
    "other",
]

# Roles a party can hold in a trust structure (see models/trust_party.py).
TRUST_PARTY_ROLES: list[str] = [
    "settlor",
    "appointor",
    "trustee",
    "beneficiary",
    "beneficial_owner",
]

# What a trust party *is*. A trustee may be an individual, a company or a
# partnership (the latter two carry an ABN); beneficiaries may also be a class
# ("the children of X"), captured as "other" with a free-text name.
TRUST_PARTY_KINDS: list[str] = [
    "individual",
    "company",
    "partnership",
    "trust",
    "other",
]

DEFAULT_KANBAN_COLUMNS = [
    {"title": "Draft", "mapped_status": "draft", "position": 0, "color": "muted-foreground"},
    {"title": "Application Received", "mapped_status": "application_received", "position": 1, "color": "primary"},
    {"title": "Application Assessed", "mapped_status": "application_assessed", "position": 2, "color": "chart-4"},
    {"title": "Submitted", "mapped_status": "submitted", "position": 3, "color": "chart-2"},
    {"title": "Approval", "mapped_status": "approval", "position": 4, "color": "chart-5"},
    {"title": "Settled", "mapped_status": "settled", "position": 5, "color": "success"},
    {"title": "Rejected", "mapped_status": "rejected", "position": 6, "color": "destructive"},
]
