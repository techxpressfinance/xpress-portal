"""Backfill CRM contact email/phone from the applications that created them.

Why this exists
---------------
A contact is filed the first time an application carries a first and last name.
For a referrer lead that is the auto-saved draft, which has a name and nothing
else — so the contact lands with a NULL email and phone. Every later mirror
(``_sync_company_contact`` and the referrer mirror in ``update_application``)
skipped an application that already had a ``contact_id``, so the email and phone
typed in afterwards never reached the CRM record.

The result is a contact book full of bare names: a broker cannot search them by
email, and has no number to ring. ``update_application`` now enriches the linked
contact on every save, but that only helps applications saved from here on.
This script repairs the rows already on file.

Only ever fills blanks — a field already set on the contact is left alone, so a
contact a broker has edited by hand keeps what they typed. Safe to re-run.

    python3 backfill_contact_details.py --dry-run   # report, change nothing
    python3 backfill_contact_details.py             # apply
"""

from __future__ import annotations

import argparse
import sys

import app.main  # noqa: F401 — registers every model on the mapper registry
from app.database import SessionLocal
from app.models.contact import Contact
from app.models.external_referral import ExternalReferral
from app.models.loan_application import LoanApplication
from app.services.contacts import ensure_contact

# Contact field <- application column. Only fields both sides actually hold.
FIELD_MAP = {
    "email": "applicant_email",
    "phone": "applicant_mobile",
    "middle_name": "applicant_middle_name",
    "date_of_birth": "applicant_dob",
    "address": "applicant_address",
    "suburb": "applicant_suburb",
    "state": "applicant_state",
    "postcode": "applicant_postcode",
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="report without writing")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        contacts = {c.id: c for c in db.query(Contact).all()}
        # Newest last, so the freshest application wins a field two of them
        # could fill. Anything already on the contact still takes precedence.
        applications = (
            db.query(LoanApplication)
            .filter(LoanApplication.contact_id.isnot(None))
            .order_by(LoanApplication.created_at.asc())
            .all()
        )

        # Gather every candidate value per contact/field first. ensure_contact's
        # name-based fallback (used when an application has no email) can file
        # two different people under one contact, so a contact may be linked to
        # applications carrying genuinely different emails. Guessing between
        # them would staple the wrong identity onto the record, so a field with
        # more than one candidate is reported and left alone for a human.
        candidates: dict[tuple[str, str], set[str]] = {}
        for application in applications:
            contact = contacts.get(application.contact_id)
            if contact is None or contact.tenant_id != application.tenant_id:
                continue
            for contact_field, app_column in FIELD_MAP.items():
                if getattr(contact, contact_field, None):
                    continue  # never overwrite what the CRM already holds
                value = (getattr(application, app_column, None) or "").strip()
                if not value:
                    continue
                if contact_field == "email":
                    value = value.lower()
                candidates.setdefault((contact.id, contact_field), set()).add(value)

        filled: dict[str, dict[str, str]] = {}
        conflicts: dict[str, dict[str, list[str]]] = {}
        for (contact_id, contact_field), values in candidates.items():
            if len(values) > 1:
                conflicts.setdefault(contact_id, {})[contact_field] = sorted(values)
                continue
            value = values.pop()
            setattr(contacts[contact_id], contact_field, value)
            filled.setdefault(contact_id, {})[contact_field] = value

        if conflicts:
            print("SKIPPED — linked applications disagree, needs a human:\n")
            for contact_id, fields in conflicts.items():
                contact = contacts[contact_id]
                for contact_field, values in sorted(fields.items()):
                    print(f"  {contact.first_name} {contact.last_name} .{contact_field}: {values}")
            print()

        if not filled:
            print("No contact had an unambiguous missing field.")
        else:
            print("Filling:\n")
            for contact_id, fields in filled.items():
                contact = contacts[contact_id]
                shown = ", ".join(f"{k}={v!r}" for k, v in sorted(fields.items()))
                print(f"  {contact.first_name} {contact.last_name}: {shown}")

            field_count = sum(len(f) for f in filled.values())
            print(f"\n{len(filled)} contact(s), {field_count} field(s).")
        if conflicts:
            conflict_count = sum(len(f) for f in conflicts.values())
            print(f"{conflict_count} field(s) skipped as ambiguous.")

        # Referred clients that never reached the book at all. /refer now files
        # one at invite time; these predate that.
        filed = []
        for referral in db.query(ExternalReferral).filter(
            ExternalReferral.referred_client_id.isnot(None)
        ).all():
            client = referral.referred_client
            if not client or client.email.endswith("@deleted.invalid"):
                continue
            email = client.email.lower().strip()
            if any((c.email or "").lower().strip() == email for c in contacts.values()):
                continue
            parts = (client.full_name or email.split("@")[0]).split()
            first, last = parts[0], " ".join(parts[1:])
            tenant = referral.tenant_id or client.tenant_id

            # A namesake with no email at all is almost certainly this person,
            # filed earlier from an application that had a name and nothing
            # else. Fill it in rather than creating a second card for them.
            # Only when exactly one such namesake exists: two would mean the
            # name is shared, and picking either could staple this email onto
            # the wrong person.
            namesakes = [
                c for c in contacts.values()
                if c.tenant_id == tenant
                and not (c.email or "").strip()
                and (c.first_name or "").strip().lower() == first.strip().lower()
                and (c.last_name or "").strip().lower() == last.strip().lower()
            ]
            if len(namesakes) == 1:
                namesakes[0].email = email
                filed.append((first, last, email, "enriched existing"))
                continue
            contact = ensure_contact(db, tenant, first, last, email=email)
            contacts[contact.id] = contact
            filed.append((first, last, email, "created"))

        if filed:
            print("\nReferred clients filed into the contact book:\n")
            for first, last, email, how in filed:
                print(f"  {first} {last} <{email}>  ({how})")
            created = sum(1 for f in filed if f[3] == "created")
            print(f"\n{created} created, {len(filed) - created} enriched.")

        if args.dry_run:
            db.rollback()
            print("\nDry run — nothing written.")
        else:
            db.commit()
            print("\nCommitted.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
