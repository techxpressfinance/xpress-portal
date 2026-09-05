from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.contact import Contact, ContactOrganization, Organization
from app.models.loan_applicant import ApplicationGuarantor
from app.models.loan_application import LoanApplication
from app.models.trust_party import TrustParty
from app.models.user import User
from app.schemas.organization import (
    EntitySearchResult,
    OrganizationContactLink,
    OrganizationCreate,
    OrganizationDetailOut,
    OrganizationDuplicateCheck,
    OrganizationMergeRequest,
    OrganizationOut,
    OrganizationUpdate,
    PaginatedOrganizations,
    TrustPartyCreate,
    TrustPartyOut,
    TrustPartyUpdate,
)
from app.config import ABR_ENABLED
from app.constants import ENTITY_TYPES, TRUST_PARTY_ROLES
from app.services import acn as acn_service
from app.services.abr import lookup_abn as abr_lookup_abn
from app.services.abr import search_names as abr_search_names
from app.services.dedupe import (
    find_org_duplicates,
    match_candidate_orgs,
    merge_organizations,
    org_signals,
)
from app.services.query_utils import escape_like
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/organizations", tags=["organizations"])


def _normalize_abn(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    digits = "".join(ch for ch in value if ch.isdigit())
    return digits or None


def _normalize_acn(
    value: Optional[str],
    abn: Optional[str] = None,
    entity_type: Optional[str] = None,
) -> Optional[str]:
    """Strip an ACN to digits, rejecting one that can't be real.

    An ACN carries a check digit, and a company's ABN ends in its ACN, so a
    mistyped one is catchable offline — worth doing, since ASIC has no per-record
    API to confirm the company against. A trust is exempt from the ABN
    cross-check: the ACN it records is its corporate trustee's.
    """
    normalized = acn_service.normalize_acn(value)
    if not normalized:
        return None
    problem = acn_service.validation_error(normalized, abn, entity_type)
    if problem:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=problem)
    return normalized


def _org_with_counts(org: Organization, db: Session) -> dict:
    contact_count = (
        db.query(func.count(ContactOrganization.id))
        .filter(ContactOrganization.organization_id == org.id)
        .scalar() or 0
    )
    application_count = (
        db.query(func.count(LoanApplication.id))
        .filter(
            LoanApplication.business_organization_id == org.id,
            LoanApplication.deleted_at.is_(None),
        )
        .scalar() or 0
    )
    return {
        "id": org.id,
        "name": org.name,
        "entity_type": org.entity_type,
        "abn": org.abn,
        "acn": org.acn,
        "industry": org.industry,
        "address": org.address,
        "notes": org.notes,
        "trust_type": org.trust_type,
        "no_abn_confirmed": org.no_abn_confirmed,
        "no_abn_confirmed_at": org.no_abn_confirmed_at,
        "contact_count": contact_count,
        "application_count": application_count,
        "created_at": org.created_at,
        "updated_at": org.updated_at,
    }


def _get_org_in_tenant(org_id: str, tenant_id: str, db: Session) -> Organization:
    org = db.query(Organization).filter(Organization.id == org_id, Organization.tenant_id == tenant_id).first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found")
    return org


NO_ABN_CONFIRM_DETAIL = (
    "A trust without an ABN needs confirmation — check the structure with the client's "
    "accountant, then resubmit with no_abn_confirmed set."
)


def _require_no_abn_confirmation(entity_type: Optional[str], abn: Optional[str], confirmed: bool) -> None:
    """A trust may genuinely have no ABN, but the broker has to acknowledge it."""
    if entity_type == "trust" and not abn and not confirmed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=NO_ABN_CONFIRM_DETAIL)


def _party_display_name(party: TrustParty) -> str:
    """Linked record's name wins; the free-text name is the fallback."""
    if party.contact:
        return f"{party.contact.first_name} {party.contact.last_name}".strip()
    if party.linked_organization:
        return party.linked_organization.name
    return party.name or "Unnamed party"


def _ordered_parties(parties: list[TrustParty]) -> list[TrustParty]:
    """Group by role in the order the structure is presented, oldest first."""
    order = {role: i for i, role in enumerate(TRUST_PARTY_ROLES)}
    return sorted(parties, key=lambda p: (order.get(p.role, len(order)), p.created_at))


