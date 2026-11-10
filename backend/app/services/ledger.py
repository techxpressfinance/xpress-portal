"""The private commission ledger: who may see it, and the figures it shows.

Access
  * The OWNER (LedgerSettings.owner_user_id) sees and edits everything.
  * A GRANTEE (always another admin) sees only the scopes on their grant, read-only, and only once
    the grant's 24-hour wait is over. Payment dates and notes are the owner's
    alone and are never grantable.
  * Nobody else gets anything — never a broker, client or referrer, not other admins, not an admin impersonating
    the owner (the router refuses impersonation tokens outright).
  Redaction happens here, on the server: a field outside the viewer's scopes
  is removed from the response, not hidden by the page.

Figures
  One row per settled application, dated by settled_at. What the owner has
  entered (LedgerDeal) wins; anything not entered is prefilled from the
  application — lender pricing for finance amount, brokerage, origination
  fee and VIR, the approval lender, and the referrer on the client — and the row says
  which fields are still prefilled. The maths mirrors the desk's spreadsheet:
  income lines are ex GST with 10% GST beside each, total income is their sum,
  the referrer's share is a percentage of a base or a dollar figure that wins
  when set (as the quote sheets do brokerage), and net profit is total income
  less the referrer's share, both ex GST.

Volume bonus
  Estimated per deal unless the owner types one: finance amount ex GST
  (÷ 1.1) × the lender's
  VBI rate (lender book, admin-only; a personal-loan, business or repeat-
  customer rate overrides the default for that kind of deal) × our share,
  which is set by the WHOLE month's settled volume across the tenant
  (DEFAULT_VB_TIERS, editable per tenant) and paid from dollar one. Home loans
  and clawbacks get no estimate — it is the spreadsheet's "possible volume
  bonus". What the aggregator actually paid is entered per month
  (LedgerMonth, inc GST); final profit = net profit + that, ex GST.

Report layout (screen, PDF and Excel alike, as the desk's spreadsheet)
  Each month splits into 1st–15th and after the 15th (work is reviewed
  fortnightly), each half with its total, then the month total carrying the
  volume bonus received and final profit. Months roll up into financial-year
  quarters (Q1 Jul–Sep … Q4 Apr–Jun) and financial years (1 July – 30 June).
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
from app.models.ledger import (
    LedgerAuditEvent,
    LedgerDeal,
    LedgerDealShare,
    LedgerGrant,
    LedgerMonth,
    LedgerPayee,
    LedgerSettings,
)
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
    "vb_rate", "vb_share", "vb_month_volume", "vb_received_inc_gst", "vb_received_ex_gst", "final_profit",
)
_REFERRER_FIELDS = (
    "shares", "share_percent", "share_base", "share_amount", "share_gst",
    "referrer_comms_ex_gst", "referrer_comms_gst", "referrer_comms_inc_gst",
)
_PAYMENT_FIELDS = ("paid_on", "payment_method", "payment_notes", "payment_reference", "payment_status",
                   "payment_status_label", "notes")
# Inside each share: what only the owner sees.
_SHARE_PAYMENT_FIELDS = ("status", "scheduled_on", "paid_on", "payment_method", "payment_reference", "payment_notes")

# Money columns that are summed into month subtotals and the period total.
TOTALLED = (
    "finance_amount", "brokerage", "brokerage_gst", "doc_fee", "doc_fee_gst",
    "origination_fee", "origination_gst", "vir", "vir_gst", "income_ex_gst", "income_inc_gst",
    "referrer_comms_ex_gst", "referrer_comms_gst", "referrer_comms_inc_gst", "volume_bonus", "net_profit",
)
# Month-level money: blank on a deal, filled on month / quarter / year totals.
PERIOD_ONLY = ("vb_received_ex_gst", "vb_received_inc_gst", "final_profit")

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
    {"key": "broker_name", "label": "Broker", "kind": "text", "scope": "deals"},
    {"key": "referrer_comms_ex_gst", "label": "Referrer comms ex GST", "kind": "money", "scope": "referrers"},
    {"key": "referrer_comms_gst", "label": "GST – referrer comms", "kind": "money", "scope": "referrers"},
    {"key": "referrer_comms_inc_gst", "label": "Referrer comms inc GST", "kind": "money", "scope": "referrers"},
    {"key": "referrer_name", "label": "Referrer", "kind": "text", "scope": "deals"},
    {"key": "payment_method", "label": "Payment type", "kind": "text", "scope": "payments"},
    {"key": "payment_status_label", "label": "Payment status", "kind": "text", "scope": "payments"},
    {"key": "paid_on", "label": "Paid on", "kind": "date", "scope": "payments"},
    {"key": "payment_reference", "label": "Payment reference", "kind": "text", "scope": "payments"},
    {"key": "payment_notes", "label": "Payment to referrer – notes", "kind": "text", "scope": "payments"},
    {"key": "volume_bonus", "label": "Possible volume bonus", "kind": "money", "scope": "income"},
    {"key": "net_profit", "label": "Net profit", "kind": "money", "scope": "income"},
    # Filled on the month, quarter and year totals only (PERIOD_ONLY).
    {"key": "vb_received_ex_gst", "label": "Total volume bonus ex GST", "kind": "money", "scope": "income"},
    {"key": "vb_received_inc_gst", "label": "Total volume bonus inc GST", "kind": "money", "scope": "income"},
    {"key": "final_profit", "label": "Final profit before expenses", "kind": "money", "scope": "income"},
]

# Our share of the lenders' volume bonus, by the month's total settled volume:
# the highest tier the month reaches applies to every deal in it, from dollar one.
DEFAULT_VB_TIERS = [
    {"min_volume": 0, "share_percent": 0},
    {"min_volume": 250_000, "share_percent": 50},
    {"min_volume": 750_000, "share_percent": 65},
    {"min_volume": 1_250_000, "share_percent": 80},
    {"min_volume": 3_000_000, "share_percent": 90},
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
    # Admins only — a broker is refused even if a grant was made before the
    # ledger became admin-only, or they were demoted after it.
    if user.role != UserRole.admin:
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
    """Finance amount, brokerage, origination fee and VIR off the latest lender pricing."""
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
        for src, key in (("brokerage_amount", "brokerage"), ("origination_fee", "origination_fee"), ("vir_fee", "vir")):
            value = params.get(src)
            if isinstance(value, (int, float)) and not isinstance(value, bool) and value:
                out[key] = _d(value)
    return out


def vb_tiers(settings: Optional[LedgerSettings]) -> list[dict]:
    raw = None
    if settings and settings.vb_tiers:
        try:
            raw = json.loads(settings.vb_tiers)
        except ValueError:
            raw = None
    tiers = raw if isinstance(raw, list) and raw else DEFAULT_VB_TIERS
    return sorted(
        ({"min_volume": float(t["min_volume"]), "share_percent": float(t["share_percent"])} for t in tiers),
        key=lambda t: t["min_volume"],
    )


def vb_share(volume: Decimal, tiers: list[dict]) -> Decimal:
    share = ZERO
    for t in tiers:
        if volume >= _d(t["min_volume"]):
            share = _d(t["share_percent"])
    return share


def _vb_rate(lender: Optional[Lender], sub_type: Optional[str], kind: Optional[str], repeat: bool) -> Optional[Decimal]:
    """The lender's VBI % for this kind of deal, or None when it has none."""
    if lender is None or kind == "home_loan":
        return None
    for applies, value in (
        (repeat, lender.vbi_repeat_percent),
        (sub_type == "personal", lender.vbi_personal_percent),
        (kind in ("asset_finance", "commercial"), lender.vbi_commercial_percent),
    ):
        if applies and value is not None:
            return _d(value)
    return _d(lender.vbi_percent) if lender.vbi_percent is not None else None


