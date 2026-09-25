from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.config import ABR_ENABLED
from app.models.contact import ContactOrganization, Organization
from app.services.abr import AbrRecord, AbrUnavailable, lookup_abn

logger = logging.getLogger(__name__)

# The ABR snapshot columns on Organization, cleared when the ABN goes away.
ABR_FIELDS = (
    "abr_entity_type_name", "abn_status", "abn_active_from", "gst_registered",
    "gst_from", "trading_names", "abr_state", "abr_postcode", "abr_checked_at",
)


def entity_type_from_abr(name: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """Map the register's EntityTypeName onto our (entity_type, trust_type).

    (None, None) for anything without a clean equivalent (government bodies,
    deceased estates, super funds other than an SMSF...) — the broker picks.
    A company acting as trustee reads as a plain company on the register, so
    "trustee" is never inferred.
    """
    label = (name or "").lower()
    if not label:
        return None, None
    if label in ("australian private company", "australian public company"):
        return "company", None
    if "sole trader" in label:
        return "sole_trader", None
    if "partnership" in label:
        return "partnership", None
    if "self-managed superannuation" in label:
        return "trust", "smsf"
    if "trust" in label:
        if "discretionary" in label:
            return "trust", "discretionary"
        if "unit trust" in label:
            return "trust", "unit"
        if "hybrid" in label:
            return "trust", "hybrid"
        if "fixed" in label:
            return "trust", "fixed"
        return "trust", "other"
    return None, None


def apply_abr_record(org: Organization, record: Optional[AbrRecord]) -> None:
    """Write an ABR lookup result onto the entity.

    The snapshot columns are overwritten (the register is the authority on
    them); entity_type/trust_type/acn are only filled when blank, so a broker's
    own classification is never second-guessed. ``None`` records a miss.
    """
    org.abr_checked_at = datetime.now(timezone.utc)
    if record is None:
        for field in ABR_FIELDS:
            if field != "abr_checked_at":
                setattr(org, field, None)
        return

    org.abr_entity_type_name = record.get("entity_type")
    org.abn_status = record.get("status")
    org.abn_active_from = record.get("status_from")
    org.gst_registered = record.get("gst_registered")
    org.gst_from = record.get("gst_from")
    org.trading_names = json.dumps(record.get("trading_names") or [])
    org.abr_state = record.get("state")
    org.abr_postcode = record.get("postcode")

    if not org.entity_type:
        entity_type, trust_type = entity_type_from_abr(record.get("entity_type"))
        if entity_type:
            org.entity_type = entity_type
            if entity_type == "trust" and not org.trust_type:
                org.trust_type = trust_type
    if not org.acn and record.get("acn"):
        org.acn = record["acn"]


def refresh_from_abr(org: Organization) -> bool:
    """Re-read the entity's ABN from the register. Returns False when nothing was
    asked (no ABN, ABR not configured) or the register couldn't be reached — in
    which case the entity is left untouched so a later view retries."""
    if not ABR_ENABLED or not org.abn:
        return False
    try:
        record = lookup_abn(org.abn, raise_errors=True)
    except AbrUnavailable as exc:
        logger.warning("ABR refresh skipped for organization %s: %s", org.id, exc)
        return False
    apply_abr_record(org, record)
    return True


def clear_abr(org: Organization) -> None:
    for field in ABR_FIELDS:
        setattr(org, field, None)


def parse_trading_names(value: Optional[str]) -> list[str]:
    if not value:
        return []
    try:
        names = json.loads(value)
    except (TypeError, ValueError):
        return []
    return [n for n in names if isinstance(n, str) and n] if isinstance(names, list) else []


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
