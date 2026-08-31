from __future__ import annotations

# NOTE: frontend copy at frontend/src/lib/constants.ts — keep in sync
VALID_TRANSITIONS: dict[str, list[str]] = {
    "draft": ["application_received", "rejected", "not_proceeding"],
    # Settled is reachable only via Approval — an application must be approved
    # by a lender before it can be marked settled.
    "application_received": ["application_assessed", "submitted", "rejected", "not_proceeding", "draft"],
    "application_assessed": ["submitted", "approval", "rejected", "not_proceeding", "application_received", "draft"],
    "submitted": ["approval", "rejected", "not_proceeding", "application_assessed", "application_received", "draft"],
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
    {"title": "Not Proceeding", "mapped_status": "not_proceeding", "position": 7, "color": "muted-foreground"},
]

# Display label for each application status. Board stages carry their own titles
# (see BOARD_STAGE_TEMPLATES); these labels are the client-facing status names and
# the fallback title for a stage created without one.
STATUS_LABELS: dict[str, str] = {c["mapped_status"]: c["title"] for c in DEFAULT_KANBAN_COLUMNS}

# ── Board stage templates ───────────────────────────────────
# A stage is an internal, per-board step. Several stages roll up to the same
# `mapped_status`, which is what the client sees and what SMS/email copy, the
# analytics and the arrears book key off — so the status set stays at eight
# while a board can carry as many stages as the desk actually works through.
#
# `stage_key` is the stable identifier: re-applying a template matches on it, so
# renaming a stage in the UI does not make the template create a duplicate.
#
# `gates` are what a stage asks before it will accept a card (see
# models/kanban.KanbanColumnGate). They seed the compliance stops the business
# asked for; admins can add more from the board without a deploy.
#
# `notifications` are who gets told when a card enters the stage. Only the one
# stage the brief names explicitly ("Loan Settled – All parties informed") is
# seeded — the per-stage wording for the rest is the desk's to write, and the
# board's stage editor adds them without a deploy. Bodies may use
# {client_name} {recipient_name} {stage} {lender} {amount} {reference}.

ASSET_FINANCE_STAGES: list[dict] = [
    {"stage_key": "af_deal_inquiry", "title": "Deal Inquiry", "mapped_status": "draft", "team": None, "color": "muted-foreground"},
    {"stage_key": "af_apps_searches", "title": "Apps & Searches", "mapped_status": "application_received", "team": "Offshore", "color": "primary"},
    {"stage_key": "af_find_lender", "title": "Find a Lender", "mapped_status": "application_assessed", "team": "Melbourne", "color": "chart-4"},
    {"stage_key": "af_lender_decided", "title": "Lender Decided / Waiting on Docs", "mapped_status": "application_assessed", "team": "Offshore", "color": "chart-4"},
    {"stage_key": "af_submitted_lender", "title": "Submitted to Lender", "mapped_status": "submitted", "team": "Melbourne", "color": "chart-2", "gates": [
        {"kind": "confirm", "label": "The client has signed the application form", "is_required": True},
        {"kind": "confirm", "label": "The client has signed the privacy consent", "is_required": True},
    ]},
    {"stage_key": "af_credit_more_info", "title": "Credit Needs More Info", "mapped_status": "submitted", "team": "Melbourne", "color": "chart-4"},
    {"stage_key": "af_approved_deals", "title": "Approved Deals", "mapped_status": "approval", "team": "Offshore", "color": "chart-5", "gates": [
        {"kind": "checklist", "label": "Approval conditions", "is_required": True, "target": "approval_conditions",
         "help_text": "Record the lender and every condition of the approval. The team ticks these off as they are met."},
    ]},
    {"stage_key": "af_waiting_tax_invoice", "title": "Waiting for Tax Invoice", "mapped_status": "approval", "team": "Offshore", "color": "chart-5"},
    {"stage_key": "af_quote_locked", "title": "Invoice Recd. / Quote Locked In", "mapped_status": "approval", "team": "Melbourne", "color": "chart-5"},
    {"stage_key": "af_loan_docs_issued", "title": "Loan Docs Issued", "mapped_status": "approval", "team": "Melbourne", "color": "chart-5"},
    {"stage_key": "af_settlement_docs", "title": "Settlement Docs – Submitted to Lender", "mapped_status": "approval", "team": "Melbourne", "color": "chart-5"},
    {"stage_key": "af_settled", "title": "Loan Settled – All Parties Informed", "mapped_status": "settled", "team": "Melbourne", "color": "success", "notifications": [
        {"audience": "client", "channel": "email", "subject": "Your loan has settled",
         "body": "Hi {client_name},\n\nYour loan has settled. Thank you for choosing us — please get in touch if there is anything you need.",
         "default_enabled": True},
        {"audience": "referrer", "channel": "email", "subject": "Settled: {client_name}",
         "body": "Hi {recipient_name},\n\nThe loan you referred for {client_name} has settled.",
         "default_enabled": True},
    ]},
    {"stage_key": "af_declined", "title": "Declined", "mapped_status": "rejected", "team": None, "color": "destructive"},
    {"stage_key": "af_not_proceeding", "title": "Not Proceeding", "mapped_status": "not_proceeding", "team": None, "color": "muted-foreground"},
]

# Home-loan and commercial desks keep the plain status board until their own
# stage lists arrive; add them here and they seed the same way.
BOARD_STAGE_TEMPLATES: dict[str, list[dict]] = {
    "asset_finance": ASSET_FINANCE_STAGES,
}
