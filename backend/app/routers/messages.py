from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import EMAIL_ENABLED
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.application_note import ApplicationNote
from app.models.client_alert import ClientAlert
from app.models.client_message import ClientMessage
from app.models.direct_message import DirectMessage
from app.models.notification import Notification
from app.models.external_referral import ExternalReferral
from app.models.loan_application import LoanApplication
from app.models.referral import Referral
from app.models.user import User
from app.models.user import UserRole
from app.schemas.message import ApplicationNoteMessageOut, MessageCreate, MessageOut, MessageRecipientOut, PaginatedMessages
from app.services.email import _send_async
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


@router.get("/notifications")
def get_notifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    items: list[dict] = []

    # Unread direct messages
    msgs = (
        db.query(DirectMessage)
        .filter(
            DirectMessage.recipient_id == current_user.id,
            DirectMessage.is_read == False,  # noqa: E712
            DirectMessage.tenant_id == tenant_id,
        )
        .order_by(DirectMessage.created_at.desc())
        .limit(15)
        .all()
    )
    for msg in msgs:
        sender_name = msg.sender.full_name if msg.sender else "Someone"
        preview = msg.content[:80] + ("..." if len(msg.content) > 80 else "")
        if current_user.role == UserRole.client:
            link = "/messages"
        elif current_user.role == UserRole.referrer:
            link = "/referrer/messages"
        else:
            link = "/admin/messages"
        items.append({
            "id": msg.id,
            "type": "message",
            "title": f"Message from {sender_name}",
            "body": msg.subject or preview,
            "is_read": msg.is_read,
            "created_at": msg.created_at.isoformat(),
            "link": link,
        })

    # Unread client messages (for clients)
    client_msgs = (
        db.query(ClientMessage)
        .filter(
            ClientMessage.recipient_id == current_user.id,
            ClientMessage.is_read == False,  # noqa: E712
            ClientMessage.tenant_id == tenant_id,
        )
        .order_by(ClientMessage.created_at.desc())
        .limit(10)
        .all()
    )
    for msg in client_msgs:
        sender_name = msg.author.full_name if msg.author else "Your broker"
        preview = msg.content[:80] + ("..." if len(msg.content) > 80 else "")
        if current_user.role == UserRole.client:
            link = "/messages"
        elif current_user.role == UserRole.referrer:
            link = "/referrer/messages"
        else:
            link = "/admin/messages"
        items.append({
            "id": msg.id,
            "type": "message",
            "title": f"Message from {sender_name}",
            "body": preview,
            "is_read": msg.is_read,
            "created_at": msg.created_at.isoformat(),
            "link": link,
        })

    # Client alerts (for clients)
    if current_user.role == UserRole.client:
        alerts = (
            db.query(ClientAlert)
            .filter(
                ClientAlert.client_id == current_user.id,
                ClientAlert.is_read == False,  # noqa: E712
                ClientAlert.tenant_id == tenant_id,
            )
            .order_by(ClientAlert.created_at.desc())
            .limit(10)
            .all()
        )
        for alert in alerts:
            items.append({
                "id": alert.id,
                "type": "alert",
                "title": "Update from your broker",
                "body": alert.content[:100] + ("..." if len(alert.content) > 100 else ""),
                "is_read": alert.is_read,
                "created_at": alert.created_at.isoformat(),
                "link": "/applications",
            })

    # Dedicated notification records (status changes, document requests, etc.)
    db_notifs = (
        db.query(Notification)
        .filter(
            Notification.user_id == current_user.id,
            Notification.is_read == False,  # noqa: E712
            Notification.tenant_id == tenant_id,
        )
        .order_by(Notification.created_at.desc())
        .limit(20)
        .all()
    )
    for n in db_notifs:
        items.append({
            "id": n.id,
            "type": n.type,
            "title": n.title,
            "body": n.body or "",
            "is_read": n.is_read,
            "created_at": n.created_at.isoformat(),
            "link": n.link,
        })

    items.sort(key=lambda x: x["created_at"], reverse=True)
    return items[:20]


@router.get("/unread-count")
def unread_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    direct_count = (
        db.query(DirectMessage)
        .filter(DirectMessage.recipient_id == current_user.id, DirectMessage.is_read == False, DirectMessage.tenant_id == tenant_id)  # noqa: E712
        .count()
    )
    client_count = (
        db.query(ClientMessage)
        .filter(ClientMessage.recipient_id == current_user.id, ClientMessage.is_read == False, ClientMessage.tenant_id == tenant_id)  # noqa: E712
        .count()
    )
    alert_count = 0
    if current_user.role == UserRole.client:
        alert_count = (
            db.query(ClientAlert)
            .filter(ClientAlert.client_id == current_user.id, ClientAlert.is_read == False, ClientAlert.tenant_id == tenant_id)  # noqa: E712
            .count()
        )
    notif_count = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id, Notification.is_read == False, Notification.tenant_id == tenant_id)  # noqa: E712
        .count()
    )
    return {"count": direct_count + client_count + alert_count + notif_count}


