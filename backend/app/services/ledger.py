"""The private commission ledger: who may see it, and the figures it shows.

Access
  * The OWNER (LedgerSettings.owner_user_id) sees and edits everything.
  * A GRANTEE sees only the scopes on their grant, read-only, and only once
    the grant's 24-hour wait is over. Payment dates and notes are the owner's
    alone and are never grantable.
  * Nobody else gets anything — not other admins, not an admin impersonating
    the owner (the router refuses impersonation tokens outright).
  Redaction happens here, on the server: a field outside the viewer's scopes
  is removed from the response, not hidden by the page.

Figures
  One row per settled application, dated by settled_at. What the owner has
  entered (LedgerDeal) wins; anything not entered is prefilled from the
  application — lender pricing for finance amount, brokerage and origination
  fee, the approval lender, and the referrer on the client — and the row says
  which fields are still prefilled. The maths mirrors the desk's spreadsheet:
  income lines are ex GST with 10% GST beside each, total income is their sum,
  the referrer's share is a percentage of a base or a dollar figure that wins
  when set (as the quote sheets do brokerage), and net profit is total income
  less the referrer's share, both ex GST.
"""
from __future__ import annotations

import io
import json
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Iterable, Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.models.contact import Contact
from app.models.ledger import LedgerAuditEvent, LedgerDeal, LedgerGrant, LedgerSettings
from app.models.lender import Lender
from app.models.loan_application import APPLICANT_TYPE_INDIVIDUAL, ApplicationStatus, LoanApplication
from app.models.quote_sheet import QuoteSheet, QuoteSheetType
from app.models.settled_deal_snapshot import SettledDealSnapshot
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.services.loan_category import CONSUMER_SUB_TYPES, application_loan_category, application_sub_type
from app.services.serialization import referrer_info_map

LEDGER_GRANT_DELAY = timedelta(hours=24)

# What the owner can let a team member see.
GRANT_SCOPES = {
    "summary": "Period totals",
    "deals": "Settled deals list (clients, lenders, amounts)",
    "income": "Our income — brokerage, fees, VIR, net profit",
    "referrers": "Referrer report and referrer commissions",
    "invoices": "Referrer commission invoices",
    "export": "Excel / PDF downloads",
}
SHARE_BASES = ("brokerage", "total_income", "finance_amount")
GST_RATE = Decimal("0.10")
CENT = Decimal("0.01")
ZERO = Decimal("0")

_INCOME_FIELDS = (
    "brokerage", "brokerage_gst", "doc_fee", "doc_fee_gst", "origination_fee", "origination_gst",
    "vir", "vir_gst", "income_ex_gst", "income_inc_gst", "income_gst", "volume_bonus", "net_profit",
)
_REFERRER_FIELDS = (
    "share_percent", "share_base", "share_amount", "share_gst",
    "referrer_comms_ex_gst", "referrer_comms_gst", "referrer_comms_inc_gst",
)
_PAYMENT_FIELDS = ("paid_on", "payment_method", "payment_notes")

# Money columns that are summed into month subtotals and the period total.
TOTALLED = (
    "finance_amount", "brokerage", "brokerage_gst", "doc_fee", "doc_fee_gst",
    "origination_fee", "origination_gst", "vir", "vir_gst", "income_ex_gst", "income_inc_gst",
    "referrer_comms_ex_gst", "referrer_comms_gst", "referrer_comms_inc_gst", "volume_bonus", "net_profit",
)

