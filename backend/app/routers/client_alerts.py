from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.client_alert import ClientAlert
from app.models.user import User
from app.services.activity_log import log_activity
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/clients", tags=["client-alerts"])


class ClientAlertCreate(BaseModel):
    content: str


def _alert_out(alert: ClientAlert) -> dict:
    return {
        "id": alert.id,
        "client_id": alert.client_id,
        "author_id": alert.author_id,
        "author_name": alert.author.full_name if alert.author else None,
        "author_role": alert.author.role.value if alert.author else None,
        "content": alert.content,
        "created_at": alert.created_at,
    }


@router.get("/{client_id}/alerts")
def list_client_alerts(
    client_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    alerts = (
        db.query(ClientAlert)
        .filter(ClientAlert.client_id == client_id, ClientAlert.tenant_id == tenant_id)
        .order_by(ClientAlert.created_at.asc())
        .all()
    )
    return [_alert_out(a) for a in alerts]


@router.post("/{client_id}/alerts", status_code=status.HTTP_201_CREATED)
def create_client_alert(
    client_id: str,
    data: ClientAlertCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    if not data.content.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Content required")
    alert = ClientAlert(
        client_id=client_id,
        author_id=current_user.id,
        content=data.content.strip(),
        tenant_id=tenant_id,
    )
    db.add(alert)
    db.flush()
    log_activity(db, current_user.id, "alert_created", "client_alert", alert.id, {"client_id": client_id}, tenant_id=tenant_id)
    db.commit()
    db.refresh(alert)
    return _alert_out(alert)


@router.delete("/{client_id}/alerts/{alert_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_client_alert(
    client_id: str,
    alert_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    alert = db.query(ClientAlert).filter(
        ClientAlert.id == alert_id,
        ClientAlert.client_id == client_id,
        ClientAlert.tenant_id == tenant_id,
    ).first()
    if not alert:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")
    log_activity(db, current_user.id, "alert_deleted", "client_alert", alert_id, {"client_id": client_id}, tenant_id=tenant_id)
    db.delete(alert)
    db.commit()
