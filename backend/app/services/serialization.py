from __future__ import annotations

from app.database import SessionLocal
from app.models.external_referral import ExternalReferral
from app.models.loan_application import LoanApplication
from app.models.referral import Referral


def app_with_user(app: LoanApplication) -> dict:
    """Build response dict with user info and assigned brokers list."""
    data = {c.name: getattr(app, c.name) for c in app.__table__.columns}
    if app.user:
        data["user_name"] = app.user.full_name
        data["user_email"] = app.user.email
        data["user_role"] = app.user.role.value
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
    # Referrer info
    referrer_info = None
    if app.user and app.user.role.value == "referrer":
        referrer_info = {
            "id": app.user.id,
            "full_name": app.user.full_name,
            "email": app.user.email,
            "phone": app.user.phone,
            "organization_name": getattr(app.user, "organization_name", None),
        }
    elif app.user:
        db = SessionLocal()
        try:
            ext_ref = db.query(ExternalReferral).filter(
                ExternalReferral.referred_client_id == app.user_id,
            ).first()
            if ext_ref and ext_ref.referrer:
                referrer_info = {
                    "id": ext_ref.referrer.id,
                    "full_name": ext_ref.referrer.full_name,
                    "email": ext_ref.referrer.email,
                    "phone": ext_ref.referrer.phone,
                    "organization_name": getattr(ext_ref.referrer, "organization_name", None),
                }
            else:
                ref = db.query(Referral).filter(
                    Referral.referred_user_id == app.user_id,
                ).first()
                if ref and ref.referrer:
                    referrer_info = {
                        "id": ref.referrer.id,
                        "full_name": ref.referrer.full_name,
                        "email": ref.referrer.email,
                        "phone": ref.referrer.phone,
                        "organization_name": getattr(ref.referrer, "organization_name", None),
                    }
        finally:
            db.close()
    data["referrer"] = referrer_info
    return data
