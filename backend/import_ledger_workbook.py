"""
Import the desk's "Deals" spreadsheet into the private ledger.

Each deal row becomes a ledger-only deal (no portal application behind it)
with its figures, its payee(s) as fixed-dollar shares (the commission the sheet
recorded, ex GST, GST on when the sheet charged it), and the payment status
read from the notes column. Each month's "volume bonus received" (column AA on
the month's TOTAL row) goes into the month record. Payees are matched to portal
referrers by name, then to the "Referrer Details" tab (which seeds off-portal
payees with ABN and bank details), else created by name.

A DRY RUN by default — it prints what it would do. Run with --apply to write.

    source venv/bin/activate
    python3 import_ledger_workbook.py --tenant-slug default --file "/path/sidd's deals.xlsx"
    python3 import_ledger_workbook.py --tenant-slug default --file ... --apply

Skipped, and listed in the report:
  * rows already imported (re-running is safe),
  * rows that look like a deal already settled in the portal that month
    (same finance amount ±$1 and a shared name) — the portal deal is the record.

Start the app once after deploying first: its startup adds the ledger
columns this import writes to.
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import inspect

from app.database import SessionLocal, engine
from app.models import Tenant, User
from app.models.ledger import LedgerDeal, LedgerDealShare, LedgerMonth, LedgerPayee, LedgerSettings
from app.models.user import UserRole

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}
# The sheet's colour coding on the customer cell.
FILL_CATEGORY = {
    "FFA8D08D": "asset_finance",
    "FFFF6699": "consumer",
    "FFF76D94": "consumer",
    "FFFFFF00": "commercial",
    "FF9BC2E6": "home_loan",
    "FFBDD7EE": "home_loan",
}
NO_PAYEE = {"", "-", "none", "nil", "n/a", "na", "0"}
TAG = "[import:{sheet}:{row}]"


def norm(s: Optional[str]) -> str:
    return " ".join(re.sub(r"[^a-z0-9 ]", " ", (s or "").lower()).split())


def money(v) -> Decimal:
    if v is None or isinstance(v, str) and not v.strip():
        return Decimal("0")
    try:
        return Decimal(str(v)).quantize(Decimal("0.01"))
    except Exception:
        return Decimal("0")


def month_of(v) -> Optional[int]:
    if isinstance(v, (datetime, date)):
        return v.month
    return None


def fy_month_date(fy_start: int, month: int, day: int) -> date:
    """A month of the financial year starting 1 July fy_start."""
    year = fy_start if month >= 7 else fy_start + 1
    return date(year, month, day)


def parse_paid_date(text: str, settled: date) -> Optional[date]:
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{2,4})", text)
    if m:
        d, mo, y = (int(x) for x in m.groups())
        y = y + 2000 if y < 100 else y
        try:
            return date(y, mo, d)
        except ValueError:
            return None
    m = re.search(r"(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*", text.lower())
    if m and m.group(2) in MONTHS:
        mo = MONTHS[m.group(2)]
        y = settled.year if mo >= settled.month else settled.year + 1
        try:
            return date(y, mo, int(m.group(1)))
        except ValueError:
            return None
    return None


def payment_from(note: str, method: str, comms: Decimal, settled: date) -> dict:
    """Read the sheet's free-text payment note into a status."""
    raw = (note or "").strip()
    text = raw.lower().lstrip("?").strip()
    out = {"status": "unpaid", "paid_on": None, "scheduled_on": None, "notes": raw or None,
           "method": None if method.strip() in ("", "-") else method.strip().capitalize()}
    if "no comms" in text or (comms == 0 and text in ("", "-")):
        out["status"] = "not_payable"
    elif text.startswith("scheduled"):
        out["status"] = "scheduled"
        out["scheduled_on"] = parse_paid_date(text, settled)
        if not out["scheduled_on"]:
            out["status"] = "unpaid"
    elif text.startswith(("paid", "transferred", "transffered")):
        out["status"] = "paid"
        out["paid_on"] = parse_paid_date(text, settled)
        if not out["paid_on"]:
            # Paid, but the sheet didn't say when — date it to settlement and say so.
            out["paid_on"] = settled
            out["notes"] = f"{raw} (date not recorded in the sheet)"
    return out


