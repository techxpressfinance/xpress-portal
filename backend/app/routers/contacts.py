from __future__ import annotations

import logging
from typing import Optional

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
    search: Optional[str] = None,
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


def _extract_extra_fields(app: LoanApplication) -> tuple[Optional[str], Optional[str]]:
    """Extract phone and DL number from lend_extra_data JSON."""
    import json
    phone = None
    dl_number = None
    if app.lend_extra_data:
        try:
            extra = json.loads(app.lend_extra_data)
            phone = extra.get("mobile_phone") or extra.get("phone")
            dl_number = extra.get("drivers_license_number")
        except (json.JSONDecodeError, AttributeError):
            pass
    return phone, dl_number


def _find_matching_contact(
    contacts: list[Contact],
    first_name: str,
    last_name: str,
    dob: Optional[str],
    phone: Optional[str],
    dl_number: Optional[str],
) -> Optional[Contact]:
    """Find an existing contact matching the given identifiers.

    Priority: DL number > phone+DOB > DOB+name > name (case-insensitive).
    """
    fn_lower = first_name.strip().lower()
    ln_lower = last_name.strip().lower()

    # 1. DL number (strongest)
    if dl_number:
        for c in contacts:
            if c.drivers_license_number and c.drivers_license_number.strip() == dl_number.strip():
                return c

    # 2. Phone + DOB
    if phone and dob:
        for c in contacts:
            if c.phone and c.phone.strip() == phone.strip() and c.date_of_birth and c.date_of_birth.strip() == dob.strip():
                return c

    # 3. DOB + name
    if dob:
        for c in contacts:
            if (
                c.date_of_birth and c.date_of_birth.strip() == dob.strip()
                and (c.first_name or "").strip().lower() == fn_lower
                and (c.last_name or "").strip().lower() == ln_lower
            ):
                return c

    # 4. Name only (first + last, case-insensitive)
    for c in contacts:
        if (c.first_name or "").strip().lower() == fn_lower and (c.last_name or "").strip().lower() == ln_lower:
            return c

    return None


@router.post("/auto-create", status_code=status.HTTP_200_OK)
def auto_create_contacts(
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
):
    """Scan all loan applications without a contact_id and auto-create/link contacts.

    Matching priority: DL number > phone+DOB > DOB+name > name.
    Also auto-creates organizations from business_name/business_abn on applications.
    """
    unlinked = db.query(LoanApplication).filter(LoanApplication.contact_id.is_(None)).all()
    # Load all existing contacts once; refresh after each new creation
    all_contacts: list[Contact] = list(db.query(Contact).all())
    created = 0
    linked = 0
    orgs_created = 0

    for app in unlinked:
        first_name = app.applicant_first_name
        last_name = app.applicant_last_name
        if not first_name or not last_name:
            continue

        dob = app.applicant_dob
        phone, dl_number = _extract_extra_fields(app)

        contact = _find_matching_contact(all_contacts, first_name, last_name, dob, phone, dl_number)

        if not contact:
            contact = Contact(
                first_name=first_name.strip(),
                last_name=last_name.strip(),
                middle_name=(app.applicant_middle_name or "").strip() or None,
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
            all_contacts.append(contact)  # keep cache in sync
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


def _pick_best_value(field: str, contacts: list[Contact]) -> Optional[str]:
    """Pick the best value for a field across all duplicate contacts.

    Prefers the longest non-empty value (most complete data wins).
    For address fields, all four parts (address/suburb/state/postcode) are
    scored together so we take the most complete address as a unit.
    """
    values = [(getattr(c, field) or "").strip() for c in contacts]
    non_empty = [v for v in values if v]
    if not non_empty:
        return None
    # Return the longest (most complete) value
    return max(non_empty, key=len)


def _pick_best_address(contacts: list[Contact]) -> dict[str, Optional[str]]:
    """Pick the most complete address across all duplicate contacts.

    Scores each contact's address by how many of the 4 fields are filled,
    then takes all 4 fields from the winner.
    """
    best_idx = 0
    best_score = 0
    for i, c in enumerate(contacts):
        score = sum(1 for f in ("address", "suburb", "state", "postcode") if (getattr(c, f) or "").strip())
        if score > best_score:
            best_score = score
            best_idx = i
    winner = contacts[best_idx]
    return {
        "address": (winner.address or "").strip() or None,
        "suburb": (winner.suburb or "").strip() or None,
        "state": (winner.state or "").strip() or None,
        "postcode": (winner.postcode or "").strip() or None,
    }


@router.post("/deduplicate", status_code=status.HTTP_200_OK)
def deduplicate_contacts(
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
):
    """Find and merge duplicate contacts.

    Groups contacts by normalized (first_name + last_name). Keeps the oldest
    contact as the primary, but picks the best (most complete) value for each
    field across all duplicates. Address fields are picked as a unit so you
    don't get a Frankenstein address.
    """
    all_contacts = db.query(Contact).order_by(Contact.created_at.asc()).all()

    # Group by normalized name
    name_groups: dict[str, list[Contact]] = {}
    for c in all_contacts:
        key = f"{(c.first_name or '').strip().lower()}|{(c.last_name or '').strip().lower()}"
        name_groups.setdefault(key, []).append(c)

    merged_count = 0
    deleted_count = 0

    for _key, group in name_groups.items():
        if len(group) < 2:
            continue

        # The primary is the oldest (first created) — we keep this record
        primary = group[0]
        duplicates = group[1:]

        # Pick the best value for each field across ALL contacts in the group
        for field in ("email", "phone", "date_of_birth", "drivers_license_number", "middle_name"):
            best = _pick_best_value(field, group)
            if best:
                setattr(primary, field, best)

        # Pick address as a unit (most complete set of address fields wins)
        best_addr = _pick_best_address(group)
        for field, value in best_addr.items():
            if value:
                setattr(primary, field, value)

        # Merge notes: concatenate any non-empty notes from duplicates
        all_notes = [c.notes for c in group if c.notes and c.notes.strip()]
        if all_notes:
            primary.notes = "\n".join(dict.fromkeys(all_notes))  # dedupe identical notes

        for dup in duplicates:
            # Move all applications from dup to primary
            db.query(LoanApplication).filter(
                LoanApplication.contact_id == dup.id
            ).update({"contact_id": primary.id}, synchronize_session="fetch")

            # Move org links — skip if primary already has that org
            dup_org_links = db.query(ContactOrganization).filter(
                ContactOrganization.contact_id == dup.id
            ).all()
            for link in dup_org_links:
                existing = db.query(ContactOrganization).filter(
                    ContactOrganization.contact_id == primary.id,
                    ContactOrganization.organization_id == link.organization_id,
                ).first()
                if not existing:
                    link.contact_id = primary.id
                else:
                    db.delete(link)

            db.delete(dup)
            deleted_count += 1

        merged_count += 1

    db.commit()
    remaining = db.query(func.count(Contact.id)).scalar()
    return {
        "groups_merged": merged_count,
        "duplicates_removed": deleted_count,
        "contacts_remaining": remaining,
    }
