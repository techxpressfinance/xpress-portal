from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.application_broker import ApplicationBroker
from app.models.contact import Contact, ContactOrganization, Organization
from app.models.kanban import ApplicationStagePlacement, KanbanBoard, KanbanColumn
from app.models.lending_history_entry import LendingHistoryEntry, RepaymentFrequency
from app.models.loan_application import ApplicationStatus, LoanApplication
from app.models.user import User, UserRole
from app.schemas.contact import (
    ContactCreate,
    ContactDetailOut,
    ContactDuplicateCheck,
    ContactMergeRequest,
    ContactOrganizationLink,
    ContactOut,
    ContactPipelineCreate,
    ContactUpdate,
    PaginatedContacts,
)
from app.schemas.lending_history import (
    LendingHistoryEntryCreate,
    LendingHistoryEntryOut,
    LendingHistoryEntryUpdate,
)
from app.services.dedupe import (
    contact_signals,
    find_contact_duplicates,
    match_candidate_contacts,
    merge_contacts,
)
from app.services.activity_log import log_activity
from app.services.loan_category import CONSUMER_SUB_TYPES
from app.services.scoring import score, tokenize
from app.services.search_cache import get_searchable_contacts
from app.services.serialization import app_with_user
from app.services.tenant_scope import get_tenant_id

_logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/contacts", tags=["contacts"])


def _app_counts(db: Session, contact_ids: list[str]) -> dict[str, int]:
    """One GROUP BY query: {contact_id: application_count} for the given ids."""
    if not contact_ids:
        return {}
    rows = (
        db.query(LoanApplication.contact_id, func.count(LoanApplication.id))
        .filter(LoanApplication.contact_id.in_(contact_ids))
        .group_by(LoanApplication.contact_id)
        .all()
    )
    return {cid: cnt for cid, cnt in rows if cid}


def _linked_orgs(db: Session, contact_ids: list[str]) -> dict[str, list[dict]]:
    """Linked companies for a page of contacts, in one query — a picker needs
    them to tell two same-named clients apart, and per-contact fetches would be
    N round trips."""
    if not contact_ids:
        return {}
    rows = (
        db.query(ContactOrganization, Organization)
        .join(Organization, Organization.id == ContactOrganization.organization_id)
        .filter(ContactOrganization.contact_id.in_(contact_ids))
        .all()
    )
    out: dict[str, list[dict]] = {}
    for link, org in rows:
        out.setdefault(link.contact_id, []).append(
            {"id": org.id, "name": org.name, "abn": org.abn, "role": link.role}
        )
    return out


def _client_accounts(db: Session, contacts: list[Contact], tenant_id: str) -> dict[str, dict]:
    """{contact_id: {id, full_name, role}} for contacts whose email already has a
    portal account, in one query.

    The client picker needs it to say whether choosing this person reuses their
    login or mints a new one — the difference between one client and two.
    """
    emails = {(c.email or "").strip().lower() for c in contacts} - {""}
    if not emails:
        return {}
    users = (
        db.query(User)
        .filter(User.tenant_id == tenant_id, func.lower(User.email).in_(emails))
        .all()
    )
    by_email = {(u.email or "").lower(): u for u in users}
    out = {}
    for c in contacts:
        user = by_email.get((c.email or "").strip().lower())
        if user:
            out[c.id] = {"id": user.id, "full_name": user.full_name, "role": user.role.value}
    return out


def _serialize_contact(
    contact: Contact,
    app_count: int,
    orgs: list[dict] | None = None,
    client_account: dict | None = None,
) -> dict:
    """Serialize a contact — caller passes the precomputed application count,
    the linked companies, and the portal account when the caller asked for them."""
    return {
        "client_account": client_account,
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
        "organizations": orgs or [],
        "created_at": contact.created_at,
        "updated_at": contact.updated_at,
    }


def _contact_with_count(contact: Contact, db: Session) -> dict:
    """Serialize a single contact with its application count (one extra query)."""
    app_count = db.query(func.count(LoanApplication.id)).filter(
        LoanApplication.contact_id == contact.id
    ).scalar() or 0
    return _serialize_contact(contact, app_count)


