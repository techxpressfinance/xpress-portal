from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import or_

from app.models.application_broker import ApplicationBroker
from app.models.loan_application import ApplicationStatus, LoanApplication
from app.models.user import User, UserRole


def broker_application_filter(db, broker_id: str, tenant_id: str):
    """SQL filter for the applications a broker may see.

    Either assigned to them, or unclaimed work any broker in the tenant can pick
    up: drafts, referrer-submitted leads, their own leads, and applications with
    no assigned broker at all. Without the last clause, admin-created and
    client-submitted applications are visible to nobody but an admin.

    Keep in sync with the broker branch of check_application_access below.
    """
    return or_(
        LoanApplication.id.in_(
            db.query(ApplicationBroker.application_id).filter(
                ApplicationBroker.broker_id == broker_id
            )
        ),
        LoanApplication.user_id.in_(
            db.query(User.id).filter(
                User.role == UserRole.referrer, User.tenant_id == tenant_id
            )
        ),
        LoanApplication.user_id == broker_id,
        LoanApplication.status == ApplicationStatus.draft,
        ~LoanApplication.id.in_(db.query(ApplicationBroker.application_id)),
    )


def check_application_access(app: LoanApplication, current_user: User, *, db=None) -> None:
    """Raise 403 if the current user doesn't have access to this application.

    Rules: admin=always, client=own only, broker=assigned only, referrer=referred clients only.
    """
    if current_user.role == UserRole.admin:
        return
    if current_user.role == UserRole.client:
        if app.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        # Not yet released by the broker — invisible to the client until invited.
        if getattr(app, "hidden_from_client", False):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
        return
    if current_user.role == UserRole.broker:
        # All drafts are visible to every broker in the tenant
        if app.status.value == "draft":
            return
        # Broker-created leads (submitted directly without a client)
        if app.user_id == current_user.id:
            return
        if any(b.id == current_user.id for b in app.brokers):
            return
        # Unclaimed: no broker assigned at all, so any broker may pick it up.
        if not app.brokers:
            return
        # Referrer-submitted leads are visible to all brokers
        if db is not None:
            owner = db.query(User).filter(User.id == app.user_id).first()
            if owner and owner.role == UserRole.referrer:
                return
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not assigned to this application")
    if current_user.role == UserRole.referrer:
        # Allow access to leads submitted directly by this referrer
        if app.user_id == current_user.id:
            return
        if db is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        from app.models.external_referral import ExternalReferral
        referral = (
            db.query(ExternalReferral)
            .filter(
                ExternalReferral.referrer_id == current_user.id,
                ExternalReferral.referred_client_id == app.user_id,
            )
            .first()
        )
        if not referral:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        return
