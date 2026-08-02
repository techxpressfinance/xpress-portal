from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.contact import Contact, ContactOrganization, Organization
from app.models.loan_applicant import ApplicationGuarantor
from app.models.loan_application import LoanApplication
from app.models.user import User
from app.schemas.organization import (
    OrganizationContactLink,
    OrganizationCreate,
    OrganizationDetailOut,
    OrganizationDuplicateCheck,
    OrganizationMergeRequest,
    OrganizationOut,
    OrganizationUpdate,
    PaginatedOrganizations,
)
from app.config import ABR_ENABLED
from app.constants import ENTITY_TYPES
from app.services.abr import lookup_abn as abr_lookup_abn
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
        "industry": org.industry,
        "address": org.address,
        "notes": org.notes,
        "contact_count": contact_count,
        "application_count": application_count,
        "created_at": org.created_at,
        "updated_at": org.updated_at,
    }


def _get_org_in_tenant(org_id: str, tenant_id: str, db: Session) -> Organization:
    org = db.query(Organization).filter(Organization.id == org_id, Organization.tenant_id == tenant_id).first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")
    return org


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
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    abn = _normalize_abn(data.abn)
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

    org = Organization(
        tenant_id=tenant_id,
        name=data.name.strip(),
        entity_type=data.entity_type,
        abn=abn,
        industry=data.industry.strip() if data.industry else None,
        address=data.address.strip() if data.address else None,
        notes=data.notes,
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
    users_map: dict[str, str] = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            users_map[u.id] = u.full_name
    applications = [
        {
            "id": a.id,
            "loan_type": a.loan_type.value,
            "amount": float(a.amount),
            "status": a.status.value,
            "created_at": a.created_at,
            "user_name": users_map.get(a.user_id) if a.user_id else None,
        }
        for a in apps
    ]

    return {
        **_org_with_counts(org, db),
        "contacts": contacts,
        "applications": applications,
    }


@router.patch("/{org_id}", response_model=OrganizationOut)
def update_organization(
    org_id: str,
    data: OrganizationUpdate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    org = _get_org_in_tenant(org_id, tenant_id, db)

    payload = data.model_dump(exclude_unset=True)
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
    if linked_apps or linked_contacts or linked_guarantees:
        bits = []
        if linked_contacts:
            bits.append(f"{linked_contacts} contact{'s' if linked_contacts != 1 else ''}")
        if linked_apps:
            bits.append(f"{linked_apps} application{'s' if linked_apps != 1 else ''}")
        if linked_guarantees:
            bits.append(
                f"guarantor on {linked_guarantees} application{'s' if linked_guarantees != 1 else ''}"
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
