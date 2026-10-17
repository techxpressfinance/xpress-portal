from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.contact import Contact
from app.models.lending_history_entry import LendingHistoryEntry, RepaymentFrequency
from app.models.user import User
from app.schemas.lending_history import CommitmentLineCreate, CommitmentLineUpdate
from app.services import commitment_schedule as schedules
from app.services.activity_log import log_activity
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/commitment-schedules", tags=["commitment-schedules"])

@router.get("/{holder_type}/{holder_id}")
def get_schedule(
    holder_type: str,
    holder_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    holder = schedules.get_holder(db, holder_type, holder_id, tenant_id)
    return schedules.build(db, holder, tenant_id)


@router.get("/{holder_type}/{holder_id}/xlsx")
def download_schedule_xlsx(
    holder_type: str,
    holder_id: str,
    columns: Optional[str] = Query(None, max_length=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    holder = schedules.get_holder(db, holder_type, holder_id, tenant_id)
    keys = schedules.parse_columns(columns)
    content = schedules.to_xlsx(schedules.build(db, holder, tenant_id), keys)
    log_activity(db, current_user.id, "commitment_schedule_downloaded", holder_type, holder.id,
                 {"format": "xlsx", "columns": keys}, tenant_id=tenant_id)
    db.commit()
    safe = re.sub(r"[^\w\s-]", "", schedules.holder_name(holder)).strip().replace(" ", "-") or "schedule"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="Commitment-Schedule-{safe}.xlsx"'},
    )


def _apply(entry: LendingHistoryEntry, payload: dict) -> None:
    if "repayment_frequency" in payload:
        freq = payload.pop("repayment_frequency")
        entry.repayment_frequency = RepaymentFrequency(freq) if freq else None
    for key, value in payload.items():
        if key not in schedules.EDITABLE_FIELDS:
            continue
        if isinstance(value, str):
            value = value.strip() or None
        if key in ("lender_name", "amount") and value is None:
            continue
        setattr(entry, key, value)
    # A term and settled date with no end date work it out.
    if entry.end_date is None and entry.start_date and entry.term_months:
        entry.end_date = schedules._add_months(entry.start_date, entry.term_months)


@router.post("/{holder_type}/{holder_id}/lines", status_code=status.HTTP_201_CREATED)
def add_other_commitment(
    holder_type: str,
    holder_id: str,
    data: CommitmentLineCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """A commitment held elsewhere. Our own loans come from settled deals."""
    holder = schedules.get_holder(db, holder_type, holder_id, tenant_id)
    entry = LendingHistoryEntry(
        tenant_id=tenant_id,
        lender_name=data.lender_name.strip(),
        amount=data.amount,
        **({"contact_id": holder.id} if isinstance(holder, Contact) else {"organization_id": holder.id}),
    )
    _apply(entry, data.model_dump(exclude_unset=True))
    db.add(entry)
    log_activity(db, current_user.id, "commitment_added", holder_type, holder.id,
                 {"lender": entry.lender_name, "amount": entry.amount}, tenant_id=tenant_id)
    db.commit()
    return schedules.build(db, holder, tenant_id)


def _get_line(db: Session, holder, line_id: str, tenant_id: str) -> LendingHistoryEntry:
    entry = db.query(LendingHistoryEntry).filter(
        LendingHistoryEntry.id == line_id,
        LendingHistoryEntry.tenant_id == tenant_id,
        schedules._holder_filter(holder),
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Line not found")
    return entry


@router.patch("/{holder_type}/{holder_id}/lines/{line_id}")
def update_line(
    holder_type: str,
    holder_id: str,
    line_id: str,
    data: CommitmentLineUpdate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    holder = schedules.get_holder(db, holder_type, holder_id, tenant_id)
    entry = _get_line(db, holder, line_id, tenant_id)
    _apply(entry, data.model_dump(exclude_unset=True))
    db.commit()
    return schedules.build(db, holder, tenant_id)


@router.delete("/{holder_type}/{holder_id}/lines/{line_id}")
def delete_line(
    holder_type: str,
    holder_id: str,
    line_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    holder = schedules.get_holder(db, holder_type, holder_id, tenant_id)
    entry = _get_line(db, holder, line_id, tenant_id)
    if entry.application_id:
        # It would only come back on the next draw — the deal is still settled.
        raise HTTPException(status_code=400, detail="A loan we arranged comes from its settled deal and can't be removed — correct it instead.")
    log_activity(db, current_user.id, "commitment_removed", holder_type, holder.id,
                 {"lender": entry.lender_name, "amount": entry.amount}, tenant_id=tenant_id)
    db.delete(entry)
    db.commit()
    return schedules.build(db, holder, tenant_id)
