from __future__ import annotations

from fastapi import HTTPException, status

from app.models.loan_application import LoanApplication
from app.models.user import User, UserRole


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
