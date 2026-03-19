from __future__ import annotations

import logging
import threading

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import EMAIL_ENABLED
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.application_note import ApplicationNote
from app.models.direct_message import DirectMessage
from app.models.loan_application import LoanApplication
from app.models.user import User
from app.models.user import UserRole
from app.schemas.message import ApplicationNoteMessageOut, MessageCreate, MessageOut, MessageRecipientOut, PaginatedMessages
from app.services.email import _send_email

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/messages", tags=["messages"])


def _message_to_out(msg: DirectMessage) -> MessageOut:
    return MessageOut(
        id=msg.id,
        sender_id=msg.sender_id,
        sender_name=msg.sender.full_name if msg.sender else None,
        recipient_id=msg.recipient_id,
        recipient_name=msg.recipient.full_name if msg.recipient else None,
        subject=msg.subject,
        content=msg.content,
        is_read=msg.is_read,
        created_at=msg.created_at,
    )


@router.get("/unread-count")
def unread_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    count = (
        db.query(DirectMessage)
        .filter(DirectMessage.recipient_id == current_user.id, DirectMessage.is_read == False)  # noqa: E712
        .count()
    )
    return {"count": count}


@router.get("", response_model=PaginatedMessages)
def list_messages(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(DirectMessage).filter(
        or_(DirectMessage.recipient_id == current_user.id, DirectMessage.sender_id == current_user.id)
    )

    total = query.count()
    messages = query.order_by(DirectMessage.created_at.desc()).offset((page - 1) * per_page).limit(per_page).all()

    items = [
        MessageOut(
            id=msg.id,
            sender_id=msg.sender_id,
            sender_name=msg.sender.full_name if msg.sender else None,
            recipient_id=msg.recipient_id,
            recipient_name=msg.recipient.full_name if msg.recipient else None,
            subject=msg.subject,
            content=msg.content,
            is_read=msg.is_read,
            created_at=msg.created_at,
        )
        for msg in messages
    ]
    return {
        "items": items,
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.get("/application-notes", response_model=list[ApplicationNoteMessageOut])
def list_application_note_messages(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return all non-internal application notes relevant to the current user."""
    if current_user.role.value == "client":
        # Client sees non-internal notes on their own applications
        notes = (
            db.query(ApplicationNote)
            .join(LoanApplication, ApplicationNote.application_id == LoanApplication.id)
            .filter(LoanApplication.user_id == current_user.id, ApplicationNote.is_internal == False)  # noqa: E712
            .order_by(ApplicationNote.created_at.desc())
            .all()
        )
    else:
        # Broker/admin sees non-internal notes they authored
        notes = (
            db.query(ApplicationNote)
            .filter(ApplicationNote.author_id == current_user.id, ApplicationNote.is_internal == False)  # noqa: E712
            .order_by(ApplicationNote.created_at.desc())
            .all()
        )
    return [
        ApplicationNoteMessageOut(
            id=n.id,
            application_id=n.application_id,
            loan_type=n.application.loan_type.value if n.application else "unknown",
            author_id=n.author_id,
            author_name=n.author.full_name if n.author else None,
            content=n.content,
            created_at=n.created_at,
        )
        for n in notes
    ]


@router.get("/recipients", response_model=list[MessageRecipientOut])
def list_message_recipients(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role.value == "client":
        recipients = db.query(User).filter(User.role.in_([UserRole.broker, UserRole.admin])).all()
    else:
        recipients = db.query(User).filter(User.role == UserRole.client).all()
    return recipients


@router.get("/{message_id}", response_model=MessageOut)
def get_message(
    message_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    msg = db.query(DirectMessage).filter(DirectMessage.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    # Only sender or recipient can view
    if msg.sender_id != current_user.id and msg.recipient_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    # Mark as read if current user is the recipient
    if msg.recipient_id == current_user.id and not msg.is_read:
        msg.is_read = True
        db.commit()
        db.refresh(msg)

    return _message_to_out(msg)


@router.post("", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
def send_message(
    data: MessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Validate recipient exists and is a client
    recipient = db.query(User).filter(User.id == data.recipient_id).first()
    if not recipient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipient not found")

    sender_role = current_user.role.value
    recipient_role = recipient.role.value
    if sender_role == "client" and recipient_role not in {"broker", "admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Clients can only message brokers or admins")
    if sender_role in {"broker", "admin"} and recipient_role != "client":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Brokers and admins can only message clients")

    msg = DirectMessage(
        sender_id=current_user.id,
        recipient_id=data.recipient_id,
        subject=data.subject,
        content=data.content,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)

    # Send email notification to the recipient
    if EMAIL_ENABLED:
        if recipient_role == "client":
            body = (
                f"Dear {recipient.full_name},\n\n"
                f"You have a new message from {current_user.full_name}.\n\n"
                f"Subject: {data.subject}\n\n"
                f"{data.content}\n\n"
                f"Log in to your Xpress Tech Portal account to view the full message.\n\n"
                f"Best regards,\nXpress Tech Team"
            )
        else:
            body = (
                f"Hello {recipient.full_name},\n\n"
                f"You have a new client message from {current_user.full_name}.\n\n"
                f"Subject: {data.subject}\n\n"
                f"{data.content}\n\n"
                f"Log in to your Xpress Tech Portal account to reply.\n\n"
                f"Best regards,\nXpress Tech Team"
            )
        thread = threading.Thread(
            target=_send_email,
            args=(recipient.email, f"New Message: {data.subject} - Xpress Tech Portal", body),
            daemon=True,
        )
        thread.start()
    else:
        logger.debug("Email not configured, skipping message notification to %s", recipient.email)

    return _message_to_out(msg)
