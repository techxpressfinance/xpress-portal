from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.models.contact import ContactOrganization, Organization


def normalize_abn(value: Optional[str]) -> Optional[str]:
    """Return digits-only ABN, or None if there are no digits."""
    if not value:
        return None
    digits = "".join(ch for ch in value if ch.isdigit())
    return digits or None


def find_or_create_organization_by_abn(
    db: Session,
    tenant_id: str,
    abn: Optional[str],
    fallback_name: Optional[str],
) -> Optional[Organization]:
    """Find an Organization by ABN within the tenant. Create a stub if missing.

    With no ABN the name is the only handle there is — a trust may legitimately
    have none — so an exact (case/whitespace-insensitive) name match is used
    instead, otherwise every save of the same ABN-less borrower would strand
    another stub company.

    Returns None if neither abn nor fallback_name is meaningful — caller should
    skip linkage in that case.
    """
    normalized = normalize_abn(abn)
    if normalized:
        existing = (
            db.query(Organization)
            .filter(Organization.tenant_id == tenant_id, Organization.abn == normalized)
            .first()
        )
        if existing:
            return existing

    name = (fallback_name or "").strip()
    if not normalized and not name:
        return None

    if not normalized and name:
        key = " ".join(name.lower().split())
        for candidate in (
            db.query(Organization)
            .filter(Organization.tenant_id == tenant_id, Organization.abn.is_(None))
            .all()
        ):
            if " ".join((candidate.name or "").lower().split()) == key:
                return candidate

    org = Organization(
        tenant_id=tenant_id,
        name=name or "Unnamed Company",
        abn=normalized,
    )
    db.add(org)
    db.flush()
    return org


def contact_organization_link(
    db: Session, contact_id: Optional[str], organization_id: Optional[str]
) -> Optional[ContactOrganization]:
    """The existing link between a contact and an organization, if any."""
    if not contact_id or not organization_id:
        return None
    return (
        db.query(ContactOrganization)
        .filter(
            ContactOrganization.contact_id == contact_id,
            ContactOrganization.organization_id == organization_id,
        )
        .first()
    )


def ensure_contact_organization_link(
    db: Session,
    tenant_id: str,
    contact_id: Optional[str],
    organization_id: Optional[str],
    role: Optional[str] = None,
) -> Optional[ContactOrganization]:
    """Link a contact to an organization, on the broker's say-so.

    An application can carry both a client (contact) and a business entity
    (organization), and when it does the entity should surface on the client's
    page and the client on the entity's page. But the pairing is a *claim about a
    person* — that this client is part of that business — and an application can
    pair them by accident: an ABN typed wrong, a company matched on a name
    collision, a client re-using a draft. Creating it unasked writes that claim
    into the CRM, where it then seeds directors onto applications and puts a
    person's name on another company's tax invoice.

    So this is only called once a broker has confirmed the pairing. Idempotent —
    an existing link is left untouched, so a role already set by hand is never
    overwritten.
    """
    if not contact_id or not organization_id:
        return None
    existing = contact_organization_link(db, contact_id, organization_id)
    if existing:
        return existing
    link = ContactOrganization(
        tenant_id=tenant_id,
        contact_id=contact_id,
        organization_id=organization_id,
        role=role,
    )
    db.add(link)
    return link
