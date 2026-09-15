"""
Import the lender book from the "Lender details" spreadsheet.

Run on EC2 from the backend/ directory with the venv active so DATABASE_URL
from .env points at the production Postgres instance:

    source venv/bin/activate
    python3 import_lenders.py --file "Lender details (1).xlsx"            # dry run
    python3 import_lenders.py --file "Lender details (1).xlsx" --commit   # write

It is a dry run unless --commit is passed, and it is idempotent: lenders are
matched by name within the tenant (case- and whitespace-insensitive), so a
second run updates rather than duplicates. Re-running after the desk has
corrected a cell in the spreadsheet is the intended way to push that fix
through.

What it will NOT do is blank a field. A lender whose row has gone empty in the
spreadsheet keeps whatever is in the database, because the far more likely
story is a column that did not get filled in this time — not a mailbox that has
been retired. Clearing one is a deliberate edit in the lender book.

Column mapping (sheet -> database):
    LENDER NAME            -> lenders.name
    ADDRESS                -> lenders.address
    ON PANEL YES/NO        -> lenders.is_active
    SERVICE REQUEST EMAIL  -> lenders.service_request_email
    COLLECTIONS EMAIL      -> lenders.collections_email
    PAYOUT LETTER EMAIL    -> lenders.payout_letter_email
    SETTLEMENTS EMAIL      -> lenders.settlements_email
    CREDIT EMAIL           -> lenders.credit_email
    DOC REQUEST EMAIL      -> lenders.doc_request_email
    BDM NAME/CONTACT/EMAIL -> a lender_contacts row, designation "BDM"

The BDM is a contact row rather than the lenders.contact_* columns, which are
superseded and read by nothing.
"""
from __future__ import annotations

import argparse
import re
import sys
import uuid
from datetime import datetime, timezone

# Importing the models package loads every model, which SQLAlchemy needs before
# it can resolve relationships — see the note in app/models/__init__.py.
from app.database import SessionLocal
from app.models import Tenant
from app.models.lender import Lender, LenderContact

# Sheet heading -> Lender column. Headings are matched with whitespace
# collapsed, since several carry a trailing space in the file.
COLUMN_MAP = {
    "LENDER NAME": "name",
    "ADDRESS": "address",
    "SERVICE REQUEST EMAIL": "service_request_email",
    "COLLECTIONS EMAIL": "collections_email",
    "PAYOUT LETTER EMAIL": "payout_letter_email",
    "SETTLEMENTS EMAIL": "settlements_email",
    "CREDIT EMAIL": "credit_email",
    "DOC REQUEST EMAIL": "doc_request_email",
}
EMAIL_FIELDS = [f for f in COLUMN_MAP.values() if f.endswith("_email")]
LENDER_FIELDS = ["address"] + EMAIL_FIELDS

BDM_DESIGNATION = "BDM"

# Deliberately loose — this is a typo tripwire, not address validation. Anything
# it rejects is reported and still imported, because the desk's copy of a
# lender's mailbox beats this script's opinion of it.
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def clean(value) -> str | None:
    """Trim a cell to a value or None. Cells holding only whitespace are
    blanks — one settlements address in the sheet is a single space."""
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def parse_panel(value) -> bool | None:
    """ON PANEL as a tri-state: yes, no, or never answered."""
    text = (clean(value) or "").lower()
    if text.startswith("y"):
        return True
    if text.startswith("n"):
        return False
    return None


