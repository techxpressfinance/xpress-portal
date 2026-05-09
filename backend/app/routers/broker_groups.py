from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.broker_group import BrokerGroup, broker_group_members
from app.models.user import User, UserRole
from app.schemas.broker_group import BrokerGroupCreate, BrokerGroupMemberOut, BrokerGroupOut, BrokerGroupUpdate
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/broker-groups", tags=["broker-groups"])


@router.get("", response_model=list[BrokerGroupOut])
def list_groups(
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    return db.query(BrokerGroup).filter(BrokerGroup.tenant_id == tenant_id).order_by(BrokerGroup.name).all()


@router.post("", response_model=BrokerGroupOut, status_code=status.HTTP_201_CREATED)
def create_group(
    data: BrokerGroupCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    existing = db.query(BrokerGroup).filter(BrokerGroup.name == data.name, BrokerGroup.tenant_id == tenant_id).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A group with this name already exists")

    group = BrokerGroup(name=data.name, description=data.description, created_by_id=current_user.id, tenant_id=tenant_id)

    # Add initial members
    if data.member_ids:
        brokers = db.query(User).filter(User.id.in_(data.member_ids), User.role == UserRole.broker, User.tenant_id == tenant_id).all()
        group.members = brokers

    db.add(group)
    db.commit()
    db.refresh(group)
    return group


@router.get("/{group_id}", response_model=BrokerGroupOut)
def get_group(
    group_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    group = db.query(BrokerGroup).filter(BrokerGroup.id == group_id, BrokerGroup.tenant_id == tenant_id).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    return group


@router.patch("/{group_id}", response_model=BrokerGroupOut)
def update_group(
    group_id: str,
    data: BrokerGroupUpdate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    group = db.query(BrokerGroup).filter(BrokerGroup.id == group_id, BrokerGroup.tenant_id == tenant_id).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    if data.name is not None:
        group.name = data.name
    if data.description is not None:
        group.description = data.description
    db.commit()
    db.refresh(group)
    return group


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group(
    group_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    group = db.query(BrokerGroup).filter(BrokerGroup.id == group_id, BrokerGroup.tenant_id == tenant_id).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    db.delete(group)
    db.commit()


@router.post("/{group_id}/members", response_model=BrokerGroupOut)
def add_member(
    group_id: str,
    broker_id: str = Query(...),
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    group = db.query(BrokerGroup).filter(BrokerGroup.id == group_id, BrokerGroup.tenant_id == tenant_id).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")

    broker = db.query(User).filter(User.id == broker_id, User.role == UserRole.broker, User.tenant_id == tenant_id).first()
    if not broker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Broker not found")

    if any(m.id == broker_id for m in group.members):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Broker is already in this group")

    group.members.append(broker)
    db.commit()
    db.refresh(group)
    return group


@router.delete("/{group_id}/members", response_model=BrokerGroupOut)
def remove_member(
    group_id: str,
    broker_id: str = Query(...),
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    group = db.query(BrokerGroup).filter(BrokerGroup.id == group_id, BrokerGroup.tenant_id == tenant_id).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")

    broker = db.query(User).filter(User.id == broker_id, User.tenant_id == tenant_id).first()
    if not broker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Broker not found")

    if not any(m.id == broker_id for m in group.members):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Broker is not in this group")

    group.members.remove(broker)
    db.commit()
    db.refresh(group)
    return group