# The columns, in the order of the desk's "Deals" spreadsheet. `scope` is what
# a grantee needs to see the column; "payments" is owner-only.
COLUMNS = [
    {"key": "settled_on", "label": "Settled", "kind": "date", "scope": "deals"},
    {"key": "new_lead", "label": "New lead", "kind": "bool", "scope": "deals"},
    {"key": "repeat_customer", "label": "Repeat customer", "kind": "bool", "scope": "deals"},
    {"key": "customer_name", "label": "Customer name", "kind": "text", "scope": "deals"},
    {"key": "entity_name", "label": "Entity (business)", "kind": "text", "scope": "deals"},
    {"key": "finance_amount", "label": "Finance amount", "kind": "money", "scope": "deals"},
    {"key": "brokerage", "label": "Brokerage (ex GST)", "kind": "money", "scope": "income"},
    {"key": "brokerage_gst", "label": "Brokerage GST", "kind": "money", "scope": "income"},
    {"key": "doc_fee", "label": "Doc fee", "kind": "money", "scope": "income"},
    {"key": "doc_fee_gst", "label": "Doc fee GST", "kind": "money", "scope": "income"},
    {"key": "origination_fee", "label": "Origination fee (ex GST)", "kind": "money", "scope": "income"},
    {"key": "origination_gst", "label": "Origination GST", "kind": "money", "scope": "income"},
    {"key": "vir", "label": "VIR (ex GST)", "kind": "money", "scope": "income"},
    {"key": "vir_gst", "label": "VIR GST", "kind": "money", "scope": "income"},
    {"key": "income_ex_gst", "label": "Total income ex GST", "kind": "money", "scope": "income"},
    {"key": "income_inc_gst", "label": "Total income inc GST", "kind": "money", "scope": "income"},
    {"key": "lender_name", "label": "Lender", "kind": "text", "scope": "deals"},
    {"key": "referrer_comms_ex_gst", "label": "Referrer comms ex GST", "kind": "money", "scope": "referrers"},
    {"key": "referrer_comms_gst", "label": "GST – referrer comms", "kind": "money", "scope": "referrers"},
    {"key": "referrer_comms_inc_gst", "label": "Referrer comms inc GST", "kind": "money", "scope": "referrers"},
    {"key": "referrer_name", "label": "Referrer", "kind": "text", "scope": "deals"},
    {"key": "payment_method", "label": "Payment type", "kind": "text", "scope": "payments"},
    {"key": "paid_on", "label": "Paid on", "kind": "date", "scope": "payments"},
    {"key": "payment_notes", "label": "Payment to referrer – notes", "kind": "text", "scope": "payments"},
    {"key": "volume_bonus", "label": "Volume bonus", "kind": "money", "scope": "income"},
    {"key": "net_profit", "label": "Net profit", "kind": "money", "scope": "income"},
]
_COLUMN_KEYS = {c["key"] for c in COLUMNS}

# The spreadsheet's colour coding.
CATEGORY_KINDS = {
    "asset_finance": "Asset finance",
    "consumer": "Consumer (car / personal loan)",
    "home_loan": "Home loan",
    "commercial": "Commercial",
}


# ── Access ───────────────────────────────────────────────────────────────


@dataclass
class LedgerAccess:
    user: User
    tenant_id: str
    settings: LedgerSettings
    is_owner: bool
    scopes: frozenset[str]

    def can(self, scope: str) -> bool:
        return self.is_owner or scope in self.scopes

    def require(self, scope: str) -> None:
        if not self.can(scope):
            raise HTTPException(status_code=403, detail="Not shared with you")

    def require_owner(self) -> None:
        if not self.is_owner:
            raise HTTPException(status_code=403, detail="Only the ledger owner can do that")


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def parse_scopes(raw: str | Iterable[str] | None) -> frozenset[str]:
    items = raw.split(",") if isinstance(raw, str) else (raw or [])
    return frozenset(s.strip() for s in items if s and s.strip() in GRANT_SCOPES)


def grant_is_live(grant: LedgerGrant, now: Optional[datetime] = None) -> bool:
    now = now or datetime.now(timezone.utc)
    return grant.revoked_at is None and _aware(grant.active_from) <= now


def resolve_access(db: Session, user: User, tenant_id: str) -> Optional[LedgerAccess]:
    """The viewer's access to the tenant's ledger, or None for no access at all."""
    if user.role not in (UserRole.admin, UserRole.broker):
        return None
    settings = db.query(LedgerSettings).filter(LedgerSettings.tenant_id == tenant_id).first()
    if not settings:
        return None
    if settings.owner_user_id == user.id:
        return LedgerAccess(user, tenant_id, settings, True, frozenset(GRANT_SCOPES) | {"payments"})
    now = datetime.now(timezone.utc)
    grants = (
        db.query(LedgerGrant)
        .filter(LedgerGrant.tenant_id == tenant_id, LedgerGrant.user_id == user.id, LedgerGrant.revoked_at.is_(None))
        .all()
    )
    live = [g for g in grants if grant_is_live(g, now)]
    if not live:
        return None
    scopes: frozenset[str] = frozenset()
    for g in live:
        scopes |= parse_scopes(g.scopes)
    return LedgerAccess(user, tenant_id, settings, False, scopes)


