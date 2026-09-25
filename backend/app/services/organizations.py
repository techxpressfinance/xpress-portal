from __future__ import annotations

import json
import logging
import time
from datetime import date, datetime, timezone
from typing import TYPE_CHECKING, Callable, Optional

from sqlalchemy.orm import Session

from app.models.contact import ContactOrganization, Organization
from app.services.abr import AbrRecord, lookup_abn

if TYPE_CHECKING:
    from app.models.loan_application import LoanApplication

logger = logging.getLogger(__name__)

# Names given to organizations stubbed from application data before anyone
# knew what the entity was called — safe for the ABR's legal name to replace.
PLACEHOLDER_ORG_NAMES = {"unnamed company", "unknown"}

# Pause between register calls in a bulk sync, to stay polite to the free ABR API.
ABR_BULK_DELAY_SECONDS = 0.25


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
    if normalized:
        # One register call per new entity — a stub is only made once per ABN.
        refresh_from_abr(org)
    db.add(org)
    db.flush()
    return org


def _parse_iso_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _entity_type_from_abr(abr_type: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """Map the ABR's EntityTypeName onto (ENTITY_TYPES, TRUST_TYPES) values.

    Only the unambiguous cases — anything else is left for the broker to set.
    """
    label = (abr_type or "").lower()
    if not label:
        return None, None
    if "superannuation fund" in label and "self managed" in label.replace("-", " "):
        return "trust", "smsf"
    if "trust" in label:
        for key, trust_type in (("discretionary", "discretionary"), ("unit", "unit"),
                                ("hybrid", "hybrid"), ("fixed", "fixed")):
            if key in label:
                return "trust", trust_type
        return "trust", None
    if "private company" in label or "public company" in label:
        return "company", None
    if "partnership" in label:
        return "partnership", None
    if "sole trader" in label:
        return "sole_trader", None
    return None, None


def apply_abr_record(org: Organization, record: AbrRecord) -> None:
    """Copy an ABR record onto an organization.

    The register snapshot fields are always overwritten (the ABR is the
    authority and they go stale). Broker-owned fields — name, ACN, entity
    type — are only filled when blank, never overwritten."""
    org.abn_status = record.get("status")
    org.abn_registered_from = _parse_iso_date(record.get("status_from"))
    org.abr_entity_type = record.get("entity_type")
    org.gst_registered = record.get("gst_registered")
    org.gst_registered_from = _parse_iso_date(record.get("gst_from"))
    # ABR lists a business name once per registration, so repeats are common.
    seen: set[str] = set()
    names: list[str] = []
    for name in record.get("trading_names") or []:
        if name.strip().lower() not in seen:
            seen.add(name.strip().lower())
            names.append(name.strip())
    org.trading_names = json.dumps(names)
    org.registered_state = record.get("state")
    org.registered_postcode = record.get("postcode")
    org.abr_checked_at = datetime.now(timezone.utc)

    legal_name = (record.get("name") or "").strip()
    if legal_name and (not (org.name or "").strip() or org.name.strip().lower() in PLACEHOLDER_ORG_NAMES):
        org.name = legal_name[:200]
    if not org.acn and record.get("acn"):
        org.acn = record["acn"]
    if not org.entity_type:
        entity_type, trust_type = _entity_type_from_abr(record.get("entity_type"))
        if entity_type:
            org.entity_type = entity_type
            if entity_type == "trust" and not org.trust_type:
                org.trust_type = trust_type


def clear_abr_snapshot(org: Organization) -> None:
    """Drop register data that belonged to an ABN the organization no longer has."""
    org.abn_status = None
    org.abn_registered_from = None
    org.abr_entity_type = None
    org.gst_registered = None
    org.gst_registered_from = None
    org.trading_names = None
    org.registered_state = None
    org.registered_postcode = None
    org.abr_checked_at = None


def refresh_from_abr(org: Organization) -> bool:
    """Look the organization's ABN up on the ABR and apply the result.

    Returns True when a record was found and applied. Never raises — a register
    outage must not break the save that triggered it. Caller commits."""
    if not org.abn:
        return False
    try:
        record = lookup_abn(org.abn)
    except Exception:  # noqa: BLE001 — best-effort enrichment
        logger.exception("ABR refresh failed for organization %s", org.id)
        return False
    if not record:
        return False
    apply_abr_record(org, record)
    return True


def refresh_tenant_orgs_from_abr(
    tenant_id: str,
    org_ids: list[str],
    session_factory: Callable[[], Session],
) -> None:
    """Background bulk sync. One fresh session per organization (ocr.py pattern),
    so a slow register call never holds a transaction open across the batch."""
    updated = 0
    for org_id in org_ids:
        db = session_factory()
        try:
            org = (
                db.query(Organization)
                .filter(Organization.id == org_id, Organization.tenant_id == tenant_id)
                .first()
            )
            if org and refresh_from_abr(org):
                db.commit()
                updated += 1
        except Exception:  # noqa: BLE001
            db.rollback()
            logger.exception("ABR bulk sync failed for organization %s", org_id)
        finally:
            db.close()
        time.sleep(ABR_BULK_DELAY_SECONDS)
    logger.info("ABR bulk sync: %d/%d organizations updated (tenant %s)", updated, len(org_ids), tenant_id)


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


# The entity book's structure vocabulary, in the words the application forms'
# Business Structure select offers. A trustee company is a company there.
ENTITY_TYPE_TO_STRUCTURE = {
    "sole_trader": "Sole Trader",
    "partnership": "Partnership",
    "company": "Company",
    "trustee": "Company",
    "trust": "Trust",
}


def is_placeholder_name(name: Optional[str]) -> bool:
    return not (name or "").strip() or name.strip().lower() in PLACEHOLDER_ORG_NAMES


def duration_since(start: Optional[date], today: Optional[date] = None) -> Optional[str]:
    """ "4 years 2 months" — mirrors durationSince in frontend/src/lib/utils.ts."""
    if not start:
        return None
    today = today or date.today()
    months = (today.year - start.year) * 12 + (today.month - start.month)
    if today.day < start.day:
        months -= 1
    if months < 0:
        return None
    years, rem = divmod(months, 12)
    parts = []
    if years:
        parts.append(f"{years} year{'' if years == 1 else 's'}")
    if rem or not years:
        parts.append(f"{rem} month{'' if rem == 1 else 's'}")
    return " ".join(parts)


def ensure_abr_snapshot(org: Organization) -> None:
    """Fetch the ABR record for an entity that has an ABN but was never checked
    (created before the ABR sync existed). Caller commits."""
    if org.abn and not org.abr_checked_at:
        refresh_from_abr(org)


def fill_application_from_org(application: "LoanApplication", org: Organization) -> list[str]:
    """Copy what the entity knows onto the application's business fields.

    Blank fields only — anything the applicant or broker entered stands. The
    ABN age is a floor on time trading (the business may have traded under an
    earlier ABN), which is why it never overwrites a typed figure. Returns the
    fields that were filled."""
    filled: list[str] = []

    def fill(field: str, value) -> None:
        if value in (None, "") or getattr(application, field) not in (None, ""):
            return
        setattr(application, field, value)
        filled.append(field)

    if not is_placeholder_name(org.name) and is_placeholder_name(application.business_name):
        application.business_name = org.name
        filled.append("business_name")
    fill("business_abn", org.abn)
    try:
        names = json.loads(org.trading_names) if org.trading_names else []
    except ValueError:
        names = []
    fill("trading_name", names[0] if names and isinstance(names[0], str) else None)
    fill("business_structure", ENTITY_TYPE_TO_STRUCTURE.get(org.entity_type or ""))
    if org.abn_registered_from:
        fill("business_registration_date", org.abn_registered_from.isoformat())
        fill("time_trading", duration_since(org.abn_registered_from))
    fill("gst_registered", org.gst_registered)
    return filled
