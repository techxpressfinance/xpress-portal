from __future__ import annotations

from app.models.loan_application import LoanApplication


def app_with_user(app: LoanApplication) -> dict:
    """Build response dict with user info and assigned brokers list."""
    data = {c.name: getattr(app, c.name) for c in app.__table__.columns}
    if app.user:
        data["user_name"] = app.user.full_name
        data["user_email"] = app.user.email
    # Backward compat: first assigned broker populates the legacy fields
    if app.brokers:
        data["assigned_broker_id"] = app.brokers[0].id
        data["assigned_broker_name"] = app.brokers[0].full_name
    else:
        data["assigned_broker_id"] = None
        data["assigned_broker_name"] = None
    data["assigned_brokers"] = [{"id": b.id, "full_name": b.full_name} for b in app.brokers]
    # Completion info
    if app.completed_by:
        data["completed_by_name"] = app.completed_by.full_name
    else:
        data["completed_by_name"] = None
    return data
