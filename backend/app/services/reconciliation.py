from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.models.loan_application import (
    COMMERCIAL_LOAN_TYPES,
    ApplicationStatus,
    LoanApplication,
)
from app.services.organizations import normalize_abn

# Statuses where an application is still "open" and a newly-applying director
# could reasonably be reconciled into it. Closed outcomes are excluded.
_OPEN_STATUSES = (
    ApplicationStatus.draft,
    ApplicationStatus.application_received,
    ApplicationStatus.application_assessed,
    ApplicationStatus.submitted,
    ApplicationStatus.approval,
)


def loan_signature(app: LoanApplication) -> tuple:
    """The tuple that defines whether two commercial applies are 'the same loan'.

    Two applications with matching signatures are treated as one application;
    a mismatch on an otherwise-matching ABN is what flags reconciliation.
    """
    return (
        app.tenant_id,
        normalize_abn(app.business_abn),
        app.loan_type,
        app.amount,
        app.loan_term_requested,
        app.loan_purpose_id,
    )


def signature_diff(a: LoanApplication, b: LoanApplication) -> list[str]:
    """Human-readable list of where two applications' loan details diverge."""
    diffs: list[str] = []
    if a.loan_type != b.loan_type:
        diffs.append(f"loan type {b.loan_type.value} vs {a.loan_type.value}")
    if a.amount != b.amount:
        diffs.append(f"amount {b.amount} vs {a.amount}")
    if a.loan_term_requested != b.loan_term_requested:
        diffs.append(f"term {b.loan_term_requested} vs {a.loan_term_requested}")
    if a.loan_purpose_id != b.loan_purpose_id:
        diffs.append(f"purpose {b.loan_purpose_id} vs {a.loan_purpose_id}")
    return diffs


def _normalize_name(value: Optional[str]) -> Optional[str]:
    """Lowercased, whitespace-collapsed company name for soft matching."""
    if not value:
        return None
    collapsed = " ".join(value.split()).strip().lower()
    return collapsed or None


def find_matching_application(
    db: Session,
    tenant_id: str,
    abn: Optional[str],
    business_name: Optional[str] = None,
    exclude_id: Optional[str] = None,
) -> Optional[LoanApplication]:
    """Find an open commercial application for the same company.

    Matches on normalized ABN when available; otherwise falls back to a
    normalized business-name match (softer signal, used only when ABN is
    absent — e.g. legacy rows created before ABN was required). Returns the
    most recent open application that matches, or None. Same-vs-divergent
    comparison is left to the caller.
    """
    normalized_abn = normalize_abn(abn)
    normalized_name = _normalize_name(business_name)
    if not normalized_abn and not normalized_name:
        return None
    q = (
        db.query(LoanApplication)
        .filter(
            LoanApplication.tenant_id == tenant_id,
            LoanApplication.deleted_at.is_(None),
            LoanApplication.status.in_(_OPEN_STATUSES),
            LoanApplication.loan_type.in_(tuple(COMMERCIAL_LOAN_TYPES)),
        )
        .order_by(LoanApplication.created_at.desc())
    )
    if exclude_id:
        q = q.filter(LoanApplication.id != exclude_id)
    for app in q.all():
        if normalized_abn:
            if normalize_abn(app.business_abn) == normalized_abn:
                return app
        elif normalized_name and _normalize_name(app.business_name) == normalized_name:
            return app
    return None
