from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from typing import Optional
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.application_broker import ApplicationBroker
from app.models.document import Document
from app.models.loan_application import LoanApplication
from app.models.user import User, UserRole
from app.services.query_utils import escape_like

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("")
def global_search(
    q: str = Query(..., min_length=2, max_length=100),
    limit: int = Query(10, ge=1, le=25),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
):
    """Search across applications, users, and documents. Admin/broker only."""
    safe_q = escape_like(q)
    pattern = f"%{safe_q}%"

    # ── Applications ───────────────────────────────────────
    app_query = db.query(LoanApplication).join(User, LoanApplication.user_id == User.id)

    # Brokers only see their assigned applications
    if current_user.role == UserRole.broker:
        app_query = app_query.filter(
            LoanApplication.id.in_(
                db.query(ApplicationBroker.application_id).filter(
                    ApplicationBroker.broker_id == current_user.id
                )
            )
        )

    app_query = app_query.filter(
        User.full_name.ilike(pattern, escape="\\")
        | User.email.ilike(pattern, escape="\\")
        | LoanApplication.business_name.ilike(pattern, escape="\\")
        | LoanApplication.lend_ref.ilike(pattern, escape="\\")
        | LoanApplication.loan_type.ilike(pattern, escape="\\")
        | LoanApplication.id.ilike(pattern, escape="\\")
        | LoanApplication.notes.ilike(pattern, escape="\\")
        | LoanApplication.status.ilike(pattern, escape="\\")
        | LoanApplication.applicant_state.ilike(pattern, escape="\\")
    )

    apps = (
        app_query.order_by(LoanApplication.created_at.desc())
        .limit(limit)
        .all()
    )

    # Batch-load user info for matched applications
    user_ids = {a.user_id for a in apps}
    users_map = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            users_map[u.id] = u

    app_results = []
    for a in apps:
        u = users_map.get(a.user_id)
        app_results.append(
            {
                "id": a.id,
                "loan_type": a.loan_type.value if hasattr(a.loan_type, "value") else a.loan_type,
                "amount": float(a.amount),
                "status": a.status.value if hasattr(a.status, "value") else a.status,
                "user_name": u.full_name if u else None,
                "user_email": u.email if u else None,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
        )

    # ── Users ──────────────────────────────────────────────
    user_query = db.query(User).filter(
        User.full_name.ilike(pattern, escape="\\")
        | User.email.ilike(pattern, escape="\\")
        | User.phone.ilike(pattern, escape="\\")
        | User.employee_id.ilike(pattern, escape="\\")
        | User.organization_name.ilike(pattern, escape="\\")
        | User.license_number.ilike(pattern, escape="\\")
        | User.department.ilike(pattern, escape="\\")
    )

    users = user_query.order_by(User.created_at.desc()).limit(limit).all()

    user_results = [
        {
            "id": u.id,
            "full_name": u.full_name,
            "email": u.email,
            "role": u.role.value if hasattr(u.role, "value") else u.role,
            "is_active": u.is_active,
            "created_at": u.created_at.isoformat() if u.created_at else None,
        }
        for u in users
    ]

    # ── Documents ──────────────────────────────────────────
    doc_query = (
        db.query(Document)
        .join(LoanApplication, Document.application_id == LoanApplication.id)
        .filter(
            Document.original_filename.ilike(pattern, escape="\\")
            | Document.doc_type.ilike(pattern, escape="\\")
            | Document.lend_document_type.ilike(pattern, escape="\\")
        )
    )

    # Brokers only see docs on their assigned applications
    if current_user.role == UserRole.broker:
        doc_query = doc_query.filter(
            Document.application_id.in_(
                db.query(ApplicationBroker.application_id).filter(
                    ApplicationBroker.broker_id == current_user.id
                )
            )
        )

    docs = doc_query.order_by(Document.uploaded_at.desc()).limit(limit).all()

    # Batch-load application user info for docs
    doc_app_ids = {d.application_id for d in docs}
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
            "doc_type": d.doc_type.value if hasattr(d.doc_type, "value") else d.doc_type,
            "is_verified": d.is_verified,
            "uploaded_at": d.uploaded_at.isoformat() if d.uploaded_at else None,
            "user_name": app_user_map.get(d.application_id),
        }
        for d in docs
    ]

    return {"applications": app_results, "users": user_results, "documents": doc_results, "query": q}
