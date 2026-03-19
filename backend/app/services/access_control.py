from __future__ import annotations

from fastapi import HTTPException, status

from app.models.loan_application import LoanApplication
from app.models.user import User, UserRole


def check_application_access(app: LoanApplication, current_user: User) -> None:
    """Raise 403 if the current user doesn't have access to this application.

    Rules: admin=always, client=own only, broker=assigned only.
    """
    if current_user.role == UserRole.admin:
        return
    if current_user.role == UserRole.client:
        if app.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        return
    if current_user.role == UserRole.broker and not any(b.id == current_user.id for b in app.brokers):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not assigned to this application")
