"""
Reset the PostgreSQL database to a clean state, preserving only admin users
and the tenants they belong to.

What it keeps:
  - users with a role in KEEP_ROLES  (admin + super_admin by default)
  - the `tenants` table (so the kept admins' tenant_id FK stays valid)
  - `alembic_version` if present

What it wipes:
  - every other table, discovered by reflecting the live DB (so tables added
    later are handled automatically — no hardcoded list to drift out of date)

Usage (run where DATABASE_URL points at the AWS Postgres instance, e.g. on the
server with the prod .env, or locally with DATABASE_URL exported):

    python3 reset_to_admin_pg.py          # DRY RUN — prints the plan, changes nothing
    python3 reset_to_admin_pg.py --yes    # arm it, then type WIPE at the prompt

This is irreversible. Take an RDS snapshot first.
"""
from __future__ import annotations

import argparse
import sys

from sqlalchemy import MetaData, text

from app.config import DATABASE_URL
from app.database import engine

# Roles whose user rows (the login credentials) are preserved.
KEEP_ROLES = ("admin", "super_admin")

# Tables never wiped. `tenants` is kept so kept admins' tenant_id FK stays valid.
PRESERVE_TABLES = {"users", "tenants", "alembic_version"}


def _mask(url: str) -> str:
    """Hide the password when printing the connection string."""
    if "://" in url and "@" in url:
        scheme, rest = url.split("://", 1)
        creds, host = rest.rsplit("@", 1)
        user = creds.split(":", 1)[0]
        return f"{scheme}://{user}:***@{host}"
    return url


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--yes", action="store_true", help="arm the wipe (still prompts for WIPE confirmation)")
    args = parser.parse_args()

    if not engine.dialect.name.startswith("postgres"):
        print(f"Refusing to run: connected dialect is '{engine.dialect.name}', expected postgresql.")
        print("This script targets the AWS Postgres instance. For local SQLite use reset_to_admin.py.")
        sys.exit(1)

    meta = MetaData()
    meta.reflect(bind=engine)
    all_tables = set(meta.tables)
    wipe_tables = sorted(all_tables - PRESERVE_TABLES)

    with engine.connect() as conn:
        total_users = conn.execute(text("SELECT count(*) FROM users")).scalar()
        keep_admins = conn.execute(
            text("SELECT email, role FROM users WHERE role::text = ANY(:roles) ORDER BY role, email"),
            {"roles": list(KEEP_ROLES)},
        ).fetchall()

    print(f"Target DB : {_mask(DATABASE_URL)}")
    print(f"Keep roles: {', '.join(KEEP_ROLES)}")
    print(f"Preserved : {', '.join(sorted(PRESERVE_TABLES & all_tables))}")
    print(f"Wiping    : {len(wipe_tables)} tables")
    print(f"            {', '.join(wipe_tables)}")
    print(f"Users     : {total_users} total; keeping {len(keep_admins)}:")
    for email, role in keep_admins:
        print(f"            - {email} ({role})")

    if not keep_admins:
        print("\nNo admin/super_admin users found — aborting so you are not locked out.")
        sys.exit(1)

    if not args.yes:
        print("\nDRY RUN — nothing changed. Re-run with --yes to perform the wipe.")
        return

    if input("\nType 'WIPE' to permanently delete the above data: ").strip() != "WIPE":
        print("Aborted.")
        return

    with engine.begin() as conn:
        if wipe_tables:
            quoted = ", ".join(f'"{t}"' for t in wipe_tables)
            conn.execute(text(f"TRUNCATE TABLE {quoted} RESTART IDENTITY CASCADE"))
        # Drop self-referential invite chains so deleting non-admins can't hit a FK.
        conn.execute(text("UPDATE users SET invited_by_id = NULL"))
        deleted = conn.execute(
            text("DELETE FROM users WHERE NOT (role::text = ANY(:roles))"),
            {"roles": list(KEEP_ROLES)},
        ).rowcount

    print(f"\nTruncated {len(wipe_tables)} tables. Deleted {deleted} non-admin user(s).")
    print("Done. Admin credentials and tenants preserved.")


if __name__ == "__main__":
    main()