def read_rows(path: str) -> list[dict]:
    try:
        import openpyxl
    except ImportError:
        sys.exit("openpyxl is not installed. Run: pip install openpyxl")

    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        sys.exit(f"{path} is empty.")

    headers = [re.sub(r"\s+", " ", str(h or "").strip()).upper() for h in rows[0]]
    missing = [h for h in COLUMN_MAP if h not in headers]
    if missing:
        sys.exit(f"Spreadsheet is missing expected column(s): {', '.join(missing)}")
    index = {h: i for i, h in enumerate(headers)}

    def cell(row, heading):
        i = index.get(heading)
        return clean(row[i]) if i is not None and i < len(row) else None

    parsed = []
    for row_number, row in enumerate(rows[1:], start=2):
        name = cell(row, "LENDER NAME")
        if not name:
            continue
        record = {
            "row_number": row_number,
            "name": name,
            "on_panel": parse_panel(row[index["ON PANEL YES/NO"]])
            if "ON PANEL YES/NO" in index else None,
            "bdm_name": cell(row, "BDM NAME"),
            "bdm_phone": cell(row, "BDM CONTACT"),
            "bdm_email": cell(row, "BDM EMAIL"),
        }
        for heading, field in COLUMN_MAP.items():
            if field != "name":
                record[field] = cell(row, heading)
        parsed.append(record)
    return parsed


def audit(records: list[dict]) -> list[str]:
    """Rows worth a human's eye before they reach the database.

    None of this blocks the import — the spreadsheet is the desk's own record
    and this script is not the authority on it. But a mistyped payout mailbox
    is a fortnight of silence before anyone works out why, so it gets said out
    loud rather than imported quietly."""
    notes: list[str] = []

    seen: dict[str, str] = {}
    for record in records:
        key = record["name"].strip().lower()
        if key in seen:
            notes.append(f"{record['name']}: appears twice in the sheet (rows {seen[key]} and {record['row_number']})")
        seen[key] = str(record["row_number"])

        addresses = {f: record[f] for f in EMAIL_FIELDS if record.get(f)}
        if record.get("bdm_email"):
            addresses["bdm_email"] = record["bdm_email"]

        for field, value in addresses.items():
            if not EMAIL_RE.match(value):
                notes.append(f"{record['name']}: {field} does not look like an email — {value!r}")

        # The strongest signal available without leaving the file: the same row
        # spelling its own domain two different ways. One of them is a typo.
        domains = {v.rsplit("@", 1)[-1].lower() for v in addresses.values() if "@" in v}
        near = sorted(domains)
        for i, left in enumerate(near):
            for right in near[i + 1:]:
                if left != right and _near_miss(left, right):
                    notes.append(
                        f"{record['name']}: two spellings of the same domain on one row — "
                        f"{left} and {right}"
                    )
    return notes


def _near_miss(left: str, right: str) -> bool:
    """True for two domains within a single slip of each other — one letter
    wrong, one letter missing, or two letters swapped.

    Different domains on one row are normal and must not be flagged: a BDM at
    the parent bank, or a lender whose servicing was taken over by another. It
    is the near-identical pair that means somebody mistyped, and the swap is
    the case that actually turns up here — "commerical" for "commercial"."""
    if left == right or abs(len(left) - len(right)) > 1:
        return False
    if len(left) == len(right):
        differing = [i for i, (a, b) in enumerate(zip(left, right)) if a != b]
        if len(differing) == 1:
            return True
        # Two adjacent positions holding each other's letter — a transposition.
        if len(differing) == 2 and differing[1] == differing[0] + 1:
            i, j = differing
            return left[i] == right[j] and left[j] == right[i]
        return False
    shorter, longer = (left, right) if len(left) < len(right) else (right, left)
    return any(shorter == longer[:i] + longer[i + 1:] for i in range(len(longer)))