@router.get("", response_model=PaginatedContacts)
def list_contacts(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    include_organizations: bool = Query(
        False, description="Attach each contact's linked companies (id/name/abn/role)"
    ),
    include_client_account: bool = Query(
        False, description="Attach the portal account already registered to each contact's email"
    ),
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    # No search: straight DB pagination ordered by recency.
    if not search or not search.strip():
        query = (
            db.query(Contact)
            .filter(Contact.tenant_id == tenant_id)
            .order_by(Contact.created_at.desc())
        )
        total = query.count()
        items = query.offset((page - 1) * per_page).limit(per_page).all()
        counts = _app_counts(db, [c.id for c in items])
        orgs = _linked_orgs(db, [c.id for c in items]) if include_organizations else {}
        accounts = _client_accounts(db, items, tenant_id) if include_client_account else {}
        return PaginatedContacts(
            items=[
                _serialize_contact(c, counts.get(c.id, 0), orgs.get(c.id), accounts.get(c.id))
                for c in items
            ],
            total=total,
            page=page,
            per_page=per_page,
        )

    # Search: most contact PII is encrypted at rest, so SQL LIKE only sees
    # email and would miss name/phone/DL matches. Score against the in-
    # process decrypted contact cache (same engine as global search) so all
    # fields match in one ranked pass — no dual-path branch, no 2000-row cap.
    tokens = tokenize(search.strip())
    if not tokens:
        return PaginatedContacts(items=[], total=0, page=page, per_page=per_page)

    contact_fields = get_searchable_contacts(db, tenant_id)
    scored: list[tuple[int, str]] = []
    for cid, f in contact_fields.items():
        s = score(
            tokens,
            [
                (f["full_name"], 10),
                (f["email"], 8),
                (f["phone"], 6),
                (f["drivers_license_number"], 4),
                (f["suburb"], 2),
                (f["state"], 2),
            ],
        )
        if s > 0:
            scored.append((s, cid))

    # Rank by score desc, then most-recently created desc.
    scored.sort(key=lambda t: t[0], reverse=True)

    total = len(scored)
    start = (page - 1) * per_page
    page_ids = [cid for _, cid in scored[start:start + per_page]]
    if not page_ids:
        return PaginatedContacts(items=[], total=total, page=page, per_page=per_page)

    # Fetch the full ORM rows for this page; preserve ranked order from `scored`.
    by_id = {c.id: c for c in db.query(Contact).filter(Contact.id.in_(page_ids)).all()}
    ordered = [by_id[cid] for cid in page_ids if cid in by_id]
    counts = _app_counts(db, page_ids)
    orgs = _linked_orgs(db, page_ids) if include_organizations else {}
    accounts = _client_accounts(db, ordered, tenant_id) if include_client_account else {}
    return PaginatedContacts(
        items=[
            _serialize_contact(c, counts.get(c.id, 0), orgs.get(c.id), accounts.get(c.id))
            for c in ordered
        ],
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


def _resolve_pipeline_column(
    board_id: Optional[str], column_id: Optional[str], tenant_id: str, db: Session
) -> Optional[KanbanColumn]:
    """The column a new pipeline card lands in, or None when no board exists yet.

    Falls back to the tenant's default board (then its oldest board) and that
    board's first column. A card with no column still shows on a board via the
    status → column mapping in the kanban router.
    """
    boards = db.query(KanbanBoard).filter(KanbanBoard.tenant_id == tenant_id)
    if board_id:
        board = boards.filter(KanbanBoard.id == board_id).first()
        if not board:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board not found")
    else:
        board = (
            boards.filter(KanbanBoard.is_default.is_(True)).first()
            or boards.order_by(KanbanBoard.created_at).first()
        )
    if not board:
        return None

    if column_id:
        column = next((c for c in board.columns if c.id == column_id), None)
        if not column:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Column not found on that board")
        return column
    return board.columns[0] if board.columns else None  # relationship is ordered by position


def _sub_type_extra_data(sub_type: Optional[str], label: Optional[str]) -> Optional[str]:
    """lend_extra_data recording the form sub-type, so the card resolves to a
    loan category. Mirrors buildLoanTypeDetails in frontend AddLead.tsx."""
    if not sub_type:
        return None
    key = "consumer_loan_type" if sub_type in CONSUMER_SUB_TYPES else "commercial_loan_type"
    return json.dumps({"loan_type_details": {key: {"type": sub_type, "label": label}}})


@router.post("/{contact_id}/pipeline", status_code=status.HTTP_201_CREATED)
def add_contact_to_pipeline(
    contact_id: str,
    data: ContactPipelineCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Create a draft pipeline card (loan application) for an existing contact.

    Deliberately silent: unlike POST /api/applications, no client account is
    created and no email is sent — the card is staff-owned, and the broker
    invites the client later from the application itself. The contact's details
    are copied onto the applicant fields so the card shows their name.
    """
    contact = _get_contact_in_tenant(contact_id, tenant_id, db)
    column = _resolve_pipeline_column(data.board_id, data.column_id, tenant_id, db)

    application = LoanApplication(
        tenant_id=tenant_id,
        user_id=current_user.id,
        contact_id=contact.id,
        loan_type=data.loan_type,
        amount=data.amount,
        status=ApplicationStatus.draft,
        notes=data.notes,
        kanban_column_id=column.id if column else None,
        lend_extra_data=_sub_type_extra_data(data.sub_type, data.sub_type_label),
        applicant_first_name=contact.first_name,
        applicant_last_name=contact.last_name,
        applicant_middle_name=contact.middle_name,
        applicant_email=contact.email,
        applicant_mobile=contact.phone,
        applicant_dob=contact.date_of_birth,
        applicant_address=contact.address,
        applicant_suburb=contact.suburb,
        applicant_state=contact.state,
        applicant_postcode=contact.postcode,
    )
    if current_user.role == UserRole.broker:
        application.assigned_broker_id = current_user.id
    db.add(application)
    db.flush()
    # Record the chosen stage on that board, so a card dropped straight into a
    # named stage stays there instead of falling back to its status's first one.
    if column:
        db.add(ApplicationStagePlacement(
            application_id=application.id,
            board_id=column.board_id,
            column_id=column.id,
            tenant_id=tenant_id,
        ))
    # Mirror the assignment into application_brokers — that table, not the legacy
    # column, is what the broker-visibility filters read.
    if application.assigned_broker_id:
        db.add(ApplicationBroker(
            application_id=application.id,
            broker_id=application.assigned_broker_id,
            tenant_id=tenant_id,
        ))
    log_activity(
        db,
        current_user.id,
        "created",
        "application",
        application.id,
        {"loan_type": data.loan_type.value, "amount": str(data.amount), "from_contact_id": contact.id},
        tenant_id=tenant_id,
    )
    db.commit()
    db.refresh(application)
    return app_with_user(application, db)


@router.get("/duplicates")
def list_duplicate_contacts(
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Find candidate duplicate contacts, grouped, without changing anything.

    Matches on name, DOB, phone, email, address, and licence number (encrypted
    fields compared post-decryption). "high" groups are safe to auto-merge;
    "review" groups need a human decision.
    """
    all_contacts = db.query(Contact).filter(Contact.tenant_id == tenant_id).all()
    groups, high_groups = find_contact_duplicates(all_contacts)
    return {
        "groups": [
            {
                "confidence": g["confidence"],
                "matched_on": g["matched_on"],
                "contacts": [_contact_with_count(c, db) for c in g["members"]],
            }
            for g in groups
        ],
        "total_duplicates": sum(len(g["members"]) - 1 for g in groups),
        "auto_merge_groups": len(high_groups),
    }


@router.post("/check-duplicates")
def check_duplicate_contacts(
    data: ContactDuplicateCheck,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Screen partial form values against existing contacts before creating one.

    Returns possible matches with confidence + matched-on fields; never blocks.
    """
    candidate = contact_signals(**data.model_dump())
    if not any(candidate.values()):
        return {"matches": []}
    all_contacts = db.query(Contact).filter(Contact.tenant_id == tenant_id).all()
    matches = match_candidate_contacts(candidate, all_contacts)
    return {
        "matches": [
            {
                "confidence": level,
                "matched_on": reasons,
                "contact": _contact_with_count(c, db),
            }
            for c, level, reasons in matches[:5]
        ]
    }


@router.post("/merge", response_model=ContactOut)
def merge_contact_group(
    data: ContactMergeRequest,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Merge specific duplicates into a chosen primary contact.

    Applications, additional applicants, lending history, guarantees, and
    company links all move to the primary; the duplicates are deleted.
    """
    if data.primary_id in data.duplicate_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Primary contact cannot be in the duplicate list")
    if not data.duplicate_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No duplicates to merge")

    primary = db.query(Contact).filter(Contact.id == data.primary_id, Contact.tenant_id == tenant_id).first()
    if not primary:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Primary contact not found")
    duplicates = db.query(Contact).filter(Contact.id.in_(data.duplicate_ids), Contact.tenant_id == tenant_id).all()
    if len(duplicates) != len(set(data.duplicate_ids)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="One or more duplicate contacts not found")

    merge_contacts(db, primary, duplicates)
    db.commit()
    db.refresh(primary)
    return _contact_with_count(primary, db)


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
            "entity_type": org.entity_type,
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

    link = ContactOrganization(
        tenant_id=tenant_id,
        contact_id=contact_id,
        organization_id=data.organization_id,
        role=data.role,
    )
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

    Contacts and companies are created and attached to their applications, but
    the client↔company links are only *proposed* — each application then shows
    the pairing for a broker to confirm. Asserting that a person belongs to a
    business is not something a bulk sweep should decide.
    Also auto-creates organizations from business_name/business_abn on applications.
    """
    unlinked = db.query(LoanApplication).filter(LoanApplication.contact_id.is_(None), LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None)).all()
    # Load all existing contacts once; refresh after each new creation
    all_contacts: list[Contact] = list(db.query(Contact).filter(Contact.tenant_id == tenant_id).all())
    created = 0
    linked = 0
    orgs_created = 0
    links_pending = 0

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

            app.business_organization_id = app.business_organization_id or org.id

            # The contact↔company link is NOT made here. This sweep matches a
            # company by exact business_name when there is no ABN, so a name
            # collision would otherwise write "this person is part of that
            # business" across the whole book in one click. Each pairing surfaces
            # on its application for a broker to confirm — see
            # _pending_business_link in services/serialization.py.
            existing_link = db.query(ContactOrganization).filter(
                ContactOrganization.contact_id == contact.id,
                ContactOrganization.organization_id == org.id,
            ).first()
            if not existing_link:
                links_pending += 1

    db.commit()
    return {
        "contacts_created": created,
        "applications_linked": linked,
        "organizations_created": orgs_created,
        # Client↔business pairings now waiting on a broker's confirmation.
        "links_pending": links_pending,
    }


@router.post("/deduplicate", status_code=status.HTTP_200_OK)
def deduplicate_contacts(
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Auto-merge high-confidence duplicate contacts only.

    High confidence = shared licence number, same name + a corroborating
    identifier (DOB/phone/email), or matching phone + email. The oldest
    contact in each group is kept; empty fields are filled from duplicates and
    all related records (applications, applicants, lending history, guarantees,
    company links) move to it. Name-only matches are left for manual review
    via GET /contacts/duplicates.
    """
    all_contacts = db.query(Contact).filter(Contact.tenant_id == tenant_id).all()
    _groups, high_groups = find_contact_duplicates(all_contacts)

    merged_count = 0
    deleted_count = 0
    for group in high_groups:
        primary, duplicates = group[0], group[1:]
        merge_contacts(db, primary, duplicates)
        merged_count += 1
        deleted_count += len(duplicates)

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
