from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session, aliased

from app.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.loan_application import LoanApplication
from app.models.user import User
from app.schemas.user import InvitationCreate, InvitationOut, InviteToCompleteCreate, PaginatedInvitations, StartApplicationForClient, UserOut
from app.services.email import send_complete_application_email, send_invitation_email
from app.services.login_code import set_login_code

router = APIRouter(prefix="/api/invitations", tags=["invitations"])


@router.get("", response_model=PaginatedInvitations)
def list_invitations(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
):
    Inviter = aliased(User)
    query = (
        db.query(User, Inviter.full_name.label("inviter_name"))
        .outerjoin(Inviter, User.invited_by_id == Inviter.id)
        .filter(User.invited_by_id.isnot(None))
    )

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

    items = []
    for user, inviter_name in rows:
        item = InvitationOut.model_validate(user)
        item.invited_by_name = inviter_name
        items.append(item)

    return PaginatedInvitations(items=items, total=total, page=page, per_page=per_page)


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def invite_user(
    data: InvitationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
):
    if data.email.lower() == current_user.email.lower():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot invite yourself")

    existing = db.query(User).filter(User.email == data.email).first()

    if existing:
        if existing.auth_method != "code":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This email already has a password-based account",
            )
        if not existing.is_active:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This account has been deactivated. Reactivate it first.",
            )
        # Re-invite: generate a fresh code
        plain = set_login_code(existing)
        db.commit()
        db.refresh(existing)
        send_invitation_email(data.email, existing.full_name, plain, current_user.full_name)
        return existing

    # Create new invited user
    user = User(
        email=data.email,
        full_name=data.full_name,
        phone=data.phone,
        password_hash="!invited",
        auth_method="code",
        role="client",
        is_active=True,
        email_verified=True,
        login_code_attempts=0,
        invited_by_id=current_user.id,
    )
    plain = set_login_code(user)
    db.add(user)
    db.commit()
    db.refresh(user)

    send_invitation_email(data.email, data.full_name, plain, current_user.full_name)
    return user


@router.post("/complete-application", status_code=status.HTTP_200_OK)
def invite_to_complete_application(
    data: InviteToCompleteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
):
    application = db.query(LoanApplication).filter(LoanApplication.id == data.application_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    if application.status.value != "draft":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Application is not in draft status")

    client = db.query(User).filter(User.id == application.user_id).first()
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")

    # Regenerate login code for code-auth users
    login_code = None
    if client.auth_method == "code":
        login_code = set_login_code(client)
        db.commit()

    send_complete_application_email(
        to_email=client.email,
        client_name=client.full_name,
        inviter_name=current_user.full_name,
        loan_type=application.loan_type.value,
        amount=str(application.amount),
        application_id=application.id,
        login_code=login_code,
    )

    return {"detail": f"Completion invite sent to {client.email}"}


@router.post("/start-application", status_code=status.HTTP_201_CREATED)
def start_application_for_client(
    data: StartApplicationForClient,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
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
    )
    db.add(application)
    db.flush()

    # Regenerate login code for code-auth users
    login_code = None
    if client.auth_method == "code":
        login_code = set_login_code(client)

    db.commit()
    db.refresh(application)

    send_complete_application_email(
        to_email=client.email,
        client_name=client.full_name,
        inviter_name=current_user.full_name,
        loan_type=loan_type.value,
        amount=str(data.amount),
        application_id=application.id,
        login_code=login_code,
    )

    return {
        "detail": f"Draft application created and invite sent to {client.email}",
        "application_id": application.id,
    }