def _norm_name(name: Optional[str]) -> str:
    return "".join(ch for ch in (name or "").lower() if ch.isalnum())


def _finance_of(entry: Optional[LedgerDeal], sheet: Optional[QuoteSheet], amount) -> Decimal:
    """Finance amount exactly as build_rows picks it."""
    if entry and entry.finance_amount is not None:
        return _d(entry.finance_amount)
    if sheet and sheet.amount_borrowed is not None:
        return _d(sheet.amount_borrowed)
    return _d(amount)


def month_volumes(db: Session, tenant_id: str, months_wanted: Iterable[date]) -> dict[str, Decimal]:
    """Total settled volume for each whole month asked for (first-of-month
    dates), across the tenant — the volume bonus tier is set by the month, not
    by whatever range or referrer the ledger is filtered to. Clawbacks don't
    count as volume."""
    wanted = sorted(set(months_wanted))
    if not wanted:
        return {}
    start = wanted[0]
    last = wanted[-1]
    end = (last.replace(day=28) + timedelta(days=4)).replace(day=1)
    settled_dt = func.coalesce(LoanApplication.settled_at, LoanApplication.updated_at)
    apps = (
        db.query(LoanApplication.id, LoanApplication.amount, LoanApplication.settled_at, LoanApplication.updated_at)
        .filter(
            LoanApplication.tenant_id == tenant_id,
            LoanApplication.status == ApplicationStatus.settled,
            LoanApplication.deleted_at.is_(None),
            settled_dt >= datetime.combine(start, datetime.min.time()),
            settled_dt < datetime.combine(end, datetime.min.time()),
        )
        .all()
    )
    ids = [a.id for a in apps]
    entries = {e.application_id: e for e in db.query(LedgerDeal).filter(
        LedgerDeal.tenant_id == tenant_id, LedgerDeal.application_id.in_(ids))} if ids else {}
    sheets: dict[str, QuoteSheet] = {}
    if ids:
        for sheet in (
            db.query(QuoteSheet)
            .filter(QuoteSheet.application_id.in_(ids), QuoteSheet.sheet_type == QuoteSheetType.lender_pricing)
            .order_by(QuoteSheet.version.asc())
        ):
            sheets[sheet.application_id] = sheet
    out: dict[str, Decimal] = {}
    for a in apps:
        e = entries.get(a.id)
        if e and e.is_clawback:
            continue
        key = (a.settled_at or a.updated_at).strftime("%Y-%m")
        out[key] = out.get(key, ZERO) + _finance_of(e, sheets.get(a.id), a.amount)
    # Ledger-only deals (history, business outside the portal) count too.
    for m in manual_deals(db, tenant_id, start, end - timedelta(days=1)):
        if m.is_clawback or not m.manual_settled_on:
            continue
        key = m.manual_settled_on.strftime("%Y-%m")
        out[key] = out.get(key, ZERO) + _d(m.finance_amount)
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