def audit(db: Session, access: LedgerAccess, action: str, detail: Optional[dict] = None) -> None:
    db.add(LedgerAuditEvent(
        tenant_id=access.tenant_id,
        actor_id=access.user.id,
        action=action,
        detail=json.dumps(detail, default=str) if detail else None,
    ))


# ── Money ────────────────────────────────────────────────────────────────


def _d(value) -> Decimal:
    if value is None:
        return ZERO
    return value if isinstance(value, Decimal) else Decimal(str(value))


def _r(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def _f(value: Optional[Decimal]) -> Optional[float]:
    return None if value is None else float(_r(value))


def _pricing_figures(sheet: Optional[QuoteSheet]) -> dict:
    """Finance amount, brokerage and origination fee off the latest lender pricing."""
    if not sheet:
        return {}
    out: dict = {}
    if sheet.amount_borrowed is not None:
        out["finance_amount"] = _d(sheet.amount_borrowed)
    try:
        params = json.loads(sheet.input_parameters or "{}")
    except ValueError:
        params = {}
    if isinstance(params, dict):
        for src, key in (("brokerage_amount", "brokerage"), ("origination_fee", "origination_fee")):
            value = params.get(src)
            if isinstance(value, (int, float)) and not isinstance(value, bool) and value:
                out[key] = _d(value)
    return out


# ── Rows ─────────────────────────────────────────────────────────────────


def settled_on(app: LoanApplication) -> date:
    return (app.settled_at or app.updated_at).date()


def _customer_name(app: LoanApplication) -> str:
    name = " ".join(p for p in [app.applicant_first_name, app.applicant_last_name] if p).strip()
    if name:
        return name
    contact: Optional[Contact] = getattr(app, "contact", None)
    if contact:
        name = " ".join(p for p in [contact.first_name, contact.last_name] if p).strip()
        if name:
            return name
    return _entity_name(app) or "Unnamed applicant"


def _entity_name(app: LoanApplication) -> Optional[str]:
    org = getattr(app, "business_organization", None)
    if org is not None and getattr(org, "name", None):
        return org.name
    return app.business_name or None


def category_kind(app: LoanApplication) -> Optional[str]:
    category = application_loan_category(app)
    if (
        category == "asset_finance"
        and app.applicant_type == APPLICANT_TYPE_INDIVIDUAL
        and application_sub_type(app) in CONSUMER_SUB_TYPES
    ):
        return "consumer"
    return category


def settled_applications(
    db: Session, tenant_id: str, date_from: Optional[date], date_to: Optional[date],
    application_ids: Optional[Iterable[str]] = None,
) -> list[LoanApplication]:
    settled_dt = func.coalesce(LoanApplication.settled_at, LoanApplication.updated_at)
    q = (
        db.query(LoanApplication)
        .options(
            joinedload(LoanApplication.user),
            joinedload(LoanApplication.contact),
            joinedload(LoanApplication.business_organization),
        )
        .filter(
            LoanApplication.tenant_id == tenant_id,
            LoanApplication.status == ApplicationStatus.settled,
            LoanApplication.deleted_at.is_(None),
        )
    )
    if date_from:
        q = q.filter(settled_dt >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        q = q.filter(settled_dt < datetime.combine(date_to + timedelta(days=1), datetime.min.time()))
    if application_ids is not None:
        q = q.filter(LoanApplication.id.in_(list(application_ids)))
    apps = q.all()
    apps.sort(key=lambda a: (settled_on(a), a.created_at))
    return apps


def _first_settlements(db: Session, tenant_id: str) -> dict[str, date]:
    """Each client's first settlement, for "repeat customer"."""
    settled_dt = func.coalesce(LoanApplication.settled_at, LoanApplication.updated_at)
    rows = (
        db.query(LoanApplication.user_id, func.min(settled_dt))
        .filter(
            LoanApplication.tenant_id == tenant_id,
            LoanApplication.status == ApplicationStatus.settled,
            LoanApplication.deleted_at.is_(None),
        )
        .group_by(LoanApplication.user_id)
        .all()
    )
    out = {}
    for user_id, first in rows:
        if isinstance(first, str):  # SQLite hands func.min() back as text
            first = datetime.fromisoformat(first)
        if first:
            out[user_id] = first.date()
    return out


def build_rows(db: Session, tenant_id: str, apps: list[LoanApplication]) -> list[dict]:
    """Every figure for each application, unredacted. See module docstring."""
    if not apps:
        return []
    ids = [a.id for a in apps]
    entries = {e.application_id: e for e in db.query(LedgerDeal).filter(
        LedgerDeal.tenant_id == tenant_id, LedgerDeal.application_id.in_(ids))}
    sheets: dict[str, QuoteSheet] = {}
    for sheet in (
        db.query(QuoteSheet)
        .filter(QuoteSheet.application_id.in_(ids), QuoteSheet.sheet_type == QuoteSheetType.lender_pricing)
        .order_by(QuoteSheet.version.asc())
    ):
        sheets[sheet.application_id] = sheet  # ascending, so the newest wins
    snapshot_lenders = dict(
        db.query(SettledDealSnapshot.application_id, SettledDealSnapshot.lender_id)
        .filter(SettledDealSnapshot.application_id.in_(ids))
    )
    lender_names = dict(db.query(Lender.id, Lender.name).filter(Lender.tenant_id == tenant_id))

    # The referrer on the client, as the rest of the app attributes it.
    client_referrers = referrer_info_map(db, (a.user_id for a in apps))
    referrer_ids = {e.referrer_id for e in entries.values() if e.referrer_set and e.referrer_id}
    referrer_ids |= {info["id"] for info in client_referrers.values()}
    referrer_ids |= {a.user_id for a in apps if a.user and a.user.role == UserRole.referrer}
    referrers = {u.id: u for u in db.query(User).filter(User.id.in_(referrer_ids))} if referrer_ids else {}

    first_settled = _first_settlements(db, tenant_id)

    rows = []
    for app in apps:
        e = entries.get(app.id)
        pricing = _pricing_figures(sheets.get(app.id))
        prefilled: list[str] = []

        def pick(field: str, fallback: Optional[Decimal]) -> Decimal:
            value = getattr(e, field) if e else None
            if value is not None:
                return _d(value)
            if fallback is not None:
                prefilled.append(field)
                return fallback
            return ZERO

        finance = pick("finance_amount", pricing.get("finance_amount", _d(app.amount)))
        brokerage = pick("brokerage", pricing.get("brokerage"))
        doc_fee = pick("doc_fee", None)
        origination = pick("origination_fee", pricing.get("origination_fee"))
        vir = pick("vir", None)
        volume_bonus = pick("volume_bonus", None)
        income_gst = e.income_gst if e else True
        rate = GST_RATE if income_gst else ZERO
        income_ex = brokerage + doc_fee + origination + vir

        lender = e.lender_name if e and e.lender_name else None
        if not lender:
            pricing_sheet = sheets.get(app.id)
            lender = (
                app.approval_lender_name
                or (lender_names.get(pricing_sheet.lender_id) if pricing_sheet and pricing_sheet.lender_id else None)
                or lender_names.get(snapshot_lenders.get(app.id) or "")
            )
            if lender:
                prefilled.append("lender_name")

        if e and e.referrer_set:
            referrer_id = e.referrer_id
        elif app.user and app.user.role == UserRole.referrer:
            referrer_id = app.user.id
        else:
            info = client_referrers.get(app.user_id)
            referrer_id = info["id"] if info else None
        referrer = referrers.get(referrer_id) if referrer_id else None

        share_base = e.share_base if e and e.share_base in SHARE_BASES else "brokerage"
        share_percent = _d(e.share_percent) if e and e.share_percent is not None else None
        share_amount = _d(e.share_amount) if e and e.share_amount is not None else None
        base_value = {"brokerage": brokerage, "total_income": income_ex, "finance_amount": finance}[share_base]
        if not referrer_id:
            comms = ZERO
        elif share_amount is not None:
            comms = share_amount
        elif share_percent is not None:
            comms = _r(base_value * share_percent / Decimal(100))
        else:
            comms = ZERO
        if e and e.share_gst is not None:
            share_gst = e.share_gst
        else:
            share_gst = bool(referrer and referrer.business_gst_registered)
        comms_gst = _r(comms * GST_RATE) if share_gst else ZERO

        settled = settled_on(app)
        first = first_settled.get(app.user_id)
        derived_repeat = bool(first and first < settled)
        derived_new_lead = app.created_at.date().replace(day=1) == settled.replace(day=1)

        rows.append({
            "application_id": app.id,
            "settled_on": settled.isoformat(),
            "month": settled.strftime("%Y-%m"),
            "customer_name": _customer_name(app),
            "entity_name": _entity_name(app),
            "category": category_kind(app),
            "loan_type": app.loan_type.value,
            "new_lead": e.new_lead if e and e.new_lead is not None else derived_new_lead,
            "repeat_customer": e.repeat_customer if e and e.repeat_customer is not None else derived_repeat,
            "finance_amount": _f(finance),
            "brokerage": _f(brokerage),
            "brokerage_gst": _f(brokerage * rate),
            "doc_fee": _f(doc_fee),
            "doc_fee_gst": _f(doc_fee * rate),
            "origination_fee": _f(origination),
            "origination_gst": _f(origination * rate),
            "vir": _f(vir),
            "vir_gst": _f(vir * rate),
            "income_ex_gst": _f(income_ex),
            "income_inc_gst": _f(income_ex * (1 + rate)),
            "income_gst": income_gst,
            "lender_name": lender,
            "referrer_id": referrer_id,
            "referrer_name": (referrer.full_name if referrer else None),
            "referrer_organization": (referrer.organization_name if referrer else None),
            "share_percent": float(share_percent) if share_percent is not None else None,
            "share_base": share_base,
            "share_amount": _f(share_amount),
            "share_gst": share_gst,
            "referrer_comms_ex_gst": _f(comms),
            "referrer_comms_gst": _f(comms_gst),
            "referrer_comms_inc_gst": _f(comms + comms_gst),
            "volume_bonus": _f(volume_bonus),
            "net_profit": _f(income_ex - comms),
            "is_clawback": bool(e and e.is_clawback),
            "paid_on": e.paid_on.isoformat() if e and e.paid_on else None,
            "payment_method": e.payment_method if e else None,
            "payment_notes": e.payment_notes if e else None,
            "has_entry": e is not None,
            "prefilled": prefilled,
        })
    return rows


def totals(rows: list[dict]) -> dict:
    out: dict = {"count": len(rows)}
    for key in TOTALLED:
        out[key] = float(_r(sum((_d(r.get(key)) for r in rows), ZERO)))
    return out


def months(rows: list[dict]) -> list[dict]:
    grouped: dict[str, list[dict]] = {}
    for r in rows:
        grouped.setdefault(r["month"], []).append(r)
    return [{"month": m, "totals": totals(rs)} for m, rs in sorted(grouped.items())]


# ── Redaction ────────────────────────────────────────────────────────────


def _hidden_fields(access: LedgerAccess) -> set[str]:
    hidden: set[str] = set()
    if not access.can("income"):
        hidden.update(_INCOME_FIELDS)
    if not access.can("referrers"):
        hidden.update(_REFERRER_FIELDS)
    if not access.is_owner:
        hidden.update(_PAYMENT_FIELDS)
        hidden.update(("prefilled", "has_entry"))
    return hidden


def redact_row(row: dict, access: LedgerAccess) -> dict:
    hidden = _hidden_fields(access)
    return {k: v for k, v in row.items() if k not in hidden}


def redact_totals(t: dict, access: LedgerAccess) -> dict:
    hidden = _hidden_fields(access)
    return {k: v for k, v in t.items() if k not in hidden}


def visible_columns(access: LedgerAccess) -> list[dict]:
    return [c for c in COLUMNS if (c["scope"] == "payments" and access.is_owner) or (c["scope"] != "payments" and access.can(c["scope"]))]


# ── Referrers ────────────────────────────────────────────────────────────


def referrer_summary(rows: list[dict], include_payments: bool) -> list[dict]:
    grouped: dict[str, list[dict]] = {}
    for r in rows:
        if r["referrer_id"]:
            grouped.setdefault(r["referrer_id"], []).append(r)
    out = []
    for referrer_id, rs in grouped.items():
        t = totals(rs)
        item = {
            "referrer_id": referrer_id,
            "referrer_name": rs[0]["referrer_name"],
            "referrer_organization": rs[0]["referrer_organization"],
            "deals": len(rs),
            "finance_amount": t["finance_amount"],
            "referrer_comms_ex_gst": t["referrer_comms_ex_gst"],
            "referrer_comms_gst": t["referrer_comms_gst"],
            "referrer_comms_inc_gst": t["referrer_comms_inc_gst"],
        }
        if include_payments:
            unpaid = [r for r in rs if not r["paid_on"]]
            item["unpaid_deals"] = len(unpaid)
            item["unpaid_comms_inc_gst"] = totals(unpaid)["referrer_comms_inc_gst"]
        out.append(item)
    out.sort(key=lambda i: (-i["deals"], (i["referrer_name"] or "").lower()))
    return out


# ── Settings ─────────────────────────────────────────────────────────────


def settings_out(settings: LedgerSettings, db: Session) -> dict:
    tenant = db.get(Tenant, settings.tenant_id)
    owner = db.get(User, settings.owner_user_id)
    return {
        "owner_name": owner.full_name if owner else None,
        "business_name": settings.business_name or (tenant.name if tenant else None),
        "business_abn": settings.business_abn,
        "business_address": settings.business_address,
        "business_email": settings.business_email or (owner.email if owner else None),
        "invoice_prefix": settings.invoice_prefix,
        "next_invoice_number": settings.next_invoice_number,
    }


# ── Invoices ─────────────────────────────────────────────────────────────


def referrer_party(referrer: User, include_bank: bool) -> dict:
    party = {
        "id": referrer.id,
        "name": referrer.organization_name or referrer.full_name,
        "contact_name": referrer.business_director_name or referrer.full_name,
        "abn": referrer.business_abn,
        "address": referrer.business_address,
        "email": referrer.email,
        "gst_registered": referrer.business_gst_registered,
    }
    if include_bank:
        party.update(
            bank_account_name=referrer.bank_account_name,
            bank_bsb=referrer.bank_bsb,
            bank_account_number=referrer.bank_account_number,
        )
    return party


def invoice_lines(rows: list[dict], layout: str, period_label: str) -> list[dict]:
    if layout == "single":
        t = totals(rows)
        return [{
            "description": f"Referral commission — {len(rows)} settled deal{'s' if len(rows) != 1 else ''}, {period_label}",
            "amount_ex_gst": t["referrer_comms_ex_gst"],
            "gst": t["referrer_comms_gst"],
            "amount_inc_gst": t["referrer_comms_inc_gst"],
        }]
    return [{
        "application_id": r["application_id"],
        "settled_on": r["settled_on"],
        "customer_name": r["customer_name"],
        "entity_name": r["entity_name"],
        "lender_name": r["lender_name"],
        "finance_amount": r["finance_amount"],
        "description": "Referral commission",
        "amount_ex_gst": r["referrer_comms_ex_gst"],
        "gst": r["referrer_comms_gst"],
        "amount_inc_gst": r["referrer_comms_inc_gst"],
    } for r in rows]


def period_label(date_from: Optional[date], date_to: Optional[date]) -> str:
    fmt = "%d/%m/%Y"
    if date_from and date_to:
        return f"{date_from.strftime(fmt)} – {date_to.strftime(fmt)}"
    if date_from:
        return f"from {date_from.strftime(fmt)}"
    if date_to:
        return f"to {date_to.strftime(fmt)}"
    return "all settled deals"


# ── Excel ────────────────────────────────────────────────────────────────

# Fill colours for the spreadsheet's category coding.
_CATEGORY_FILLS = {"asset_finance": "C6EFCE", "consumer": "F8CBDE", "home_loan": "BDD7EE", "commercial": "FFF2CC"}


def to_xlsx(rows: list[dict], month_list: list[dict], period_totals: dict, columns: list[dict], title: str) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = "Settled deals"
    bold = Font(bold=True)
    head_fill = PatternFill("solid", fgColor="1F2A44")
    band_fill = PatternFill("solid", fgColor="EEF1F6")
    thin = Side(style="thin", color="C9CED8")
    box = Border(top=thin, bottom=thin, left=thin, right=thin)
    fmt = {"money": '"$"#,##0.00;[Red]-"$"#,##0.00', "date": "DD/MM/YYYY"}
    label_col = next((i for i, c in enumerate(columns, start=1) if c["key"] not in TOTALLED), 1)

    ws.cell(row=1, column=1, value=title).font = Font(bold=True, size=14)
    r = 3

    def header(row: int) -> None:
        for i, c in enumerate(columns, start=1):
            cell = ws.cell(row=row, column=i, value=c["label"])
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = head_fill
            cell.alignment = Alignment(wrap_text=True, vertical="center")
            cell.border = box

    def total_row(label: str, t: dict, row: int) -> None:
        ws.cell(row=row, column=label_col, value=label).font = bold
        for i, c in enumerate(columns, start=1):
            cell = ws.cell(row=row, column=i)
            cell.fill = band_fill
            cell.border = box
            if c["key"] in TOTALLED and c["key"] in t:
                cell.value = t[c["key"]]
                cell.number_format = fmt["money"]
                cell.font = bold

    by_month: dict[str, list[dict]] = {}
    for row in rows:
        by_month.setdefault(row["month"], []).append(row)
    for m in month_list:
        month_rows = by_month.get(m["month"], [])
        heading = datetime.strptime(m["month"], "%Y-%m").strftime("%B %Y")
        ws.cell(row=r, column=1, value=heading).font = Font(bold=True, size=12)
        r += 1
        header(r)
        r += 1
        for row in month_rows:
            fill = _CATEGORY_FILLS.get(row.get("category") or "")
            for i, c in enumerate(columns, start=1):
                value = row.get(c["key"])
                if c["kind"] == "date" and value:
                    value = date.fromisoformat(value)
                elif c["kind"] == "bool":
                    value = "Yes" if value else "No"
                cell = ws.cell(row=r, column=i, value=value)
                cell.border = box
                cell.alignment = Alignment(wrap_text=True, vertical="top")
                if c["kind"] in fmt:
                    cell.number_format = fmt[c["kind"]]
                if fill and c["key"] in ("customer_name", "entity_name"):
                    cell.fill = PatternFill("solid", fgColor=fill)
                if row.get("is_clawback"):
                    cell.font = Font(color="C00000")
            r += 1
        total_row(f"Total {heading}", m["totals"], r)
        r += 2

    total_row("TOTAL", period_totals, r)

    widths = {"money": 14, "date": 12, "bool": 9, "text": 24}
    for i, c in enumerate(columns, start=1):
        ws.column_dimensions[get_column_letter(i)].width = widths.get(c["kind"], 16)
    ws.freeze_panes = "A3"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True

    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def pick_columns(keys: Optional[str], access: LedgerAccess) -> list[dict]:
    allowed = visible_columns(access)
    if not keys:
        return allowed
    wanted = [k.strip() for k in keys.split(",") if k.strip() in _COLUMN_KEYS]
    by_key = {c["key"]: c for c in allowed}
    picked = [by_key[k] for k in wanted if k in by_key]
    if not picked:
        raise HTTPException(status_code=400, detail="Choose at least one column you can see")
    return picked
