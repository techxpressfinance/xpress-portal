from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy.orm import Session

from app.config import FRONTEND_URL
from app.database import get_db
from app.middleware.auth import require_role
from app.models.external_referral import ExternalReferral, ExternalReferralStatus
from app.models.loan_application import LoanApplication, LoanType
from app.models.user import User, UserRole
from app.schemas.common import normalize_email
from app.services.activity_log import log_activity
from app.services.email import send_complete_application_email, send_new_lead_notification, send_setup_account_email
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

    _normalize_email = field_validator("email", mode="before")(normalize_email)


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
    if existing_user and existing_user.role.value != "client":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account exists for this email but is not a client account",
        )

    if not existing_user:
        full_name = f"{data.first_name.strip()} {data.last_name.strip()}".strip()
        token = secrets.token_urlsafe(32)
        new_user = User(
            email=email,
            full_name=full_name,
            password_hash="!",
            auth_method="password",
            role="client",
            is_active=True,
            email_verified=True,
            invited_by_id=current_user.id,
            tenant_id=tenant_id,
            email_verification_token=token,
            email_verification_token_expires_at=datetime.now(timezone.utc) + timedelta(hours=48),
        )
        db.add(new_user)
        db.flush()
        client_id = new_user.id
        setup_url = f"{FRONTEND_URL}/setup-account?token={token}"
        send_setup_account_email(email, full_name, setup_url, current_user.full_name, role="client")
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
    client_name = f"{data.first_name.strip()} {data.last_name.strip()}".strip()
    log_activity(db, current_user.id, "client_referred", "client", client_id,
                {"client_name": client_name, "client_email": email}, tenant_id=tenant_id)
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


class DirectReferralCreate(BaseModel):
    first_name: str
    last_name: str
    email: EmailStr
    mobile: Optional[str] = None
    company_name: Optional[str] = None
    loan_type: str
    amount: float
    notes: Optional[str] = None
    business_name: Optional[str] = None
    business_abn: Optional[str] = None
    lend_extra_data: Optional[str] = None

    _normalize_email = field_validator("email", mode="before")(normalize_email)


@router.post("/direct-referral", status_code=status.HTTP_201_CREATED)
def create_direct_referral(
    data: DirectReferralCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    email = data.email.lower().strip()

    if email == current_user.email.lower():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot refer yourself")

    try:
        loan_type = LoanType(data.loan_type)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid loan type: {data.loan_type}")

    existing_user = db.query(User).filter(User.email == email, User.tenant_id == tenant_id).first()
    if existing_user and existing_user.role.value != "client":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account exists for this email but is not a client account",
        )

    full_name = f"{data.first_name.strip()} {data.last_name.strip()}".strip()
    is_new_user = not existing_user

    if is_new_user:
        token = secrets.token_urlsafe(32)
        client = User(
            email=email,
            full_name=full_name,
            phone=data.mobile,
            password_hash="!",
            auth_method="password",
            role="client",
            is_active=True,
            email_verified=True,
            invited_by_id=current_user.id,
            tenant_id=tenant_id,
            email_verification_token=token,
            email_verification_token_expires_at=datetime.now(timezone.utc) + timedelta(hours=48),
        )
        db.add(client)
        db.flush()

        referral = ExternalReferral(
            referrer_id=current_user.id,
            referred_email=email,
            referred_client_id=client.id,
            status=ExternalReferralStatus.signed_up,
            converted_at=datetime.now(timezone.utc),
            company_name=data.company_name.strip() if data.company_name else None,
            tenant_id=tenant_id,
        )
        db.add(referral)
    else:
        client = existing_user
        # Ensure a referral link exists for visibility; don't duplicate if already present
        existing_referral = db.query(ExternalReferral).filter(
            ExternalReferral.referrer_id == current_user.id,
            ExternalReferral.referred_client_id == client.id,
        ).first()
        if not existing_referral:
            db.add(ExternalReferral(
                referrer_id=current_user.id,
                referred_email=email,
                referred_client_id=client.id,
                status=ExternalReferralStatus.signed_up,
                converted_at=datetime.now(timezone.utc),
                company_name=data.company_name.strip() if data.company_name else None,
                tenant_id=tenant_id,
            ))

    application = LoanApplication(
        user_id=client.id,
        loan_type=loan_type,
        amount=data.amount,
        notes=data.notes,
        business_name=data.business_name,
        business_abn=data.business_abn,
        lend_extra_data=data.lend_extra_data,
        tenant_id=tenant_id,
    )
    db.add(application)
    log_activity(db, current_user.id, "lead_submitted", "application", application.id,
                {"loan_type": loan_type.value, "amount": str(data.amount), "client_name": full_name},
                tenant_id=tenant_id)
    db.commit()
    db.refresh(application)

    if is_new_user:
        redirect_target = quote(f"/applications/new?completeId={application.id}", safe="")
        setup_url = f"{FRONTEND_URL}/setup-account?token={token}&redirect={redirect_target}"
        send_setup_account_email(email, full_name, setup_url, current_user.full_name, role="client")
    else:
        send_complete_application_email(
            to_email=email,
            client_name=client.full_name,
            inviter_name=current_user.full_name,
            loan_type=loan_type.value,
            amount=str(int(data.amount)),
            application_id=application.id,
        )

    portal_url = f"{FRONTEND_URL}/admin/applications/{application.id}"
    admins = db.query(User).filter(User.role == UserRole.admin, User.tenant_id == tenant_id).all()
    for admin in admins:
        send_new_lead_notification(
            admin.email,
            admin.full_name or "Admin",
            current_user.full_name or current_user.email,
            full_name,
            loan_type.value,
            str(int(data.amount)),
            portal_url,
        )

    return {"application_id": application.id, "client_id": client.id}
