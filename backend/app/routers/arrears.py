"""Arrears book — one row per contract in arrears, for admins and brokers.

Two read modes share the same shape:
  * live      — records as they stand today, day counts recomputed on read
  * historical— a completed month replayed from ArrearsSnapshot, so a report
                issued for March still says exactly what March said

Client/company search can't use SQL LIKE on contact names (encrypted at rest),
so it scores against the decrypted-fields cache the same way contacts.py does,
and ORs the resulting ids with plain LIKE matches on the unencrypted contract
columns.
"""
from __future__ import annotations

import os
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.middleware.rate_limit import RateLimiter
from app.models.arrears import ArrearsAttachment, ArrearsEvent, ArrearsRecord, ArrearsSnapshot
from app.models.contact import Contact, Organization
from app.models.lender import Lender
from app.models.loan_application import LoanApplication
from app.models.user import User
from app.schemas.arrears import (
    ArrearsBucketCount,
    ArrearsMonthSummary,
    ArrearsNoteCreate,
    ArrearsRecordCreate,
    ArrearsRecordDetailOut,
    ArrearsRecordOut,
    ArrearsRecordUpdate,
    ArrearsSummaryOut,
    PaginatedArrears,
)
from app.services.activity_log import log_activity
from app.services.arrears import (
    ARREARS_BUCKETS,
    bucket_for,
    days_in_arrears,
    month_end,
    month_start,
    previous_month,
)
from app.services.email_import import EMAIL_EXTENSIONS, parse_email
from app.services.s3_storage import delete_file, download_file, file_exists, upload_file
from app.services.scoring import score, tokenize
from app.services.search_cache import get_searchable_contacts
from app.services.tenant_scope import get_tenant_id
from app.services.upload_validation import safe_filename, validate_attachment

router = APIRouter(prefix="/api/arrears", tags=["arrears"])

attachment_upload_limiter = RateLimiter(max_requests=30, window_seconds=60)

# Cap on how many rows one PDF report may contain — the report endpoint is
# unpaginated by design, and html2pdf falls over well before this.
MAX_REPORT_ROWS = 1000


# ── Helpers ──────────────────────────────────────────────────────────────────


def _parse_month(value: str) -> date:
    """Accept 'YYYY-MM' or a full ISO date; normalise to the first of the month."""
    try:
        parsed = date.fromisoformat(value if len(value) > 7 else f"{value}-01")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid month — expected YYYY-MM")
    return month_start(parsed)


