"""
Create an admin (or broker / super_admin) user in the current database.

Run on EC2 from the backend/ directory with the venv active so DATABASE_URL
from .env points at the RDS Postgres instance:

    source venv/bin/activate
    python3 create_admin.py --email you@example.com --name "Your Name"

It prompts for the password (twice, hidden) so it never lands in shell history.
Tenant resolution:
  - --tenant-slug given  -> use that tenant (created if missing)
  - omitted, one tenant  -> use it automatically
  - omitted, none        -> creates the default "xpress" tenant
  - omitted, several     -> error, asks you to pass --tenant-slug
"""
from __future__ import annotations

import argparse
import getpass
import sys
import uuid
from datetime import datetime, timezone

from app.database import SessionLocal
from app.models import Tenant, User
from app.services.auth import hash_password

VALID_ROLES = ("admin", "super_admin", "broker")


def resolve_tenant(db, slug: str | None, name: str | None) -> Tenant:
    if slug:
        tenant = db.query(Tenant).filter_by(slug=slug).first()
        if tenant:
            return tenant
        tenant = Tenant(
            id=str(uuid.uuid4()),
            name=name or slug.title(),
            slug=slug,
            is_active=True,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        db.add(tenant)
        db.flush()
        print(f"Created tenant: {tenant.name} (slug={tenant.slug})")
        return tenant

    tenants = db.query(Tenant).all()
    if len(tenants) == 1:
        return tenants[0]
    if not tenants:
        tenant = Tenant(
            id=str(uuid.uuid4()),
            name="Xpress Finance",
            slug="xpress",
            is_active=True,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        db.add(tenant)
        db.flush()
        print(f"Created tenant: {tenant.name} (slug={tenant.slug})")
        return tenant
    slugs = ", ".join(t.slug for t in tenants)
    sys.exit(f"Multiple tenants exist ({slugs}). Re-run with --tenant-slug <slug>.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--role", default="admin", choices=VALID_ROLES)
    parser.add_argument("--tenant-slug", default=None)
    parser.add_argument("--tenant-name", default=None, help="name used only if the tenant is created")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        tenant = resolve_tenant(db, args.tenant_slug, args.tenant_name)

        existing = db.query(User).filter_by(email=args.email, tenant_id=tenant.id).first()
        if existing:
            sys.exit(f"User {args.email} already exists in tenant {tenant.slug} — nothing to do.")

        password = getpass.getpass("Password: ")
        if len(password) < 8:
            sys.exit("Password must be at least 8 characters.")
        if password != getpass.getpass("Confirm password: "):
            sys.exit("Passwords do not match.")

        user = User(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            email=args.email,
            full_name=args.name,
            password_hash=hash_password(password),
            role=args.role,
            is_active=True,
            email_verified=True,
            auth_method="password",
            created_at=datetime.now(timezone.utc),
        )
        db.add(user)
        db.commit()
        print(f"\nCreated {args.role}: {args.email} in tenant '{tenant.slug}'.")
        print("You can log in now.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
