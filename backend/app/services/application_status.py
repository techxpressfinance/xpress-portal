from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.constants import VALID_TRANSITIONS
from app.models.loan_application import ApplicationStatus, LoanApplication
from app.models.user import User, UserRole
from app.services.activity_log import log_activity
from app.services.email import send_status_notification
from app.services.notification_service import create_notification


def change_application_status(
    db: Session,
    application: LoanApplication,
    new_status: ApplicationStatus,
    actor_id: str,
    tenant_id: Optional[str],
) -> None:
    """Transition an application to a new status, with the same validation and
    side-effects as the /applications/{id}/status endpoint (transition rules,
    settled_at stamping, activity log, client notification).

    Shared by the status endpoint and the kanban board so a card move and a
    status change are always the same operation.
    """
    current = application.status.value
    allowed = VALID_TRANSITIONS.get(current, [])
    if new_status.value not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot transition from '{current}' to '{new_status.value}'. Allowed: {allowed}",
        )

    application.status = new_status
    if new_status == ApplicationStatus.settled and application.settled_at is None:
        application.settled_at = datetime.now(timezone.utc).replace(tzinfo=None)
    log_activity(
        db,
        actor_id,
        "status_changed",
        "application",
        application.id,
        {"from": current, "to": new_status.value},
        tenant_id=tenant_id,
    )
    db.commit()

    client = db.query(User).filter(User.id == application.user_id).first()
    if client and client.role == UserRole.client and not client.email.endswith("@deleted.invalid"):
        send_status_notification(client.email, client.full_name, application.loan_type.value, new_status.value)
        if client.phone:
            from app.services.sms import send_status_sms

            send_status_sms(client.phone, new_status.value)
        create_notification(
            db,
            user_id=client.id,
            type="status_change",
            title=f"Application {new_status.value.replace('_', ' ')}",
            body=f"Your {application.loan_type.value} application has been updated to: {new_status.value.replace('_', ' ')}",
            link=f"/applications/{application.id}",
            tenant_id=tenant_id,
        )
        db.commit()
    elif application.applicant_email:
        applicant_name = " ".join(filter(None, [application.applicant_first_name, application.applicant_last_name])) or "Applicant"
        send_status_notification(application.applicant_email, applicant_name, application.loan_type.value, new_status.value)
