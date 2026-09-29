from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.decline_reason import DEFAULT_DECLINE_REASONS, DeclineReason
from app.models.user import User
from app.schemas.application_note import DeclineReasonCreate, DeclineReasonOut, DeclineReasonUpdate
from app.services.activity_log import log_activity
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/decline-reasons", tags=["decline-reasons"])


def _ensure_seeded(db: Session, tenant_id: str) -> None:
    """Give a tenant the default tags the first time its list is read."""
    if db.query(DeclineReason.id).filter(DeclineReason.tenant_id == tenant_id).first():
        return
    for i, label in enumerate(DEFAULT_DECLINE_REASONS):
        db.add(DeclineReason(tenant_id=tenant_id, label=label, sort_order=i))
    db.commit()


def _clean_label(label: str) -> str:
    cleaned = " ".join(label.split())
    if not cleaned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A reason needs a name")
    if len(cleaned) > 100:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Keep the reason under 100 characters")
    return cleaned


def _check_unique(db: Session, tenant_id: str, label: str, exclude_id: str | None = None) -> None:
    query = db.query(DeclineReason.id).filter(
        DeclineReason.tenant_id == tenant_id, func.lower(DeclineReason.label) == label.lower()
    )
    if exclude_id:
        query = query.filter(DeclineReason.id != exclude_id)
    if query.first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f'"{label}" is already a reason')


@router.get("", response_model=list[DeclineReasonOut])
def list_decline_reasons(
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Every reason, retired ones included — old notes still show theirs. The
    picker offers only the active ones."""
    _ensure_seeded(db, tenant_id)
    return (
        db.query(DeclineReason)
        .filter(DeclineReason.tenant_id == tenant_id)
        .order_by(DeclineReason.sort_order.asc(), DeclineReason.label.asc())
        .all()
    )


@router.post("", response_model=DeclineReasonOut, status_code=status.HTTP_201_CREATED)
def create_decline_reason(
    data: DeclineReasonCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    _ensure_seeded(db, tenant_id)
    label = _clean_label(data.label)
    _check_unique(db, tenant_id, label)
    last = db.query(func.max(DeclineReason.sort_order)).filter(DeclineReason.tenant_id == tenant_id).scalar()
    reason = DeclineReason(tenant_id=tenant_id, label=label, sort_order=(last or 0) + 1)
    db.add(reason)
    db.flush()
    log_activity(db, current_user.id, "decline_reason_added", "decline_reason", reason.id, {"label": label}, tenant_id=tenant_id)
    db.commit()
    db.refresh(reason)
    return reason


@router.patch("/{reason_id}", response_model=DeclineReasonOut)
def update_decline_reason(
    reason_id: str,
    data: DeclineReasonUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Rename, reorder, retire or restore. There is no delete: notes filed under
    a reason keep it, so a renamed reason renames it on those notes too."""
    reason = db.query(DeclineReason).filter(DeclineReason.id == reason_id, DeclineReason.tenant_id == tenant_id).first()
    if not reason:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reason not found")
    changes: dict = {}
    if data.label is not None:
        label = _clean_label(data.label)
        _check_unique(db, tenant_id, label, exclude_id=reason.id)
        changes["label"] = [reason.label, label]
        reason.label = label
    if data.sort_order is not None:
        reason.sort_order = data.sort_order
    if data.is_active is not None:
        changes["is_active"] = data.is_active
        reason.is_active = data.is_active
    if changes:
        log_activity(db, current_user.id, "decline_reason_updated", "decline_reason", reason.id, changes, tenant_id=tenant_id)
    db.commit()
    db.refresh(reason)
    return reason
