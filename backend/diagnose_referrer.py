"""Diagnose why a referrer can't see applications they submitted.

Usage (from backend/, with venv active):
    python3 diagnose_referrer.py referrer@example.com

A referrer sees an application only if BOTH hold:
  * app.tenant_id == referrer.tenant_id and app.deleted_at IS NULL, AND
  * app.user_id == referrer.id  (self-managed lead they own), OR
    app.user_id IN (external_referrals.referred_client_id WHERE referrer_id = referrer.id)

Everything below checks one of those clauses.
"""

from __future__ import annotations

import importlib
import pkgutil
import sys

import app.models
from app.database import SessionLocal

# Import every model module so SQLAlchemy's mapper registry can resolve all
# relationships (app.models.__init__ doesn't cover all of them).
for _m in pkgutil.iter_modules(app.models.__path__):
    importlib.import_module(f"app.models.{_m.name}")


from app.models.external_referral import ExternalReferral
from app.models.loan_application import LoanApplication
from app.models.user import User, UserRole


def line(char: str = "-") -> None:
    print(char * 78)


def main(email: str) -> None:
    db = SessionLocal()
    try:
        accounts = db.query(User).filter(User.email == email.lower().strip()).all()
        if not accounts:
            # fall back to a fuzzy match in case of a typo / alias
            accounts = db.query(User).filter(User.email.ilike(f"%{email.strip()}%")).all()
        if not accounts:
            print(f"No user found for {email!r}")
            return

        line("=")
        print(f"ACCOUNTS MATCHING {email}  ({len(accounts)} found)")
        line("=")
        for u in accounts:
            print(f"  id={u.id}  role={u.role.value if hasattr(u.role, 'value') else u.role}  "
                  f"tenant={u.tenant_id}  active={u.is_active}  name={u.full_name}")
        if len(accounts) > 1:
            print("\n  !! MULTIPLE ACCOUNTS. Referral rows may point at the account they")
            print("     are NOT logging in as — that alone hides everything.")

        for ref_user in accounts:
            role = ref_user.role.value if hasattr(ref_user.role, "value") else ref_user.role
            if role != "referrer":
                continue

            line("=")
            print(f"REFERRER {ref_user.email}  (id={ref_user.id}, tenant={ref_user.tenant_id})")
            line("=")

            # --- Clause 1: apps the referrer owns directly ------------------
            owned = (
                db.query(LoanApplication)
                .filter(LoanApplication.user_id == ref_user.id)
                .order_by(LoanApplication.created_at.desc())
                .all()
            )
            visible_owned = [
                a for a in owned
                if a.deleted_at is None and a.tenant_id == ref_user.tenant_id
            ]
            print(f"\n[1] Applications OWNED by the referrer (self-managed leads): {len(owned)}")
            for a in owned:
                flags = []
                if a.deleted_at is not None:
                    flags.append(f"TRASHED at {a.deleted_at}")
                if a.tenant_id != ref_user.tenant_id:
                    flags.append(f"TENANT MISMATCH ({a.tenant_id})")
                mark = "HIDDEN: " + ", ".join(flags) if flags else "visible"
                print(f"    {a.id}  {a.created_at}  status={a.status}  -> {mark}")

            # --- Clause 2: referred clients ---------------------------------
            refs = (
                db.query(ExternalReferral)
                .filter(ExternalReferral.referrer_id == ref_user.id)
                .order_by(ExternalReferral.created_at.desc())
                .all()
            )
            print(f"\n[2] external_referrals rows for this referrer: {len(refs)}")
            linked_client_ids = []
            for r in refs:
                status_val = r.status.value if hasattr(r.status, "value") else r.status
                if r.referred_client_id:
                    linked_client_ids.append(r.referred_client_id)
                    note = "linked"
                else:
                    note = "!! referred_client_id IS NULL — referrer CANNOT see this client's apps"
                print(f"    {r.created_at}  email={r.referred_email}  client_id={r.referred_client_id}  "
                      f"status={status_val}  tenant={r.tenant_id}  {note}")

            # --- Apps owned by those referred clients -----------------------
            client_apps = []
            if linked_client_ids:
                client_apps = (
                    db.query(LoanApplication)
                    .filter(LoanApplication.user_id.in_(linked_client_ids))
                    .order_by(LoanApplication.created_at.desc())
                    .all()
                )
            visible_client_apps = [
                a for a in client_apps
                if a.deleted_at is None and a.tenant_id == ref_user.tenant_id
            ]
            print(f"\n[3] Applications owned by referred clients: {len(client_apps)}")
            for a in client_apps:
                owner = db.query(User).filter(User.id == a.user_id).first()
                flags = []
                if a.deleted_at is not None:
                    flags.append(f"TRASHED at {a.deleted_at}")
                if a.tenant_id != ref_user.tenant_id:
                    flags.append(f"TENANT MISMATCH ({a.tenant_id})")
                mark = "HIDDEN: " + ", ".join(flags) if flags else "visible"
                print(f"    {a.id}  {a.created_at}  status={a.status}  "
                      f"client={owner.email if owner else '?'}  -> {mark}")

            total_visible = len(visible_owned) + len(visible_client_apps)
            line()
            print(f"TOTAL VISIBLE IN PORTAL: {total_visible}")
            line()

            # --- Orphan hunt: apps that LOOK like this referrer's but aren't -
            print("\n[4] Orphan check — apps naming a referred email as applicant but")
            print("    NOT reachable through either clause above:")
            referred_emails = {
                (r.referred_email or "").lower() for r in refs if r.referred_email
            }
            # also include emails of clients this referrer created accounts for
            invited = db.query(User).filter(User.invited_by_id == ref_user.id).all()
            for u in invited:
                referred_emails.add(u.email.lower())
            invited_ids = {u.id for u in invited}

            reachable = {a.id for a in owned} | {a.id for a in client_apps}
            orphans = []
            candidates = (
                db.query(LoanApplication)
                .filter(LoanApplication.tenant_id == ref_user.tenant_id)
                .all()
            )
            for a in candidates:
                if a.id in reachable:
                    continue
                owner = db.query(User).filter(User.id == a.user_id).first()
                owner_email = (owner.email or "").lower() if owner else ""
                applicant_email = (a.applicant_email or "").lower()
                if (
                    owner_email in referred_emails
                    or applicant_email in referred_emails
                    or a.user_id in invited_ids
                ):
                    orphans.append((a, owner))

            if not orphans:
                print("    none")
            for a, owner in orphans:
                print(f"    {a.id}  {a.created_at}  status={a.status}  "
                      f"owner={owner.email if owner else a.user_id}  "
                      f"applicant_email={a.applicant_email}  deleted_at={a.deleted_at}")
                print("      -> no external_referrals row links this owner to the referrer")

            if invited:
                print(f"\n[5] Users invited by this referrer: {len(invited)}")
                for u in invited:
                    has_link = u.id in set(linked_client_ids)
                    print(f"    {u.email}  id={u.id}  role={u.role.value if hasattr(u.role,'value') else u.role}  "
                          f"referral_link={'yes' if has_link else 'NO — this is the gap'}")
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1])