@router.post("/notifications/{notification_id}/read", status_code=status.HTTP_200_OK)
def mark_notification_read(
    notification_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    # Try DirectMessage
    msg = db.query(DirectMessage).filter(
        DirectMessage.id == notification_id,
        DirectMessage.recipient_id == current_user.id,
        DirectMessage.tenant_id == tenant_id,
    ).first()
    if msg:
        msg.is_read = True
        db.commit()
        return {"ok": True}

    # Try ClientMessage
    client_msg = db.query(ClientMessage).filter(
        ClientMessage.id == notification_id,
        ClientMessage.recipient_id == current_user.id,
        ClientMessage.tenant_id == tenant_id,
    ).first()
    if client_msg:
        client_msg.is_read = True
        db.commit()
        return {"ok": True}

    # Try ClientAlert
    alert = db.query(ClientAlert).filter(
        ClientAlert.id == notification_id,
        ClientAlert.client_id == current_user.id,
        ClientAlert.tenant_id == tenant_id,
    ).first()
    if alert:
        alert.is_read = True
        db.commit()
        return {"ok": True}

    # Try Notification
    notif = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == current_user.id,
        Notification.tenant_id == tenant_id,
    ).first()
    if notif:
        notif.is_read = True
        db.commit()
        return {"ok": True}

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")


@router.get("", response_model=PaginatedMessages)
def list_messages(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    query = db.query(DirectMessage).filter(
        DirectMessage.tenant_id == tenant_id,
        or_(DirectMessage.recipient_id == current_user.id, DirectMessage.sender_id == current_user.id),
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
            .filter(
                ApplicationNote.tenant_id == tenant_id,
                LoanApplication.user_id == current_user.id,
                ApplicationNote.visibility.contains("client"),
            )
            .order_by(ApplicationNote.created_at.desc())
            .all()
        )
    elif current_user.role.value == "referrer":
        # Referrer sees notes where visibility includes "referrer"
        notes = (
            db.query(ApplicationNote)
            .filter(
                ApplicationNote.tenant_id == tenant_id,
                ApplicationNote.visibility.contains("referrer"),
            )
            .order_by(ApplicationNote.created_at.desc())
            .all()
        )
    else:
        # Broker/admin sees client/referrer-visible notes they authored (for the Messages page)
        notes = (
            db.query(ApplicationNote)
            .filter(
                ApplicationNote.tenant_id == tenant_id,
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
    role = current_user.role.value
    if role == "client":
        recipients = db.query(User).filter(User.role.in_([UserRole.broker, UserRole.admin]), User.tenant_id == tenant_id).all()
    elif role == "referrer":
        # Referrers can message brokers, admins, and clients they referred
        staff = db.query(User).filter(User.role.in_([UserRole.broker, UserRole.admin]), User.tenant_id == tenant_id).all()
        # Get clients they referred via ExternalReferral
        ext_referral_clients = db.query(User).join(
            ExternalReferral, User.id == ExternalReferral.referred_client_id
        ).filter(
            ExternalReferral.referrer_id == current_user.id,
            ExternalReferral.referred_client_id.isnot(None),
        ).all()
        # Get clients they referred via Referral (internal)
        internal_referral_clients = db.query(User).join(
            Referral, User.id == Referral.referred_user_id
        ).filter(
            Referral.referrer_id == current_user.id,
            Referral.referred_user_id.isnot(None),
        ).all()
        # Combine and deduplicate
        seen_ids = {u.id for u in staff}
        recipients = list(staff)
        for client in ext_referral_clients + internal_referral_clients:
            if client.id not in seen_ids:
                recipients.append(client)
                seen_ids.add(client.id)
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
    from datetime import datetime, timezone
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
            if peer and peer.role == UserRole.broker:
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
    # Validate recipient exists within the same tenant
    recipient = db.query(User).filter(User.id == data.recipient_id, User.tenant_id == tenant_id).first()
    if not recipient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipient not found")

    sender_role = current_user.role.value
    recipient_role = recipient.role.value
    if sender_role == "client" and recipient_role not in {"broker", "admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Clients can only message brokers or admins")
    if sender_role == "referrer":
        # Referrers can message brokers, admins, or clients they referred
        if recipient_role in {"broker", "admin"}:
            pass  # Allowed
        elif recipient_role == "client":
            # Check if this referrer referred this client
            referred = db.query(ExternalReferral).filter(
                ExternalReferral.referrer_id == current_user.id,
                ExternalReferral.referred_client_id == recipient.id,
            ).first() or db.query(Referral).filter(
                Referral.referrer_id == current_user.id,
                Referral.referred_user_id == recipient.id,
            ).first()
            if not referred:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You can only message clients you referred",
                )
        else:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Referrers can only message brokers, admins, or clients they referred")
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
        _send_async(recipient.email, f"New Message: {data.subject} - Xpress Finance Portal", body)
    else:
        logger.debug("Email not configured, skipping message notification to %s", recipient.email)

    return _message_to_out(msg)