def _party_acn(party: TrustParty) -> Optional[str]:
    """A corporate trustee's ACN: the one recorded against its linked entity, or
    else read off its ABN (a company's ABN ends in its ACN). Only companies have
    one — a partnership or individual trustee does not."""
    if party.party_kind != "company":
        return None
    if party.linked_organization and party.linked_organization.acn:
        return party.linked_organization.acn
    abn = party.abn or (party.linked_organization.abn if party.linked_organization else None)
    return acn_service.acn_from_abn(abn)


def _trust_party_dict(party: TrustParty) -> dict:
    return {
        "id": party.id,
        "organization_id": party.organization_id,
        "role": party.role,
        "party_kind": party.party_kind,
        "contact_id": party.contact_id,
        "linked_organization_id": party.linked_organization_id,
        "display_name": _party_display_name(party),
        "name": party.name,
        "abn": party.abn or (party.linked_organization.abn if party.linked_organization else None),
        "acn": _party_acn(party),
        "ownership_percentage": party.ownership_percentage,
        "notes": party.notes,
        "created_at": party.created_at,
        "updated_at": party.updated_at,
    }


@router.get("", response_model=PaginatedOrganizations)
def list_organizations(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    entity_type: Optional[str] = Query(None, description="Filter to one entity type (see ENTITY_TYPES)"),
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    query = db.query(Organization).filter(Organization.tenant_id == tenant_id)
    if entity_type:
        if entity_type not in ENTITY_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"entity_type must be one of: {', '.join(ENTITY_TYPES)}",
            )
        query = query.filter(Organization.entity_type == entity_type)
    if search:
        safe = escape_like(search)
        digits = _normalize_abn(search)
        clauses = [Organization.name.ilike(f"%{safe}%", escape="\\")]
        if digits:
            clauses.append(Organization.abn.ilike(f"%{digits}%", escape="\\"))
        query = query.filter(or_(*clauses))

    total = query.count()
    items = (
        query.order_by(Organization.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    return PaginatedOrganizations(
        items=[_org_with_counts(o, db) for o in items],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.get("/abr-lookup")
def abr_lookup(
    abn: str = Query(..., min_length=1),
    _current_user: User = Depends(require_role("admin", "broker", "referrer", "client")),
):
    """Query the public Australian Business Register for an ABN.

    Returns {"enabled": false} if ABR_GUID is not configured. Returns {"record": null}
    when the ABN is unknown or malformed.
    """
    if not ABR_ENABLED:
        return {"enabled": False, "record": None}
    record = abr_lookup_abn(abn)
    return {"enabled": True, "record": record}


@router.get("/abr-search")
def abr_search(
    name: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=20),
    _current_user: User = Depends(require_role("admin", "broker", "referrer", "client")),
):
    """Search the Australian Business Register by entity/business/trading name.

    Returns {"enabled": false} if ABR_GUID is not configured, and an empty list
    when the term is under 3 characters or nothing matches.
    """
    if not ABR_ENABLED:
        return {"enabled": False, "matches": []}
    return {"enabled": True, "matches": abr_search_names(name, limit)}


@router.get("/search", response_model=list[EntitySearchResult])
def search_entities(
    q: str = Query(..., min_length=2, description="Entity name or ABN fragment"),
    limit: int = Query(8, ge=1, le=25),
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Typeahead over the tenant's own entity book, for the business-details fields
    on the application forms.

    Staff only: unlike ``/lookup``, which needs the ABN in hand, this enumerates
    the book by name fragment, so it stays off the client and referrer portals.
    Exact-name matches sort first, then names that start with the term.
    """
    term = q.strip()
    safe = escape_like(term)
    digits = _normalize_abn(term)
    clauses = [Organization.name.ilike(f"%{safe}%", escape="\\")]
    if digits:
        clauses.append(Organization.abn.ilike(f"{digits}%", escape="\\"))
    rows = (
        db.query(Organization)
        .filter(Organization.tenant_id == tenant_id, or_(*clauses))
        .order_by(Organization.name)
        .limit(limit * 4)  # room for the relevance sort below to do its work
        .all()
    )

    lowered = term.lower()

    def rank(org: Organization) -> tuple[int, str]:
        name = (org.name or "").lower()
        if name == lowered:
            return (0, name)
        if name.startswith(lowered):
            return (1, name)
        return (2, name)

    rows.sort(key=rank)
    rows = rows[:limit]
    if not rows:
        return []

    ids = [o.id for o in rows]
    director_counts = dict(
        db.query(ContactOrganization.organization_id, func.count(ContactOrganization.id))
        .filter(
            ContactOrganization.organization_id.in_(ids),
            func.lower(ContactOrganization.role).in_(("director", "guarantor")),
        )
        .group_by(ContactOrganization.organization_id)
        .all()
    )
    app_counts = dict(
        db.query(LoanApplication.business_organization_id, func.count(LoanApplication.id))
        .filter(
            LoanApplication.business_organization_id.in_(ids),
            LoanApplication.deleted_at.is_(None),
        )
        .group_by(LoanApplication.business_organization_id)
        .all()
    )
    return [
        EntitySearchResult(
            id=o.id,
            name=o.name,
            entity_type=o.entity_type,
            trust_type=o.trust_type,
            abn=o.abn,
            acn=o.acn,
            industry=o.industry,
            address=o.address,
            director_count=director_counts.get(o.id, 0),
            application_count=app_counts.get(o.id, 0),
        )
        for o in rows
    ]


@router.get("/lookup")
def lookup_by_abn(
    abn: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker", "referrer", "client")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Find a Company in this tenant whose ABN matches (digits-only). Returns null if none."""
    normalized = _normalize_abn(abn)
    if not normalized:
        return {"organization": None}
    org = (
        db.query(Organization)
        .filter(Organization.tenant_id == tenant_id, Organization.abn == normalized)
        .first()
    )
    if not org:
        return {"organization": None}
    return {"organization": _org_with_counts(org, db)}


@router.post("", response_model=OrganizationOut, status_code=status.HTTP_201_CREATED)
def create_organization(
    data: OrganizationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    abn = _normalize_abn(data.abn)
    _require_no_abn_confirmation(data.entity_type, abn, data.no_abn_confirmed)
    if abn:
        existing = (
            db.query(Organization)
            .filter(Organization.tenant_id == tenant_id, Organization.abn == abn)
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A company with this ABN already exists: {existing.name}",
            )

    confirmed_no_abn = data.entity_type == "trust" and not abn and data.no_abn_confirmed
    org = Organization(
        tenant_id=tenant_id,
        name=data.name.strip(),
        entity_type=data.entity_type,
        abn=abn,
        acn=_normalize_acn(data.acn, abn, data.entity_type),
        industry=data.industry.strip() if data.industry else None,
        address=data.address.strip() if data.address else None,
        notes=data.notes,
        trust_type=data.trust_type if data.entity_type == "trust" else None,
        no_abn_confirmed=confirmed_no_abn,
        no_abn_confirmed_at=datetime.now(timezone.utc) if confirmed_no_abn else None,
        no_abn_confirmed_by_id=current_user.id if confirmed_no_abn else None,
    )
    db.add(org)
    db.commit()
    db.refresh(org)
    return _org_with_counts(org, db)


@router.get("/duplicates")
def list_duplicate_organizations(
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Find candidate duplicate companies, grouped, without changing anything.

    Matches on ABN and normalized name ("high"), or name ignoring legal
    suffixes like Pty Ltd ("review"). Companies with the same name but
    different ABNs are treated as distinct entities and never grouped.
    """
    all_orgs = db.query(Organization).filter(Organization.tenant_id == tenant_id).all()
    groups, high_groups = find_org_duplicates(all_orgs)
    return {
        "groups": [
            {
                "confidence": g["confidence"],
                "matched_on": g["matched_on"],
                "organizations": [_org_with_counts(o, db) for o in g["members"]],
            }
            for g in groups
        ],
        "total_duplicates": sum(len(g["members"]) - 1 for g in groups),
        "auto_merge_groups": len(high_groups),
    }


@router.post("/check-duplicates")
def check_duplicate_organizations(
    data: OrganizationDuplicateCheck,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Screen partial form values against existing companies before creating one.

    Returns possible matches with confidence + matched-on fields; never blocks.
    """
    candidate = org_signals(**data.model_dump())
    if not any(candidate.values()):
        return {"matches": []}
    all_orgs = db.query(Organization).filter(Organization.tenant_id == tenant_id).all()
    matches = match_candidate_orgs(candidate, all_orgs)
    return {
        "matches": [
            {
                "confidence": level,
                "matched_on": reasons,
                "organization": _org_with_counts(o, db),
            }
            for o, level, reasons in matches[:5]
        ]
    }


@router.post("/merge", response_model=OrganizationOut)
def merge_organization_group(
    data: OrganizationMergeRequest,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Merge specific duplicate companies into a chosen primary.

    Applications, corporate guarantees, and contact links all move to the
    primary; the duplicates are deleted.
    """
    if data.primary_id in data.duplicate_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Primary company cannot be in the duplicate list")
    if not data.duplicate_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No duplicates to merge")

    primary = _get_org_in_tenant(data.primary_id, tenant_id, db)
    duplicates = db.query(Organization).filter(
        Organization.id.in_(data.duplicate_ids), Organization.tenant_id == tenant_id
    ).all()
    if len(duplicates) != len(set(data.duplicate_ids)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="One or more duplicate companies not found")

    merge_organizations(db, primary, duplicates)
    db.commit()
    db.refresh(primary)
    return _org_with_counts(primary, db)


@router.post("/deduplicate", status_code=status.HTTP_200_OK)
def deduplicate_organizations(
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Auto-merge high-confidence duplicate companies (matching ABN or exact
    normalized name with no ABN conflict). The oldest company in each group is
    kept. Suffix-only name variations are left for manual review."""
    all_orgs = db.query(Organization).filter(Organization.tenant_id == tenant_id).all()
    _groups, high_groups = find_org_duplicates(all_orgs)

    merged_count = 0
    deleted_count = 0
    for group in high_groups:
        primary, duplicates = group[0], group[1:]
        merge_organizations(db, primary, duplicates)
        merged_count += 1
        deleted_count += len(duplicates)

    db.commit()
    remaining = db.query(func.count(Organization.id)).filter(Organization.tenant_id == tenant_id).scalar()
    return {
        "groups_merged": merged_count,
        "duplicates_removed": deleted_count,
        "organizations_remaining": remaining,
    }


@router.get("/{org_id}", response_model=OrganizationDetailOut)
def get_organization(
    org_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    org = _get_org_in_tenant(org_id, tenant_id, db)

    contact_rows = (
        db.query(Contact, ContactOrganization.role)
        .join(ContactOrganization, ContactOrganization.contact_id == Contact.id)
        .filter(ContactOrganization.organization_id == org_id)
        .all()
    )
    contacts = [
        {
            "id": c.id,
            "first_name": c.first_name,
            "last_name": c.last_name,
            "email": c.email,
            "phone": c.phone,
            "role": role,
        }
        for c, role in contact_rows
    ]

    apps = (
        db.query(LoanApplication)
        .filter(
            LoanApplication.business_organization_id == org_id,
            LoanApplication.deleted_at.is_(None),
        )
        .order_by(LoanApplication.created_at.desc())
        .limit(200)
        .all()
    )
    user_ids = {a.user_id for a in apps if a.user_id}
    users_map: dict[str, tuple[Optional[str], str]] = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            users_map[u.id] = (u.full_name, u.role.value)
    applications = [
        {
            "id": a.id,
            "loan_type": a.loan_type.value,
            "amount": float(a.amount),
            "status": a.status.value,
            "created_at": a.created_at,
            # user_name/user_role are the *owner* — a staff-created application is
            # owned by the broker who created it, so the client column must prefer
            # the applicant fields and only fall back for client-owned rows.
            "user_name": users_map.get(a.user_id, (None, None))[0] if a.user_id else None,
            "user_role": users_map.get(a.user_id, (None, None))[1] if a.user_id else None,
            "applicant_first_name": a.applicant_first_name,
            "applicant_last_name": a.applicant_last_name,
        }
        for a in apps
    ]

    return {
        **_org_with_counts(org, db),
        "contacts": contacts,
        "applications": applications,
        "trust_parties": [_trust_party_dict(p) for p in _ordered_parties(org.trust_parties)],
    }


@router.patch("/{org_id}", response_model=OrganizationOut)
def update_organization(
    org_id: str,
    data: OrganizationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    org = _get_org_in_tenant(org_id, tenant_id, db)

    payload = data.model_dump(exclude_unset=True)

    # Re-check the no-ABN acknowledgement against the *resulting* entity, so it
    # also fires when an existing company is retyped as a trust or loses its ABN.
    entity_type = payload.get("entity_type", org.entity_type)
    resulting_abn = _normalize_abn(payload["abn"]) if "abn" in payload else org.abn
    confirmed = payload.get("no_abn_confirmed", org.no_abn_confirmed)
    _require_no_abn_confirmation(entity_type, resulting_abn, bool(confirmed))
    if payload.get("no_abn_confirmed") and not org.no_abn_confirmed:
        org.no_abn_confirmed_at = datetime.now(timezone.utc)
        org.no_abn_confirmed_by_id = current_user.id
    if entity_type != "trust":
        # Trust-only fields don't survive a change of legal structure.
        payload["trust_type"] = None

    if "abn" in payload:
        new_abn = _normalize_abn(payload["abn"])
        if new_abn and new_abn != org.abn:
            clash = (
                db.query(Organization)
                .filter(
                    Organization.tenant_id == tenant_id,
                    Organization.abn == new_abn,
                    Organization.id != org_id,
                )
                .first()
            )
            if clash:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"A company with this ABN already exists: {clash.name}",
                )
        org.abn = new_abn
        payload.pop("abn")
    if "acn" in payload:
        payload["acn"] = _normalize_acn(payload["acn"], resulting_abn, entity_type)
    for key in ("name", "industry", "address"):
        if key in payload and payload[key] is not None:
            payload[key] = payload[key].strip() or None
    for field, value in payload.items():
        setattr(org, field, value)
    db.commit()
    db.refresh(org)
    return _org_with_counts(org, db)


@router.delete("/{org_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_organization(
    org_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    org = _get_org_in_tenant(org_id, tenant_id, db)

    linked_apps = (
        db.query(func.count(LoanApplication.id))
        .filter(
            LoanApplication.business_organization_id == org_id,
            LoanApplication.deleted_at.is_(None),
        )
        .scalar() or 0
    )
    linked_contacts = (
        db.query(func.count(ContactOrganization.id))
        .filter(ContactOrganization.organization_id == org_id)
        .scalar() or 0
    )
    linked_guarantees = (
        db.query(func.count(ApplicationGuarantor.id))
        .join(LoanApplication, ApplicationGuarantor.application_id == LoanApplication.id)
        .filter(
            ApplicationGuarantor.organization_id == org_id,
            LoanApplication.deleted_at.is_(None),
        )
        .scalar() or 0
    )
    # Named in another entity's trust structure (corporate trustee, beneficiary…).
    linked_trust_roles = (
        db.query(func.count(TrustParty.id))
        .filter(TrustParty.linked_organization_id == org_id)
        .scalar() or 0
    )
    if linked_apps or linked_contacts or linked_guarantees or linked_trust_roles:
        bits = []
        if linked_contacts:
            bits.append(f"{linked_contacts} contact{'s' if linked_contacts != 1 else ''}")
        if linked_apps:
            bits.append(f"{linked_apps} application{'s' if linked_apps != 1 else ''}")
        if linked_guarantees:
            bits.append(
                f"guarantor on {linked_guarantees} application{'s' if linked_guarantees != 1 else ''}"
            )
        if linked_trust_roles:
            bits.append(
                f"named in {linked_trust_roles} trust structure{'s' if linked_trust_roles != 1 else ''}"
            )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot delete: still linked to {' and '.join(bits)}. Unlink first.",
        )

    # Soft-deleted (trashed) applications still hold FK rows that would make the
    # DELETE fail on Postgres, and there is no purge flow to clear them — detach.
    db.query(LoanApplication).filter(
        LoanApplication.business_organization_id == org_id,
        LoanApplication.deleted_at.isnot(None),
    ).update({"business_organization_id": None}, synchronize_session=False)
    for guarantor in (
        db.query(ApplicationGuarantor)
        .filter(ApplicationGuarantor.organization_id == org_id)
        .all()
    ):
        db.delete(guarantor)

    db.delete(org)
    db.commit()


@router.post("/{org_id}/contacts", status_code=status.HTTP_201_CREATED)
def link_contact(
    org_id: str,
    data: OrganizationContactLink,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    _get_org_in_tenant(org_id, tenant_id, db)
    contact = db.query(Contact).filter(Contact.id == data.contact_id, Contact.tenant_id == tenant_id).first()
    if not contact:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")

    existing = (
        db.query(ContactOrganization)
        .filter(
            ContactOrganization.organization_id == org_id,
            ContactOrganization.contact_id == data.contact_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Contact is already linked to this company")

    link = ContactOrganization(
        contact_id=data.contact_id,
        organization_id=org_id,
        role=data.role.strip() if data.role else None,
        tenant_id=tenant_id,
    )
    db.add(link)
    db.commit()
    return {
        "id": contact.id,
        "first_name": contact.first_name,
        "last_name": contact.last_name,
        "email": contact.email,
        "phone": contact.phone,
        "role": link.role,
    }


# ---------------------------------------------------------------------------
# Trust structure — parties of an entity_type == "trust" organization
# ---------------------------------------------------------------------------


def _resolve_party_links(
    payload: dict, org: Organization, tenant_id: str, db: Session
) -> None:
    """Validate the party's linked records in place (tenant-scoped, mutually exclusive)."""
    contact_id = payload.get("contact_id")
    linked_org_id = payload.get("linked_organization_id")

    if contact_id and linked_org_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A trust party links to either a contact or a company, not both",
        )
    if contact_id:
        contact = db.query(Contact).filter(Contact.id == contact_id, Contact.tenant_id == tenant_id).first()
        if not contact:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")
    if linked_org_id:
        if linked_org_id == org.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A trust cannot be its own trustee or beneficiary",
            )
        _get_org_in_tenant(linked_org_id, tenant_id, db)
    if "abn" in payload:
        payload["abn"] = _normalize_abn(payload["abn"])
        # A corporate trustee is the party a lender actually contracts with, so a
        # transposed digit here is worth catching at entry rather than at signing.
        if payload["abn"] and not acn_service.is_valid_abn(payload["abn"]):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="That ABN's check digit doesn't match — it looks like a typo",
            )
    if "name" in payload and payload["name"]:
        payload["name"] = payload["name"].strip() or None


def _require_party_identity(
    contact_id: Optional[str], linked_org_id: Optional[str], name: Optional[str]
) -> None:
    if not contact_id and not linked_org_id and not (name or "").strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Link a contact or company, or enter a name for this trust party",
        )


def _get_trust_org(org_id: str, tenant_id: str, db: Session) -> Organization:
    org = _get_org_in_tenant(org_id, tenant_id, db)
    if org.entity_type != "trust":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Trust parties can only be recorded on an entity of type trust",
        )
    return org


@router.get("/{org_id}/trust-parties", response_model=list[TrustPartyOut])
def list_trust_parties(
    org_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    org = _get_org_in_tenant(org_id, tenant_id, db)
    return [_trust_party_dict(p) for p in _ordered_parties(org.trust_parties)]


@router.post("/{org_id}/trust-parties", response_model=TrustPartyOut, status_code=status.HTTP_201_CREATED)
def add_trust_party(
    org_id: str,
    data: TrustPartyCreate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    org = _get_trust_org(org_id, tenant_id, db)

    payload = data.model_dump()
    _resolve_party_links(payload, org, tenant_id, db)
    _require_party_identity(payload.get("contact_id"), payload.get("linked_organization_id"), payload.get("name"))

    party = TrustParty(tenant_id=tenant_id, organization_id=org.id, **payload)
    db.add(party)
    db.commit()
    db.refresh(party)
    return _trust_party_dict(party)


@router.patch("/{org_id}/trust-parties/{party_id}", response_model=TrustPartyOut)
def update_trust_party(
    org_id: str,
    party_id: str,
    data: TrustPartyUpdate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    org = _get_trust_org(org_id, tenant_id, db)
    party = (
        db.query(TrustParty)
        .filter(TrustParty.id == party_id, TrustParty.organization_id == org.id)
        .first()
    )
    if not party:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trust party not found")

    payload = data.model_dump(exclude_unset=True)
    _resolve_party_links(payload, org, tenant_id, db)
    # Switching to a linked record clears the other identity, so the resulting
    # party is checked as a whole rather than field by field.
    if payload.get("contact_id"):
        payload["linked_organization_id"] = None
    elif payload.get("linked_organization_id"):
        payload["contact_id"] = None
    for field, value in payload.items():
        setattr(party, field, value)
    _require_party_identity(party.contact_id, party.linked_organization_id, party.name)

    db.commit()
    db.refresh(party)
    return _trust_party_dict(party)


@router.delete("/{org_id}/trust-parties/{party_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_trust_party(
    org_id: str,
    party_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    org = _get_org_in_tenant(org_id, tenant_id, db)
    party = (
        db.query(TrustParty)
        .filter(TrustParty.id == party_id, TrustParty.organization_id == org.id)
        .first()
    )
    if not party:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trust party not found")
    db.delete(party)
    db.commit()


@router.delete("/{org_id}/contacts/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def unlink_contact(
    org_id: str,
    contact_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    _get_org_in_tenant(org_id, tenant_id, db)
    link = (
        db.query(ContactOrganization)
        .filter(
            ContactOrganization.organization_id == org_id,
            ContactOrganization.contact_id == contact_id,
        )
        .first()
    )
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link not found")
    db.delete(link)
    db.commit()
