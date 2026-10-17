"""
Make a tenant admin the owner of the private commission ledger.

The ledger owner is deliberately NOT settable from the web app — whoever
owns it decides who else may see it, so ownership is set from the server:

    source venv/bin/activate
    python3 set_ledger_owner.py --tenant-slug default --email owner@example.com

Moving an existing ledger to someone else needs --transfer. Every grant the
old owner made is revoked on a transfer, so the new owner starts from nobody.
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone

from app.database import SessionLocal, engine
from app.models import Tenant, User
from app.models.ledger import LedgerAuditEvent, LedgerDeal, LedgerGrant, LedgerInvoice, LedgerSettings
from app.models.user import UserRole


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--tenant-slug", required=True)
    parser.add_argument("--email", required=True, help="The admin who will own the ledger")
    parser.add_argument("--transfer", action="store_true", help="Replace an existing owner")
    args = parser.parse_args()

    for model in (LedgerSettings, LedgerGrant, LedgerDeal, LedgerInvoice, LedgerAuditEvent):
        model.__table__.create(bind=engine, checkfirst=True)

    db = SessionLocal()
    try:
        tenant = db.query(Tenant).filter_by(slug=args.tenant_slug).first()
        if not tenant:
            print(f"No tenant with slug {args.tenant_slug!r}", file=sys.stderr)
            return 1
        user = db.query(User).filter(
            User.tenant_id == tenant.id, User.email == args.email.strip().lower(), User.deleted_at.is_(None)
        ).first()
        if not user or user.role != UserRole.admin or not user.is_active:
            print(f"{args.email} is not an active admin of {tenant.slug}", file=sys.stderr)
            return 1

        settings = db.query(LedgerSettings).filter_by(tenant_id=tenant.id).first()
        now = datetime.now(timezone.utc)
        if settings and settings.owner_user_id != user.id:
            if not args.transfer:
                current = db.get(User, settings.owner_user_id)
                print(
                    f"The ledger is already owned by {current.email if current else settings.owner_user_id}. "
                    "Pass --transfer to move it.",
                    file=sys.stderr,
                )
                return 1
            revoked = (
                db.query(LedgerGrant)
                .filter(LedgerGrant.tenant_id == tenant.id, LedgerGrant.revoked_at.is_(None))
                .update({LedgerGrant.revoked_at: now})
            )
            db.add(LedgerAuditEvent(tenant_id=tenant.id, action="owner_transferred",
                                    detail=f'{{"from": "{settings.owner_user_id}", "to": "{user.id}", "grants_revoked": {revoked}}}'))
            settings.owner_user_id = user.id
            print(f"Ledger moved to {user.email}; {revoked} grant(s) revoked.")
        elif settings:
            print(f"{user.email} already owns the ledger.")
        else:
            db.add(LedgerSettings(tenant_id=tenant.id, owner_user_id=user.id, business_name=tenant.name))
            db.add(LedgerAuditEvent(tenant_id=tenant.id, actor_id=user.id, action="owner_set"))
            print(f"{user.email} now owns the {tenant.slug} ledger.")
        db.commit()
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