STATUS_LABELS = {"unpaid": "Unpaid", "scheduled": "Scheduled", "paid": "Paid", "not_payable": "Not payable", "part_paid": "Part paid"}


def payee_key(payee: Optional[LedgerPayee], user_id: Optional[str] = None) -> str:
    """A payee's stable key: "u:<user id>" for a portal referrer (whether or not
    they have a payee row yet), "p:<payee id>" for someone off-portal."""
    uid = (payee.user_id if payee else None) or user_id
    return f"u:{uid}" if uid else f"p:{payee.id}"


def payee_display(payee: Optional[LedgerPayee], user: Optional[User]) -> dict:
    """Name, organisation and GST registration — from the User for a portal
    referrer (one record, not a copy), from the payee row otherwise."""
    if user is not None:
        return {"name": user.full_name, "organization": user.organization_name, "gst_registered": user.business_gst_registered}
    return {"name": payee.name if payee else None, "organization": payee.company_name if payee else None,
            "gst_registered": payee.gst_registered if payee else None}


def manual_deals(db: Session, tenant_id: str, date_from: Optional[date], date_to: Optional[date],
                 keys: Optional[Iterable[str]] = None) -> list[LedgerDeal]:
    q = db.query(LedgerDeal).filter(LedgerDeal.tenant_id == tenant_id, LedgerDeal.is_manual.is_(True))
    if date_from:
        q = q.filter(LedgerDeal.manual_settled_on >= date_from)
    if date_to:
        q = q.filter(LedgerDeal.manual_settled_on <= date_to)
    if keys is not None:
        q = q.filter(LedgerDeal.application_id.in_(list(keys)))
    return q.all()


def _app_brokers(db: Session, apps: list[LoanApplication]) -> dict[str, list[str]]:
    """Every broker on each application: the assigned one first, then co-brokers."""
    from app.models.application_broker import ApplicationBroker

    out: dict[str, list[str]] = {a.id: ([a.assigned_broker_id] if a.assigned_broker_id else []) for a in apps}
    if apps:
        for app_id, broker_id in db.query(ApplicationBroker.application_id, ApplicationBroker.broker_id).filter(
            ApplicationBroker.application_id.in_([a.id for a in apps])
        ):
            if broker_id not in out[app_id]:
                out[app_id].append(broker_id)
    return out


