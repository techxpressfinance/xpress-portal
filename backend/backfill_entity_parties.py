"""
Put people already linked to entities as directors/guarantors/signatories onto
those entities' live applications.

From now on this happens the moment someone is linked on the entity page; this
catches up links made before that (e.g. a director linked after the deal was
already on the board). Settled / rejected / not-proceeding applications are
left alone, and nobody already on an application is added twice.

A DRY RUN by default. With --apply each person added is emailed their
invite to complete their details, exactly as if a broker had added them.

    source venv/bin/activate
    python3 backfill_entity_parties.py --tenant-slug default
    python3 backfill_entity_parties.py --tenant-slug default --apply
"""
from __future__ import annotations

import argparse
import sys

from app.database import SessionLocal
from app.models import Tenant
from app.models.contact import ContactOrganization, Organization
from app.services import entity_parties


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--tenant-slug", required=True)
    parser.add_argument("--apply", action="store_true", help="Write and send invites (default is a dry run)")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        tenant = db.query(Tenant).filter_by(slug=args.tenant_slug).first()
        if not tenant:
            print(f"No tenant {args.tenant_slug!r}", file=sys.stderr)
            return 1
        links = db.query(ContactOrganization).filter(ContactOrganization.tenant_id == tenant.id).all()
        all_added = []
        for link in links:
            if not link.contact or not entity_parties.is_signing_role(link.role):
                continue
            added = entity_parties.add_to_live_applications(db, tenant.id, link.organization_id, link.contact, link.role)
            if added:
                org = db.get(Organization, link.organization_id)
                for app, party, _company in added:
                    print(f"  {link.contact.first_name} {link.contact.last_name} ({link.role}) → "
                          f"{org.name if org else link.organization_id} · application {app.id[:8]} "
                          f"as {party.role}{' (guarantor company signatory)' if party.application_guarantor_id else ''}"
                          f"{'' if party.invite_email else ' — no email, added uninvited'}")
                all_added += added
            db.flush()
        print(f"\n{len(all_added)} part{'y' if len(all_added) == 1 else 'ies'} to add.")
        if args.apply:
            db.commit()
            entity_parties.send_invites(all_added)
            print("Applied — invites sent to those with an email.")
        else:
            db.rollback()
            print("Dry run — nothing written. Re-run with --apply.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
