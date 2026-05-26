from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session, aliased

from app.config import FRONTEND_URL
from app.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.loan_application import LoanApplication, LoanType
from app.models.user import User
from app.schemas.user import InvitationCreate, InvitationOut, InviteToCompleteCreate, PaginatedInvitations, StartApplicationForClient, UserOut
from app.models.application_broker import ApplicationBroker
from app.schemas.common import normalize_email
from app.services.email import send_complete_application_email, send_setup_account_email
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/invitations", tags=["invitations"])


@router.get("", response_model=PaginatedInvitations)
def list_invitations(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    role: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    Inviter = aliased(User)
    query = (
        db.query(User, Inviter.full_name.label("inviter_name"))
        .outerjoin(Inviter, User.invited_by_id == Inviter.id)
        .filter(User.invited_by_id.isnot(None), User.tenant_id == tenant_id)
    )

    if role:
        query = query.filter(User.role == role)

    # Brokers see only their own invitations
    if current_user.role.value == "broker":
        query = query.filter(User.invited_by_id == current_user.id)

    total = query.with_entities(func.count(User.id)).scalar()

    rows = (
        query.order_by(User.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    now = datetime.now(timezone.utc)
    items = []
    for user, inviter_name in rows:
        item = InvitationOut.model_validate(user)
        item.invited_by_name = inviter_name
        # Pending = invite issued but the user has not set a real password yet.
        pending = user.password_hash in ("!", "!invited")
        item.setup_pending = pending
        expires_at = user.email_verification_token_expires_at
        if pending and expires_at is not None:
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            item.setup_expired = expires_at < now
        items.append(item)

    return PaginatedInvitations(items=items, total=total, page=page, per_page=per_page)


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def invite_user(
    data: InvitationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    if data.email.lower() == current_user.email.lower():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot invite yourself")

    existing = db.query(User).filter(User.email == data.email, User.tenant_id == tenant_id).first()

    if existing:
        if not existing.is_active:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This account has been deactivated. Reactivate it first.",
            )
        # Refuse to overwrite an already-set-up account via the invite flow —
        # an admin who wants the user to reset should send a password reset instead.
        if existing.password_hash not in ("!", "!invited"):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This user has already set up an account. Send a password reset instead.",
            )
        # Re-invite an account that hasn't completed setup: refresh the token.
        token = secrets.token_urlsafe(32)
        existing.email_verification_token = token
        existing.email_verification_token_expires_at = datetime.now(timezone.utc) + timedelta(hours=48)
        existing.auth_method = "password"
        db.commit()
        db.refresh(existing)
        setup_url = f"{FRONTEND_URL}/setup-account?token={token}"
        send_setup_account_email(data.email, existing.full_name, setup_url, current_user.full_name, role="client")
        return existing

    # Create new invited user
    token = secrets.token_urlsafe(32)
    user = User(
        email=data.email,
        full_name=data.full_name,
        phone=data.phone,
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
    db.add(user)
    db.commit()
    db.refresh(user)

    setup_url = f"{FRONTEND_URL}/setup-account?token={token}"
    send_setup_account_email(data.email, data.full_name, setup_url, current_user.full_name, role="client")
    return user


@router.post("/complete-application", status_code=status.HTTP_200_OK)
def invite_to_complete_application(
    data: InviteToCompleteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    application = db.query(LoanApplication).filter(LoanApplication.id == data.application_id, LoanApplication.tenant_id == tenant_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    if application.status.value != "draft":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Application is not in draft status")

    client = db.query(User).filter(User.id == application.user_id).first()
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")

    send_complete_application_email(
        to_email=client.email,
        client_name=client.full_name,
        inviter_name=current_user.full_name,
        loan_type=application.loan_type.value,
        amount=str(application.amount),
        application_id=application.id,
    )

    return {"detail": f"Completion invite sent to {client.email}"}


@router.post("/start-application", status_code=status.HTTP_201_CREATED)
def start_application_for_client(
    data: StartApplicationForClient,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Create a draft application on behalf of a client and send them an email to complete it."""
    from app.models.loan_application import LoanType

    client = db.query(User).filter(User.id == data.client_id).first()
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")
    if client.role.value != "client":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is not a client")

    # Validate loan type
    try:
        loan_type = LoanType(data.loan_type)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid loan type: {data.loan_type}")

    application = LoanApplication(
        user_id=client.id,
        loan_type=loan_type,
        amount=data.amount,
        notes=data.notes,
        tenant_id=tenant_id,
        assigned_broker_id=current_user.id,
    )
    db.add(application)
    db.flush()

    db.add(ApplicationBroker(
        application_id=application.id,
        broker_id=current_user.id,
        tenant_id=tenant_id,
    ))

    db.commit()
    db.refresh(application)

    send_complete_application_email(
        to_email=client.email,
        client_name=client.full_name,
        inviter_name=current_user.full_name,
        loan_type=loan_type.value,
        amount=str(data.amount),
        application_id=application.id,
    )

    return {
        "detail": f"Draft application created and invite sent to {client.email}",
        "application_id": application.id,
    }


class InviteNewClientCreate(BaseModel):
    first_name: str
    last_name: str
    email: EmailStr
    phone: Optional[str] = None
    loan_type: str
    amount: float
    notes: Optional[str] = None

    _normalize_email = field_validator("email", mode="before")(normalize_email)


@router.post("/invite-new-client", status_code=status.HTTP_201_CREATED)
def invite_new_client_with_application(
    data: InviteNewClientCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Invite a brand-new client and create a draft application in one step.

    If the email is already registered and pending setup, refreshes their token.
    If fully set up, sends a complete-application email instead.
    """
    email = data.email.lower().strip()

    if email == current_user.email.lower():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot invite yourself")

    try:
        loan_type = LoanType(data.loan_type)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid loan type: {data.loan_type}")

    full_name = f"{data.first_name.strip()} {data.last_name.strip()}".strip()
    existing = db.query(User).filter(User.email == email, User.tenant_id == tenant_id).first()

    if existing and not existing.is_active:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This account has been deactivated. Reactivate it first.")

    is_new_user = existing is None or existing.password_hash in ("!", "!invited")

    if existing is None:
        token = secrets.token_urlsafe(32)
        client = User(
            email=email,
            full_name=full_name,
            phone=data.phone,
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
    else:
        client = existing
        if is_new_user:
            token = secrets.token_urlsafe(32)
            client.email_verification_token = token
            client.email_verification_token_expires_at = datetime.now(timezone.utc) + timedelta(hours=48)
            db.flush()

    application = LoanApplication(
        user_id=client.id,
        loan_type=loan_type,
        amount=data.amount,
        notes=data.notes,
        tenant_id=tenant_id,
        assigned_broker_id=current_user.id,
    )
    db.add(application)
    db.flush()

    db.add(ApplicationBroker(
        application_id=application.id,
        broker_id=current_user.id,
        tenant_id=tenant_id,
    ))

    db.commit()
    db.refresh(client)
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

    return {
        "detail": f"Client invited and application created for {email}",
        "application_id": application.id,
        "client_id": client.id,
        "is_new_user": is_new_user,
    }