def build_rows(db: Session, tenant_id: str, apps: list[LoanApplication],
               manual: Iterable[LedgerDeal] = ()) -> list[dict]:
    """Every figure for each deal — settled applications and ledger-only deals —
    unredacted, in settled order. See module docstring."""
    manual = list(manual)
    if not apps and not manual:
        return []
    ids = [a.id for a in apps]
    entries = {e.application_id: e for e in db.query(LedgerDeal).filter(
        LedgerDeal.tenant_id == tenant_id, LedgerDeal.application_id.in_(ids))} if ids else {}
    sheets: dict[str, QuoteSheet] = {}
    snapshot_lenders: dict = {}
    if ids:
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
    lenders = {lender.id: lender for lender in db.query(Lender).filter(Lender.tenant_id == tenant_id)}
    lender_names = {lid: lender.name for lid, lender in lenders.items()}
    lenders_by_name: dict[str, Lender] = {}
    for lender in lenders.values():
        lenders_by_name.setdefault(_norm_name(lender.name), lender)
    settings = db.query(LedgerSettings).filter(LedgerSettings.tenant_id == tenant_id).first()
    tiers = vb_tiers(settings)
    volumes = month_volumes(
        db, tenant_id,
        [settled_on(a).replace(day=1) for a in apps] + [m.manual_settled_on.replace(day=1) for m in manual if m.manual_settled_on],
    )

    # Payees and their shares of these deals.
    deal_keys = ids + [m.application_id for m in manual]
    shares_by_deal: dict[str, list[LedgerDealShare]] = {}
    for sh in (
        db.query(LedgerDealShare)
        .filter(LedgerDealShare.tenant_id == tenant_id, LedgerDealShare.deal_key.in_(deal_keys))
        .order_by(LedgerDealShare.sort_order, LedgerDealShare.created_at)
    ):
        shares_by_deal.setdefault(sh.deal_key, []).append(sh)
    payees = {p.id: p for p in db.query(LedgerPayee).filter(LedgerPayee.tenant_id == tenant_id)}
    payee_by_user = {p.user_id: p for p in payees.values() if p.user_id}

    # The referrer on the client, as the rest of the app attributes it — the
    # payee a deal has until the owner says otherwise.
    client_referrers = referrer_info_map(db, (a.user_id for a in apps))
    user_ids = {e.referrer_id for e in list(entries.values()) + manual if e.referrer_set and e.referrer_id}
    user_ids |= {info["id"] for info in client_referrers.values()}
    user_ids |= {a.user_id for a in apps if a.user and a.user.role == UserRole.referrer}
    user_ids |= set(payee_by_user)
    app_brokers = _app_brokers(db, apps)
    broker_ids = {b for bs in app_brokers.values() for b in bs} | {m.manual_broker_id for m in manual if m.manual_broker_id}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids | broker_ids))} if (user_ids | broker_ids) else {}

    first_settled = _first_settlements(db, tenant_id)

    def share_out(*, share: Optional[LedgerDealShare], payee: Optional[LedgerPayee], user_id: Optional[str],
                  legacy: Optional[LedgerDeal], bases: dict) -> dict:
        """One payee's figures on a deal. A saved share wins; otherwise the
        deal's legacy single-payee fields, then the payee's usual cut."""
        user = users.get(user_id or (payee.user_id if payee else None) or "")
        who = payee_display(payee, user)
        if share is not None:
            src_percent, src_base, src_amount, src_gst = share.share_percent, share.share_base, share.share_amount, share.share_gst
        elif legacy is not None and (legacy.share_percent is not None or legacy.share_amount is not None or legacy.share_gst is not None):
            src_percent, src_base, src_amount, src_gst = legacy.share_percent, legacy.share_base, legacy.share_amount, legacy.share_gst
        elif payee is not None:
            src_percent, src_base, src_amount, src_gst = payee.default_share_percent, payee.default_share_base, payee.default_share_amount, None
        else:
            src_percent, src_base, src_amount, src_gst = None, "brokerage", None, None
        base = src_base if src_base in SHARE_BASES else "brokerage"
        percent = _d(src_percent) if src_percent is not None else None
        amount = _d(src_amount) if src_amount is not None else None
        if amount is not None:
            comms = amount
        elif percent is not None:
            comms = _r(bases[base] * percent / Decimal(100))
        else:
            comms = ZERO
        gst_on = src_gst if src_gst is not None else bool(who["gst_registered"])
        comms_gst = _r(comms * GST_RATE) if gst_on else ZERO
        if share is not None:
            status, scheduled, paid = share.status, share.scheduled_on, share.paid_on
            method, reference, notes = share.payment_method, share.payment_reference, share.payment_notes
        elif legacy is not None:
            status = "paid" if legacy.paid_on else "unpaid"
            scheduled, paid, method, reference, notes = None, legacy.paid_on, legacy.payment_method, None, legacy.payment_notes
        else:
            status, scheduled, paid, method, reference, notes = "unpaid", None, None, None, None, None
        return {
            "id": share.id if share else None,
            "payee_key": payee_key(payee, user_id),
            "payee_id": payee.id if payee else None,
            "user_id": user.id if user else None,
            "payee_name": who["name"],
            "payee_organization": who["organization"],
            "share_percent": float(percent) if percent is not None else None,
            "share_base": base,
            "share_amount": _f(amount),
            "share_gst": gst_on,
            # True = GST on/off was chosen for this share; False = it follows the payee.
            "share_gst_set": src_gst is not None,
            "comms_ex_gst": _f(comms),
            "comms_gst": _f(comms_gst),
            "comms_inc_gst": _f(comms + comms_gst),
            "status": status,
            "scheduled_on": scheduled.isoformat() if scheduled else None,
            "paid_on": paid.isoformat() if paid else None,
            "payment_method": method,
            "payment_reference": reference,
            "payment_notes": notes,
            "saved": share is not None,
        }

    def payment_summary(shares: list[dict]) -> dict:
        owed = [s for s in shares if s["comms_ex_gst"] or s["status"] != "unpaid"]
        if not owed:
            return {"payment_status": None, "payment_status_label": None}
        st = {s["status"] for s in owed}
        if st <= {"paid", "not_payable"}:
            code = "paid" if "paid" in st else "not_payable"
        elif "paid" in st:
            code = "part_paid"
        elif st <= {"scheduled", "not_payable"}:
            code = "scheduled"
        else:
            code = "unpaid"
        label = STATUS_LABELS[code]
        if code == "scheduled":
            dates = sorted(s["scheduled_on"] for s in owed if s["scheduled_on"])
            if dates:
                label += " " + date.fromisoformat(dates[0]).strftime("%d/%m/%Y")
        return {"payment_status": code, "payment_status_label": label}

    def deal_row(*, key: str, e: Optional[LedgerDeal], settled: date, customer: str, entity: Optional[str],
                 kind: Optional[str], loan_type: str, sub_type: Optional[str], new_lead: bool, repeat: bool,
                 pricing: dict, app_amount, lender: Optional[str], lender_obj: Optional[Lender],
                 lender_prefilled: bool, default_user_id: Optional[str], brokers: list[str],
                 broker_name: Optional[str], is_manual: bool) -> dict:
        prefilled: list[str] = ["lender_name"] if lender_prefilled else []

        def pick(field: str, fallback: Optional[Decimal]) -> Decimal:
            value = getattr(e, field) if e else None
            if value is not None:
                return _d(value)
            if fallback is not None:
                prefilled.append(field)
                return fallback
            return ZERO

        finance = pick("finance_amount", pricing.get("finance_amount", _d(app_amount) if app_amount is not None else None))
        brokerage = pick("brokerage", pricing.get("brokerage"))
        doc_fee = pick("doc_fee", None)
        origination = pick("origination_fee", pricing.get("origination_fee"))
        vir = pick("vir", pricing.get("vir"))
        income_gst = e.income_gst if e else True
        rate = GST_RATE if income_gst else ZERO
        income_ex = brokerage + doc_fee + origination + vir
        bases = {"brokerage": brokerage, "total_income": income_ex, "finance_amount": finance}

        saved = shares_by_deal.get(key, [])
        if saved:
            shares = [share_out(share=sh, payee=payees.get(sh.payee_id), user_id=None, legacy=None, bases=bases)
                      for sh in saved if sh.payee_id in payees]
        else:
            uid = (e.referrer_id if e and e.referrer_set else default_user_id)
            shares = [share_out(share=None, payee=payee_by_user.get(uid), user_id=uid, legacy=e, bases=bases)] if uid else []
        comms = sum((_d(s["comms_ex_gst"]) for s in shares), ZERO)
        comms_gst = sum((_d(s["comms_gst"]) for s in shares), ZERO)
        paid_dates = sorted(s["paid_on"] for s in shares if s["paid_on"])

        is_clawback = bool(e and e.is_clawback)
        vb_rate = None if is_clawback else _vb_rate(lender_obj, sub_type, kind, repeat)
        month_volume = volumes.get(settled.strftime("%Y-%m"), ZERO)
        share = vb_share(month_volume, tiers)
        # VBI is a percentage of the amount financed ex GST.
        finance_ex_gst = finance / (1 + GST_RATE)
        estimate = _r(finance_ex_gst * vb_rate / Decimal(100) * share / Decimal(100)) if vb_rate is not None else None
        volume_bonus = pick("volume_bonus", estimate)
        single = shares[0] if len(shares) == 1 else None

        return {
            "application_id": key,
            "is_manual": is_manual,
            "settled_on": settled.isoformat(),
            "month": settled.strftime("%Y-%m"),
            # 1 = settled 1st–15th, 2 = after the 15th.
            "half": 1 if settled.day <= 15 else 2,
            "customer_name": customer,
            "entity_name": entity,
            "category": kind,
            "loan_type": loan_type,
            "broker_ids": brokers,
            "broker_name": broker_name,
            "new_lead": new_lead,
            "repeat_customer": repeat,
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
            "shares": shares,
            "referrer_keys": [s["payee_key"] for s in shares],
            "referrer_id": shares[0]["payee_key"] if shares else None,
            "referrer_name": " & ".join(s["payee_name"] or "Unnamed" for s in shares) or None,
            "referrer_organization": shares[0]["payee_organization"] if shares else None,
            "share_percent": single["share_percent"] if single else None,
            "share_base": single["share_base"] if single else None,
            "share_amount": single["share_amount"] if single else None,
            "share_gst": single["share_gst"] if single else None,
            "referrer_comms_ex_gst": _f(comms),
            "referrer_comms_gst": _f(comms_gst),
            "referrer_comms_inc_gst": _f(comms + comms_gst),
            "volume_bonus": _f(volume_bonus),
            "net_profit": _f(income_ex - comms),
            "vb_rate": float(vb_rate) if vb_rate is not None else None,
            "vb_share": float(share),
            "vb_month_volume": _f(month_volume),
            "is_clawback": is_clawback,
            "paid_on": paid_dates[-1] if paid_dates else None,
            "payment_method": ", ".join(dict.fromkeys(s["payment_method"] for s in shares if s["payment_method"])) or None,
            "payment_reference": ", ".join(dict.fromkeys(s["payment_reference"] for s in shares if s["payment_reference"])) or None,
            "payment_notes": "; ".join(
                (f"{s['payee_name']}: {s['payment_notes']}" if len(shares) > 1 else s["payment_notes"])
                for s in shares if s["payment_notes"]
            ) or None,
            **payment_summary(shares),
            "notes": e.notes if e else None,
            "has_entry": e is not None,
            "prefilled": prefilled,
        }

    rows = []
    for app in apps:
        e = entries.get(app.id)
        pricing = _pricing_figures(sheets.get(app.id))
        lender = e.lender_name if e and e.lender_name else None
        lender_obj: Optional[Lender] = lenders_by_name.get(_norm_name(lender)) if lender else None
        lender_prefilled = False
        if not lender:
            pricing_sheet = sheets.get(app.id)
            lender = (
                app.approval_lender_name
                or (lender_names.get(pricing_sheet.lender_id) if pricing_sheet and pricing_sheet.lender_id else None)
                or lender_names.get(snapshot_lenders.get(app.id) or "")
            )
            if app.approval_lender_name:
                lender_obj = lenders.get(app.approval_lender_id or "") or lenders_by_name.get(_norm_name(lender))
            else:
                lender_obj = lenders.get(
                    (pricing_sheet.lender_id if pricing_sheet else None) or snapshot_lenders.get(app.id) or ""
                )
            lender_prefilled = bool(lender)
        if app.user and app.user.role == UserRole.referrer:
            default_uid = app.user.id
        else:
            info = client_referrers.get(app.user_id)
            default_uid = info["id"] if info else None
        settled = settled_on(app)
        first = first_settled.get(app.user_id)
        derived_repeat = bool(first and first < settled)
        derived_new_lead = app.created_at.date().replace(day=1) == settled.replace(day=1)
        brokers = app_brokers.get(app.id, [])
        rows.append(deal_row(
            key=app.id, e=e, settled=settled, customer=_customer_name(app), entity=_entity_name(app),
            kind=category_kind(app), loan_type=app.loan_type.value, sub_type=application_sub_type(app),
            new_lead=e.new_lead if e and e.new_lead is not None else derived_new_lead,
            repeat=e.repeat_customer if e and e.repeat_customer is not None else derived_repeat,
            pricing=pricing, app_amount=app.amount, lender=lender, lender_obj=lender_obj,
            lender_prefilled=lender_prefilled, default_user_id=default_uid, brokers=brokers,
            broker_name=", ".join(users[b].full_name for b in brokers if b in users) or None, is_manual=False,
        ))
    for m in manual:
        if not m.manual_settled_on:
            continue
        broker_user = users.get(m.manual_broker_id or "")
        rows.append(deal_row(
            key=m.application_id, e=m, settled=m.manual_settled_on,
            customer=m.manual_customer_name or m.manual_entity_name or "Unnamed", entity=m.manual_entity_name,
            kind=m.manual_category, loan_type="manual", sub_type=None,
            new_lead=bool(m.new_lead), repeat=bool(m.repeat_customer), pricing={}, app_amount=None,
            lender=m.lender_name, lender_obj=lenders_by_name.get(_norm_name(m.lender_name)) if m.lender_name else None,
            lender_prefilled=False, default_user_id=None,
            brokers=[m.manual_broker_id] if m.manual_broker_id else [],
            broker_name=(broker_user.full_name if broker_user else m.manual_broker_name), is_manual=True,
        ))
    rows.sort(key=lambda r: (r["settled_on"], r["customer_name"].lower()))
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
    # The tier is the whole month's, so it is the same on every row of it.
    return [
        {"month": m, "totals": totals(rs), "vb_month_volume": rs[0].get("vb_month_volume"), "vb_share": rs[0].get("vb_share")}
        for m, rs in sorted(grouped.items())
    ]


