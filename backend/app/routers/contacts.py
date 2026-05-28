from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.contact import Contact, ContactOrganization, Organization
from app.models.lending_history_entry import LendingHistoryEntry, RepaymentFrequency
from app.models.loan_application import LoanApplication
from app.models.user import User
from app.schemas.contact import (
    ContactCreate,
    ContactDetailOut,
    ContactOrganizationLink,
    ContactOut,
    ContactUpdate,
    PaginatedContacts,
)
from app.schemas.lending_history import (
    LendingHistoryEntryCreate,
    LendingHistoryEntryOut,
    LendingHistoryEntryUpdate,
)
from app.services.query_utils import escape_like
from app.services.tenant_scope import get_tenant_id

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
    tenant_id: str = Depends(get_tenant_id),
):
    query = db.query(Contact).filter(Contact.tenant_id == tenant_id)
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
        # Fallback: load and filter by decrypted name (capped to prevent OOM on large tenants)
        all_contacts = db.query(Contact).filter(Contact.tenant_id == tenant_id).limit(2000).all()
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


@router.post("", response_model=ContactOut, status_code=status.HTTP_201_CREATED)
def create_contact(
    data: ContactCreate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    contact = Contact(
        tenant_id=tenant_id,
        **data.model_dump(exclude_unset=True),
    )
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return _contact_with_count(contact, db)


@router.get("/{contact_id}", response_model=ContactDetailOut)
def get_contact(
    contact_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    contact = db.query(Contact).filter(Contact.id == contact_id, Contact.tenant_id == tenant_id).first()
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
    apps = db.query(LoanApplication).filter(LoanApplication.contact_id == contact_id, LoanApplication.deleted_at.is_(None)).order_by(LoanApplication.created_at.desc()).all()
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

    lending_history = _list_lending_history(contact_id, db)

    return {
        **_contact_with_count(contact, db),
        "organizations": organizations,
        "applications": applications,
        "lending_history": lending_history,
    }


@router.patch("/{contact_id}", response_model=ContactOut)
def update_contact(
    contact_id: str,
    data: ContactUpdate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    contact = db.query(Contact).filter(Contact.id == contact_id, Contact.tenant_id == tenant_id).first()
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
    tenant_id: str = Depends(get_tenant_id),
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
    tenant_id: str = Depends(get_tenant_id),
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
    tenant_id: str = Depends(get_tenant_id),
):
    """Scan all loan applications without a contact_id and auto-create/link contacts.

    Matching priority: DL number > phone+DOB > DOB+name > name.
    Also auto-creates organizations from business_name/business_abn on applications.
    """
    unlinked = db.query(LoanApplication).filter(LoanApplication.contact_id.is_(None), LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None)).all()
    # Load all existing contacts once; refresh after each new creation
    all_contacts: list[Contact] = list(db.query(Contact).filter(Contact.tenant_id == tenant_id).all())
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
                tenant_id=tenant_id,
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
                org = db.query(Organization).filter(Organization.abn == app.business_abn, Organization.tenant_id == tenant_id).first()
            if not org and app.business_name:
                org = db.query(Organization).filter(Organization.name == app.business_name, Organization.tenant_id == tenant_id).first()
            if not org:
                org = Organization(
                    name=app.business_name or "Unknown",
                    abn=app.business_abn,
                    tenant_id=tenant_id,
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
    tenant_id: str = Depends(get_tenant_id),
):
    """Find and merge duplicate contacts.

    Groups contacts by normalized (first_name + last_name). Keeps the oldest
    contact as the primary, but picks the best (most complete) value for each
    field across all duplicates. Address fields are picked as a unit so you
    don't get a Frankenstein address.
    """
    all_contacts = db.query(Contact).filter(Contact.tenant_id == tenant_id).order_by(Contact.created_at.asc()).all()

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
    remaining = db.query(func.count(Contact.id)).filter(Contact.tenant_id == tenant_id).scalar()
    return {
        "groups_merged": merged_count,
        "duplicates_removed": deleted_count,
        "contacts_remaining": remaining,
    }


# --- Lending history (manual entries) ---


def _serialize_lending_entry(entry: LendingHistoryEntry, guarantor_name: Optional[str]) -> dict:
    return {
        "id": entry.id,
        "contact_id": entry.contact_id,
        "lender_name": entry.lender_name,
        "amount": float(entry.amount) if entry.amount is not None else 0.0,
        "balloon": float(entry.balloon) if entry.balloon is not None else None,
        "other_broker_name": entry.other_broker_name,
        "repayment_amount": float(entry.repayment_amount) if entry.repayment_amount is not None else None,
        "repayment_frequency": entry.repayment_frequency.value if entry.repayment_frequency else None,
        "start_date": entry.start_date,
        "identifier": entry.identifier,
        "guaranteed_by_contact_id": entry.guaranteed_by_contact_id,
        "guaranteed_by_name": guarantor_name,
        "notes": entry.notes,
        "created_at": entry.created_at,
        "updated_at": entry.updated_at,
    }


def _list_lending_history(contact_id: str, db: Session) -> list[dict]:
    entries = (
        db.query(LendingHistoryEntry)
        .filter(LendingHistoryEntry.contact_id == contact_id)
        .order_by(LendingHistoryEntry.start_date.desc().nullslast(), LendingHistoryEntry.created_at.desc())
        .all()
    )
    if not entries:
        return []
    guarantor_ids = {e.guaranteed_by_contact_id for e in entries if e.guaranteed_by_contact_id}
    guarantor_names: dict[str, str] = {}
    if guarantor_ids:
        for c in db.query(Contact).filter(Contact.id.in_(guarantor_ids)).all():
            guarantor_names[c.id] = f"{c.first_name} {c.last_name}".strip()
    return [_serialize_lending_entry(e, guarantor_names.get(e.guaranteed_by_contact_id)) for e in entries]


def _get_contact_in_tenant(contact_id: str, tenant_id: str, db: Session) -> Contact:
    contact = db.query(Contact).filter(Contact.id == contact_id, Contact.tenant_id == tenant_id).first()
    if not contact:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")
    return contact


def _resolve_guarantor(
    guarantor_id: Optional[str], tenant_id: str, db: Session
) -> Optional[Contact]:
    if not guarantor_id:
        return None
    guarantor = db.query(Contact).filter(Contact.id == guarantor_id, Contact.tenant_id == tenant_id).first()
    if not guarantor:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Guarantor contact not found")
    return guarantor


@router.post("/{contact_id}/lending-history", response_model=LendingHistoryEntryOut, status_code=status.HTTP_201_CREATED)
def create_lending_entry(
    contact_id: str,
    data: LendingHistoryEntryCreate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    _get_contact_in_tenant(contact_id, tenant_id, db)
    guarantor = _resolve_guarantor(data.guaranteed_by_contact_id, tenant_id, db)

    entry = LendingHistoryEntry(
        contact_id=contact_id,
        tenant_id=tenant_id,
        lender_name=data.lender_name.strip(),
        amount=data.amount,
        balloon=data.balloon,
        other_broker_name=data.other_broker_name.strip() if data.other_broker_name else None,
        repayment_amount=data.repayment_amount,
        repayment_frequency=RepaymentFrequency(data.repayment_frequency) if data.repayment_frequency else None,
        start_date=data.start_date,
        identifier=data.identifier.strip() if data.identifier else None,
        guaranteed_by_contact_id=guarantor.id if guarantor else None,
        notes=data.notes,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    guarantor_name = f"{guarantor.first_name} {guarantor.last_name}".strip() if guarantor else None
    return _serialize_lending_entry(entry, guarantor_name)


@router.patch("/{contact_id}/lending-history/{entry_id}", response_model=LendingHistoryEntryOut)
def update_lending_entry(
    contact_id: str,
    entry_id: str,
    data: LendingHistoryEntryUpdate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    _get_contact_in_tenant(contact_id, tenant_id, db)
    entry = (
        db.query(LendingHistoryEntry)
        .filter(LendingHistoryEntry.id == entry_id, LendingHistoryEntry.contact_id == contact_id)
        .first()
    )
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lending entry not found")

    payload = data.model_dump(exclude_unset=True)
    if "guaranteed_by_contact_id" in payload:
        guarantor = _resolve_guarantor(payload["guaranteed_by_contact_id"], tenant_id, db)
        entry.guaranteed_by_contact_id = guarantor.id if guarantor else None
        payload.pop("guaranteed_by_contact_id")
    if "repayment_frequency" in payload:
        freq = payload.pop("repayment_frequency")
        entry.repayment_frequency = RepaymentFrequency(freq) if freq else None
    for key in ("lender_name", "other_broker_name", "identifier"):
        if key in payload and payload[key] is not None:
            payload[key] = payload[key].strip() or None
    for field, value in payload.items():
        setattr(entry, field, value)
    db.commit()
    db.refresh(entry)

    guarantor_name = None
    if entry.guaranteed_by_contact_id:
        g = db.query(Contact).filter(Contact.id == entry.guaranteed_by_contact_id).first()
        if g:
            guarantor_name = f"{g.first_name} {g.last_name}".strip()
    return _serialize_lending_entry(entry, guarantor_name)


@router.delete("/{contact_id}/lending-history/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lending_entry(
    contact_id: str,
    entry_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    _get_contact_in_tenant(contact_id, tenant_id, db)
    entry = (
        db.query(LendingHistoryEntry)
        .filter(LendingHistoryEntry.id == entry_id, LendingHistoryEntry.contact_id == contact_id)
        .first()
    )
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lending entry not found")
    db.delete(entry)
    db.commit()
