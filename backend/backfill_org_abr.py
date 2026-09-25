"""Fill every entity's Australian Business Register details from its ABN.

Why this exists
---------------
Entities auto-created from an application (or a lead) were stored with just a
name and an ABN, so the entity page showed no type, GST, "ABN active since" or
registered location even though the register had all of it. New and edited
entities now look themselves up, and an unlooked-up one refreshes the first time
it is opened, but this fills the whole book in one pass.

Like the live refresh, it overwrites only the ABR snapshot columns and fills
entity_type/trust_type/acn only where blank. Safe to re-run: by default it skips
entities already looked up; --all re-reads those too.

    python3 backfill_org_abr.py --dry-run                     # report, change nothing
    python3 backfill_org_abr.py --tenant-slug default         # one tenant
    python3 backfill_org_abr.py --all                         # re-read every entity
"""

from __future__ import annotations

import argparse
import sys
import time

import app.main  # noqa: F401 — registers every model on the mapper registry
from app.config import ABR_ENABLED
from app.database import SessionLocal
from app.models.contact import Organization
from app.models.tenant import Tenant
from app.services.organizations import refresh_from_abr

# The ABR's free web service asks callers not to hammer it.
PAUSE_SECONDS = 0.3


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="report without writing")
    parser.add_argument("--tenant-slug", help="only this tenant's entities")
    parser.add_argument("--all", action="store_true", help="also re-read entities already looked up")
    args = parser.parse_args()

    if not ABR_ENABLED:
        print("ABR_GUID is not set — nothing to look up against.", file=sys.stderr)
        return 1

    db = SessionLocal()
    try:
        query = db.query(Organization).filter(Organization.abn.isnot(None), Organization.abn != "")
        if args.tenant_slug:
            tenant = db.query(Tenant).filter(Tenant.slug == args.tenant_slug).first()
            if not tenant:
                print(f"No tenant with slug {args.tenant_slug!r}", file=sys.stderr)
                return 1
            query = query.filter(Organization.tenant_id == tenant.id)
        if not args.all:
            query = query.filter(Organization.abr_checked_at.is_(None))
        orgs = query.order_by(Organization.created_at.asc()).all()

        print(f"{len(orgs)} entit{'y' if len(orgs) == 1 else 'ies'} to look up")
        if args.dry_run:
            for org in orgs:
                print(f"  would look up {org.abn}  {org.name}")
            return 0

        found = missed = failed = 0
        for org in orgs:
            if not refresh_from_abr(org):
                failed += 1
                print(f"  FAILED    {org.abn}  {org.name}  (register unreachable — re-run later)")
            elif org.abn_status:
                found += 1
                print(f"  ok        {org.abn}  {org.name}  → {org.abr_entity_type_name}, {org.abn_status}")
            else:
                missed += 1
                print(f"  not found {org.abn}  {org.name}")
            db.commit()
            time.sleep(PAUSE_SECONDS)

        print(f"\nDone: {found} filled, {missed} not on the register, {failed} failed")
        return 0 if not failed else 2
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
