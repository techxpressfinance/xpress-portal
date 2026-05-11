from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.external_referral import ExternalReferral
from app.models.loan_application import LoanApplication
from app.models.user import User
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/referrer", tags=["referrer"])


@router.get("/clients")
def list_referrer_clients(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    seen: set[str] = set()
    clients = []

    # Direct leads: applications submitted by the referrer with applicant details
    direct_apps = (
        db.query(LoanApplication)
        .filter(
            LoanApplication.user_id == current_user.id,
            LoanApplication.tenant_id == tenant_id,
            LoanApplication.applicant_first_name.isnot(None),
            LoanApplication.deleted_at.is_(None),
        )
        .order_by(LoanApplication.created_at.desc())
        .all()
    )

    for app in direct_apps:
        key = app.applicant_email or f"__{app.applicant_first_name}__{app.applicant_last_name}"
        if key in seen:
            continue
        seen.add(key)
        clients.append({
            "id": f"direct_{app.id}",
            "first_name": app.applicant_first_name,
            "last_name": app.applicant_last_name or "",
            "email": app.applicant_email or "",
            "mobile": app.applicant_mobile or "",
            "source": "direct",
        })

    # Referred registered clients via ExternalReferral
    ext_refs = (
        db.query(ExternalReferral)
        .filter(
            ExternalReferral.referrer_id == current_user.id,
            ExternalReferral.referred_client_id.isnot(None),
        )
        .all()
    )

    for ref in ext_refs:
        client = ref.referred_client
        if not client:
            continue
        key = client.email
        if key in seen:
            continue
        seen.add(key)
        name_parts = client.full_name.split() if client.full_name else [""]
        clients.append({
            "id": client.id,
            "first_name": name_parts[0],
            "last_name": " ".join(name_parts[1:]),
            "email": client.email,
            "mobile": client.phone or "",
            "source": "referred",
        })

    return clients
