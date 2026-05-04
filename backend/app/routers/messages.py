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
from app.models.client_message import ClientMessage
from app.models.direct_message import DirectMessage
from app.models.external_referral import ExternalReferral
from app.models.loan_application import LoanApplication
from app.models.referral import Referral
from app.models.user import User
from app.models.user import UserRole
from app.schemas.message import ApplicationNoteMessageOut, MessageCreate, MessageOut, MessageRecipientOut, PaginatedMessages
from app.services.email import _send_email
from app.services.tenant_scope import get_tenant_id

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
    tenant_id: str = Depends(get_tenant_id),
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
    tenant_id: str = Depends(get_tenant_id),
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
    tenant_id: str = Depends(get_tenant_id),
):
    """Return application notes visible to the current user (based on visibility field)."""
    if current_user.role.value == "client":
        # Client sees notes where visibility includes "client" on their own applications
        notes = (
            db.query(ApplicationNote)
            .join(LoanApplication, ApplicationNote.application_id == LoanApplication.id)
            .filter(LoanApplication.user_id == current_user.id, ApplicationNote.visibility.contains("client"))
            .order_by(ApplicationNote.created_at.desc())
            .all()
        )
    elif current_user.role.value == "referrer":
        # Referrer sees notes where visibility includes "referrer"
        notes = (
            db.query(ApplicationNote)
            .filter(ApplicationNote.visibility.contains("referrer"))
            .order_by(ApplicationNote.created_at.desc())
            .all()
        )
    else:
        # Broker/admin sees client/referrer-visible notes they authored (for the Messages page)
        notes = (
            db.query(ApplicationNote)
            .filter(
                ApplicationNote.author_id == current_user.id,
                ApplicationNote.visibility != "broker",
            )
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
    tenant_id: str = Depends(get_tenant_id),
):
    from app.models.external_referral import ClientEngagementModel
    if current_user.role.value in {"client", "referrer"}:
        recipients = db.query(User).filter(User.role.in_([UserRole.broker, UserRole.admin]), User.tenant_id == tenant_id).all()
    else:
        all_recipients = db.query(User).filter(
            User.role.in_([UserRole.client, UserRole.referrer, UserRole.broker]),
            User.tenant_id == tenant_id,
            User.id != current_user.id,
        ).all()
        if current_user.role.value == "broker":
            blocked = {
                r.referred_client_id
                for r in db.query(ExternalReferral).filter(
                    ExternalReferral.client_engagement_model == ClientEngagementModel.direct_engagement,
                    ExternalReferral.referred_client_id.isnot(None),
                ).all()
            }
            recipients = [u for u in all_recipients if not (u.role == UserRole.client and u.id in blocked)]
        else:
            recipients = all_recipients
    return recipients


def _build_conversations(pairs: list, db: Session, tenant_id: str) -> list:
    """Build per-peer conversation summaries. Each pair is (client_id, peer_id, client_name, peer_name)."""
    from datetime import datetime
    from sqlalchemy import or_
    conversations = []
    for client_id, peer_id, client_name, peer_name in pairs:
        last_msg = (
            db.query(ClientMessage)
            .filter(
                ClientMessage.client_id == client_id,
                ClientMessage.tenant_id == tenant_id,
                or_(ClientMessage.author_id == peer_id, ClientMessage.recipient_id == peer_id),
            )
            .order_by(ClientMessage.created_at.desc())
            .first()
        )
        msg_count = (
            db.query(ClientMessage)
            .filter(
                ClientMessage.client_id == client_id,
                ClientMessage.tenant_id == tenant_id,
                or_(ClientMessage.author_id == peer_id, ClientMessage.recipient_id == peer_id),
            )
            .count()
        )
        conversations.append({
            "client_id": client_id,
            "client_name": client_name,
            "peer_id": peer_id,
            "peer_name": peer_name,
            "last_message": last_msg.content if last_msg else None,
            "last_message_at": last_msg.created_at if last_msg else None,
            "last_message_author_name": last_msg.author.full_name if last_msg and last_msg.author else None,
            "message_count": msg_count,
        })
    conversations.sort(key=lambda c: c["last_message_at"] or datetime.min, reverse=True)
    return conversations


