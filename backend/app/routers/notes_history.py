"""Notes history: every loan a client or company has been on, with the staff
notes kept on each, for the notes-history PDF / Word export.

A person's loans are the ones they applied for, the ones they are a director or
guarantor signatory on, and the ones a company they are (confirmed-)linked to
borrowed or guaranteed. Personal ("only me") notes are never included. Brokers
see only loans assigned to them or to nobody; admins see every loan.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.application_broker import ApplicationBroker
from app.models.application_note import ApplicationNote
from app.models.contact import Contact, ContactOrganization, Organization
from app.models.decline_reason import DeclineReason
from app.models.lender_submission import LenderSubmission
from app.models.loan_applicant import ApplicationGuarantor, LoanApplicant
from app.models.loan_application import LoanApplication
from app.models.user import User, UserRole
from app.routers.application_notes import _note_to_out
from app.services.activity_log import log_activity
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/notes-history", tags=["notes-history"])


def _sub_type_label(app: LoanApplication) -> Optional[str]:
    if not app.lend_extra_data:
        return None
    try:
        details = json.loads(app.lend_extra_data).get("loan_type_details") or {}
    except (ValueError, AttributeError):
        return None
    for key in ("consumer_loan_type", "commercial_loan_type"):
        entry = details.get(key)
        if isinstance(entry, dict) and (entry.get("label") or entry.get("type")):
            return entry.get("label") or str(entry["type"]).replace("_", " ").capitalize()
    return None


def _role_label(role: Optional[str]) -> str:
    return (role or "director").replace("_", " ").capitalize()


def _add(roles: dict[str, list[str]], app_id: str, label: str) -> None:
    labels = roles.setdefault(app_id, [])
    if label not in labels:
        labels.append(label)


def _contact_loan_roles(db: Session, contact_id: str, tenant_id: str) -> dict[str, list[str]]:
    roles: dict[str, list[str]] = {}
    for (app_id,) in db.query(LoanApplication.id).filter(
        LoanApplication.contact_id == contact_id, LoanApplication.tenant_id == tenant_id
    ):
        _add(roles, app_id, "Main applicant")

    # Party and guarantor rows are not tenant-filtered here: _history() keeps
    # only this tenant's applications.
    parties = db.query(LoanApplicant).filter(LoanApplicant.contact_id == contact_id).all()
    guarantor_ids = {p.application_guarantor_id for p in parties if p.application_guarantor_id}
    guarantor_orgs = {
        g.id: g.organization_id
        for g in db.query(ApplicationGuarantor).filter(ApplicationGuarantor.id.in_(guarantor_ids))
    } if guarantor_ids else {}
    org_names = _org_names(db, set(guarantor_orgs.values()))
    for p in parties:
        if p.application_guarantor_id:
            org = org_names.get(guarantor_orgs.get(p.application_guarantor_id, ""), "a company")
            _add(roles, p.application_id, f"Guarantor signatory for {org}")
        else:
            _add(roles, p.application_id, _role_label(p.role))

    links = db.query(ContactOrganization).filter(ContactOrganization.contact_id == contact_id).all()
    if links:
        link_roles = {link.organization_id: link.role for link in links}
        org_names = _org_names(db, set(link_roles))
        for org_id, org_roles in _organization_loan_roles(db, set(link_roles), tenant_id).items():
            for app_id, label in org_roles:
                person = f" (as {link_roles[org_id]})" if link_roles.get(org_id) else ""
                _add(roles, app_id, f"{org_names.get(org_id, 'Company')} — {label.lower()}{person}")
    return roles


def _organization_loan_roles(db: Session, org_ids: set[str], tenant_id: str) -> dict[str, list[tuple[str, str]]]:
    """org id → [(application id, "Borrower" | "Guarantor")]."""
    out: dict[str, list[tuple[str, str]]] = {}
    if not org_ids:
        return out
    for app_id, org_id in db.query(LoanApplication.id, LoanApplication.business_organization_id).filter(
        LoanApplication.business_organization_id.in_(org_ids), LoanApplication.tenant_id == tenant_id
    ):
        out.setdefault(org_id, []).append((app_id, "Borrower"))
    for app_id, org_id in db.query(ApplicationGuarantor.application_id, ApplicationGuarantor.organization_id).filter(
        ApplicationGuarantor.organization_id.in_(org_ids)
    ):
        out.setdefault(org_id, []).append((app_id, "Guarantor"))
    return out


def _org_names(db: Session, org_ids: set[str]) -> dict[str, str]:
    if not org_ids:
        return {}
    return dict(db.query(Organization.id, Organization.name).filter(Organization.id.in_(org_ids)).all())


def _visible_to(apps: list[LoanApplication], current_user: User, db: Session) -> list[LoanApplication]:
    """Admins see every loan. A broker sees loans assigned to them, or to nobody —
    not loans another broker is handling."""
    if current_user.role != UserRole.broker or not apps:
        return apps
    assigned: dict[str, set[str]] = {}
    for app_id, broker_id in db.query(ApplicationBroker.application_id, ApplicationBroker.broker_id).filter(
        ApplicationBroker.application_id.in_([a.id for a in apps])
    ):
        assigned.setdefault(app_id, set()).add(broker_id)
    visible = []
    for app in apps:
        brokers = assigned.get(app.id, set()) | ({app.assigned_broker_id} if app.assigned_broker_id else set())
        if not brokers or current_user.id in brokers:
            visible.append(app)
    return visible


def _submission_out(sub: LenderSubmission) -> dict:
    return {
        "id": sub.id,
        "lender_name": sub.lender.name if sub.lender else None,
        "status": sub.status.value,
        "submitted_at": sub.submitted_at,
        "responded_at": sub.responded_at,
        "offered_rate": float(sub.offered_rate) if sub.offered_rate is not None else None,
        "offered_amount": float(sub.offered_amount) if sub.offered_amount is not None else None,
        "conditions": sub.conditions,
        "notes": sub.notes,
        "submitted_by_name": sub.submitted_by.full_name if sub.submitted_by else None,
    }


def _broker_names(db: Session, apps: list[LoanApplication]) -> dict[str, list[str]]:
    ids = [a.id for a in apps]
    if not ids:
        return {}
    rows = (
        db.query(ApplicationBroker.application_id, User.full_name)
        .join(User, User.id == ApplicationBroker.broker_id)
        .filter(ApplicationBroker.application_id.in_(ids))
        .all()
    )
    names: dict[str, list[str]] = {}
    for app in apps:
        if app.assigned_broker and app.assigned_broker.full_name:
            names.setdefault(app.id, []).append(app.assigned_broker.full_name)
    for app_id, name in rows:
        if name and name not in names.get(app_id, []):
            names.setdefault(app_id, []).append(name)
    return names


def _history(db: Session, roles: dict[str, list[str]], current_user: User, tenant_id: str) -> dict:
    apps = (
        db.query(LoanApplication)
        .filter(
            LoanApplication.id.in_(list(roles)),
            LoanApplication.tenant_id == tenant_id,
            LoanApplication.deleted_at.is_(None),
        )
        .order_by(LoanApplication.created_at.desc())
        .all()
    ) if roles else []
    visible = _visible_to(apps, current_user, db)
    ids = [a.id for a in visible]

    notes_by_app: dict[str, list[dict]] = {}
    subs_by_app: dict[str, list[dict]] = {}
    if ids:
        notes = (
            db.query(ApplicationNote)
            .filter(ApplicationNote.application_id.in_(ids), ApplicationNote.visibility != "personal")
            .order_by(ApplicationNote.created_at.asc())
            .all()
        )
        for note in notes:
            if "personal" in note.visibility.split(","):
                continue
            notes_by_app.setdefault(note.application_id, []).append(_note_to_out(note))
        subs = (
            db.query(LenderSubmission)
            .filter(LenderSubmission.application_id.in_(ids))
            .order_by(LenderSubmission.submitted_at.asc())
            .all()
        )
        for sub in subs:
            subs_by_app.setdefault(sub.application_id, []).append(_submission_out(sub))

    brokers = _broker_names(db, visible)
    loans = []
    for app in visible:
        applicant = " ".join(p for p in (app.applicant_first_name, app.applicant_last_name) if p)
        loans.append({
            "id": app.id,
            "ref": "APP-" + app.id.replace("-", "")[-6:].upper(),
            "loan_type": app.loan_type.value,
            "sub_type_label": _sub_type_label(app),
            "amount": float(app.amount) if app.amount is not None else None,
            "status": app.status.value,
            "created_at": app.created_at,
            "settled_at": app.settled_at,
            "applicant_type": app.applicant_type,
            "applicant_name": applicant or None,
            "business_name": app.business_name,
            "approval_lender_name": app.approval_lender_name,
            "brokers": brokers.get(app.id, []),
            "roles": roles.get(app.id, []),
            "notes": notes_by_app.get(app.id, []),
            "submissions": subs_by_app.get(app.id, []),
        })

    reasons = (
        db.query(DeclineReason)
        .filter(DeclineReason.tenant_id == tenant_id)
        .order_by(DeclineReason.sort_order.asc())
        .all()
    )
    return {
        "generated_at": datetime.now(timezone.utc),
        "generated_by": current_user.full_name,
        "hidden_count": len(apps) - len(visible),
        "loans": loans,
        "decline_reasons": [{"id": r.id, "label": r.label, "is_active": r.is_active} for r in reasons],
    }


@router.get("/contact/{contact_id}")
def contact_notes_history(
    contact_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    contact = db.query(Contact).filter(Contact.id == contact_id, Contact.tenant_id == tenant_id).first()
    if not contact:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")
    history = _history(db, _contact_loan_roles(db, contact_id, tenant_id), current_user, tenant_id)
    name = " ".join(p for p in (contact.first_name, contact.last_name) if p)
    return {"subject": {"type": "contact", "id": contact.id, "name": name}, **history}


@router.get("/organization/{org_id}")
def organization_notes_history(
    org_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    org = db.query(Organization).filter(Organization.id == org_id, Organization.tenant_id == tenant_id).first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")
    roles: dict[str, list[str]] = {}
    for app_id, label in _organization_loan_roles(db, {org_id}, tenant_id).get(org_id, []):
        _add(roles, app_id, label)
    history = _history(db, roles, current_user, tenant_id)
    return {"subject": {"type": "organization", "id": org.id, "name": org.name}, **history}


class ExportLog(BaseModel):
    format: Literal["pdf", "docx"]
    layout: Literal["by_loan", "by_type"]
    application_ids: list[str]
    sections: list[str]


@router.post("/{subject_type}/{subject_id}/exported", status_code=status.HTTP_204_NO_CONTENT)
def log_notes_history_export(
    subject_type: Literal["contact", "organization"],
    subject_id: str,
    data: ExportLog,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Audit trail: who took a copy of which loans' notes, and in what form."""
    log_activity(
        db, current_user.id, "notes_history_exported", subject_type, subject_id,
        {"format": data.format, "layout": data.layout, "application_ids": data.application_ids[:200], "sections": data.sections},
        tenant_id=tenant_id,
    )
    db.commit()