_QUARTER_MONTHS = {1: "Jul–Sep", 2: "Oct–Dec", 3: "Jan–Mar", 4: "Apr–Jun"}
HALF_LABELS = {1: "1st – 15th", 2: "After 15th"}


def fy_of(month: str) -> tuple[int, int]:
    """(financial year, quarter) for "YYYY-MM"; the year is the one it ends in
    (Jul 2026 – Jun 2027 is FY 2027), Q1 = Jul–Sep."""
    y, m = (int(p) for p in month.split("-"))
    return (y + 1 if m >= 7 else y), ((m - 7) % 12) // 3 + 1


def fy_label(fy: int) -> str:
    return f"FY {fy - 1}–{str(fy)[2:]} (Jul {fy - 1} – Jun {fy})"


def quarter_label(fy: int, q: int) -> str:
    return f"Qtr {q} · {_QUARTER_MONTHS[q]} {fy - 1 if q <= 2 else fy}"


def month_records(db: Session, tenant_id: str, keys: Iterable[str]) -> dict:
    keys = list(set(keys))
    if not keys:
        return {}
    return {m.month: m for m in db.query(LedgerMonth).filter(LedgerMonth.tenant_id == tenant_id, LedgerMonth.month.in_(keys))}


def _received(totals_: dict, inc: Optional[Decimal]) -> dict:
    """Add the volume bonus received (inc GST, as entered) and final profit to a
    totals dict. Final profit is net profit + the bonus ex GST."""
    ex = _r(inc / (1 + GST_RATE)) if inc is not None else None
    out = dict(totals_)
    out["vb_received_inc_gst"] = _f(inc)
    out["vb_received_ex_gst"] = _f(ex)
    out["final_profit"] = float(_r(_d(totals_.get("net_profit")) + (ex or ZERO)))
    return out


