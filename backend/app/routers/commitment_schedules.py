from __future__ import annotations

import re
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.contact import Contact
from app.models.lending_history_entry import LendingHistoryEntry, RepaymentFrequency
from app.models.user import User
from app.schemas.lending_history import CommitmentLineCreate, CommitmentLineUpdate, ContractClosure, PreviousContractClosure
from app.services import commitment_schedule as schedules
from app.services import contract_registry as registry
from app.services.activity_log import log_activity
from app.services.tenant_scope import get_tenant_id
from app.services.vin import NOTES_REQUIRED_MESSAGE

router = APIRouter(prefix="/api/commitment-schedules", tags=["commitment-schedules"])


# ── Contracts (tenant-wide, any holder) ──────────────────────────────
# Declared before the holder routes so "contracts" is never read as a holder type.

def _get_contract(db: Session, line_id: str, tenant_id: str) -> LendingHistoryEntry:
    entry = db.query(LendingHistoryEntry).filter(
        LendingHistoryEntry.id == line_id, LendingHistoryEntry.tenant_id == tenant_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Contract not found")
    return entry


@router.post("/contracts/{line_id}/close")
def close_contract(
    line_id: str,
    data: ContractClosure,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Mark a contract paid off / sold / refinanced. It leaves its holder's
    schedule totals and exports, and frees its VIN/PPSR for another contract."""
    entry = _get_contract(db, line_id, tenant_id)
    registry.close(entry, data.status, data.notes, current_user.id)
    log_activity(db, current_user.id, "contract_closed", "lending_history_entry", entry.id,
                 {"status": data.status, "lender": entry.lender_name}, tenant_id=tenant_id)
    db.commit()
    return registry.describe(entry)


@router.post("/contracts/{line_id}/reopen")
def reopen_contract(
    line_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    entry = _get_contract(db, line_id, tenant_id)
    registry.reopen(entry)
    log_activity(db, current_user.id, "contract_reopened", "lending_history_entry", entry.id,
                 {"lender": entry.lender_name}, tenant_id=tenant_id)
    db.commit()
    return registry.describe(entry)


def _resolve_duplicates(
    db: Session, entry: LendingHistoryEntry, before: tuple[set[str], str | None],
    closures: list[PreviousContractClosure] | None, keep: bool, user_id: str, tenant_id: str,
) -> None:
    """Enforce one live contract per VIN / PPSR charge for identifiers newly on
    this contract. Unanswered duplicates come back as a 409 the UI turns into
    the "mark the previous contract" warning; nothing is saved until answered."""
    vins, ppsr = registry.identifiers(entry)
    old_vins, old_ppsr = before
    new_vins = vins - old_vins
    new_ppsr = ppsr if ppsr and ppsr != old_ppsr else None
    conflicts = registry.find_conflicts(db, tenant_id, new_vins, new_ppsr, exclude_id=entry.id)
    if not conflicts:
        return
    by_id = {other.id: other for other, _ in conflicts}
    answered = {c.line_id: c for c in closures or [] if c.line_id in by_id}
    unanswered = [(o, m) for o, m in conflicts if o.id not in answered]
    if unanswered and not keep:
        db.rollback()
        raise HTTPException(status_code=409, detail={
            "code": "duplicate_contract",
            "message": "This VIN, serial number or PPSR charge is already on another active contract.",
            "conflicts": [jsonable_encoder(registry.describe(o, m)) for o, m in conflicts],
        })
    for line_id, closure in answered.items():
        other = by_id[line_id]
        registry.close(other, closure.status, closure.notes, user_id, superseded_by_id=entry.id)
        log_activity(db, user_id, "contract_closed", "lending_history_entry", other.id,
                     {"status": closure.status, "lender": other.lender_name, "superseded_by": entry.id},
                     tenant_id=tenant_id)
    if unanswered:
        log_activity(db, user_id, "contract_duplicate_kept", "lending_history_entry", entry.id,
                     {"others": [o.id for o, _ in unanswered]}, tenant_id=tenant_id)


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
    view: Optional[str] = Query(None, max_length=20),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    holder = schedules.get_holder(db, holder_type, holder_id, tenant_id)
    view_key = schedules.parse_view(view)
    keys = schedules.parse_columns(columns, view_key)
    content = schedules.to_xlsx(schedules.build(db, holder, tenant_id), keys, view_key)
    log_activity(db, current_user.id, "commitment_schedule_downloaded", holder_type, holder.id,
                 {"format": "xlsx", "view": view_key, "columns": keys}, tenant_id=tenant_id)
    db.commit()
    safe = re.sub(r"[^\w\s-]", "", schedules.holder_name(holder)).strip().replace(" ", "-") or "schedule"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{"PPSR" if view_key == "ppsr" else "Commitment"}-Schedule-{safe}.xlsx"'},
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
    # A serial number says little on its own: it needs the asset notes.
    if entry.serial_numbers and not entry.identifier_notes:
        raise HTTPException(status_code=400, detail=NOTES_REQUIRED_MESSAGE)


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
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        lender_name=data.lender_name.strip(),
        amount=data.amount,
        **({"contact_id": holder.id} if isinstance(holder, Contact) else {"organization_id": holder.id}),
    )
    _apply(entry, data.model_dump(exclude_unset=True, exclude={"close_previous", "keep_duplicates"}))
    db.add(entry)
    _resolve_duplicates(db, entry, (set(), None), data.close_previous, data.keep_duplicates, current_user.id, tenant_id)
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
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    holder = schedules.get_holder(db, holder_type, holder_id, tenant_id)
    entry = _get_line(db, holder, line_id, tenant_id)
    before = registry.identifiers(entry)
    _apply(entry, data.model_dump(exclude_unset=True, exclude={"close_previous", "keep_duplicates"}))
    if not entry.closure_status:
        _resolve_duplicates(db, entry, before, data.close_previous, data.keep_duplicates, current_user.id, tenant_id)
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