def read_referrer_details(wb) -> dict[str, dict]:
    name = next((n for n in wb.sheetnames if n.strip().lower() == "referrer details"), None)
    if not name:
        return {}
    ws = wb[name]
    out = {}
    for r in range(3, ws.max_row + 1):
        full = ws.cell(r, 1).value
        if not full or not str(full).strip():
            continue
        person = str(full).split(" - ")[0].strip()
        rec = {
            "name": person,
            "company_name": (str(ws.cell(r, 2).value).strip() if ws.cell(r, 2).value else None),
            "abn": re.sub(r"\D", "", str(ws.cell(r, 3).value or "")) or None,
            "bank_account_name": (str(ws.cell(r, 4).value).strip() if ws.cell(r, 4).value else None),
            "bank_name": (str(ws.cell(r, 5).value).strip() if ws.cell(r, 5).value else None),
            "bank_bsb": re.sub(r"\D", "", str(ws.cell(r, 6).value or "")).zfill(6) if ws.cell(r, 6).value else None,
            "bank_account_number": re.sub(r"\D", "", str(ws.cell(r, 7).value or "")) or None,
            "notes": " ".join(x for x in [str(full).strip() if " - " in str(full) else None,
                                         str(ws.cell(r, 8).value).strip() if ws.cell(r, 8).value else None] if x) or None,
        }
        if rec["abn"] and len(rec["abn"]) > 11:
            # Two numbers run together in one cell — keep the first, note the rest.
            rec["notes"] = " ".join(x for x in [rec["notes"], f"ABN/ACN cell on the sheet: {ws.cell(r, 3).value}"] if x)
            rec["abn"] = rec["abn"][:11]
        out[norm(person)] = rec
        if rec["company_name"]:
            out.setdefault(norm(rec["company_name"]), rec)
    return out


