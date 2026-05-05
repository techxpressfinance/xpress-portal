from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.client_message import ClientMessage
from app.models.external_referral import ClientEngagementModel, ExternalReferral
from app.models.referral import Referral
from app.models.user import User, UserRole
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/clients", tags=["client-messages"])


class ClientMessageCreate(BaseModel):
    content: str
    recipient_id: str


def _check_access(client_id: str, current_user: User, tenant_id: str, db: Session) -> None:
    if current_user.role in (UserRole.admin, UserRole.broker):
        client = db.query(User).filter(User.id == client_id, User.tenant_id == tenant_id).first()
        if not client:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")
        if current_user.role == UserRole.broker:
            direct = db.query(ExternalReferral).filter(
                ExternalReferral.referred_client_id == client_id,
                ExternalReferral.client_engagement_model == ClientEngagementModel.direct_engagement,
            ).first()
            if direct:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This client is managed by their referrer")
    elif current_user.role == UserRole.client:
        if client_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    elif current_user.role == UserRole.referrer:
        # Allow referrer to use their own ID as the conversation subject (for staff direct chats)
        if client_id == current_user.id:
            return
        ext_referral = db.query(ExternalReferral).filter(
            ExternalReferral.referrer_id == current_user.id,
            ExternalReferral.referred_client_id == client_id,
        ).first()
        if not ext_referral:
            referral = db.query(Referral).filter(
                Referral.referrer_id == current_user.id,
                Referral.referred_user_id == client_id,
                Referral.tenant_id == tenant_id,
            ).first()
            if not referral:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    else:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")


def _msg_out(msg: ClientMessage) -> dict:
    return {
        "id": msg.id,
        "client_id": msg.client_id,
        "author_id": msg.author_id,
        "author_name": msg.author.full_name if msg.author else None,
        "author_role": msg.author.role.value if msg.author else None,
        "recipient_id": msg.recipient_id,
        "content": msg.content,
        "is_read": msg.is_read,
        "created_at": msg.created_at,
    }


@router.get("/{client_id}/messages")
def list_client_messages(
    client_id: str,
    peer_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    _check_access(client_id, current_user, tenant_id, db)
    q = db.query(ClientMessage).filter(
        ClientMessage.client_id == client_id,
        ClientMessage.tenant_id == tenant_id,
    )
    if peer_id:
        q = q.filter(
            or_(ClientMessage.author_id == peer_id, ClientMessage.recipient_id == peer_id)
        )
    msgs = q.order_by(ClientMessage.created_at.asc()).all()
    # Mark received messages as read
    unread = [m for m in msgs if m.recipient_id == current_user.id and not m.is_read]
    if unread:
        for m in unread:
            m.is_read = True
        db.commit()
    return [_msg_out(m) for m in msgs]


@router.post("/{client_id}/messages", status_code=status.HTTP_201_CREATED)
def create_client_message(
    client_id: str,
    data: ClientMessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    _check_access(client_id, current_user, tenant_id, db)
    if not data.content.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Content required")
    recipient = db.query(User).filter(User.id == data.recipient_id).first()
    if not recipient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipient not found")
    # Invariant: one of the two participants must be the conversation subject (client_id)
    if current_user.id != client_id and data.recipient_id != client_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Sender or recipient must match the conversation subject")
    if data.recipient_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Cannot send a message to yourself")
    # Client-specific restrictions
    if current_user.role == UserRole.client:
        if recipient.role == UserRole.client:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot message another client")
        direct = db.query(ExternalReferral).filter(
            ExternalReferral.referred_client_id == current_user.id,
            ExternalReferral.client_engagement_model == ClientEngagementModel.direct_engagement,
        ).first()
        if direct and recipient.role in (UserRole.broker, UserRole.admin):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Your account is managed by your referrer")
    msg = ClientMessage(
        client_id=client_id,
        author_id=current_user.id,
        recipient_id=data.recipient_id,
        content=data.content.strip(),
        tenant_id=tenant_id,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return _msg_out(msg)


@router.delete("/{client_id}/messages/{msg_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_client_message(
    client_id: str,
    msg_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    if current_user.role not in (UserRole.admin, UserRole.broker):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin or broker required")
    msg = db.query(ClientMessage).filter(
        ClientMessage.id == msg_id,
        ClientMessage.client_id == client_id,
        ClientMessage.tenant_id == tenant_id,
    ).first()
    if not msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    db.delete(msg)
    db.commit()
