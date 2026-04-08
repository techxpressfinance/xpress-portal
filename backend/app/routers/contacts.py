from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.contact import Contact, ContactOrganization, Organization
from app.models.loan_application import LoanApplication
from app.models.user import User
from app.schemas.contact import (
    ContactDetailOut,
    ContactOrganizationLink,
    ContactOut,
    ContactUpdate,
    PaginatedContacts,
)
from app.services.query_utils import escape_like

_logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/contacts", tags=["contacts"])


def _contact_with_count(contact: Contact, db: Session) -> dict:
    """Serialize a contact with its application count."""
    app_count = db.query(func.count(LoanApplication.id)).filter(
        LoanApplication.contact_id == contact.id
    ).scalar() or 0
    return {
        "id": contact.id,
        "first_name": contact.first_name,
        "last_name": contact.last_name,
        "middle_name": contact.middle_name,
        "email": contact.email,
        "phone": contact.phone,
        "date_of_birth": contact.date_of_birth,
        "drivers_license_number": contact.drivers_license_number,
        "address": contact.address,
        "suburb": contact.suburb,
        "state": contact.state,
        "postcode": contact.postcode,
        "notes": contact.notes,
        "application_count": app_count,
        "created_at": contact.created_at,
        "updated_at": contact.updated_at,
    }