def _parse_date(value: str, label: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid {label}")


def _is_historical(month: Optional[date]) -> bool:
    """A month is replayed from snapshots only once it has finished."""
    return bool(month and month < month_start(datetime.now(timezone.utc).date()))


def _names(db: Session, records: list[ArrearsRecord]) -> tuple[dict, dict, dict]:
    """Batch-resolve contact, organization, and user display names for a page."""
    contact_ids = {r.contact_id for r in records if r.contact_id}
    org_ids = {r.organization_id for r in records if r.organization_id}
    user_ids = {r.created_by_id for r in records if r.created_by_id}

    contacts = {}
    if contact_ids:
        for c in db.query(Contact).filter(Contact.id.in_(contact_ids)).all():
            contacts[c.id] = " ".join(p for p in [c.first_name, c.last_name] if p)
    orgs = {}
    if org_ids:
        orgs = dict(db.query(Organization.id, Organization.name).filter(Organization.id.in_(org_ids)).all())
    users = {}
    if user_ids:
        users = dict(db.query(User.id, User.full_name).filter(User.id.in_(user_ids)).all())
    return contacts, orgs, users


def _serialize(
    record: ArrearsRecord,
    contacts: dict,
    orgs: dict,
    users: dict,
    as_of: Optional[date] = None,
    snapshot: Optional[ArrearsSnapshot] = None,
) -> dict:
    """Serialize one record. When `snapshot` is given the frozen month-end
    values are reported instead of today's, so historical months don't drift."""
    if snapshot is not None:
        days, bucket = snapshot.days_in_arrears, snapshot.bucket
        resolved, proof, delinquent = snapshot.resolved, snapshot.proof_of_payment_received, snapshot.delinquent
        arrears_amount = snapshot.arrears_amount
        repayment_amount = snapshot.repayment_amount
    else:
        days = days_in_arrears(record.in_arrears_since, as_of)
        bucket = bucket_for(record, as_of)
        resolved, proof, delinquent = record.resolved, record.proof_of_payment_received, record.delinquent
        arrears_amount = record.arrears_amount
        repayment_amount = record.repayment_amount

    attachments = record.attachments or []
    return {
        "id": record.id,
        "contact_id": record.contact_id,
        "contact_name": contacts.get(record.contact_id),
        "organization_id": record.organization_id,
        "organization_name": orgs.get(record.organization_id),
        "application_id": record.application_id,
        "lender_id": record.lender_id,
        "lender_name": record.lender_name,
        "contract_number": record.contract_number,
        "asset_details": record.asset_details,
        "file_type": record.file_type,
        "repayment_amount": repayment_amount,
        "repayment_frequency": record.repayment_frequency,
        "arrears_amount": arrears_amount,
        "in_arrears_since": record.in_arrears_since,
        "days_in_arrears": days,
        "bucket": bucket,
        "resolved": resolved,
        "resolved_at": record.resolved_at,
        "proof_of_payment_received": proof,
        "proof_received_at": record.proof_received_at,
        "delinquent": delinquent,
        "delinquent_at": record.delinquent_at,
        "delinquent_reason": record.delinquent_reason,
        "notes": record.notes,
        "attachment_count": sum(1 for a in attachments if a.kind != "email"),
        "email_count": sum(1 for a in attachments if a.kind == "email"),
        "created_by_name": users.get(record.created_by_id),
        "created_at": record.created_at,
        "updated_at": record.updated_at,
    }


def _log_event(
    db: Session,
    record: ArrearsRecord,
    user: User,
    event_type: str,
    detail: Optional[str] = None,
) -> None:
    """Stamp a timeline entry. Arrears records are collections evidence, so
    every change is appended here as well as applied to the record."""
    db.add(ArrearsEvent(
        tenant_id=record.tenant_id,
        arrears_record_id=record.id,
        event_type=event_type,
        detail=detail,
        created_by_id=user.id,
    ))


def _validate_links(
    db: Session,
    tenant_id: str,
    contact_id: Optional[str],
    organization_id: Optional[str],
    application_id: Optional[str],
    lender_id: Optional[str],
) -> None:
    """Reject ids that don't exist in this tenant — links are the whole point of
    the arrears book mapping onto contact/company pages."""
    if contact_id and not db.query(Contact.id).filter(
        Contact.id == contact_id, Contact.tenant_id == tenant_id
    ).first():
        raise HTTPException(status_code=404, detail="Client not found")
    if organization_id and not db.query(Organization.id).filter(
        Organization.id == organization_id, Organization.tenant_id == tenant_id
    ).first():
        raise HTTPException(status_code=404, detail="Company not found")
    if application_id and not db.query(LoanApplication.id).filter(
        LoanApplication.id == application_id, LoanApplication.tenant_id == tenant_id
    ).first():
        raise HTTPException(status_code=404, detail="Application not found")
    if lender_id and not db.query(Lender.id).filter(
        Lender.id == lender_id, Lender.tenant_id == tenant_id
    ).first():
        raise HTTPException(status_code=404, detail="Lender not found")


def _matching_contact_ids(db: Session, tenant_id: str, search: str) -> set[str]:
    """Contacts whose decrypted fields match the query (same engine as global search)."""
    tokens = tokenize(search)
    if not tokens:
        return set()
    matches = set()
    for cid, f in get_searchable_contacts(db, tenant_id).items():
        if score(tokens, [(f["full_name"], 10), (f["email"], 8), (f["phone"], 6)]) > 0:
            matches.add(cid)
    return matches


def _base_query(
    db: Session,
    tenant_id: str,
    search: Optional[str],
    file_type: Optional[str],
    resolved: Optional[bool],
    proof: Optional[bool],
    contact_id: Optional[str],
    organization_id: Optional[str],
    lender_id: Optional[str],
    date_from: Optional[str],
    date_to: Optional[str],
):
    query = db.query(ArrearsRecord).filter(ArrearsRecord.tenant_id == tenant_id)

    if contact_id:
        query = query.filter(ArrearsRecord.contact_id == contact_id)
    if organization_id:
        query = query.filter(ArrearsRecord.organization_id == organization_id)
    if lender_id:
        query = query.filter(ArrearsRecord.lender_id == lender_id)
    if file_type:
        query = query.filter(ArrearsRecord.file_type == file_type)
    if resolved is not None:
        query = query.filter(ArrearsRecord.resolved == resolved)
    if proof is not None:
        query = query.filter(ArrearsRecord.proof_of_payment_received == proof)
    if date_from:
        query = query.filter(ArrearsRecord.in_arrears_since >= _parse_date(date_from, "date_from"))
    if date_to:
        query = query.filter(ArrearsRecord.in_arrears_since <= _parse_date(date_to, "date_to"))

    if search and search.strip():
        term = search.strip()
        pattern = f"%{term}%"
        org_ids = [
            row[0]
            for row in db.query(Organization.id).filter(
                Organization.tenant_id == tenant_id, Organization.name.ilike(pattern)
            )
        ]
        contact_ids = _matching_contact_ids(db, tenant_id, term)
        clauses = [
            ArrearsRecord.lender_name.ilike(pattern),
            ArrearsRecord.contract_number.ilike(pattern),
            ArrearsRecord.asset_details.ilike(pattern),
        ]
        if contact_ids:
            clauses.append(ArrearsRecord.contact_id.in_(contact_ids))
        if org_ids:
            clauses.append(ArrearsRecord.organization_id.in_(org_ids))
        query = query.filter(or_(*clauses))

    return query


def _apply_bucket(records: list[ArrearsRecord], bucket: Optional[str], as_of: Optional[date]):
    """Bucket filtering happens in Python — the band depends on today's date and
    the delinquent flag, so it has no stable SQL expression."""
    if not bucket:
        return records
    return [r for r in records if bucket_for(r, as_of) == bucket]


def _bucket_counts(rows: list[tuple[str, Optional[Decimal], Optional[Decimal]]]) -> list[ArrearsBucketCount]:
    """rows: (bucket, arrears_amount, repayment_amount). Always returns every
    bucket, including empty ones, so the UI columns never shift around."""
    totals = {b: [0, Decimal("0"), Decimal("0")] for b in ARREARS_BUCKETS}
    for bucket, arrears_amount, repayment_amount in rows:
        entry = totals[bucket]
        entry[0] += 1
        entry[1] += Decimal(arrears_amount or 0)
        entry[2] += Decimal(repayment_amount or 0)
    return [
        ArrearsBucketCount(bucket=b, count=c, total_arrears=a, total_repayment=r)
        for b, (c, a, r) in totals.items()
    ]


# ── Read ─────────────────────────────────────────────────────────────────────


@router.get("", response_model=PaginatedArrears)
def list_arrears(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=200),
    search: Optional[str] = None,
    month: Optional[str] = Query(None, description="YYYY-MM. A completed month is replayed from snapshots."),
    bucket: Optional[str] = None,
    file_type: Optional[str] = None,
    resolved: Optional[bool] = None,
    proof_of_payment_received: Optional[bool] = None,
    contact_id: Optional[str] = None,
    organization_id: Optional[str] = None,
    lender_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    if bucket and bucket not in ARREARS_BUCKETS:
        raise HTTPException(status_code=400, detail=f"Invalid bucket: {bucket}")

    target_month = _parse_month(month) if month else None
    historical = _is_historical(target_month)

    query = _base_query(
        db, tenant_id, search, file_type, resolved, proof_of_payment_received,
        contact_id, organization_id, lender_id, date_from, date_to,
    )

    if historical:
        snapshots = {
            s.arrears_record_id: s
            for s in db.query(ArrearsSnapshot).filter(
                ArrearsSnapshot.tenant_id == tenant_id,
                ArrearsSnapshot.snapshot_month == target_month,
            )
        }
        records = [r for r in query.all() if r.id in snapshots]
        if bucket:
            records = [r for r in records if snapshots[r.id].bucket == bucket]
        records.sort(key=lambda r: snapshots[r.id].days_in_arrears, reverse=True)
    else:
        # The current month means "records that were in arrears during it".
        if target_month:
            query = query.filter(ArrearsRecord.in_arrears_since <= month_end(target_month))
        records = _apply_bucket(query.all(), bucket, None)
        records.sort(key=lambda r: r.in_arrears_since)
        snapshots = {}

    total = len(records)
    page_rows = records[(page - 1) * per_page : page * per_page]
    contacts, orgs, users = _names(db, page_rows)
    return PaginatedArrears(
        items=[
            _serialize(r, contacts, orgs, users, snapshot=snapshots.get(r.id) if historical else None)
            for r in page_rows
        ],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.get("/summary", response_model=ArrearsSummaryOut)
def arrears_summary(
    months: int = Query(12, ge=1, le=36),
    search: Optional[str] = None,
    file_type: Optional[str] = None,
    resolved: Optional[bool] = None,
    contact_id: Optional[str] = None,
    organization_id: Optional[str] = None,
    lender_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Today's bucket totals plus a month-by-month series behind them.

    Completed months come from snapshots (the book as it stood); the current
    month is computed live, since its snapshot doesn't exist yet.
    """
    query = _base_query(
        db, tenant_id, search, file_type, resolved, None,
        contact_id, organization_id, lender_id, date_from, date_to,
    )
    records = query.all()
    today = datetime.now(timezone.utc).date()

    live_rows = [(bucket_for(r), r.arrears_amount, r.repayment_amount) for r in records]
    total_arrears = sum((Decimal(r.arrears_amount or 0) for r in records), Decimal("0"))

    record_ids = {r.id for r in records}
    current = month_start(today)
    wanted_months = []
    cursor = current
    for _ in range(months):
        wanted_months.append(cursor)
        cursor = previous_month(cursor)

    snapshot_rows = (
        db.query(ArrearsSnapshot)
        .filter(
            ArrearsSnapshot.tenant_id == tenant_id,
            ArrearsSnapshot.snapshot_month.in_(wanted_months[1:]),
        )
        .all()
        if len(wanted_months) > 1
        else []
    )
    by_month: dict[date, list[ArrearsSnapshot]] = {}
    for s in snapshot_rows:
        if s.arrears_record_id in record_ids:
            by_month.setdefault(s.snapshot_month, []).append(s)

    month_summaries = []
    for m in reversed(wanted_months):
        if m == current:
            rows = live_rows
            month_total = total_arrears
        else:
            snaps = by_month.get(m, [])
            rows = [(s.bucket, s.arrears_amount, s.repayment_amount) for s in snaps]
            month_total = sum((Decimal(s.arrears_amount or 0) for s in snaps), Decimal("0"))
        month_summaries.append(ArrearsMonthSummary(
            month=m, count=len(rows), total_arrears=month_total, buckets=_bucket_counts(rows),
        ))

    return ArrearsSummaryOut(
        as_of=today,
        total_count=len(records),
        total_arrears=total_arrears,
        resolved_count=sum(1 for r in records if r.resolved),
        unresolved_count=sum(1 for r in records if not r.resolved),
        buckets=_bucket_counts(live_rows),
        months=month_summaries,
    )


@router.get("/report", response_model=list[ArrearsRecordOut])
def arrears_report(
    month: Optional[str] = None,
    bucket: Optional[str] = None,
    search: Optional[str] = None,
    file_type: Optional[str] = None,
    resolved: Optional[bool] = None,
    proof_of_payment_received: Optional[bool] = None,
    contact_id: Optional[str] = None,
    organization_id: Optional[str] = None,
    lender_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Every matching row, unpaginated, for the PDF export. Same filters as the
    list endpoint so what's on screen is what lands in the report."""
    result = list_arrears(
        page=1, per_page=MAX_REPORT_ROWS, search=search, month=month, bucket=bucket,
        file_type=file_type, resolved=resolved, proof_of_payment_received=proof_of_payment_received,
        contact_id=contact_id, organization_id=organization_id, lender_id=lender_id,
        date_from=date_from, date_to=date_to, db=db, _current_user=_current_user, tenant_id=tenant_id,
    )
    return result.items


@router.get("/{record_id}", response_model=ArrearsRecordDetailOut)
def get_arrears_record(
    record_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    record = _load(db, record_id, tenant_id)
    contacts, orgs, users = _names(db, [record])
    data = _serialize(record, contacts, orgs, users)
    data["attachments"] = [
        {
            "id": a.id,
            "kind": a.kind,
            "original_filename": a.original_filename,
            "email_from": a.email_from,
            "email_to": a.email_to,
            "email_subject": a.email_subject,
            "email_body": a.email_body,
            "email_sent_at": a.email_sent_at,
            "uploaded_by_name": a.uploaded_by.full_name if a.uploaded_by else None,
            "uploaded_at": a.uploaded_at,
        }
        for a in sorted(record.attachments, key=lambda a: a.uploaded_at, reverse=True)
    ]
    data["events"] = [
        {
            "id": e.id,
            "event_type": e.event_type,
            "detail": e.detail,
            "created_by_name": e.created_by.full_name if e.created_by else None,
            "created_at": e.created_at,
        }
        for e in sorted(record.events, key=lambda e: e.created_at, reverse=True)
    ]
    return data


def _load(db: Session, record_id: str, tenant_id: str) -> ArrearsRecord:
    record = (
        db.query(ArrearsRecord)
        .filter(ArrearsRecord.id == record_id, ArrearsRecord.tenant_id == tenant_id)
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Arrears record not found")
    return record


# ── Write ────────────────────────────────────────────────────────────────────


@router.post("", response_model=ArrearsRecordDetailOut, status_code=status.HTTP_201_CREATED)
def create_arrears_record(
    data: ArrearsRecordCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    _validate_links(db, tenant_id, data.contact_id, data.organization_id, data.application_id, data.lender_id)

    record = ArrearsRecord(
        tenant_id=tenant_id,
        created_by_id=current_user.id,
        **data.model_dump(),
    )
    db.add(record)
    db.flush()
    _log_event(db, record, current_user, "created", f"{record.lender_name} — in arrears since {record.in_arrears_since:%d %b %Y}")
    log_activity(
        db, current_user.id, "arrears_created", "arrears_record", record.id,
        {"lender": record.lender_name, "contract_number": record.contract_number}, tenant_id,
    )
    db.commit()
    db.refresh(record)
    return get_arrears_record(record.id, db, current_user, tenant_id)


# Fields whose change is worth its own timeline entry, with how to phrase it.
_TRACKED_FLAGS = {
    "resolved": ("resolved", "reopened", "Arrears marked resolved", "Arrears reopened"),
    "proof_of_payment_received": (
        "proof_received", "proof_cleared",
        "Proof of payment received", "Proof of payment marked not received",
    ),
    "delinquent": ("delinquent", "delinquent_cleared", "Flagged delinquent", "Delinquent flag removed"),
}


@router.patch("/{record_id}", response_model=ArrearsRecordDetailOut)
def update_arrears_record(
    record_id: str,
    data: ArrearsRecordUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    record = _load(db, record_id, tenant_id)
    updates = data.model_dump(exclude_unset=True)

    _validate_links(
        db, tenant_id,
        updates.get("contact_id"), updates.get("organization_id"),
        updates.get("application_id"), updates.get("lender_id"),
    )

    # Clearing both party links would orphan the record from every detail page.
    next_contact = updates.get("contact_id", record.contact_id)
    next_org = updates.get("organization_id", record.organization_id)
    if not next_contact and not next_org:
        raise HTTPException(status_code=400, detail="A record must stay linked to a client or a company")

    now = datetime.now(timezone.utc)
    for field, (on_type, off_type, on_text, off_text) in _TRACKED_FLAGS.items():
        if field not in updates or updates[field] == getattr(record, field):
            continue
        turning_on = bool(updates[field])
        detail = on_text if turning_on else off_text
        if field == "delinquent" and turning_on and updates.get("delinquent_reason"):
            detail = f"{on_text} — {updates['delinquent_reason']}"
        _log_event(db, record, current_user, on_type if turning_on else off_type, detail)
        # Stamp the matching audit columns; clear them when the flag is turned off.
        stamps = {
            "resolved": ("resolved_at", "resolved_by_id"),
            "proof_of_payment_received": ("proof_received_at", "proof_received_by_id"),
            "delinquent": ("delinquent_at", "delinquent_by_id"),
        }[field]
        setattr(record, stamps[0], now if turning_on else None)
        setattr(record, stamps[1], current_user.id if turning_on else None)
        if field == "delinquent" and not turning_on:
            record.delinquent_reason = None

    changed_details = [
        f for f in ("lender_name", "contract_number", "asset_details", "file_type",
                    "repayment_amount", "repayment_frequency", "arrears_amount", "in_arrears_since")
        if f in updates and updates[f] != getattr(record, f)
    ]

    for field, value in updates.items():
        setattr(record, field, value)

    if changed_details:
        _log_event(db, record, current_user, "updated", "Updated: " + ", ".join(
            f.replace("_", " ") for f in changed_details
        ))

    log_activity(db, current_user.id, "arrears_updated", "arrears_record", record.id,
                 {"fields": list(updates.keys())}, tenant_id)
    db.commit()
    db.refresh(record)
    return get_arrears_record(record.id, db, current_user, tenant_id)


@router.delete("/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_arrears_record(
    record_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    record = _load(db, record_id, tenant_id)
    for attachment in record.attachments:
        delete_file(attachment.file_path)
    log_activity(db, current_user.id, "arrears_deleted", "arrears_record", record.id,
                 {"lender": record.lender_name}, tenant_id)
    # Snapshots are intentionally left behind — a deleted record must not erase
    # the months it was reported in.
    db.delete(record)
    db.commit()


# ── Timeline notes ───────────────────────────────────────────────────────────


@router.post("/{record_id}/events", response_model=ArrearsRecordDetailOut, status_code=status.HTTP_201_CREATED)
def add_arrears_note(
    record_id: str,
    payload: ArrearsNoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    record = _load(db, record_id, tenant_id)
    _log_event(db, record, current_user, "note", payload.detail)
    db.commit()
    db.refresh(record)
    return get_arrears_record(record.id, db, current_user, tenant_id)


# ── Attachments (screenshots, documents, dropped emails) ─────────────────────


@router.post("/{record_id}/attachments", response_model=ArrearsRecordDetailOut, status_code=status.HTTP_201_CREATED)
def upload_arrears_attachment(
    record_id: str,
    request: Request,
    file: UploadFile,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    record = _load(db, record_id, tenant_id)
    attachment_upload_limiter.check(request)

    contents = file.file.read()
    filename = safe_filename(file.filename or "unknown")
    ext = os.path.splitext(filename)[1].lower()

    if ext in EMAIL_EXTENSIONS:
        parsed = parse_email(filename, contents)
        stored_name = f"{uuid4()}{ext}"
        attachment = ArrearsAttachment(
            tenant_id=tenant_id,
            arrears_record_id=record.id,
            kind="email",
            file_path=upload_file(contents, stored_name),
            original_filename=filename,
            email_from=parsed.sender,
            email_to=parsed.recipients,
            email_subject=parsed.subject,
            email_body=parsed.body,
            # Naive datetimes are serialized as UTC app-wide (see main.py), so
            # normalise the sender's offset rather than storing it unconverted.
            email_sent_at=parsed.sent_at.astimezone(timezone.utc).replace(tzinfo=None)
            if parsed.sent_at and parsed.sent_at.tzinfo
            else parsed.sent_at,
        )
        event_detail = f"Email attached: {parsed.subject or filename}"
    else:
        ext = validate_attachment(filename, contents)
        stored_name = f"{uuid4()}{ext}"
        # A pasted screenshot arrives named screenshot-<timestamp>.png from the
        # dropzone; keep that distinction so the timeline can label it.
        kind = "screenshot" if filename.startswith("screenshot-") else "file"
        attachment = ArrearsAttachment(
            tenant_id=tenant_id,
            arrears_record_id=record.id,
            kind=kind,
            file_path=upload_file(contents, stored_name),
            original_filename=filename,
        )
        event_detail = f"{'Screenshot' if kind == 'screenshot' else 'File'} attached: {filename}"

    attachment.uploaded_by_id = current_user.id
    db.add(attachment)
    _log_event(db, record, current_user, "attachment_added", event_detail)
    log_activity(db, current_user.id, "arrears_attachment_uploaded", "arrears_record", record.id,
                 {"filename": filename, "kind": attachment.kind}, tenant_id)
    db.commit()
    db.refresh(record)
    return get_arrears_record(record.id, db, current_user, tenant_id)


@router.get("/{record_id}/attachments/{attachment_id}/download")
def download_arrears_attachment(
    record_id: str,
    attachment_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    record = _load(db, record_id, tenant_id)
    attachment = (
        db.query(ArrearsAttachment)
        .filter(ArrearsAttachment.id == attachment_id, ArrearsAttachment.arrears_record_id == record.id)
        .first()
    )
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if not file_exists(attachment.file_path):
        raise HTTPException(status_code=404, detail="File not found in storage")

    ext = os.path.splitext(attachment.original_filename or "file")[1].lower()
    media_types = {
        ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
        ".eml": "message/rfc822", ".msg": "application/vnd.ms-outlook",
    }
    safe_name = os.path.basename((attachment.original_filename or "file").replace("\r", "").replace("\n", "").replace('"', "'"))
    return Response(
        content=download_file(attachment.file_path),
        media_type=media_types.get(ext, "application/octet-stream"),
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


@router.delete("/{record_id}/attachments/{attachment_id}", response_model=ArrearsRecordDetailOut)
def delete_arrears_attachment(
    record_id: str,
    attachment_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    record = _load(db, record_id, tenant_id)
    attachment = (
        db.query(ArrearsAttachment)
        .filter(ArrearsAttachment.id == attachment_id, ArrearsAttachment.arrears_record_id == record.id)
        .first()
    )
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    delete_file(attachment.file_path)
    _log_event(db, record, current_user, "attachment_removed", f"Removed: {attachment.original_filename}")
    log_activity(db, current_user.id, "arrears_attachment_deleted", "arrears_record", record.id,
                 {"filename": attachment.original_filename}, tenant_id)
    db.delete(attachment)
    db.commit()
    db.refresh(record)
    return get_arrears_record(record.id, db, current_user, tenant_id)
