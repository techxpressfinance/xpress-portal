"""Leads — deal inquiries that sit on the board before there is an application.

A lead turns into a LoanApplication, and into a CRM contact, when the desk drags
it into an application stage. The board mechanics of that move (gates, the
placement, the stage transition, stage messages, the status change) live in the
kanban router alongside the application move; this module owns the lead itself:
how it serialises and what converting it creates.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.application_broker import ApplicationBroker
from app.models.contact import Contact
from app.models.lead import Lead, LeadStatus
from app.models.loan_application import ApplicationStatus, LoanApplication
from app.models.user import User, UserRole
from app.services.contacts import ensure_contact
from app.services.loan_category import (
    CATEGORY_DEFAULT_LOAN_TYPE,
    LOAN_CATEGORIES,
    category_for_sub_type,
    sub_type_extra_data,
    sub_type_to_loan_type,
)
from app.services.organizations import find_or_create_organization_by_abn

CATEGORY_LABELS = {"asset_finance": "Asset Finance", "home_loan": "Home Loan", "commercial": "Commercial"}


def lead_name(lead: Lead) -> str:
    return " ".join(filter(None, [lead.first_name, lead.last_name])).strip() or "Lead"


def validate_lead_category(loan_category: Optional[str], sub_type: Optional[str]) -> None:
    """A lead's sub-type must belong to its category, or the application it
    becomes would land on a different category's board than the lead did."""
    if loan_category not in LOAN_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid loan_category: {loan_category}")
    if sub_type and category_for_sub_type(sub_type) != loan_category:
        raise HTTPException(status_code=400, detail="That loan type belongs to a different category")


def lead_to_dict(lead: Lead, *, stage_entered_at: Optional[datetime] = None) -> dict:
    return {
        "id": lead.id,
        "first_name": lead.first_name,
        "last_name": lead.last_name,
        "email": lead.email,
        "phone": lead.phone,
        "company_name": lead.company_name,
        "company_abn": lead.company_abn,
        "loan_category": lead.loan_category,
        "sub_type": lead.sub_type,
        "amount": float(lead.amount) if lead.amount is not None else None,
        "source": lead.source,
        "notes": lead.notes,
        "status": lead.status.value,
        "lost_reason": lead.lost_reason,
        "lost_at": lead.lost_at,
        "assigned_broker_id": lead.assigned_broker_id,
        "assigned_broker_name": lead.assigned_broker.full_name if lead.assigned_broker else None,
        "created_by_id": lead.created_by_id,
        "created_by_name": lead.created_by.full_name if lead.created_by else None,
        "converted_application_id": lead.converted_application_id,
        "converted_at": lead.converted_at,
        "contact_id": lead.contact_id,
        "created_at": lead.created_at,
        "updated_at": lead.updated_at,
        "stage_entered_at": stage_entered_at,
    }


def lead_contact_note(lead: Lead, when: datetime) -> str:
    """The inquiry as it is recorded on the contact it became — the contact is
    created at conversion, so this is the only place the original ask survives
    in the contact book."""
    parts = [CATEGORY_LABELS.get(lead.loan_category, lead.loan_category)]
    if lead.sub_type:
        parts[0] += f" ({lead.sub_type.replace('_', ' ')})"
    if lead.amount is not None:
        parts.append(f"${lead.amount:,.0f}")
    if lead.source:
        parts.append(f"Source: {lead.source}")
    if lead.company_name or lead.company_abn:
        company = lead.company_name or ""
        if lead.company_abn:
            company = f"{company} (ABN {lead.company_abn})".strip()
        parts.append(f"Company: {company}")
    header = f"Lead inquiry {lead.created_at:%d %b %Y}, converted {when:%d %b %Y} — " + " · ".join(parts)
    body = (lead.notes or "").strip()
    return f"{header}\n{body}" if body else header


def convert_lead(db: Session, lead: Lead, actor: User, tenant_id: str) -> tuple[LoanApplication, Contact]:
    """Create the contact and the draft application a lead becomes, and mark the
    lead converted. The caller places the card, records the transition and moves
    the application to the target stage's status. Does not commit.

    The application is staff-owned and silent, like the contact book's "add to
    pipeline": no client account is made and nothing is emailed — the broker
    invites the client from the application when they are ready.
    """
    if lead.status != LeadStatus.open or lead.deleted_at is not None:
        raise HTTPException(status_code=400, detail="Only an open lead can be converted")

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    contact = ensure_contact(
        db,
        tenant_id,
        lead.first_name,
        lead.last_name or "",
        email=lead.email,
        phone=lead.phone,
    )
    note = lead_contact_note(lead, now)
    contact.notes = f"{contact.notes.rstrip()}\n\n{note}" if (contact.notes or "").strip() else note

    loan_type = sub_type_to_loan_type(lead.sub_type) if lead.sub_type else CATEGORY_DEFAULT_LOAN_TYPE[lead.loan_category]
    assigned_broker_id = lead.assigned_broker_id or (actor.id if actor.role == UserRole.broker else None)
    application = LoanApplication(
        tenant_id=tenant_id,
        user_id=actor.id,
        contact_id=contact.id,
        loan_type=loan_type,
        amount=lead.amount if lead.amount is not None else Decimal("0"),
        status=ApplicationStatus.draft,
        notes=lead.notes,
        lend_extra_data=sub_type_extra_data(lead.sub_type),
        applicant_first_name=lead.first_name,
        applicant_last_name=lead.last_name,
        applicant_email=(lead.email or "").strip().lower() or None,
        applicant_mobile=lead.phone,
        business_name=lead.company_name,
        business_abn=lead.company_abn,
        assigned_broker_id=assigned_broker_id,
    )
    # An ABN from the ABR search identifies the entity exactly, so it wins over
    # a name match — the same rule as the application create path.
    if lead.company_name or lead.company_abn:
        org = find_or_create_organization_by_abn(db, tenant_id, lead.company_abn, lead.company_name)
        if org:
            application.business_organization_id = org.id
            if org.name and org.name != "Unnamed Company":
                application.business_name = org.name
    db.add(application)
    db.flush()

    # application_brokers, not the legacy column, is what broker visibility reads.
    if assigned_broker_id:
        db.add(ApplicationBroker(application_id=application.id, broker_id=assigned_broker_id, tenant_id=tenant_id))

    lead.status = LeadStatus.converted
    lead.converted_application_id = application.id
    lead.converted_at = now
    lead.converted_by_id = actor.id
    lead.contact_id = contact.id
    return application, contact