@router.get("/client-inbox")
def list_client_inbox(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Return one conversation summary per (client, peer) pair, scoped by role."""
    from app.models.external_referral import ClientEngagementModel
    role = current_user.role.value
    pairs: list = []

    if role == "referrer":
        seen: set = set()
        for r in db.query(ExternalReferral).filter(
            ExternalReferral.referrer_id == current_user.id,
            ExternalReferral.referred_client_id.isnot(None),
        ).all():
            if r.referred_client_id not in seen:
                client = db.query(User).filter(User.id == r.referred_client_id).first()
                if client:
                    pairs.append((r.referred_client_id, current_user.id, client.full_name, current_user.full_name))
                    seen.add(r.referred_client_id)
        for r in db.query(Referral).filter(
            Referral.referrer_id == current_user.id,
            Referral.tenant_id == tenant_id,
            Referral.referred_user_id.isnot(None),
        ).all():
            if r.referred_user_id not in seen:
                client = db.query(User).filter(User.id == r.referred_user_id).first()
                if client:
                    pairs.append((r.referred_user_id, current_user.id, client.full_name, current_user.full_name))
                    seen.add(r.referred_user_id)
        # Surface direct staff (admin/broker) conversations: client_id = referrer.id
        staff_rows = (
            db.query(ClientMessage.author_id, ClientMessage.recipient_id)
            .filter(
                ClientMessage.client_id == current_user.id,
                ClientMessage.tenant_id == tenant_id,
            )
            .all()
        )
        staff_peers: set = set()
        for row in staff_rows:
            if row.author_id and row.author_id != current_user.id:
                staff_peers.add(row.author_id)
            if row.recipient_id and row.recipient_id != current_user.id:
                staff_peers.add(row.recipient_id)
        for pid in staff_peers:
            peer = db.query(User).filter(User.id == pid).first()
            if peer and peer.role in (UserRole.broker, UserRole.admin):
                pairs.append((current_user.id, pid, current_user.full_name, peer.full_name))

    elif role in ("admin", "broker"):
        blocked: set = set()
        if role == "broker":
            blocked = {
                r.referred_client_id
                for r in db.query(ExternalReferral).filter(
                    ExternalReferral.client_engagement_model == ClientEngagementModel.direct_engagement,
                    ExternalReferral.referred_client_id.isnot(None),
                ).all()
            }
        client_ids = list({
            r.client_id
            for r in db.query(ClientMessage.client_id)
            .filter(
                ClientMessage.tenant_id == tenant_id,
                or_(ClientMessage.author_id == current_user.id, ClientMessage.recipient_id == current_user.id),
            )
            .all()
            if r.client_id not in blocked
        })
        for cid in client_ids:
            client = db.query(User).filter(User.id == cid).first()
            if client:
                pairs.append((cid, current_user.id, client.full_name, current_user.full_name))

    elif role == "client":
        rows = (
            db.query(ClientMessage.author_id, ClientMessage.recipient_id)
            .filter(
                ClientMessage.client_id == current_user.id,
                ClientMessage.tenant_id == tenant_id,
            )
            .all()
        )
        peer_ids: set = set()
        for row in rows:
            if row.author_id and row.author_id != current_user.id:
                peer_ids.add(row.author_id)
            if row.recipient_id and row.recipient_id != current_user.id:
                peer_ids.add(row.recipient_id)
        # Pre-populate referrer so client can initiate even without prior messages
        from app.models.external_referral import ClientEngagementModel
        ext_ref = db.query(ExternalReferral).filter(
            ExternalReferral.referred_client_id == current_user.id,
        ).first()
        if ext_ref and ext_ref.referrer_id:
            peer_ids.add(ext_ref.referrer_id)
        # If direct_engagement, only the referrer is allowed — don't add brokers
        is_direct = (
            ext_ref is not None
            and ext_ref.client_engagement_model == ClientEngagementModel.direct_engagement
        )
        if not is_direct:
            # Also pre-populate internal Referral referrer if present
            int_ref = db.query(Referral).filter(
                Referral.referred_user_id == current_user.id,
                Referral.tenant_id == tenant_id,
            ).first()
            if int_ref and int_ref.referrer_id:
                peer_ids.add(int_ref.referrer_id)
        for pid in peer_ids:
            peer = db.query(User).filter(User.id == pid).first()
            if peer:
                pairs.append((current_user.id, pid, current_user.full_name, peer.full_name))

    else:
        return []

    if not pairs:
        return []

    return _build_conversations(pairs, db, tenant_id)


@router.get("/{message_id}", response_model=MessageOut)
def get_message(
    message_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
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
    tenant_id: str = Depends(get_tenant_id),
):
    # Validate recipient exists and is a client
    recipient = db.query(User).filter(User.id == data.recipient_id).first()
    if not recipient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipient not found")

    sender_role = current_user.role.value
    recipient_role = recipient.role.value
    if sender_role == "client" and recipient_role not in {"broker", "admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Clients can only message brokers or admins")
    if sender_role == "referrer" and recipient_role not in {"broker", "admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Referrers can only message brokers or admins")
    if sender_role in {"broker", "admin"} and recipient_role not in {"client", "referrer"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Brokers and admins can only message clients or referrers")

    msg = DirectMessage(
        sender_id=current_user.id,
        recipient_id=data.recipient_id,
        subject=data.subject,
        content=data.content,
        tenant_id=tenant_id,
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
                f"Log in to your Xpress Finance Portal account to view the full message.\n\n"
                f"Best regards,\nXpress Finance Team"
            )
        else:
            body = (
                f"Hello {recipient.full_name},\n\n"
                f"You have a new client message from {current_user.full_name}.\n\n"
                f"Subject: {data.subject}\n\n"
                f"{data.content}\n\n"
                f"Log in to your Xpress Finance Portal account to reply.\n\n"
                f"Best regards,\nXpress Finance Team"
            )
        thread = threading.Thread(
            target=_send_email,
            args=(recipient.email, f"New Message: {data.subject} - Xpress Finance Portal", body),
            daemon=True,
        )
        thread.start()
    else:
        logger.debug("Email not configured, skipping message notification to %s", recipient.email)

    return _message_to_out(msg)