def report(rows: list[dict], records: dict, include_received: bool = True) -> dict:
    """The deals grouped the spreadsheet's way: months (each with its two
    halves), FY quarters and FY years, plus the period total. Rows must be in
    settled order. With include_received False (a referrer's slice of the
    ledger) the month-level bonus received and final profit are left off —
    they belong to the whole month, not part of it."""
    by_month: dict[str, list[dict]] = {}
    for r in rows:
        by_month.setdefault(r["month"], []).append(r)

    def received_of(key: str) -> Optional[Decimal]:
        rec = records.get(key)
        return _d(rec.vb_received_inc_gst) if rec and rec.vb_received_inc_gst is not None else None

    def roll(keys: list[str]) -> dict:
        t = totals([r for k in keys for r in by_month[k]])
        if not include_received:
            return t
        incs = [received_of(k) for k in keys]
        inc = sum((i for i in incs if i is not None), ZERO) if any(i is not None for i in incs) else None
        return _received(t, inc)

    month_out = []
    for key in sorted(by_month):
        rs = by_month[key]
        halves = []
        for half in (1, 2):
            hr = [r for r in rs if r.get("half") == half]
            if hr:
                halves.append({"half": half, "label": HALF_LABELS[half], "application_ids": [r["application_id"] for r in hr], "totals": totals(hr)})
        fy, q = fy_of(key)
        entry = {
            "month": key,
            "fy": fy,
            "quarter": q,
            "halves": halves,
            "totals": roll([key]),
            "vb_month_volume": rs[0].get("vb_month_volume"),
            "vb_share": rs[0].get("vb_share"),
        }
        month_out.append(entry)

    quarters: dict[tuple[int, int], list[str]] = {}
    years: dict[int, list[str]] = {}
    for m in month_out:
        quarters.setdefault((m["fy"], m["quarter"]), []).append(m["month"])
        years.setdefault(m["fy"], []).append(m["month"])
    return {
        "months": month_out,
        "quarters": [
            {"fy": fy, "quarter": q, "label": quarter_label(fy, q), "last_month": ks[-1], "totals": roll(ks)}
            for (fy, q), ks in sorted(quarters.items())
        ],
        "years": [
            {"fy": fy, "label": fy_label(fy), "last_month": ks[-1], "totals": roll(ks)}
            for fy, ks in sorted(years.items())
        ],
        "totals": roll(sorted(by_month)),
    }


