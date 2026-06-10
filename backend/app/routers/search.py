from __future__ import annotations

import re

from fastapi import APIRouter, Depends, Query
from typing import Optional
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.application_broker import ApplicationBroker
from app.models.contact import Contact, Organization
from app.models.document import Document
from app.models.loan_application import LoanApplication
from app.models.user import User, UserRole
from app.services.query_utils import active_user_clauses, escape_like
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/search", tags=["search"])

# How many candidates to fetch per entity before ranking (ranking happens in
# Python, so over-fetch to avoid recency cutting off the best match).
CANDIDATE_MULTIPLIER = 3

# Cap for the in-Python contact scan (contact names/phones are encrypted at
# rest, so they cannot be matched with SQL LIKE — same pattern as contacts.py).
CONTACT_SCAN_CAP = 1000


def _tokenize(q: str) -> list[str]:
    """Split a query into lowercase tokens (max 5) for multi-word matching."""
    return [t.lower() for t in q.split() if t][:5]


def _token_filter(tokens: list[str], columns: list):
    """Every token must match at least one column (AND of ORs).

    Lets "john smith" match first/last name split across columns, in any order.
    """
    clauses = []
    for token in tokens:
        pattern = f"%{escape_like(token)}%"
        clauses.append(or_(*[col.ilike(pattern, escape="\\") for col in columns]))
    return and_(*clauses)


def _score_token(token: str, value: str, weight: int) -> int:
    """Score one token against one field value: exact > word-prefix > substring."""
    v = value.lower()
    if v == token:
        return weight * 4
    if any(word.startswith(token) for word in v.split()):
        return weight * 2
    if token in v:
        return weight
    return 0


def _score(tokens: list[str], fields: list[tuple[Optional[str], int]]) -> int:
    """Relevance score: sum of each token's best field match; 0 if any token misses."""
    total = 0
    for token in tokens:
        best = max((_score_token(token, v, w) for v, w in fields if v), default=0)
        if best == 0:
            return 0
        total += best
    return total


def _enum_str(value) -> Optional[str]:
    if value is None:
        return None
    return value.value if hasattr(value, "value") else str(value)