@router.get("", response_model=PaginatedContacts)
def list_contacts(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: str | None = None,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
):
    query = db.query(Contact)
    if search:
        safe = escape_like(search)
        # Search across name, email, phone — encrypted fields searched post-query
        query = query.filter(
            or_(
                Contact.email.ilike(f"%{safe}%", escape="\\"),
            )
        )
        # Since most PII fields are encrypted, also do post-filter matching
        # For now, also allow searching by email (unencrypted)
        # Full-text search on encrypted fields requires fetching all — we'll do client-side for name
    total = query.count()

    # For name search on encrypted fields, we need to fetch and filter in Python
    if search and not query.count():
        # Fallback: load all and filter by decrypted name
        all_contacts = db.query(Contact).all()
        safe_lower = search.lower()
        filtered = [
            c for c in all_contacts
            if safe_lower in (c.first_name or "").lower()
            or safe_lower in (c.last_name or "").lower()
            or safe_lower in (c.phone or "").lower()
        ]
        total = len(filtered)
        start = (page - 1) * per_page
        items = filtered[start:start + per_page]
        return PaginatedContacts(
            items=[_contact_with_count(c, db) for c in items],
            total=total,
            page=page,
            per_page=per_page,
        )

    items = query.order_by(Contact.created_at.desc()).offset((page - 1) * per_page).limit(per_page).all()
    return PaginatedContacts(
        items=[_contact_with_count(c, db) for c in items],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.get("/{contact_id}", response_model=ContactDetailOut)
def get_contact(
    contact_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
):
    contact = db.query(Contact).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")

    # Get organizations via join table
    org_links = db.query(ContactOrganization).filter(ContactOrganization.contact_id == contact_id).all()
    organizations = []
    for link in org_links:
        org = link.organization
        organizations.append({
            "id": org.id,
            "name": org.name,
            "abn": org.abn,
            "industry": org.industry,
            "address": org.address,
            "notes": org.notes,
            "role": link.role,
            "created_at": org.created_at,
            "updated_at": org.updated_at,
        })

    # Get lending history
    apps = db.query(LoanApplication).filter(LoanApplication.contact_id == contact_id).order_by(LoanApplication.created_at.desc()).all()
    applications = [
        {
            "id": a.id,
            "loan_type": a.loan_type.value,
            "amount": float(a.amount),
            "status": a.status.value,
            "business_name": a.business_name,
            "business_abn": a.business_abn,
            "created_at": a.created_at,
            "updated_at": a.updated_at,
        }
        for a in apps
    ]

    return {
        **_contact_with_count(contact, db),
        "organizations": organizations,
        "applications": applications,
    }


@router.patch("/{contact_id}", response_model=ContactOut)
def update_contact(
    contact_id: str,
    data: ContactUpdate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
):
    contact = db.query(Contact).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(contact, field, value)
    db.commit()
    db.refresh(contact)
    return _contact_with_count(contact, db)


@router.post("/{contact_id}/organizations", status_code=status.HTTP_201_CREATED)
def link_organization(
    contact_id: str,
    data: ContactOrganizationLink,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
):
    contact = db.query(Contact).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")

    org = db.query(Organization).filter(Organization.id == data.organization_id).first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    existing = db.query(ContactOrganization).filter(
        ContactOrganization.contact_id == contact_id,
        ContactOrganization.organization_id == data.organization_id,
    ).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Contact is already linked to this organization")

    link = ContactOrganization(contact_id=contact_id, organization_id=data.organization_id, role=data.role)
    db.add(link)
    db.commit()
    return {"status": "linked"}


@router.delete("/{contact_id}/organizations/{org_id}", status_code=status.HTTP_204_NO_CONTENT)
def unlink_organization(
    contact_id: str,
    org_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
):
    link = db.query(ContactOrganization).filter(
        ContactOrganization.contact_id == contact_id,
        ContactOrganization.organization_id == org_id,
    ).first()
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link not found")
    db.delete(link)
    db.commit()


@router.post("/auto-create", status_code=status.HTTP_200_OK)
def auto_create_contacts(
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
):
    """Scan all loan applications without a contact_id and auto-create/link contacts.

    Matching priority: drivers_license_number > phone + DOB > phone > DOB + name.
    Also auto-creates organizations from business_name/business_abn on applications.
    """
    unlinked = db.query(LoanApplication).filter(LoanApplication.contact_id.is_(None)).all()
    created = 0
    linked = 0
    orgs_created = 0

    for app in unlinked:
        first_name = app.applicant_first_name
        last_name = app.applicant_last_name
        if not first_name or not last_name:
            continue

        phone = None
        dob = app.applicant_dob

        # Try to get phone from lend_extra_data
        if app.lend_extra_data:
            import json
            try:
                extra = json.loads(app.lend_extra_data)
                phone = extra.get("mobile_phone") or extra.get("phone")
            except (json.JSONDecodeError, AttributeError):
                pass

        dl_number = None
        if app.lend_extra_data:
            import json
            try:
                extra = json.loads(app.lend_extra_data)
                dl_number = extra.get("drivers_license_number")
            except (json.JSONDecodeError, AttributeError):
                pass

        # Try to find existing contact by matching criteria
        contact = None

        # Match by DL number (strongest identifier)
        if dl_number and not contact:
            all_contacts = db.query(Contact).all()
            for c in all_contacts:
                if c.drivers_license_number and c.drivers_license_number == dl_number:
                    contact = c
                    break

        # Match by phone + DOB
        if phone and dob and not contact:
            all_contacts = all_contacts if 'all_contacts' in dir() else db.query(Contact).all()
            for c in all_contacts:
                if c.phone == phone and c.date_of_birth == dob:
                    contact = c
                    break

        # Match by phone + name
        if phone and not contact:
            all_contacts = all_contacts if 'all_contacts' in dir() else db.query(Contact).all()
            for c in all_contacts:
                if c.phone == phone and c.first_name.lower() == first_name.lower() and c.last_name.lower() == last_name.lower():
                    contact = c
                    break

        # No match — create new contact
        if not contact:
            contact = Contact(
                first_name=first_name,
                last_name=last_name,
                middle_name=app.applicant_middle_name,
                phone=phone,
                date_of_birth=dob,
                drivers_license_number=dl_number,
                address=app.applicant_address,
                suburb=app.applicant_suburb,
                state=app.applicant_state,
                postcode=app.applicant_postcode,
            )
            db.add(contact)
            db.flush()
            created += 1

        app.contact_id = contact.id
        linked += 1

        # Auto-create organization from business fields
        if app.business_name or app.business_abn:
            org = None
            if app.business_abn:
                org = db.query(Organization).filter(Organization.abn == app.business_abn).first()
            if not org and app.business_name:
                org = db.query(Organization).filter(Organization.name == app.business_name).first()
            if not org:
                org = Organization(
                    name=app.business_name or "Unknown",
                    abn=app.business_abn,
                )
                db.add(org)
                db.flush()
                orgs_created += 1

            # Link contact to org if not already linked
            existing_link = db.query(ContactOrganization).filter(
                ContactOrganization.contact_id == contact.id,
                ContactOrganization.organization_id == org.id,
            ).first()
            if not existing_link:
                db.add(ContactOrganization(contact_id=contact.id, organization_id=org.id))

    db.commit()
    return {
        "contacts_created": created,
        "applications_linked": linked,
        "organizations_created": orgs_created,
    }
