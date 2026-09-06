from __future__ import annotations

import re
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.contact import Contact


def _text_key(value: Optional[str]) -> str:
    """A forgiving comparison key for contact names stored encrypted at rest."""
    return " ".join((value or "").strip().lower().split())


def _phone_key(value: Optional[str]) -> str:
    return re.sub(r"\D", "", value or "")


def _fill_missing_contact_fields(
    contact: Contact,
    *,
    middle_name: Optional[str] = None,
    email: Optional[str] = None,
    phone: Optional[str] = None,
    date_of_birth: Optional[str] = None,
    drivers_license_number: Optional[str] = None,
    address: Optional[str] = None,
    suburb: Optional[str] = None,
    state: Optional[str] = None,
    postcode: Optional[str] = None,
) -> Contact:
    """Enrich a CRM record without replacing information already on file."""
    values = {
        "middle_name": middle_name,
        "email": email,
        "phone": phone,
        "date_of_birth": date_of_birth,
        "drivers_license_number": drivers_license_number,
        "address": address,
        "suburb": suburb,
        "state": state,
        "postcode": postcode,
    }
    for field, value in values.items():
        if value and not getattr(contact, field):
            setattr(contact, field, value.strip())
    return contact


def ensure_contact(
    db: Session,
    tenant_id: str,
    first_name: str,
    last_name: str,
    email: Optional[str] = None,
    phone: Optional[str] = None,
    *,
    middle_name: Optional[str] = None,
    date_of_birth: Optional[str] = None,
    drivers_license_number: Optional[str] = None,
    address: Optional[str] = None,
    suburb: Optional[str] = None,
    state: Optional[str] = None,
    postcode: Optional[str] = None,
) -> Contact:
    """Find an existing contact or create one, preserving richer CRM data.

    Referrer-created clients are mirrored into the CRM Contact table so they
    surface for admins and brokers alongside manually created contacts.

    Email is the primary identity. For a person without one (a common early
    business-applicant contact), PII encryption prevents a SQL name lookup, so
    the small tenant-scoped fallback compares decrypted name/phone values in
    Python. It deliberately requires an exact name and, when present, phone.
    """
    email_norm = email.strip().lower() if email else None
    first_key = _text_key(first_name)
    last_key = _text_key(last_name)
    phone_key = _phone_key(phone)
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
            return _fill_missing_contact_fields(
                existing,
                middle_name=middle_name,
                email=email_norm,
                phone=phone,
                date_of_birth=date_of_birth,
                drivers_license_number=drivers_license_number,
                address=address,
                suburb=suburb,
                state=state,
                postcode=postcode,
            )

    # Contact names and phone numbers are encrypted, so there is no safe SQL
    # predicate for this fallback. Only use it when an email was not supplied:
    # a different email is a stronger signal than a matching common name.
    if not email_norm:
        for existing in db.query(Contact).filter(Contact.tenant_id == tenant_id).all():
            if _text_key(existing.first_name) != first_key or _text_key(existing.last_name) != last_key:
                continue
            existing_phone_key = _phone_key(existing.phone)
            if phone_key and existing_phone_key and phone_key != existing_phone_key:
                continue
            return _fill_missing_contact_fields(
                existing,
                middle_name=middle_name,
                email=email_norm,
                phone=phone,
                date_of_birth=date_of_birth,
                drivers_license_number=drivers_license_number,
                address=address,
                suburb=suburb,
                state=state,
                postcode=postcode,
            )

    contact = Contact(
        tenant_id=tenant_id,
        first_name=first_name.strip(),
        last_name=last_name.strip(),
        email=email_norm,
        phone=(phone or "").strip() or None,
        middle_name=(middle_name or "").strip() or None,
        date_of_birth=(date_of_birth or "").strip() or None,
        drivers_license_number=(drivers_license_number or "").strip() or None,
        address=(address or "").strip() or None,
        suburb=(suburb or "").strip() or None,
        state=(state or "").strip() or None,
        postcode=(postcode or "").strip() or None,
    )
    db.add(contact)
    db.flush()
    return contact
