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

DEFAULT_KANBAN_COLUMNS = [
    {"title": "Draft", "mapped_status": "draft", "position": 0, "color": "muted-foreground"},
    {"title": "Application Received", "mapped_status": "application_received", "position": 1, "color": "primary"},
    {"title": "Application Assessed", "mapped_status": "application_assessed", "position": 2, "color": "chart-4"},
    {"title": "Submitted", "mapped_status": "submitted", "position": 3, "color": "chart-2"},
    {"title": "Approval", "mapped_status": "approval", "position": 4, "color": "chart-5"},
    {"title": "Settled", "mapped_status": "settled", "position": 5, "color": "success"},
    {"title": "Rejected", "mapped_status": "rejected", "position": 6, "color": "destructive"},
]
