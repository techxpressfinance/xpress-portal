from __future__ import annotations

# NOTE: frontend copy at frontend/src/lib/constants.ts — keep in sync
VALID_TRANSITIONS: dict[str, list[str]] = {
    "draft": ["submitted", "reviewing", "approved", "rejected"],
    "submitted": ["draft", "reviewing", "approved", "rejected"],
    "reviewing": ["draft", "submitted", "approved", "rejected"],
    "approved": ["draft", "submitted", "reviewing", "rejected"],
    "rejected": ["draft", "submitted", "reviewing", "approved"],
}

DEFAULT_KANBAN_COLUMNS = [
    {"title": "Draft", "mapped_status": "draft", "position": 0, "color": "muted-foreground"},
    {"title": "Submitted", "mapped_status": "submitted", "position": 1, "color": "primary"},
    {"title": "Reviewing", "mapped_status": "reviewing", "position": 2, "color": "chart-4"},
    {"title": "Approved", "mapped_status": "approved", "position": 3, "color": "success"},
    {"title": "Rejected", "mapped_status": "rejected", "position": 4, "color": "destructive"},
]