def resolve_tenant(db, slug: str | None) -> Tenant:
    if slug:
        tenant = db.query(Tenant).filter_by(slug=slug).first()
        if not tenant:
            sys.exit(f"No tenant with slug {slug!r}.")
        return tenant
    tenants = db.query(Tenant).all()
    if len(tenants) == 1:
        return tenants[0]
    if not tenants:
        sys.exit("No tenants exist. Create one before importing lenders.")
    sys.exit(f"Multiple tenants exist ({', '.join(t.slug for t in tenants)}). Re-run with --tenant-slug <slug>.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--file", required=True, help="Path to the lender spreadsheet (.xlsx)")
    parser.add_argument("--tenant-slug", default=None, help="Tenant to import into; optional when only one exists")
    parser.add_argument("--commit", action="store_true", help="Write the changes. Without it this is a dry run.")
    parser.add_argument(
        "--blank-panel",
        choices=("active", "inactive"),
        default="inactive",
        help="How to treat a row with ON PANEL left blank (default: inactive — only an explicit Yes goes on panel)",
    )
    args = parser.parse_args()

    records = read_rows(args.file)
    print(f"Read {len(records)} lender rows from {args.file}\n")

    notes = audit(records)
    if notes:
        print("Worth checking in the spreadsheet (importing anyway):")
        for note in notes:
            print(f"  ! {note}")
        print()

    blank_is_active = args.blank_panel == "active"
    db = SessionLocal()
    created = updated = unchanged = 0
    try:
        tenant = resolve_tenant(db, args.tenant_slug)
        print(f"Tenant: {tenant.name} (slug={tenant.slug})\n")

        existing = {
            lender.name.strip().lower(): lender
            for lender in db.query(Lender).filter(Lender.tenant_id == tenant.id).all()
        }

        for record in records:
            lender = existing.get(record["name"].strip().lower())
            is_active = record["on_panel"] if record["on_panel"] is not None else blank_is_active
            changes: list[str] = []
            is_new = lender is None

            if lender is None:
                lender = Lender(
                    id=str(uuid.uuid4()),
                    tenant_id=tenant.id,
                    name=record["name"],
                    is_active=is_active,
                    created_at=datetime.now(timezone.utc),
                    updated_at=datetime.now(timezone.utc),
                )
                for field in LENDER_FIELDS:
                    setattr(lender, field, record.get(field))
                db.add(lender)
                db.flush()
                existing[record["name"].strip().lower()] = lender
                created += 1
                filled = [f for f in LENDER_FIELDS if record.get(f)]
                print(f"+ {record['name']} ({'on panel' if is_active else 'off panel'}, {len(filled)} field(s))")
            else:
                for field in LENDER_FIELDS:
                    value = record.get(field)
                    # A blank cell never clears a stored value — see the note at
                    # the top on why an empty column is not a retired mailbox.
                    if value and value != getattr(lender, field):
                        changes.append(field)
                        setattr(lender, field, value)
                if record["on_panel"] is not None and lender.is_active != is_active:
                    changes.append("is_active")
                    lender.is_active = is_active

            changes.extend(sync_bdm(db, lender, tenant.id, record))

            # A new lender has already been reported on the line above; its BDM
            # contact is part of creating it, not a change to it.
            if is_new:
                continue
            if changes:
                updated += 1
                print(f"~ {record['name']}: {', '.join(changes)}")
            else:
                unchanged += 1

        print(f"\n{created} created, {updated} updated, {unchanged} already current.")

        if args.commit:
            db.commit()
            print("Committed.")
        else:
            db.rollback()
            print("Dry run — nothing written. Re-run with --commit to apply.")
    finally:
        db.close()


def sync_bdm(db, lender: Lender, tenant_id: str, record: dict) -> list[str]:
    """Keep the BDM contact row in step with the sheet.

    Matched on designation rather than name so that a lender changing BDM
    updates the row instead of leaving the old one behind next to the new."""
    name = record.get("bdm_name")
    email = record.get("bdm_email")
    phone = record.get("bdm_phone")
    if not any((name, email, phone)):
        return []

    contact = next(
        (c for c in lender.contacts if (c.designation or "").strip().upper() == BDM_DESIGNATION),
        None,
    )
    if contact is None:
        db.add(LenderContact(
            id=str(uuid.uuid4()),
            tenant_id=tenant_id,
            lender_id=lender.id,
            # The sheet has rows with a BDM phone or email but no name; the
            # contact needs one, and the designation is the honest stand-in.
            name=name or "BDM",
            designation=BDM_DESIGNATION,
            email=email,
            phone=phone,
            created_at=datetime.now(timezone.utc),
        ))
        return ["BDM contact added"]

    changed = []
    for field, value in (("name", name), ("email", email), ("phone", phone)):
        if value and value != getattr(contact, field):
            setattr(contact, field, value)
            changed.append(f"BDM {field}")
    return changed


if __name__ == "__main__":
    main()
