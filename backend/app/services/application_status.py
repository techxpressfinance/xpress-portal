from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.constants import VALID_TRANSITIONS
from app.models.kanban import ApplicationStagePlacement, KanbanColumn
from app.models.loan_application import ApplicationStatus, LoanApplication
from app.models.user import User, UserRole
from app.services.activity_log import log_activity
from app.services.approval_conditions import add_conditions, ensure_condition_tasks
from app.services.email import send_status_notification
from app.services.notification_service import create_notification


def change_application_status(
    db: Session,
    application: LoanApplication,
    new_status: ApplicationStatus,
    actor_id: str,
    tenant_id: Optional[str],
    *,
    lender_name: Optional[str] = None,
    conditions: Optional[list[str]] = None,
    enforce_transitions: bool = True,
) -> None:
    """Transition an application to a new status, with the same validation and
    side-effects as the /applications/{id}/status endpoint (transition rules,
    settled_at stamping, activity log, client notification).

    Shared by the status endpoint and the kanban board so a card move and a
    status change are always the same operation.

    `enforce_transitions=False` skips the transition table: a board whose stages
    roll up to statuses in a different order (see BOARD_STAGE_TEMPLATES) can move
    a card between adjacent stages that VALID_TRANSITIONS would reject. The
    approval requirements below still apply either way.

    Entering Approval requires a lender name and at least one condition. The
    conditions are MERGED into whatever the application already carries — never
    replaced — so ticked-off state and conditions the team added themselves
    survive a re-entry. Each broker on the application gets (or keeps) an
    approval-conditions task whose checklist mirrors the panel — see
    services/approval_conditions.py.
    """
    current = application.status.value
    allowed = VALID_TRANSITIONS.get(current, [])
    if enforce_transitions and new_status.value not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot transition from '{current}' to '{new_status.value}'. Allowed: {allowed}",
        )

    if new_status == ApplicationStatus.approval:
        clean_conditions = [c.strip() for c in (conditions or []) if c.strip()]
        if not lender_name or not lender_name.strip() or not clean_conditions:
            raise HTTPException(
                status_code=400,
                detail="Lender name and at least one approval condition are required to move to Approval.",
            )
        application.approval_lender_name = lender_name.strip()
        # Merge, never replace. An application can enter Approval more than once
        # (a board may carry several stages that roll up to it), and wiping the
        # list would throw away every condition the team had already ticked off
        # or added since. add_conditions skips duplicates and keeps the tasks.
        add_conditions(db, application, clean_conditions, actor_id, tenant_id)
        ensure_condition_tasks(db, application, actor_id, tenant_id)

    application.status = new_status
    # A status set from outside the board (the application detail page, an
    # import) must not leave the card parked at a stage belonging to the old
    # status. Drop those placements so the card falls back to the first stage
    # for its new status; placements already consistent with it are kept, which
    # is what makes a kanban move — placement first, then this — a no-op here.
    # The session runs with autoflush off, so a placement the caller has just
    # written is still pending here — flush first or this reads the pre-move
    # stage and deletes the row the caller is mid-update on.
    db.flush()
    for placement in (
        db.query(ApplicationStagePlacement)
        .join(KanbanColumn, KanbanColumn.id == ApplicationStagePlacement.column_id)
        .filter(
            ApplicationStagePlacement.application_id == application.id,
            KanbanColumn.mapped_status != new_status.value,
        )
        .all()
    ):
        db.delete(placement)
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
