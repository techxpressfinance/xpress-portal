from __future__ import annotations

from fastapi import HTTPException, status

from app.models.loan_application import LoanApplication
from app.models.user import User, UserRole


def check_application_access(app: LoanApplication, current_user: User, *, db=None) -> None:
    """Raise 403 if the current user doesn't have access to this application.

    Rules: admin/broker=every application in the tenant, client=own only,
    referrer=referred clients only.
    """
    # Brokers see every application in their tenant. Broker assignment drives
    # attribution, workload and notifications — it is deliberately NOT an access
    # boundary. Callers still scope by tenant_id; that is the only wall here.
    if current_user.role in (UserRole.admin, UserRole.broker):
        return
    if current_user.role == UserRole.client:
        if app.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        # Not yet released by the broker — invisible to the client until invited.
        if getattr(app, "hidden_from_client", False):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
        return
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
