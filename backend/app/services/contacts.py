from __future__ import annotations

from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.contact import Contact


def ensure_contact(
    db: Session,
    tenant_id: str,
    first_name: str,
    last_name: str,
    email: Optional[str] = None,
    phone: Optional[str] = None,
) -> Contact:
    """Find an existing contact by email (case-insensitive) or create one.

    Referrer-created clients are mirrored into the CRM Contact table so they
    surface for admins and brokers alongside manually created contacts.
    """
    email_norm = email.strip().lower() if email else None
    if email_norm:
        existing = (
            db.query(Contact)
            .filter(
                Contact.tenant_id == tenant_id,
                func.lower(Contact.email) == email_norm,
            )
            .first()
        )
        if existing:
            return existing

    contact = Contact(
        tenant_id=tenant_id,
        first_name=first_name.strip(),
        last_name=last_name.strip(),
        email=email_norm,
        phone=(phone or "").strip() or None,
    )
    db.add(contact)
    db.flush()
    return contact
