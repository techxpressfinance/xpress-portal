"""
Reset a single user's password. Disambiguates by --role / --tenant-slug when an
email appears on more than one row (e.g. an admin and a super_admin share it).

Run on EC2 (root, so it can read .env; venv interpreter, so deps resolve):

    sudo venv/bin/python3 reset_password.py --email admin@xpressfinance.com.au --role admin

Prompts twice for the new password (hidden), then sets the hash and ensures the
account is active / verified / password-auth.
"""
from __future__ import annotations

import argparse
import getpass
import sys

from app.database import SessionLocal
from app.models import User
from app.models.user import UserRole
from app.services.auth import hash_password


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True)
    parser.add_argument("--role", default=None, choices=[r.value for r in UserRole])
    parser.add_argument("--tenant-slug", default=None)
    args = parser.parse_args()

    db = SessionLocal()
    try:
        q = db.query(User).filter(User.email == args.email)
        if args.role:
            q = q.filter(User.role == UserRole(args.role))
        matches = q.all()

        if args.tenant_slug:
            matches = [u for u in matches if u.tenant and u.tenant.slug == args.tenant_slug]

        if not matches:
            sys.exit(f"No user found for email={args.email} role={args.role} tenant={args.tenant_slug}.")
        if len(matches) > 1:
            print("Multiple users match — narrow it with --role and/or --tenant-slug:")
            for u in matches:
                slug = u.tenant.slug if u.tenant else "(none)"
                print(f"  email={u.email} role={u.role.value} tenant={slug}")
            sys.exit(1)

        user = matches[0]
        slug = user.tenant.slug if user.tenant else "(none)"
        print(f"Resetting password for: {user.email} (role={user.role.value}, tenant={slug})")

        password = getpass.getpass("New password: ")
        if len(password) < 8:
            sys.exit("Password must be at least 8 characters.")
        if password != getpass.getpass("Confirm password: "):
            sys.exit("Passwords do not match.")

        user.password_hash = hash_password(password)
        user.is_active = True
        user.email_verified = True
        user.auth_method = "password"
        user.failed_login_attempts = 0
        user.locked_until = None
        db.commit()
        print("\nDone. You can log in now.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
