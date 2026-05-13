from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.external_referral import ExternalReferral, ExternalReferralStatus
from app.models.loan_application import LoanApplication
from app.models.user import User
from app.services.login_code import set_login_code
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
            "company_name": app.business_name or "",
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
            "company_name": ref.company_name or "",
            "source": "referred",
        })

    return clients


class NewClientContact(BaseModel):
    first_name: str
    last_name: str
    email: EmailStr
    mobile: Optional[str] = None
    company_name: Optional[str] = None


@router.post("/clients", status_code=status.HTTP_201_CREATED)
def create_referrer_client(
    data: NewClientContact,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    email = data.email.lower().strip()

    if email == current_user.email.lower():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot add yourself as a contact")

    # Prevent duplicate referral for this email
    existing_referral = db.query(ExternalReferral).filter(
        ExternalReferral.referrer_id == current_user.id,
        ExternalReferral.referred_email == email,
    ).first()
    if existing_referral:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A contact with this email already exists")

    existing_user = db.query(User).filter(User.email == email, User.tenant_id == tenant_id).first()

    if not existing_user:
        full_name = f"{data.first_name.strip()} {data.last_name.strip()}".strip()
        new_user = User(
            email=email,
            full_name=full_name,
            password_hash="!invited",
            auth_method="code",
            role="client",
            is_active=True,
            email_verified=True,
            login_code_attempts=0,
            invited_by_id=current_user.id,
            tenant_id=tenant_id,
        )
        set_login_code(new_user)
        db.add(new_user)
        db.flush()
        client_id = new_user.id
    else:
        client_id = existing_user.id

    referral = ExternalReferral(
        referrer_id=current_user.id,
        referred_email=email,
        referred_client_id=client_id,
        status=ExternalReferralStatus.signed_up,
        converted_at=datetime.now(timezone.utc),
        company_name=data.company_name.strip() if data.company_name else None,
        tenant_id=tenant_id,
    )
    db.add(referral)
    db.commit()

    name_parts = (data.first_name.strip(), data.last_name.strip())
    return {
        "id": client_id,
        "first_name": name_parts[0],
        "last_name": name_parts[1],
        "email": email,
        "mobile": data.mobile or "",
        "company_name": data.company_name or "",
        "source": "referred",
    }


class UpdateClientContact(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    mobile: Optional[str] = None
    company_name: Optional[str] = None


@router.patch("/clients/{contact_id}")
def update_referrer_client(
    contact_id: str,
    data: UpdateClientContact,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    if contact_id.startswith("direct_"):
        app_id = contact_id[len("direct_"):]
        app = (
            db.query(LoanApplication)
            .filter(
                LoanApplication.id == app_id,
                LoanApplication.user_id == current_user.id,
                LoanApplication.tenant_id == tenant_id,
                LoanApplication.deleted_at.is_(None),
            )
            .first()
        )
        if not app:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")
        if data.first_name is not None:
            app.applicant_first_name = data.first_name.strip() or None
        if data.last_name is not None:
            app.applicant_last_name = data.last_name.strip() or None
        if data.mobile is not None:
            app.applicant_mobile = data.mobile.strip() or None
        if data.company_name is not None:
            app.business_name = data.company_name.strip() or None
        db.commit()
        return {
            "id": contact_id,
            "first_name": app.applicant_first_name or "",
            "last_name": app.applicant_last_name or "",
            "email": app.applicant_email or "",
            "mobile": app.applicant_mobile or "",
            "company_name": app.business_name or "",
            "source": "direct",
        }

    # referred contact — contact_id is the User id
    ref = (
        db.query(ExternalReferral)
        .filter(
            ExternalReferral.referrer_id == current_user.id,
            ExternalReferral.referred_client_id == contact_id,
        )
        .first()
    )
    if not ref or not ref.referred_client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")
    client = ref.referred_client

    if data.first_name is not None or data.last_name is not None:
        existing_parts = client.full_name.split() if client.full_name else [""]
        first = data.first_name.strip() if data.first_name is not None else existing_parts[0]
        last = data.last_name.strip() if data.last_name is not None else " ".join(existing_parts[1:])
        client.full_name = f"{first} {last}".strip()
    if data.mobile is not None:
        client.phone = data.mobile.strip() or None
    if data.company_name is not None:
        ref.company_name = data.company_name.strip() or None
    db.commit()

    name_parts = client.full_name.split() if client.full_name else [""]
    return {
        "id": client.id,
        "first_name": name_parts[0],
        "last_name": " ".join(name_parts[1:]),
        "email": client.email,
        "mobile": client.phone or "",
        "company_name": ref.company_name or "",
        "source": "referred",
    }