def redact_report(rep: dict, access: "LedgerAccess") -> dict:
    out = {
        "months": [],
        "quarters": [{**q, "totals": redact_totals(q["totals"], access)} for q in rep["quarters"]],
        "years": [{**y, "totals": redact_totals(y["totals"], access)} for y in rep["years"]],
        "totals": redact_totals(rep["totals"], access),
    }
    for m in rep["months"]:
        item = {**m, "totals": redact_totals(m["totals"], access),
                "halves": [{**h, "totals": redact_totals(h["totals"], access)} for h in m["halves"]]}
        if not access.can("income"):
            item.pop("vb_month_volume", None)
            item.pop("vb_share", None)
        out["months"].append(item)
    return out


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
    out = {k: v for k, v in row.items() if k not in hidden}
    if "shares" in out and not access.is_owner:
        out["shares"] = [{k: v for k, v in s.items() if k not in _SHARE_PAYMENT_FIELDS} for s in out["shares"]]
    return out


def redact_totals(t: dict, access: LedgerAccess) -> dict:
    hidden = _hidden_fields(access)
    return {k: v for k, v in t.items() if k not in hidden}


def visible_columns(access: LedgerAccess) -> list[dict]:
    return [c for c in COLUMNS if (c["scope"] == "payments" and access.is_owner) or (c["scope"] != "payments" and access.can(c["scope"]))]


# ── Referrers ────────────────────────────────────────────────────────────


def payee_share(row: dict, key: str) -> Optional[dict]:
    return next((s for s in row.get("shares", []) if s["payee_key"] == key), None)


def referrer_summary(rows: list[dict], include_payments: bool) -> list[dict]:
    """Per payee: how many deals they're on in the range, the volume, and
    THEIR share of the commission (a split deal counts once for each payee)."""
    grouped: dict[str, list[tuple[dict, dict]]] = {}
    for r in rows:
        for s in r.get("shares", []):
            grouped.setdefault(s["payee_key"], []).append((r, s))
    out = []
    for key, pairs in grouped.items():
        money = lambda field, ps=pairs: float(_r(sum((_d(s[field]) for _, s in ps), ZERO)))  # noqa: E731
        first = pairs[0][1]
        item = {
            "referrer_id": key,
            "referrer_name": first["payee_name"],
            "referrer_organization": first["payee_organization"],
            "is_portal": key.startswith("u:"),
            "deals": len(pairs),
            "finance_amount": float(_r(sum((_d(r["finance_amount"]) for r, _ in pairs), ZERO))),
            "referrer_comms_ex_gst": money("comms_ex_gst"),
            "referrer_comms_gst": money("comms_gst"),
            "referrer_comms_inc_gst": money("comms_inc_gst"),
        }
        if include_payments:
            unpaid = [(r, s) for r, s in pairs if s["status"] in ("unpaid", "scheduled") and s["comms_ex_gst"]]
            item["unpaid_deals"] = len(unpaid)
            item["unpaid_comms_inc_gst"] = float(_r(sum((_d(s["comms_inc_gst"]) for _, s in unpaid), ZERO)))
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
        "vb_tiers": vb_tiers(settings),
        "vb_tiers_default": DEFAULT_VB_TIERS,
    }


# ── Invoices ─────────────────────────────────────────────────────────────


def payee_party(payee: Optional[LedgerPayee], user: Optional[User], include_bank: bool) -> dict:
    """The supplier block of a commission invoice — a portal referrer's own
    billing profile, or the ledger's record of someone off-portal."""
    if user is not None:
        return referrer_party(user, include_bank)
    party = {
        "id": payee.id,
        "name": payee.company_name or payee.name,
        "contact_name": payee.name,
        "abn": payee.abn,
        "address": payee.address,
        "email": payee.email,
        "gst_registered": payee.gst_registered,
    }
    if include_bank:
        party.update(bank_account_name=payee.bank_account_name, bank_name=payee.bank_name,
                     bank_bsb=payee.bank_bsb, bank_account_number=payee.bank_account_number)
    return party


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
            bank_name=referrer.bank_name,
            bank_bsb=referrer.bank_bsb,
            bank_account_number=referrer.bank_account_number,
        )
    return party


def invoice_totals(rows: list[dict], key: str) -> dict:
    """This payee's share of the deals — never the whole deal's commission."""
    shares = [payee_share(r, key) for r in rows]
    return {f: float(_r(sum((_d(s[f]) for s in shares if s), ZERO))) for f in ("comms_ex_gst", "comms_gst", "comms_inc_gst")}


