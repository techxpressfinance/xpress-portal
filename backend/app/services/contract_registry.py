"""One live contract per VIN, per serial number and per PPSR charge.

Every commitment schedule line (`LendingHistoryEntry`) is a contract. A VIN,
serial / hull number or PPSR charge number can sit on only one *active* contract in a tenant: when it
turns up on another — the asset refinanced, sold to someone else, or the loan
paid out and re-financed — the previous contract is either marked paid off /
sold / refinanced (with notes, linked to the contract that took over) or the
desk explicitly keeps both active.

The check runs only for identifiers *newly* put on a contract, so a pair the
desk chose to keep doesn't re-warn on every later save. Matching is
tenant-wide — the same truck can move between clients — and exact after
normalising (spaces dropped, uppercased), one VIN or serial per line.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.lending_history_entry import LendingHistoryEntry

CLOSURE_STATUSES: dict[str, str] = {
    "paid_off": "Paid off",
    "sold": "Sold",
    "refinanced": "Refinanced",
}


def _clean(value: Optional[str]) -> str:
    return "".join((value or "").split()).upper()


def vins_of(value: Optional[str]) -> set[str]:
    return {v for v in (_clean(line) for line in (value or "").splitlines()) if v}


def ppsr_of(value: Optional[str]) -> Optional[str]:
    return _clean(value) or None


def asset_ids_of(vin: Optional[str], serial_numbers: Optional[str]) -> set[str]:
    """Every asset identifier on a line, labelled as the warning names it
    ("VIN …", "Serial …") — so a VIN and a serial that happen to read the same
    are not mistaken for one asset."""
    return {f"VIN {v}" for v in vins_of(vin)} | {f"Serial {v}" for v in vins_of(serial_numbers)}


def identifiers(entry: LendingHistoryEntry) -> tuple[set[str], Optional[str]]:
    return asset_ids_of(entry.vin, entry.serial_numbers), ppsr_of(entry.ppsr_charge_number)


def holder_label(entry: LendingHistoryEntry) -> str:
    if entry.organization is not None:
        return entry.organization.name or "Entity"
    if entry.contact is not None:
        c = entry.contact
        name = " ".join(p for p in (getattr(c, "first_name", None), getattr(c, "last_name", None)) if p)
        return name or getattr(c, "full_name", None) or getattr(c, "email", None) or "Contact"
    return "—"


def describe(entry: LendingHistoryEntry, matched: Optional[list[str]] = None) -> dict:
    """A contract as the duplicate warning and closed list name it."""
    return {
        "id": entry.id,
        "holder_type": "organization" if entry.organization_id else "contact",
        "holder_id": entry.organization_id or entry.contact_id,
        "holder_name": holder_label(entry),
        "lender_name": entry.lender_name,
        "contract_number": entry.identifier,
        "settled_date": entry.start_date,
        "amount": entry.amount,
        "ours": bool(entry.application_id),
        "matched": matched or [],
    }


def _active_with_identifiers(db: Session, tenant_id: str, exclude_ids: Iterable[str] = ()) -> list[LendingHistoryEntry]:
    q = db.query(LendingHistoryEntry).filter(
        LendingHistoryEntry.tenant_id == tenant_id,
        LendingHistoryEntry.closure_status.is_(None),
        or_(
            LendingHistoryEntry.vin.isnot(None),
            LendingHistoryEntry.serial_numbers.isnot(None),
            LendingHistoryEntry.ppsr_charge_number.isnot(None),
        ),
    )
    exclude = [i for i in exclude_ids if i]
    if exclude:
        q = q.filter(LendingHistoryEntry.id.notin_(exclude))
    return q.all()


def find_conflicts(
    db: Session, tenant_id: str, vins: set[str], ppsr: Optional[str], exclude_id: Optional[str] = None,
) -> list[tuple[LendingHistoryEntry, list[str]]]:
    """Active contracts (other than `exclude_id`) carrying any of these identifiers."""
    if not vins and not ppsr:
        return []
    out = []
    for other in _active_with_identifiers(db, tenant_id, [exclude_id] if exclude_id else []):
        o_vins, o_ppsr = identifiers(other)
        matched = sorted(vins & o_vins)
        if ppsr and o_ppsr == ppsr:
            matched.append(f"PPSR charge {ppsr}")
        if matched:
            out.append((other, matched))
    return out


def duplicate_index(db: Session, tenant_id: str) -> dict[str, list[tuple[LendingHistoryEntry, list[str]]]]:
    """For every active contract, the other active contracts it shares a VIN or
    PPSR charge with — one pass, for flagging rows on the schedule."""
    entries = _active_with_identifiers(db, tenant_id)
    by_key: dict[str, list[LendingHistoryEntry]] = {}
    labels: dict[str, str] = {}
    for e in entries:
        vins, ppsr = identifiers(e)
        for v in vins:
            by_key.setdefault(v, []).append(e)
            labels[v] = v
        if ppsr:
            by_key.setdefault(f"ppsr:{ppsr}", []).append(e)
            labels[f"ppsr:{ppsr}"] = f"PPSR charge {ppsr}"
    result: dict[str, dict[str, tuple[LendingHistoryEntry, list[str]]]] = {}
    for key, group in by_key.items():
        if len(group) < 2:
            continue
        for e in group:
            for other in group:
                if other.id == e.id:
                    continue
                slot = result.setdefault(e.id, {}).setdefault(other.id, (other, []))
                slot[1].append(labels[key])
    return {eid: list(others.values()) for eid, others in result.items()}


def close(entry: LendingHistoryEntry, status: str, notes: Optional[str], user_id: str,
          superseded_by_id: Optional[str] = None) -> None:
    if status not in CLOSURE_STATUSES:
        raise ValueError(f"Unknown closure status: {status}")
    entry.closure_status = status
    entry.closure_notes = (notes or "").strip() or None
    entry.closed_at = datetime.now(timezone.utc)
    entry.closed_by_user_id = user_id
    entry.superseded_by_id = superseded_by_id


def reopen(entry: LendingHistoryEntry) -> None:
    entry.closure_status = None
    entry.closure_notes = None
    entry.closed_at = None
    entry.closed_by_user_id = None
    entry.superseded_by_id = None
