from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.models.approval_condition import ApprovalCondition
from app.models.loan_application import LoanApplication
from app.models.task import ChecklistItem, Task, TaskPriority, TaskStatus


def _normalize(text: str) -> str:
    """Match key for a condition — conditions arriving from a lender twice, once
    with different spacing or casing, are the same condition."""
    return " ".join(text.split()).casefold()


def sync_condition_completion(db: Session, condition_id: str, is_completed: bool, actor_id: Optional[str] = None) -> None:
    """Keep an ApprovalCondition and every ChecklistItem mirroring it (one per
    broker's auto-generated approval-conditions task) in sync, so toggling
    either the application's approval panel or a broker's task checklist
    reflects on the other."""
    now = datetime.now(timezone.utc).replace(tzinfo=None) if is_completed else None
    db.query(ApprovalCondition).filter(ApprovalCondition.id == condition_id).update({
        "is_completed": is_completed,
        "completed_at": now,
        "completed_by_id": actor_id if is_completed else None,
    })
    db.query(ChecklistItem).filter(ChecklistItem.approval_condition_id == condition_id).update({"is_completed": is_completed})


def condition_tasks(db: Session, application_id: str) -> list[Task]:
    return (
        db.query(Task)
        .filter(Task.application_id == application_id, Task.is_approval_conditions_task.is_(True))
        .all()
    )


def ensure_condition_tasks(
    db: Session,
    application: LoanApplication,
    actor_id: str,
    tenant_id: Optional[str],
) -> list[Task]:
    """One approval-conditions task per broker on the application, created on
    demand and reused thereafter. Reused rather than recreated so a broker's
    task history, comments and attachments survive an application re-entering
    Approval."""
    existing = {t.assigned_to_id: t for t in condition_tasks(db, application.id)}
    broker_ids = [b.id for b in application.brokers] or (
        [application.assigned_broker_id] if application.assigned_broker_id else []
    )
    title = f"Approval conditions – {application.approval_lender_name}" if application.approval_lender_name else "Approval conditions"

    tasks = []
    for broker_id in broker_ids:
        task = existing.get(broker_id)
        if task is None:
            task = Task(
                title=title,
                status=TaskStatus.todo,
                priority=TaskPriority.high,
                assigned_to_id=broker_id,
                application_id=application.id,
                created_by_id=actor_id,
                tenant_id=tenant_id,
                is_approval_conditions_task=True,
            )
            db.add(task)
            db.flush()
        else:
            task.title = title
        tasks.append(task)
    return tasks


def mirror_condition_to_tasks(
    db: Session,
    application: LoanApplication,
    condition: ApprovalCondition,
    actor_id: str,
    tenant_id: Optional[str],
) -> None:
    """Give every broker's approval-conditions task a checklist item for this
    condition, skipping tasks that already have one."""
    for task in ensure_condition_tasks(db, application, actor_id, tenant_id):
        already = any(i.approval_condition_id == condition.id for i in task.checklist_items)
        if already:
            continue
        db.add(ChecklistItem(
            task_id=task.id,
            title=condition.text,
            sort_order=condition.sort_order,
            tenant_id=tenant_id,
            approval_condition_id=condition.id,
            is_completed=condition.is_completed,
        ))


def add_conditions(
    db: Session,
    application: LoanApplication,
    texts: list[str],
    actor_id: str,
    tenant_id: Optional[str],
) -> list[ApprovalCondition]:
    """Add conditions to an application, skipping ones it already carries.

    Additive by design: the team keeps adding conditions as the lender raises
    them, and an application re-entering Approval must never lose the ones
    already ticked off. Returns only the conditions actually created."""
    existing = (
        db.query(ApprovalCondition)
        .filter(ApprovalCondition.application_id == application.id)
        .order_by(ApprovalCondition.sort_order)
        .all()
    )
    seen = {_normalize(c.text) for c in existing}
    next_order = max((c.sort_order for c in existing), default=-1) + 1

    created = []
    for raw in texts:
        text = " ".join(raw.split())
        if not text or _normalize(text) in seen:
            continue
        seen.add(_normalize(text))
        condition = ApprovalCondition(
            application_id=application.id,
            tenant_id=tenant_id,
            text=text,
            sort_order=next_order,
        )
        next_order += 1
        db.add(condition)
        created.append(condition)

    if created:
        db.flush()
        for condition in created:
            mirror_condition_to_tasks(db, application, condition, actor_id, tenant_id)
    return created


def update_condition_text(db: Session, condition: ApprovalCondition, text: str) -> None:
    condition.text = " ".join(text.split())
    db.query(ChecklistItem).filter(ChecklistItem.approval_condition_id == condition.id).update({"title": condition.text})


def delete_condition(db: Session, condition: ApprovalCondition) -> None:
    """Remove a condition and the checklist items mirroring it. The FK is
    SET NULL on delete, which would strand the items on the brokers' tasks."""
    db.query(ChecklistItem).filter(ChecklistItem.approval_condition_id == condition.id).delete(synchronize_session=False)
    db.delete(condition)