@router.get("")
def global_search(
    q: str = Query(..., min_length=2, max_length=100),
    limit: int = Query(10, ge=1, le=25),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Search applications, users, contacts, companies and documents.

    Multi-word queries are tokenized (each word must match somewhere) and
    results are ranked by relevance instead of recency. Admin/broker only.
    """
    tokens = _tokenize(q)
    candidate_limit = limit * CANDIDATE_MULTIPLIER

    broker_app_ids = None
    if current_user.role == UserRole.broker:
        broker_app_ids = db.query(ApplicationBroker.application_id).filter(
            ApplicationBroker.broker_id == current_user.id
        )

    # ── Applications ───────────────────────────────────────
    app_query = db.query(LoanApplication).join(User, LoanApplication.user_id == User.id).filter(
        LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None)
    )
    if broker_app_ids is not None:
        app_query = app_query.filter(LoanApplication.id.in_(broker_app_ids))

    app_query = app_query.filter(
        _token_filter(
            tokens,
            [
                User.full_name,
                User.email,
                LoanApplication.business_name,
                LoanApplication.trading_name,
                LoanApplication.lend_ref,
                LoanApplication.loan_type,
                LoanApplication.id,
                LoanApplication.notes,
                LoanApplication.status,
                LoanApplication.applicant_state,
                LoanApplication.applicant_email,
                LoanApplication.applicant_mobile,
            ],
        )
    )

    apps = app_query.order_by(LoanApplication.created_at.desc()).limit(candidate_limit).all()

    # Batch-load user info for matched applications
    user_ids = {a.user_id for a in apps}
    users_map = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            users_map[u.id] = u

    scored_apps = []
    for a in apps:
        u = users_map.get(a.user_id)
        score = _score(
            tokens,
            [
                (u.full_name if u else None, 10),
                (u.email if u else None, 8),
                (a.business_name, 10),
                (a.trading_name, 8),
                (a.lend_ref, 10),
                (a.applicant_email, 6),
                (a.applicant_mobile, 6),
                (a.id, 5),
                (_enum_str(a.status), 3),
                (_enum_str(a.loan_type), 3),
                (a.applicant_state, 2),
                (a.notes, 1),
            ],
        )
        scored_apps.append((score, a, u))
    # Candidates arrive newest-first; stable sort keeps recency as tiebreak
    scored_apps.sort(key=lambda t: -t[0])

    app_results = [
        {
            "id": a.id,
            "loan_type": _enum_str(a.loan_type),
            "amount": float(a.amount),
            "status": _enum_str(a.status),
            "business_name": a.business_name,
            "lend_ref": a.lend_ref,
            "user_name": u.full_name if u else None,
            "user_email": u.email if u else None,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        }
        for _, a, u in scored_apps[:limit]
    ]

    # ── Users ──────────────────────────────────────────────
    user_query = (
        db.query(User)
        .filter(User.tenant_id == tenant_id)
        .filter(*active_user_clauses())
        .filter(
            _token_filter(
                tokens,
                [
                    User.full_name,
                    User.email,
                    User.phone,
                    User.employee_id,
                    User.organization_name,
                    User.license_number,
                    User.department,
                ],
            )
        )
    )

    users = user_query.order_by(User.created_at.desc()).limit(candidate_limit).all()
    scored_users = sorted(
        users,
        key=lambda u: -_score(
            tokens,
            [
                (u.full_name, 10),
                (u.email, 8),
                (u.phone, 6),
                (u.employee_id, 6),
                (u.organization_name, 4),
                (u.license_number, 4),
                (u.department, 2),
            ],
        ),
    )

    user_results = [
        {
            "id": u.id,
            "full_name": u.full_name,
            "email": u.email,
            "role": _enum_str(u.role),
            "is_active": u.is_active,
            "created_at": u.created_at.isoformat() if u.created_at else None,
        }
        for u in scored_users[:limit]
    ]

    # ── Contacts ───────────────────────────────────────────
    # Names/phones are encrypted at rest, so SQL LIKE can't see them; scan a
    # capped window of recent contacts and match decrypted values in Python.
    contacts = (
        db.query(Contact)
        .filter(Contact.tenant_id == tenant_id)
        .order_by(Contact.created_at.desc())
        .limit(CONTACT_SCAN_CAP)
        .all()
    )
    scored_contacts = []
    for c in contacts:
        full_name = " ".join(p for p in [c.first_name, c.middle_name, c.last_name] if p)
        score = _score(
            tokens,
            [
                (full_name, 10),
                (c.email, 8),
                (c.phone, 6),
                (c.suburb, 2),
                (c.state, 2),
            ],
        )
        if score > 0:
            scored_contacts.append((score, c, full_name))
    scored_contacts.sort(key=lambda t: -t[0])

    contact_results = [
        {
            "id": c.id,
            "full_name": full_name,
            "email": c.email,
            "phone": c.phone,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        }
        for _, c, full_name in scored_contacts[:limit]
    ]

    # ── Companies ──────────────────────────────────────────
    org_columns = [Organization.name, Organization.abn, Organization.industry]
    org_clauses = [_token_filter(tokens, org_columns)]
    # ABNs are stored digits-only; match "12 345 678 901" style queries too.
    digits = re.sub(r"\D", "", q)
    if len(digits) >= 4:
        org_clauses.append(Organization.abn.ilike(f"%{escape_like(digits)}%", escape="\\"))

    orgs = (
        db.query(Organization)
        .filter(Organization.tenant_id == tenant_id)
        .filter(or_(*org_clauses))
        .order_by(Organization.created_at.desc())
        .limit(candidate_limit)
        .all()
    )
    scored_orgs = sorted(
        orgs,
        key=lambda o: -max(
            _score(tokens, [(o.name, 10), (o.abn, 8), (o.industry, 3)]),
            8 if (len(digits) >= 4 and o.abn and digits in o.abn) else 0,
        ),
    )

    org_results = [
        {
            "id": o.id,
            "name": o.name,
            "abn": o.abn,
            "industry": o.industry,
            "created_at": o.created_at.isoformat() if o.created_at else None,
        }
        for o in scored_orgs[:limit]
    ]

    # ── Documents ──────────────────────────────────────────
    doc_query = (
        db.query(Document)
        .join(LoanApplication, Document.application_id == LoanApplication.id)
        .filter(Document.tenant_id == tenant_id)
        .filter(
            _token_filter(
                tokens,
                [Document.original_filename, Document.doc_type, Document.lend_document_type],
            )
        )
    )
    if broker_app_ids is not None:
        doc_query = doc_query.filter(Document.application_id.in_(broker_app_ids))

    docs = doc_query.order_by(Document.uploaded_at.desc()).limit(candidate_limit).all()
    scored_docs = sorted(
        docs,
        key=lambda d: -_score(
            tokens,
            [
                (d.original_filename, 10),
                (_enum_str(d.doc_type), 4),
                (d.lend_document_type, 4),
            ],
        ),
    )

    # Batch-load application user info for docs
    doc_app_ids = {d.application_id for d in scored_docs[:limit]}
    app_user_map: dict[str, Optional[str]] = {}
    if doc_app_ids:
        for app_row in (
            db.query(LoanApplication.id, User.full_name)
            .join(User, LoanApplication.user_id == User.id)
            .filter(LoanApplication.id.in_(doc_app_ids))
            .all()
        ):
            app_user_map[app_row[0]] = app_row[1]

    doc_results = [
        {
            "id": d.id,
            "application_id": d.application_id,
            "original_filename": d.original_filename,
            "doc_type": _enum_str(d.doc_type),
            "is_verified": d.is_verified,
            "uploaded_at": d.uploaded_at.isoformat() if d.uploaded_at else None,
            "user_name": app_user_map.get(d.application_id),
        }
        for d in scored_docs[:limit]
    ]

    return {
        "applications": app_results,
        "users": user_results,
        "contacts": contact_results,
        "organizations": org_results,
        "documents": doc_results,
        "query": q,
    }
