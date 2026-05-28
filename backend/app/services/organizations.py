from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.models.contact import Organization


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

    if not normalized and not fallback_name:
        return None

    org = Organization(
        tenant_id=tenant_id,
        name=(fallback_name or "Unnamed Company").strip(),
        abn=normalized,
    )
    db.add(org)
    db.flush()
    return org
