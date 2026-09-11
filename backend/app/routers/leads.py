from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.middleware.auth import require_role
from app.models.kanban import KanbanBoard, KanbanColumn
from app.models.lead import Lead, LeadStagePlacement, LeadStatus
from app.models.user import User, UserRole
from app.schemas.lead import LeadCreate, LeadLostRequest, LeadOut, LeadUpdate
from app.services.activity_log import log_activity
from app.services.leads import lead_name, lead_to_dict, validate_lead_category
from app.services.loan_category import parse_categories
from app.services.organizations import normalize_abn
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/leads", tags=["leads"])


def _clean(value: Optional[str]) -> Optional[str]:
    return (value or "").strip() or None


def _clean_abn(value: Optional[str]) -> Optional[str]:
    abn = normalize_abn(_clean(value))
    if abn and len(abn) != 11:
        raise HTTPException(status_code=400, detail="An ABN has 11 digits")
    return abn or None


def _get_lead(lead_id: str, tenant_id: str, db: Session) -> Lead:
    lead = (
        db.query(Lead)
        .options(joinedload(Lead.assigned_broker), joinedload(Lead.created_by))
        .filter(Lead.id == lead_id, Lead.tenant_id == tenant_id, Lead.deleted_at.is_(None))
        .first()
    )
    if not lead:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    return lead


def _validate_broker(broker_id: Optional[str], tenant_id: str, db: Session) -> None:
    if not broker_id:
        return
    broker = db.query(User).filter(
        User.id == broker_id,
        User.tenant_id == tenant_id,
        User.role.in_([UserRole.admin, UserRole.broker]),
    ).first()
    if not broker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Broker not found")


