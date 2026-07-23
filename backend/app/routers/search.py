from __future__ import annotations

import re
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from typing import Optional
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.application_broker import ApplicationBroker
from app.models.contact import Organization
from app.models.document import Document
from app.models.loan_application import LoanApplication
from app.models.user import User, UserRole
from app.services.query_utils import active_user_clauses, escape_like
from app.services.scoring import score as _score, tokenize as _tokenize
from app.services.search_cache import get_searchable_applications, get_searchable_contacts
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/search", tags=["search"])

# How many candidates to fetch per entity before ranking (ranking happens in
# Python, so over-fetch to avoid recency cutting off the best match).
CANDIDATE_MULTIPLIER = 3

# Recency-tiebreak fallback for rows with no created_at
_EPOCH = datetime.min


def _token_filter(tokens: list[str], columns: list):
    """Every token must match at least one column (AND of ORs).

    Lets "john smith" match first/last name split across columns, in any order.
    """
    clauses = []
    for token in tokens:
        pattern = f"%{escape_like(token)}%"
        clauses.append(or_(*[col.ilike(pattern, escape="\\") for col in columns]))
    return and_(*clauses)


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
        broker_app_ids = {
            row[0]
            for row in db.query(ApplicationBroker.application_id)
            .filter(ApplicationBroker.broker_id == current_user.id)
            .all()
        }

    # ── Applications ───────────────────────────────────────
    # Applicant name/email/mobile are encrypted at rest, so SQL LIKE can't see
    # them. Score decrypted values from the in-process search cache instead:
    # one (id, updated_at) sweep per query, decryption only for changed rows.
    app_fields = get_searchable_applications(db, tenant_id)
    if broker_app_ids is not None:
        app_fields = {aid: f for aid, f in app_fields.items() if aid in broker_app_ids}

    # Batch-load owner name/email for scoring and results
    users_map: dict[str, tuple[Optional[str], Optional[str]]] = {}
    user_ids = {f["user_id"] for f in app_fields.values()}
    if user_ids:
        for uid, uname, uemail in (
            db.query(User.id, User.full_name, User.email).filter(User.id.in_(user_ids)).all()
        ):
            users_map[uid] = (uname, uemail)

    scored_apps = []
    for f in app_fields.values():
        uname, uemail = users_map.get(f["user_id"], (None, None))
        score = _score(
            tokens,
            [
                (uname, 10),
                (uemail, 8),
                (f["applicant_name"], 10),
                (f["business_name"], 10),
                (f["trading_name"], 8),
                (f["lend_ref"], 10),
                (f["applicant_email"], 6),
                (f["applicant_mobile"], 6),
                (f["id"], 5),
                (f["status"], 3),
                (f["loan_type"], 3),
                (f["applicant_state"], 2),
                (f["notes"], 1),
            ],
        )
        if score > 0:
            scored_apps.append((score, f, uname, uemail))
    # Newest-first before the stable score sort keeps recency as tiebreak
    scored_apps.sort(key=lambda t: t[1]["created_at"] or _EPOCH, reverse=True)
    scored_apps.sort(key=lambda t: -t[0])

    app_results = [
        {
            "id": f["id"],
            "loan_type": f["loan_type"],
            "amount": f["amount"],
            "status": f["status"],
            "business_name": f["business_name"],
            "lend_ref": f["lend_ref"],
            "user_name": uname,
            "user_email": uemail,
            "created_at": f["created_at"].isoformat() if f["created_at"] else None,
        }
        for _, f, uname, uemail in scored_apps[:limit]
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
    # Names/phones are encrypted at rest, so SQL LIKE can't see them; score
    # decrypted values from the in-process search cache (same as applications).
    contact_fields = get_searchable_contacts(db, tenant_id)
    scored_contacts = []
    for f in contact_fields.values():
        score = _score(
            tokens,
            [
                (f["full_name"], 10),
                (f["email"], 8),
                (f["phone"], 6),
                (f["drivers_license_number"], 4),
                (f["suburb"], 2),
                (f["state"], 2),
            ],
        )
        if score > 0:
            scored_contacts.append((score, f))
    scored_contacts.sort(key=lambda t: t[1]["created_at"] or _EPOCH, reverse=True)
    scored_contacts.sort(key=lambda t: -t[0])

    contact_results = [
        {
            "id": f["id"],
            "full_name": f["full_name"],
            "email": f["email"],
            "phone": f["phone"],
            "created_at": f["created_at"].isoformat() if f["created_at"] else None,
        }
        for _, f in scored_contacts[:limit]
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
