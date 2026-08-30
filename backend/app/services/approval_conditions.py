from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.approval_condition import ApprovalCondition
from app.models.task import ChecklistItem


def sync_condition_completion(db: Session, condition_id: str, is_completed: bool) -> None:
    """Keep an ApprovalCondition and every ChecklistItem mirroring it (one per
    broker's auto-generated approval-conditions task) in sync, so toggling
    either the application's approval panel or a broker's task checklist
    reflects on the other."""
    db.query(ApprovalCondition).filter(ApprovalCondition.id == condition_id).update({"is_completed": is_completed})
    db.query(ChecklistItem).filter(ChecklistItem.approval_condition_id == condition_id).update({"is_completed": is_completed})
