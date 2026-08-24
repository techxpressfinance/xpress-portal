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
from sqlalchemy import exists, or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.middleware.rate_limit import RateLimiter
from app.models.arrears import (
    ArrearsAttachment,
    ArrearsContactAttempt,
    ArrearsEvent,
    ArrearsRecord,
    ArrearsRecordLender,
    ArrearsSnapshot,
)
from app.models.contact import Contact, Organization
from app.models.lender import Lender
from app.models.lending_history_entry import LendingHistoryEntry
from app.models.lender_submission import LenderSubmission
from app.models.loan_application import LoanApplication
from app.models.user import User
from app.schemas.arrears import (
    ArrearsAttemptCreate,
    ArrearsAttemptUpdate,
    ArrearsBucketCount,
    ArrearsLenderOut,
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

# Contact-attempt methods and how each reads on the record timeline.
ATTEMPT_LABELS = {"phone": "Phone call attempted", "email": "Email attempted", "text": "Text message attempted"}


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
    # Records written before the lenders table only have the parent columns;
    # read those as a single-element list so every consumer sees one shape.
    lenders = [
        {"lender_id": rl.lender_id, "lender_name": rl.lender_name}
        for rl in record.record_lenders
    ] or ([{"lender_id": record.lender_id, "lender_name": record.lender_name}] if record.lender_name else [])
    return {
        "id": record.id,
        "contact_id": record.contact_id,
        "contact_name": contacts.get(record.contact_id),
        "organization_id": record.organization_id,
        "organization_name": orgs.get(record.organization_id),
        "application_id": record.application_id,
        "lender_id": record.lender_id,
        "lender_name": record.lender_name,
        "lenders": lenders,
        "contract_number": record.contract_number,
        "vin": record.vin,
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
        "attachment_count": sum(1 for a in attachments if a.kind != "email" and not a.contact_attempt_id),
        "email_count": sum(1 for a in attachments if a.kind == "email" and not a.contact_attempt_id),
        "created_by_name": users.get(record.created_by_id),
        "created_at": record.created_at,
        "updated_at": record.updated_at,
    }


def _naive(value: datetime) -> datetime:
    """Normalise an incoming timestamp to naive UTC (see the email-upload path
    for the same convention); naive values from the datetime-local input pass
    through unchanged so the broker's wall-clock time round-trips."""
    return value.astimezone(timezone.utc).replace(tzinfo=None) if value.tzinfo else value


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
    lender_ids: Optional[list[str]],
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
        raise HTTPException(status_code=404, detail="Entity not found")
    if application_id and not db.query(LoanApplication.id).filter(
        LoanApplication.id == application_id, LoanApplication.tenant_id == tenant_id
    ).first():
        raise HTTPException(status_code=404, detail="Application not found")
    ids = [i for i in (lender_ids or []) if i]
    if ids:
        known = {
            row[0]
            for row in db.query(Lender.id).filter(Lender.id.in_(ids), Lender.tenant_id == tenant_id)
        }
        missing = [i for i in ids if i not in known]
        if missing:
            raise HTTPException(status_code=404, detail="Lender not found")


def _set_lenders(record: ArrearsRecord, lenders: list[dict]) -> None:
    """Replace the record's lender set. The parent's lender_id/lender_name are
    re-synced to the first entry — list views, search, and the lender filter
    read the parent row, and _serialize prefers children with a parent
    fallback, so both copies must agree."""
    record.record_lenders = []
    for position, item in enumerate(lenders):
        record.record_lenders.append(ArrearsRecordLender(
            tenant_id=record.tenant_id,
            lender_id=item.get("lender_id") or None,
            lender_name=item["lender_name"].strip(),
            position=position,
        ))
    record.lender_id = lenders[0].get("lender_id") or None
    record.lender_name = lenders[0]["lender_name"].strip()


def _lender_names(record: ArrearsRecord) -> list[str]:
    """Names as they should appear in events/logs — children when present,
    the legacy parent copy otherwise."""
    if record.record_lenders:
        return [rl.lender_name for rl in record.record_lenders]
    return [record.lender_name] if record.lender_name else []


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
        # The filter must catch secondary lenders too, not just the primary
        # copy on the parent row.
        query = query.filter(or_(
            ArrearsRecord.lender_id == lender_id,
            exists(select(ArrearsRecordLender.id).where(
                ArrearsRecordLender.arrears_record_id == ArrearsRecord.id,
                ArrearsRecordLender.lender_id == lender_id,
            )),
        ))
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
            exists(select(ArrearsRecordLender.id).where(
                ArrearsRecordLender.arrears_record_id == ArrearsRecord.id,
                ArrearsRecordLender.lender_name.ilike(pattern),
            )),
            ArrearsRecord.contract_number.ilike(pattern),
            ArrearsRecord.vin.ilike(pattern),
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


@router.get("/lender-options", response_model=list[ArrearsLenderOut])
def arrears_lender_options(
    contact_id: Optional[str] = None,
    organization_id: Optional[str] = None,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Lenders already associated with the chosen client/company, so the
    arrears modal's lender picker only offers lenders that business actually
    uses. Sources: their existing arrears contracts (all lenders per record),
    the client's lending history, and lender submissions on their
    applications. Deduped by name, preferring entries linked to a lender row.
    """
    if not contact_id and not organization_id:
        raise HTTPException(status_code=400, detail="Provide a client or an entity")

    found: dict[str, dict] = {}

    def add(lender_id: Optional[str], name: Optional[str]) -> None:
        name = (name or "").strip()
        if not name:
            return
        key = name.lower()
        current = found.get(key)
        if current is None or (current["lender_id"] is None and lender_id):
            found[key] = {"lender_id": lender_id, "lender_name": name}

    party_clauses = []
    if contact_id:
        party_clauses += [ArrearsRecord.contact_id == contact_id]
    if organization_id:
        party_clauses += [ArrearsRecord.organization_id == organization_id]
    for r in db.query(ArrearsRecord).filter(
        ArrearsRecord.tenant_id == tenant_id, or_(*party_clauses)
    ).all():
        add(r.lender_id, r.lender_name)
        for rl in r.record_lenders:
            add(rl.lender_id, rl.lender_name)

    if contact_id:
        for (name,) in (
            db.query(LendingHistoryEntry.lender_name)
            .filter(
                LendingHistoryEntry.tenant_id == tenant_id,
                LendingHistoryEntry.contact_id == contact_id,
            )
            .distinct()
        ):
            add(None, name)

    app_clauses = []
    if contact_id:
        app_clauses.append(LoanApplication.contact_id == contact_id)
    if organization_id:
        app_clauses.append(LoanApplication.business_organization_id == organization_id)
    submission_lender_ids = {
        row[0]
        for row in (
            db.query(LenderSubmission.lender_id)
            .join(LoanApplication, LoanApplication.id == LenderSubmission.application_id)
            .filter(
                LoanApplication.tenant_id == tenant_id,
                LenderSubmission.tenant_id == tenant_id,
                or_(*app_clauses),
            )
            .distinct()
        )
    }
    if submission_lender_ids:
        for lender in db.query(Lender).filter(
            Lender.id.in_(submission_lender_ids), Lender.tenant_id == tenant_id
        ):
            add(lender.id, lender.name)

    return sorted(found.values(), key=lambda item: item["lender_name"].lower())


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
        # Attempt snips render inside the attempts section, not here.
        for a in sorted(record.attachments, key=lambda a: a.uploaded_at, reverse=True)
        if not a.contact_attempt_id
    ]
    data["attempts"] = [
        {
            "id": a.id,
            "method": a.method,
            "attempted_at": a.attempted_at,
            "note": a.note,
            "attachments": [
                {
                    "id": f.id,
                    "original_filename": f.original_filename,
                    "kind": f.kind,
                    "email_subject": f.email_subject,
                    "email_from": f.email_from,
                    "email_to": f.email_to,
                    "email_body": f.email_body,
                    "email_sent_at": f.email_sent_at,
                }
                for f in a.attachments
            ],
            "created_by_name": a.created_by.full_name if a.created_by else None,
            "created_at": a.created_at,
            "updated_at": a.updated_at,
        }
        for a in record.contact_attempts
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
    _validate_links(
        db, tenant_id, data.contact_id, data.organization_id, data.application_id,
        [entry.lender_id for entry in data.lenders],
    )

    record = ArrearsRecord(
        tenant_id=tenant_id,
        created_by_id=current_user.id,
        **data.model_dump(exclude={"lenders"}),
    )
    db.add(record)
    # Before flush: lender_name is NOT NULL on the parent, so the primary copy
    # must be synced first — the children pick up the record id at flush time.
    _set_lenders(record, [entry.model_dump() for entry in data.lenders])
    db.flush()
    _log_event(db, record, current_user, "created", f"{' & '.join(_lender_names(record))} — in arrears since {record.in_arrears_since:%d %b %Y}")
    log_activity(
        db, current_user.id, "arrears_created", "arrears_record", record.id,
        {"lenders": _lender_names(record), "contract_number": record.contract_number}, tenant_id,
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
    lenders_payload = updates.pop("lenders", None)

    _validate_links(
        db, tenant_id,
        updates.get("contact_id"), updates.get("organization_id"),
        updates.get("application_id"),
        [entry.get("lender_id") for entry in lenders_payload] if lenders_payload is not None else None,
    )

    # Clearing both party links would orphan the record from every detail page.
    next_contact = updates.get("contact_id", record.contact_id)
    next_org = updates.get("organization_id", record.organization_id)
    if not next_contact and not next_org:
        raise HTTPException(status_code=400, detail="A record must stay linked to a client or an entity")

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
        f for f in ("contract_number", "vin", "asset_details", "file_type",
                    "repayment_amount", "repayment_frequency", "arrears_amount", "in_arrears_since")
        if f in updates and updates[f] != getattr(record, f)
    ]

    # Lenders get their own event naming the full new set, so co-financing
    # changes read as "Lenders: A, B" rather than a bare "lender name" diff.
    if lenders_payload is not None:
        names_before = [n.lower() for n in _lender_names(record)]
        _set_lenders(record, lenders_payload)
        if [n.lower() for n in _lender_names(record)] != names_before:
            _log_event(db, record, current_user, "lenders_updated", f"Lenders: {' & '.join(_lender_names(record))}")

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
                 {"lenders": _lender_names(record)}, tenant_id)
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


# ── Contact attempts (phone / email / text) ──────────────────────────────────


def _build_attachment(
    tenant_id: str,
    record: ArrearsRecord,
    file: UploadFile,
    current_user: User,
    contact_attempt_id: Optional[str] = None,
) -> tuple[ArrearsAttachment, str]:
    """Turn an upload into an unsaved ArrearsAttachment plus its timeline wording.

    Shared by record-level attachments and the evidence hanging off a single
    contact attempt, so a chase email dropped on the "Email attempted" entry is
    parsed exactly like one dropped on the record — same allowlist, same header
    extraction. `contact_attempt_id` is what makes the file belong to the
    attempt instead of the record's own list.
    """
    contents = file.file.read()
    filename = safe_filename(file.filename or "unknown")
    ext = os.path.splitext(filename)[1].lower()

    if ext in EMAIL_EXTENSIONS:
        parsed = parse_email(filename, contents)
        stored_name = f"{uuid4()}{ext}"
        attachment = ArrearsAttachment(
            tenant_id=tenant_id,
            arrears_record_id=record.id,
            contact_attempt_id=contact_attempt_id,
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
            contact_attempt_id=contact_attempt_id,
            kind=kind,
            file_path=upload_file(contents, stored_name),
            original_filename=filename,
        )
        event_detail = f"{'Screenshot' if kind == 'screenshot' else 'File'} attached: {filename}"

    attachment.uploaded_by_id = current_user.id
    return attachment, event_detail


def _load_attempt(db: Session, record: ArrearsRecord, attempt_id: str) -> ArrearsContactAttempt:
    attempt = db.query(ArrearsContactAttempt).filter(
        ArrearsContactAttempt.id == attempt_id,
        ArrearsContactAttempt.arrears_record_id == record.id,
    ).first()
    if not attempt:
        raise HTTPException(status_code=404, detail="Contact attempt not found")
    return attempt


@router.post("/{record_id}/attempts", response_model=ArrearsRecordDetailOut, status_code=status.HTTP_201_CREATED)
def add_contact_attempt(
    record_id: str,
    data: ArrearsAttemptCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    record = _load(db, record_id, tenant_id)
    attempt = ArrearsContactAttempt(
        tenant_id=tenant_id,
        arrears_record_id=record.id,
        method=data.method,
        attempted_at=_naive(data.attempted_at),
        note=data.note,
        created_by_id=current_user.id,
    )
    db.add(attempt)
    db.flush()
    _log_event(db, record, current_user, "attempt_logged",
               f"{ATTEMPT_LABELS[attempt.method]} — {attempt.attempted_at:%d %b %Y, %I:%M %p}")
    log_activity(db, current_user.id, "arrears_attempt_logged", "arrears_record", record.id,
                 {"method": attempt.method}, tenant_id)
    db.commit()
    db.refresh(record)
    return get_arrears_record(record.id, db, current_user, tenant_id)


@router.patch("/{record_id}/attempts/{attempt_id}", response_model=ArrearsRecordDetailOut)
def update_contact_attempt(
    record_id: str,
    attempt_id: str,
    data: ArrearsAttemptUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    record = _load(db, record_id, tenant_id)
    attempt = _load_attempt(db, record, attempt_id)
    updates = data.model_dump(exclude_unset=True)
    if "attempted_at" in updates and updates["attempted_at"] is not None:
        updates["attempted_at"] = _naive(updates["attempted_at"])
    changed = [f for f, v in updates.items() if v != getattr(attempt, f)]
    for field, value in updates.items():
        setattr(attempt, field, value)
    if changed:
        _log_event(db, record, current_user, "attempt_updated",
                   f"Contact attempt edited ({ATTEMPT_LABELS[attempt.method].lower()})")
    db.commit()
    db.refresh(record)
    return get_arrears_record(record.id, db, current_user, tenant_id)


@router.delete("/{record_id}/attempts/{attempt_id}", response_model=ArrearsRecordDetailOut)
def delete_contact_attempt(
    record_id: str,
    attempt_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    record = _load(db, record_id, tenant_id)
    attempt = _load_attempt(db, record, attempt_id)
    for attachment in attempt.attachments:
        delete_file(attachment.file_path)
    _log_event(db, record, current_user, "attempt_removed",
               f"{ATTEMPT_LABELS[attempt.method]} entry removed")
    db.delete(attempt)
    db.commit()
    db.refresh(record)
    return get_arrears_record(record.id, db, current_user, tenant_id)


@router.post("/{record_id}/attempts/{attempt_id}/attachments", response_model=ArrearsRecordDetailOut, status_code=status.HTTP_201_CREATED)
def upload_attempt_attachment(
    record_id: str,
    attempt_id: str,
    request: Request,
    file: UploadFile,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """The evidence for one contact attempt: a screenshot of the call log, a
    photo, or the chase email itself. Same file kinds as a record-level
    attachment — an "Email attempted" entry should carry the actual email,
    parsed for its subject and sender, not a picture of one.
    """
    record = _load(db, record_id, tenant_id)
    attempt = _load_attempt(db, record, attempt_id)
    attachment_upload_limiter.check(request)

    attachment, event_detail = _build_attachment(
        tenant_id, record, file, current_user, contact_attempt_id=attempt.id,
    )
    db.add(attachment)
    _log_event(db, record, current_user, "attachment_added",
               f"{event_detail} (on {ATTEMPT_LABELS[attempt.method].lower()})")
    log_activity(db, current_user.id, "arrears_attempt_attachment_uploaded", "arrears_record", record.id,
                 {"filename": attachment.original_filename, "kind": attachment.kind,
                  "method": attempt.method}, tenant_id)
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

    attachment, event_detail = _build_attachment(tenant_id, record, file, current_user)
    filename = attachment.original_filename
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