@router.get("", response_model=list[LeadOut])
def list_leads(
    lead_status: Optional[str] = Query("open", alias="status", description="open | converted | lost | all"),
    category: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    query = (
        db.query(Lead)
        .options(joinedload(Lead.assigned_broker), joinedload(Lead.created_by))
        .filter(Lead.tenant_id == tenant_id, Lead.deleted_at.is_(None))
    )
    if lead_status and lead_status != "all":
        try:
            query = query.filter(Lead.status == LeadStatus(lead_status))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid status: {lead_status}") from exc
    try:
        categories = parse_categories(category)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if categories:
        query = query.filter(Lead.loan_category.in_(categories))
    leads = query.order_by(Lead.created_at.desc()).all()
    if search:
        needle = search.strip().lower()
        leads = [
            lead for lead in leads
            if any(needle in (v or "").lower() for v in (lead_name(lead), lead.email, lead.phone, lead.company_name))
        ]
    return [lead_to_dict(lead) for lead in leads]


@router.post("", response_model=LeadOut, status_code=status.HTTP_201_CREATED)
def create_lead(
    data: LeadCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    first_name = _clean(data.first_name)
    if not first_name:
        raise HTTPException(status_code=400, detail="A lead needs at least a first name")
    sub_type = _clean(data.sub_type)
    validate_lead_category(data.loan_category, sub_type)
    _validate_broker(data.assigned_broker_id, tenant_id, db)

    # Adding from a particular lead stage puts the card there; otherwise it shows
    # in each board's first lead stage.
    column: Optional[KanbanColumn] = None
    if data.column_id:
        column = (
            db.query(KanbanColumn)
            .join(KanbanBoard, KanbanBoard.id == KanbanColumn.board_id)
            .filter(
                KanbanColumn.id == data.column_id,
                KanbanBoard.tenant_id == tenant_id,
                *( [KanbanColumn.board_id == data.board_id] if data.board_id else [] ),
            )
            .first()
        )
        if not column:
            raise HTTPException(status_code=404, detail="Stage not found")
        if column.card_kind != "lead":
            raise HTTPException(status_code=400, detail="Leads can only be added to a lead stage")

    lead = Lead(
        tenant_id=tenant_id,
        created_by_id=current_user.id,
        # A broker's own inquiry is theirs unless they hand it to someone.
        assigned_broker_id=data.assigned_broker_id or (current_user.id if current_user.role == UserRole.broker else None),
        first_name=first_name,
        last_name=_clean(data.last_name),
        email=(_clean(data.email) or "").lower() or None,
        phone=_clean(data.phone),
        company_name=_clean(data.company_name),
        company_abn=_clean_abn(data.company_abn),
        loan_category=data.loan_category,
        sub_type=sub_type,
        amount=data.amount,
        source=_clean(data.source),
        notes=_clean(data.notes),
    )
    db.add(lead)
    db.flush()
    if column:
        db.add(LeadStagePlacement(
            lead_id=lead.id,
            board_id=column.board_id,
            column_id=column.id,
            tenant_id=tenant_id,
            moved_by_id=current_user.id,
        ))
    log_activity(db, current_user.id, "created", "lead", lead.id, {
        "loan_category": lead.loan_category, "amount": str(lead.amount) if lead.amount is not None else None,
    }, tenant_id=tenant_id)
    db.commit()
    return lead_to_dict(_get_lead(lead.id, tenant_id, db))


@router.get("/{lead_id}", response_model=LeadOut)
def get_lead(
    lead_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    return lead_to_dict(_get_lead(lead_id, tenant_id, db))


@router.patch("/{lead_id}", response_model=LeadOut)
def update_lead(
    lead_id: str,
    data: LeadUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    lead = _get_lead(lead_id, tenant_id, db)
    if lead.status == LeadStatus.converted:
        # The application is the live record now; editing the lead would make
        # the two disagree about what the client originally asked for.
        raise HTTPException(status_code=400, detail="A converted lead can't be edited — edit its application instead")
    updates = data.model_dump(exclude_unset=True)

    if "first_name" in updates:
        first_name = _clean(updates["first_name"])
        if not first_name:
            raise HTTPException(status_code=400, detail="A lead needs at least a first name")
        lead.first_name = first_name
    for field in ("last_name", "phone", "company_name", "source", "notes"):
        if field in updates:
            setattr(lead, field, _clean(updates[field]))
    if "email" in updates:
        lead.email = (_clean(updates["email"]) or "").lower() or None
    if "company_abn" in updates:
        lead.company_abn = _clean_abn(updates["company_abn"])
    if "amount" in updates:
        lead.amount = updates["amount"]
    if "assigned_broker_id" in updates:
        _validate_broker(updates["assigned_broker_id"], tenant_id, db)
        lead.assigned_broker_id = updates["assigned_broker_id"] or None

    if "loan_category" in updates or "sub_type" in updates:
        category = updates.get("loan_category") or lead.loan_category
        sub_type = _clean(updates["sub_type"]) if "sub_type" in updates else lead.sub_type
        # Switching category without naming a new type drops a type that no
        # longer belongs; naming a mismatched one is an error.
        if "sub_type" not in updates and sub_type:
            try:
                validate_lead_category(category, sub_type)
            except HTTPException:
                sub_type = None
        validate_lead_category(category, sub_type)
        lead.loan_category = category
        lead.sub_type = sub_type

    log_activity(db, current_user.id, "updated", "lead", lead.id, {"fields": sorted(updates)}, tenant_id=tenant_id)
    db.commit()
    return lead_to_dict(_get_lead(lead_id, tenant_id, db))


@router.post("/{lead_id}/lost", response_model=LeadOut)
def mark_lead_lost(
    lead_id: str,
    data: LeadLostRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Take an inquiry that went nowhere off the board, keeping why."""
    lead = _get_lead(lead_id, tenant_id, db)
    if lead.status != LeadStatus.open:
        raise HTTPException(status_code=400, detail="Only an open lead can be marked lost")
    lead.status = LeadStatus.lost
    lead.lost_reason = _clean(data.reason)
    lead.lost_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.query(LeadStagePlacement).filter(LeadStagePlacement.lead_id == lead_id).delete(synchronize_session=False)
    log_activity(db, current_user.id, "lost", "lead", lead.id, {"reason": lead.lost_reason}, tenant_id=tenant_id)
    db.commit()
    return lead_to_dict(_get_lead(lead_id, tenant_id, db))


@router.post("/{lead_id}/reopen", response_model=LeadOut)
def reopen_lead(
    lead_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    lead = _get_lead(lead_id, tenant_id, db)
    if lead.status != LeadStatus.lost:
        raise HTTPException(status_code=400, detail="Only a lost lead can be reopened")
    lead.status = LeadStatus.open
    lead.lost_reason = None
    lead.lost_at = None
    log_activity(db, current_user.id, "reopened", "lead", lead.id, tenant_id=tenant_id)
    db.commit()
    return lead_to_dict(_get_lead(lead_id, tenant_id, db))


@router.delete("/{lead_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lead(
    lead_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Soft-delete a lead entered by mistake. A converted lead is part of its
    contact's history and stays."""
    lead = _get_lead(lead_id, tenant_id, db)
    if lead.status == LeadStatus.converted:
        raise HTTPException(status_code=400, detail="A converted lead can't be deleted")
    lead.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.query(LeadStagePlacement).filter(LeadStagePlacement.lead_id == lead_id).delete(synchronize_session=False)
    log_activity(db, current_user.id, "deleted", "lead", lead.id, tenant_id=tenant_id)
    db.commit()
