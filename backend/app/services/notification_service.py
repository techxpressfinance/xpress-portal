from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.notification import Notification


def create_notification(
    db: Session,
    *,
    user_id: str,
    type: str,
    title: str,
    body: str | None,
    link: str,
    tenant_id: str,
) -> Notification:
    notif = Notification(
        user_id=user_id,
        type=type,
        title=title,
        body=body,
        link=link,
        tenant_id=tenant_id,
    )
    db.add(notif)
    db.flush()
    return notif
