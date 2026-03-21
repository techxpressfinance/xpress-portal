import secrets
import string

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.activity_log import ActivityLog
from app.models.application_broker import ApplicationBroker
from app.models.application_note import ApplicationNote
from app.models.direct_message import DirectMessage
from app.models.loan_application import LoanApplication
from app.models.referral import Referral
from app.models.user import User
from app.schemas.user import BrokerCreate, KYCStatusUpdate, UserActiveUpdate, UserOut, UserProfileUpdate, UserRoleUpdate
from app.services.auth import hash_password
from app.services.email import send_broker_welcome_email

router = APIRouter(prefix="/api/users", tags=["users"])


def _generate_temp_password(length: int = 12) -> str:
    """Generate a temporary password that meets strength requirements."""
    alphabet = string.ascii_letters + string.digits
    while True:
        password = "".join(secrets.choice(alphabet) for _ in range(length))
        if any(c.isupper() for c in password) and any(c.isdigit() for c in password):
            return password


@router.get("", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
):
    return db.query(User).order_by(User.created_at.desc()).limit(500).all()


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=UserOut)
def update_profile(
    data: UserProfileUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if data.full_name is not None:
        current_user.full_name = data.full_name
    if data.phone is not None:
        current_user.phone = data.phone
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/brokers", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_broker(
    data: BrokerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Create a new broker account. Admin only. Sends login credentials via email."""
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        )

    temp_password = _generate_temp_password()

    user = User(
        email=data.email,
        full_name=data.full_name,
        phone=data.phone,
        password_hash=hash_password(temp_password),
        auth_method="password",
        role="broker",
        is_active=True,
        email_verified=True,
        employee_id=data.employee_id,
        department=data.department,
        license_number=data.license_number,
        invited_by_id=current_user.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    send_broker_welcome_email(data.email, data.full_name, temp_password)
    return user


@router.get("/{user_id}/referrer")
def get_user_referrer(
    user_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
):
    """Get the referrer of a user, if any."""
    referral = db.query(Referral).filter(
        Referral.referred_user_id == user_id,
    ).first()
    if not referral:
        return {"referrer": None}
    referrer = db.query(User).filter(User.id == referral.referrer_id).first()
    if not referrer:
        return {"referrer": None}
    return {
        "referrer": {
            "id": referrer.id,
            "full_name": referrer.full_name,
            "email": referrer.email,
            "phone": referrer.phone,
        }
    }


@router.get("/{user_id}", response_model=UserOut)
def get_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role.value == "client" and current_user.id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot view other users")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


@router.patch("/{user_id}/kyc", response_model=UserOut)
def update_kyc_status(
    user_id: str,
    data: KYCStatusUpdate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    user.kyc_status = data.kyc_status
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}/role", response_model=UserOut)
def update_user_role(
    user_id: str,
    data: UserRoleUpdate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
):
    if user_id == _current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot change your own role")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Clients cannot be promoted directly to admin — must go through broker first
    if user.role.value == "client" and data.role.value == "admin":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot promote a client directly to admin. Promote to broker first.",
        )

    user.role = data.role
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}/active", response_model=UserOut)
def toggle_user_active(
    user_id: str,
    data: UserActiveUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot deactivate yourself")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    user.is_active = data.is_active
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Permanently delete a user. Admin only. Blocked if user owns loan applications."""
    if user_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete yourself")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Block deletion if user owns loan applications
    app_count = db.query(LoanApplication).filter(LoanApplication.user_id == user_id).count()
    if app_count > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot delete user with {app_count} loan application(s). Deactivate instead.",
        )

    # Clean up related records
    db.query(ActivityLog).filter(ActivityLog.user_id == user_id).delete()
    db.query(ApplicationNote).filter(ApplicationNote.author_id == user_id).delete()
    db.query(DirectMessage).filter(
        (DirectMessage.sender_id == user_id) | (DirectMessage.recipient_id == user_id)
    ).delete(synchronize_session="fetch")
    db.query(Referral).filter(
        (Referral.referrer_id == user_id) | (Referral.referred_user_id == user_id)
    ).delete(synchronize_session="fetch")
    db.query(ApplicationBroker).filter(ApplicationBroker.broker_id == user_id).delete()

    # Nullify assigned_broker_id and completed_by_id references
    db.query(LoanApplication).filter(LoanApplication.assigned_broker_id == user_id).update(
        {"assigned_broker_id": None}, synchronize_session="fetch"
    )
    db.query(LoanApplication).filter(LoanApplication.completed_by_id == user_id).update(
        {"completed_by_id": None}, synchronize_session="fetch"
    )

    # Nullify invited_by_id on other users
    db.query(User).filter(User.invited_by_id == user_id).update(
        {"invited_by_id": None}, synchronize_session="fetch"
    )

    db.delete(user)
    db.commit()