def read_deals(ws, fy_start: int) -> tuple[list[dict], dict[int, Decimal]]:
    deals, received = [], {}
    month, half = None, 1
    for r in range(1, ws.max_row + 1):
        a = ws.cell(r, 1).value
        d = ws.cell(r, 4).value
        if month_of(a):
            month, half = month_of(a), 1
            continue
        if isinstance(a, str) and a.strip().upper().startswith("AFTER 15"):
            half = 2
            continue
        # A month's own total row ("TOTAL July", "Total Jan ") — not the
        # quarter or year totals ("TOTAL JULY 25- JUNE 26"), and not a
        # customer whose name starts with "Total".
        m = re.fullmatch(r"total\s+([a-z]+)", d.strip().lower()) if isinstance(d, str) else None
        if m and m.group(1)[:3] in MONTHS:
            if ws.cell(r, 27).value not in (None, ""):
                received[MONTHS[m.group(1)[:3]]] = money(ws.cell(r, 27).value)
            continue
        if not (isinstance(a, str) and a.strip().lower() in ("yes", "no")):
            continue
        customer = ws.cell(r, 3).value
        if not customer or month is None:
            continue
        settled = fy_month_date(fy_start, month, 1 if half == 1 else 16)
        fill = ws.cell(r, 3).fill
        category = FILL_CATEGORY.get(fill.fgColor.rgb if fill and fill.fill_type and isinstance(fill.fgColor.rgb, str) else "")
        figures = {k: money(ws.cell(r, c).value) for k, c in
                   (("finance_amount", 5), ("brokerage", 6), ("doc_fee", 8), ("origination_fee", 10), ("vir", 12),
                    ("comms", 17), ("comms_gst", 18))}
        deals.append({
            "row": r,
            "settled_on": settled,
            "new_lead": a.strip().lower() == "yes",
            "repeat": str(ws.cell(r, 2).value or "").strip().lower() == "yes",
            "customer": str(customer).strip(),
            "entity": str(ws.cell(r, 4).value).strip() if ws.cell(r, 4).value else None,
            "lender": str(ws.cell(r, 16).value).strip() if ws.cell(r, 16).value not in (None, 0) else None,
            "referrer": str(ws.cell(r, 20).value or "").strip(),
            "method": str(ws.cell(r, 21).value or "").strip(),
            "deal_status": str(ws.cell(r, 22).value or "").strip(),
            "note": str(ws.cell(r, 23).value or "").strip(),
            "category": category,
            # Clawbacks are entered as negatives (their red text isn't readable from the file).
            "clawback": figures["brokerage"] < 0 or figures["comms"] < 0,
            **figures,
        })
    return deals, received


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--tenant-slug", required=True)
    parser.add_argument("--file", required=True)
    parser.add_argument("--sheet", default="Deals", help="Tab to import (default: Deals)")
    parser.add_argument("--fy-start-year", type=int, help="Year the financial year starts (2026 = Jul 2026–Jun 2027). "
                        "Default: the year on the sheet's July heading date.")
    parser.add_argument("--import-vb-received", action="store_true",
                        help="Also set each month's volume bonus received from column AA of its TOTAL row "
                             "(off by default: a sheet copied forward can carry last year's figures)")
    parser.add_argument("--broker-email", help="Team member whose book these deals are (default: the ledger owner)")
    parser.add_argument("--broker-name", help="Or a name, for someone not on the team (e.g. a tab named after them)")
    parser.add_argument("--apply", action="store_true", help="Write to the database (default is a dry run)")
    args = parser.parse_args()

    cols = {c["name"] for c in inspect(engine).get_columns("ledger_deals")}
    if "is_manual" not in cols or not inspect(engine).has_table("ledger_deal_shares"):
        print("The ledger columns this needs aren't there yet — start the app once after deploying, then re-run.",
              file=sys.stderr)
        return 1

    import openpyxl
    wb = openpyxl.load_workbook(args.file, data_only=True)
    if args.sheet not in wb.sheetnames:
        print(f"No tab {args.sheet!r}. Tabs: {', '.join(wb.sheetnames)}", file=sys.stderr)
        return 1
    ws = wb[args.sheet]

    # Which financial year: the month heading dates, cross-checked against the
    # "TOTAL JULY 25- JUNE 26" label (which a copied-forward sheet can leave stale).
    from_dates = from_label = None
    for r in range(1, ws.max_row + 1):
        a = ws.cell(r, 1).value
        if from_dates is None and isinstance(a, (datetime, date)):
            from_dates = a.year if a.month >= 7 else a.year - 1
        m = re.search(r"JULY\s*(\d{2})\s*-\s*JUNE\s*(\d{2})", str(ws.cell(r, 4).value or "").upper())
        if m and from_label is None:
            from_label = 2000 + int(m.group(1))
    fy_start = args.fy_start_year or from_dates or from_label
    if fy_start is None:
        print("Couldn't tell which financial year this is — pass --fy-start-year.", file=sys.stderr)
        return 1
    if not args.fy_start_year and from_dates and from_label and from_dates != from_label:
        print(f"NOTE: the month dates say FY {from_dates}-{str(from_dates + 1)[2:]} but the total label says "
              f"FY {from_label}-{str(from_label + 1)[2:]}. Using the dates; pass --fy-start-year to choose.\n")

    db = SessionLocal()
    try:
        tenant = db.query(Tenant).filter_by(slug=args.tenant_slug).first()
        if not tenant:
            print(f"No tenant {args.tenant_slug!r}", file=sys.stderr)
            return 1
        settings = db.query(LedgerSettings).filter_by(tenant_id=tenant.id).first()
        if not settings:
            print("This tenant has no ledger owner yet — run set_ledger_owner.py first.", file=sys.stderr)
            return 1
        broker_id, broker_name = settings.owner_user_id, None
        if args.broker_name:
            broker_id, broker_name = None, args.broker_name
        elif args.broker_email:
            b = db.query(User).filter(User.tenant_id == tenant.id, User.email == args.broker_email.lower()).first()
            if not b:
                print(f"No team member {args.broker_email!r}", file=sys.stderr)
                return 1
            broker_id = b.id

        deals, received = read_deals(ws, fy_start)
        details = read_referrer_details(wb)
        print(f"FY {fy_start}-{str(fy_start + 1)[2:]} · {len(deals)} deal rows on {args.sheet!r} · "
              f"{len(received)} months with a volume bonus received\n")

        # Payee matching. Everyone the name could mean, in one pool: portal
        # referrers, the ledger's payees, the Referrer Details tab, and payees
        # this import has already created. Exact name first, then the part
        # before a dash ("Mandeep - Khangura"), then a first name that only one
        # of them has ("Bachint" → "Bachint Dhillon").
        referrers = db.query(User).filter(User.tenant_id == tenant.id, User.role == UserRole.referrer).all()
        payees = db.query(LedgerPayee).filter(LedgerPayee.tenant_id == tenant.id).all()
        pool: list[tuple[str, tuple[str, object]]] = []
        def add_keys(target, *names):
            for n in [*names, " ".join(x for x in names if x)]:
                if n and norm(n):
                    pool.append((norm(n), target))

        for u in referrers:
            add_keys(("user", u), u.full_name, u.organization_name)
        for pe in payees:
            if not pe.user_id:
                add_keys(("payee", pe), pe.name, pe.company_name)
        seen_recs: set[int] = set()
        for rec in details.values():
            if id(rec) not in seen_recs:
                seen_recs.add(id(rec))
                add_keys(("details", rec), rec["name"], rec["company_name"])
        made_from: dict[int, LedgerPayee] = {}   # id(details record) -> payee created from it
        user_payees: dict[str, LedgerPayee] = {}
        new_payees: list[LedgerPayee] = []
        fuzzy: set[str] = set()
        rank = {"user": 0, "payee": 1, "new": 2, "details": 3}

        def ident(target) -> int:
            kind, obj = target
            return id(made_from.get(id(obj), obj)) if kind == "details" else id(obj)

        def unique(cands):
            return min(cands, key=lambda t: rank[t[0]]) if cands and len({ident(t) for t in cands}) == 1 else None

        def lookup(name: str):
            """Conservative on purpose — a wrong match pays the wrong person.
            The dry-run report lists every mapping for checking."""
            n = norm(name)
            if not n:
                return None
            exact = [t for k, t in pool if k == n]
            if exact:
                return min(exact, key=lambda t: rank[t[0]])
            words = n.split()
            if len(words) == 1:
                # Just a first name ("Bachint"): only if one payee has it.
                return unique([t for k, t in pool if k.split()[0] == words[0]])
            # Every word of the sheet's name in one payee's name and company
            # ("Lakhwinder - loan melbourne" → "Lakhwinder Singh- Loan Melbourne Pty ltd").
            hit = unique([t for k, t in pool if set(words) <= set(k.split())])
            if hit:
                return hit
            # A shorter record inside the sheet's name, same first name
            # ("Bachint Dhillon" → the Referrer Details entry "bachint").
            hit = unique([t for k, t in pool if k.split()[0] == words[0] and set(k.split()) <= set(words)])
            if hit:
                return hit
            # Spelling variants ("Navare Taui" / "Navare Tui", "Bharadwaj" / "BHardwaj").
            from difflib import SequenceMatcher

            def close(a: str, b: str) -> bool:
                return a == b or (len(a) > 3 and SequenceMatcher(None, a, b).ratio() >= 0.8)
            hit = unique([t for k, t in pool if all(any(close(w, x) for x in k.split()) for w in words)])
            if hit:
                fuzzy.add(norm(name))
            return hit

        def payee_for(name: str) -> tuple[LedgerPayee, str]:
            pe, how = _payee_for(name)
            return pe, how + (" (spelling match — check)" if norm(name) in fuzzy else "")

        def _payee_for(name: str) -> tuple[LedgerPayee, str]:
            """(payee row — new ones not yet saved, how it was matched)."""
            hit = lookup(name)
            if hit:
                kind, obj = hit
                if kind == "user":
                    pe = next((x for x in payees if x.user_id == obj.id), None) or user_payees.get(obj.id)
                    if not pe:
                        pe = LedgerPayee(tenant_id=tenant.id, user_id=obj.id)
                        user_payees[obj.id] = pe
                        new_payees.append(pe)
                    return pe, f"portal referrer {obj.full_name}"
                if kind == "payee":
                    return obj, f"existing payee {obj.name or obj.company_name}"
                if kind == "new":
                    return obj, f"payee {obj.name or obj.company_name} (this import)"
                # A Referrer Details record — becomes a payee the first time it's used.
                pe = made_from.get(id(obj))
                if not pe:
                    pe = LedgerPayee(tenant_id=tenant.id, **obj)
                    made_from[id(obj)] = pe
                    new_payees.append(pe)
                    add_keys(("new", pe), pe.name, pe.company_name)
                return pe, f"Referrer Details: {pe.name}{' · ' + pe.company_name if pe.company_name else ''}"
            pe = LedgerPayee(tenant_id=tenant.id, name=name.strip())
            new_payees.append(pe)
            pool.append((norm(name), ("new", pe)))
            return pe, "NEW payee (name only — no details on file)"

        # Already imported / already in the portal?
        existing_tags = {d.notes for d in db.query(LedgerDeal).filter(
            LedgerDeal.tenant_id == tenant.id, LedgerDeal.is_manual.is_(True)) if d.notes}
        from app.services import ledger as svc
        start = date(fy_start, 7, 1)
        end = date(fy_start + 1, 6, 30)
        portal_rows = svc.build_rows(db, tenant.id, svc.settled_applications(db, tenant.id, start, end))

        def portal_match(deal: dict) -> Optional[dict]:
            words = set(norm(deal["customer"]).split()) | set(norm(deal["entity"]).split())
            for r in portal_rows:
                if r["month"] != deal["settled_on"].strftime("%Y-%m"):
                    continue
                if abs(Decimal(str(r["finance_amount"])) - deal["finance_amount"]) > 1:
                    continue
                if words & (set(norm(r["customer_name"]).split()) | set(norm(r["entity_name"]).split())):
                    return r
            return None

        report = defaultdict(list)
        for deal in deals:
            tag = TAG.format(sheet=args.sheet, row=deal["row"])
            if any(tag in t for t in existing_tags):
                report["already imported"].append(deal)
                continue
            pm = portal_match(deal)
            deal.setdefault("no_comms_referrer", None)
            deal.setdefault("payees", [])
            if pm:
                deal["portal"] = pm["customer_name"]
                report["matches a portal deal — skipped"].append(deal)
                continue
            names = [] if deal["referrer"].strip().lower() in NO_PAYEE else [
                n.strip() for n in re.split(r"\s*&\s*|\s+and\s+", deal["referrer"]) if n.strip().lower() not in NO_PAYEE]
            # No commission recorded: nobody to pay. The sheet's referrer is
            # kept on the deal's notes for the record.
            deal["no_comms_referrer"] = deal["referrer"] if deal["comms"] == 0 and names else None
            deal["payees"] = [] if deal["comms"] == 0 else [(n, *payee_for(n)) for n in names]
            report["import"].append(deal)
            if not args.apply:
                continue
            entry = LedgerDeal(
                tenant_id=tenant.id, application_id=str(__import__("uuid").uuid4()), is_manual=True,
                manual_settled_on=deal["settled_on"], manual_customer_name=deal["customer"],
                manual_entity_name=deal["entity"], manual_category=deal["category"],
                manual_broker_id=broker_id, manual_broker_name=broker_name,
                finance_amount=deal["finance_amount"], brokerage=deal["brokerage"], doc_fee=deal["doc_fee"],
                origination_fee=deal["origination_fee"], vir=deal["vir"], lender_name=deal["lender"],
                is_clawback=deal["clawback"], new_lead=deal["new_lead"], repeat_customer=deal["repeat"],
                referrer_set=True, income_gst=True,
                notes=f"{tag} Imported from the deals spreadsheet."
                      + (f" Deal status: {deal['deal_status']}." if deal["deal_status"].lower() not in ("", "settled") else "")
                      + (f" Referrer on the sheet: {deal['no_comms_referrer']} (no commission)." if deal["no_comms_referrer"] else "")
                      + (f" Sheet note: {deal['note']}." if deal["comms"] == 0 and deal["note"] not in ("", "-") else ""),
            )
            db.add(entry)
            pay = payment_from(deal["note"], deal["method"], deal["comms"], deal["settled_on"])
            n = len(deal["payees"]) or 1
            for i, (name, payee, _how) in enumerate(deal["payees"]):
                if payee.id is None:
                    db.add(payee)
                    db.flush()
                # A split the sheet records as one figure: shared evenly, flagged to check.
                amount = (deal["comms"] / n).quantize(Decimal("0.01"))
                note = pay["notes"]
                if n > 1:
                    note = f"{note + ' · ' if note else ''}Split from '{deal['referrer']}' evenly on import — check the split."
                db.add(LedgerDealShare(
                    tenant_id=tenant.id, deal_key=entry.application_id, payee_id=payee.id, sort_order=i,
                    share_amount=amount, share_gst=deal["comms_gst"] != 0, status=pay["status"],
                    paid_on=pay["paid_on"], scheduled_on=pay["scheduled_on"], payment_method=pay["method"],
                    payment_notes=note,
                ))

        # Volume bonus received per month.
        months_set = []
        for mo, amount in sorted(received.items(), key=lambda kv: (kv[0] < 7, kv[0])):
            if not args.import_vb_received or not amount:
                continue
            key = fy_month_date(fy_start, mo, 1).strftime("%Y-%m")
            rec = db.query(LedgerMonth).filter_by(tenant_id=tenant.id, month=key).first()
            if rec and rec.vb_received_inc_gst is not None:
                continue
            months_set.append((key, amount))
            if args.apply and amount:
                if not rec:
                    rec = LedgerMonth(tenant_id=tenant.id, month=key)
                    db.add(rec)
                rec.vb_received_inc_gst = amount

        # ── Report ──
        for section in ("import", "matches a portal deal — skipped", "already imported"):
            items = report.get(section, [])
            print(f"== {section}: {len(items)}")
            for d in items:
                line = f"  row {d['row']:>4} {d['settled_on']} {d['customer'][:34]:<34} ${d['finance_amount']:>12,.2f}  comms ${d['comms']:>9,.2f}"
                if section == "import":
                    pays = "; ".join(f"{n} → {how}" for n, _p, how in d["payees"]) or (
                        f"no commission (sheet: {d['no_comms_referrer']})" if d["no_comms_referrer"] else "no payee")
                    st = payment_from(d["note"], d["method"], d["comms"], d["settled_on"])
                    when = st["paid_on"] or st["scheduled_on"]
                    odd = when and (when < d["settled_on"] or (when - d["settled_on"]).days > 200)
                    line += (f"  [{st['status']}{' ' + str(when) if st['status'] in ('paid', 'scheduled') and when else ''}"
                             f"{' ← CHECK DATE' if odd else ''}]  {pays}")
                elif section.startswith("matches"):
                    line += f"  = portal deal {d['portal']}"
                print(line)
        print(f"\n== volume bonus received to set: {len(months_set)}"
              + ("" if args.import_vb_received else f" (not importing — {len(received)} months on the sheet; add --import-vb-received)"))
        for key, amount in months_set:
            print(f"  {key}  ${amount:,.2f} inc GST")
        print(f"\n== new payees: {len(new_payees)}")
        for p in new_payees:
            who = "portal referrer (ledger extras row)" if p.user_id else f"{p.name or ''} {('· ' + p.company_name) if p.company_name else ''}"
            print(f"  {who}{'  ABN ' + p.abn if p.abn else ''}{'  bank on file' if p.bank_account_number else ''}")

        if args.apply:
            db.commit()
            print("\nApplied.")
        else:
            db.rollback()
            print("\nDry run — nothing written. Re-run with --apply to import.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