def invoice_lines(rows: list[dict], key: str, layout: str, period_label: str) -> list[dict]:
    if layout == "single":
        t = invoice_totals(rows, key)
        return [{
            "description": f"Referral commission — {len(rows)} settled deal{'s' if len(rows) != 1 else ''}, {period_label}",
            "amount_ex_gst": t["comms_ex_gst"],
            "gst": t["comms_gst"],
            "amount_inc_gst": t["comms_inc_gst"],
        }]
    lines = []
    for r in rows:
        s = payee_share(r, key) or {}
        lines.append({
            "application_id": r["application_id"],
            "settled_on": r["settled_on"],
            "customer_name": r["customer_name"],
            "entity_name": r["entity_name"],
            "lender_name": r["lender_name"],
            "finance_amount": r["finance_amount"],
            "description": "Referral commission" + (" — your share of a shared deal" if len(r.get("shares", [])) > 1 else ""),
            "amount_ex_gst": s.get("comms_ex_gst", 0.0),
            "gst": s.get("comms_gst", 0.0),
            "amount_inc_gst": s.get("comms_inc_gst", 0.0),
        })
    return lines


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


def to_xlsx(rows: list[dict], rep: dict, columns: list[dict], title: str) -> bytes:
    """The desk's spreadsheet layout: per month a 1st–15th and an after-15th
    section (header, deals, total), the month total with the volume bonus
    received and final profit, quarter totals at each FY quarter's end, year
    totals when the range spans more than one FY, and the period total."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = "Settled deals"
    bold = Font(bold=True)
    head_fill = PatternFill("solid", fgColor="1F2A44")
    fills = {
        "half": PatternFill("solid", fgColor="F4F6F9"),
        "month": PatternFill("solid", fgColor="E3E7EE"),
        "quarter": PatternFill("solid", fgColor="CDD5E1"),
        "year": PatternFill("solid", fgColor="B7C2D3"),
    }
    thin = Side(style="thin", color="C9CED8")
    box = Border(top=thin, bottom=thin, left=thin, right=thin)
    fmt = {"money": '"$"#,##0.00;[Red]-"$"#,##0.00', "date": "DD/MM/YYYY"}
    label_col = next((i for i, c in enumerate(columns, start=1) if c["key"] not in TOTALLED and c["key"] not in PERIOD_ONLY), 1)
    by_id = {r["application_id"]: r for r in rows}

    ws.cell(row=1, column=1, value=title).font = Font(bold=True, size=14)
    r = 3

    def header(row: int) -> None:
        for i, c in enumerate(columns, start=1):
            cell = ws.cell(row=row, column=i, value=c["label"])
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = head_fill
            cell.alignment = Alignment(wrap_text=True, vertical="center")
            cell.border = box

    def total_row(label: str, t: dict, row: int, level: str) -> None:
        ws.cell(row=row, column=label_col, value=label).font = bold
        for i, c in enumerate(columns, start=1):
            cell = ws.cell(row=row, column=i)
            cell.fill = fills[level]
            cell.border = box
            summed = c["key"] in TOTALLED or (level != "half" and c["key"] in PERIOD_ONLY)
            if summed and t.get(c["key"]) is not None:
                cell.value = t[c["key"]]
                cell.number_format = fmt["money"]
                cell.font = bold

    def deal_row(row: dict, at: int) -> None:
        fill = _CATEGORY_FILLS.get(row.get("category") or "")
        for i, c in enumerate(columns, start=1):
            value = None if c["key"] in PERIOD_ONLY else row.get(c["key"])
            if c["kind"] == "date" and value:
                value = date.fromisoformat(value)
            elif c["kind"] == "bool":
                value = "Yes" if value else "No"
            cell = ws.cell(row=at, column=i, value=value)
            cell.border = box
            cell.alignment = Alignment(wrap_text=True, vertical="top")
            if c["kind"] in fmt:
                cell.number_format = fmt[c["kind"]]
            if fill and c["key"] in ("customer_name", "entity_name"):
                cell.fill = PatternFill("solid", fgColor=fill)
            if row.get("is_clawback"):
                cell.font = Font(color="C00000")

    quarter_end = {q["last_month"]: q for q in rep["quarters"]}
    year_end = {y["last_month"]: y for y in rep["years"]} if len(rep["years"]) > 1 else {}
    for m in rep["months"]:
        heading = datetime.strptime(m["month"], "%Y-%m").strftime("%B %Y")
        ws.cell(row=r, column=1, value=heading).font = Font(bold=True, size=12)
        r += 1
        for half in m["halves"]:
            ws.cell(row=r, column=1, value=half["label"]).font = bold
            r += 1
            header(r)
            r += 1
            for app_id in half["application_ids"]:
                if app_id in by_id:
                    deal_row(by_id[app_id], r)
                    r += 1
            total_row(f"Total {half['label']}", half["totals"], r, "half")
            r += 2
        total_row(f"TOTAL {heading}", m["totals"], r, "month")
        r += 2
        if m["month"] in quarter_end:
            q = quarter_end[m["month"]]
            total_row(f"TOTAL {q['label']}", q["totals"], r, "quarter")
            r += 2
        if m["month"] in year_end:
            y = year_end[m["month"]]
            total_row(f"TOTAL {y['label']}", y["totals"], r, "year")
            r += 2

    total_row("TOTAL", rep["totals"], r, "year")

    widths = {"money": 14, "date": 12, "bool": 9, "text": 24}
    for i, c in enumerate(columns, start=1):
        ws.column_dimensions[get_column_letter(i)].width = widths.get(c["kind"], 16)
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
