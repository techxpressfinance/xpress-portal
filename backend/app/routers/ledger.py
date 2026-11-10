"""The private commission ledger. See services/ledger.py for who sees what.

Every endpoint runs through ``ledger_access``: no ledger access is a 404 (the
area isn't advertised to people who can't open it), and an impersonation
token is refused even for the owner — "Login as" must never be a way in.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import bearer_scheme, get_current_user
from app.models.ledger import (
    LedgerAuditEvent,
    LedgerDeal,
    LedgerDealShare,
    LedgerGrant,
    LedgerInvoice,
    LedgerMonth,
    LedgerPayee,
    LedgerReceipt,
)
from app.models.user import User, UserRole
from app.schemas.ledger import (
    LedgerBulkPaid,
    LedgerDealUpdate,
    LedgerGrantCreate,
    LedgerGrantUpdate,
    LedgerInvoiceCreate,
    LedgerManualDealCreate,
    LedgerMonthUpdate,
    LedgerPayeeIn,
    LedgerReceiptIn,
    LedgerSettingsUpdate,
    LedgerSharesUpdate,
)
from app.services import ledger as svc
from app.services.auth import decode_token
from app.services.query_utils import active_user_clauses
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/ledger", tags=["ledger"])


def _maybe_access(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    tenant_id: str = Depends(get_tenant_id),
) -> Optional[svc.LedgerAccess]:
    payload = decode_token(credentials.credentials) or {}
    if payload.get("imp"):
        return None
    return svc.resolve_access(db, current_user, tenant_id)


def ledger_access(access: Optional[svc.LedgerAccess] = Depends(_maybe_access)) -> svc.LedgerAccess:
    if access is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return access


def _parse_range(date_from: Optional[str], date_to: Optional[str]) -> tuple[Optional[date], Optional[date]]:
    try:
        start = date.fromisoformat(date_from) if date_from else None
        end = date.fromisoformat(date_to) if date_to else None
    except ValueError:
        raise HTTPException(status_code=400, detail="Dates must be YYYY-MM-DD")
    if start and end and start > end:
        raise HTTPException(status_code=400, detail="The start date is after the end date")
    return start, end


def _report(db: Session, access: svc.LedgerAccess, rows: list[dict], referrer_id: Optional[str]) -> dict:
    """Months (with halves), FY quarters and years, and the period total, redacted."""
    records = svc.month_records(db, access.tenant_id, (r["month"] for r in rows))
    return svc.redact_report(svc.report(rows, records, include_received=not referrer_id), access)


def _key(referrer_id: Optional[str]) -> Optional[str]:
    """A payee key from a filter value — a bare referrer user id still works."""
    if not referrer_id:
        return None
    return referrer_id if referrer_id[:2] in ("u:", "p:") else f"u:{referrer_id}"


def _rows(db: Session, access: svc.LedgerAccess, start, end, referrer_id: Optional[str] = None,
          broker_id: Optional[str] = None) -> list[dict]:
    rows = svc.build_rows(
        db, access.tenant_id,
        svc.settled_applications(db, access.tenant_id, start, end),
        svc.manual_deals(db, access.tenant_id, start, end),
    )
    key = _key(referrer_id)
    if key:
        rows = [r for r in rows if key in r["referrer_keys"]]
    if broker_id:
        rows = [r for r in rows if broker_id in r["broker_ids"]]
    return rows


def _one_row(db: Session, access: svc.LedgerAccess, key: str) -> dict:
    """The ledger row for one deal — a settled application or a ledger-only deal."""
    apps = svc.settled_applications(db, access.tenant_id, None, None, [key])
    manual = svc.manual_deals(db, access.tenant_id, None, None, [key]) if not apps else []
    rows = svc.build_rows(db, access.tenant_id, apps, manual)
    if not rows:
        raise HTTPException(status_code=404, detail="Settled deal not found")
    return rows[0]


def _resolve_payee(db: Session, access: svc.LedgerAccess, key: str) -> LedgerPayee:
    """The payee row for a key, creating the ledger's row for a portal referrer
    the first time they're paid or given ledger-only extras."""
    key = _key(key) or ""
    if key.startswith("u:"):
        user = db.query(User).filter(
            User.id == key[2:], User.tenant_id == access.tenant_id, User.role == UserRole.referrer
        ).first()
        if not user:
            raise HTTPException(status_code=400, detail="Unknown referrer")
        payee = db.query(LedgerPayee).filter(LedgerPayee.tenant_id == access.tenant_id, LedgerPayee.user_id == user.id).first()
        if not payee:
            payee = LedgerPayee(tenant_id=access.tenant_id, user_id=user.id)
            db.add(payee)
            db.flush()
        return payee
    payee = db.query(LedgerPayee).filter(
        LedgerPayee.id == key[2:], LedgerPayee.tenant_id == access.tenant_id, LedgerPayee.user_id.is_(None)
    ).first()
    if not payee:
        raise HTTPException(status_code=400, detail="Unknown payee")
    return payee


def _clear_legacy_payee(entry: LedgerDeal) -> None:
    """Once a deal's payees are saved as shares, the old single-payee fields
    are retired — and referrer_set stops the client's referrer coming back."""
    entry.referrer_set = True
    entry.referrer_id = None
    entry.share_percent = None
    entry.share_amount = None
    entry.share_gst = None
    entry.paid_on = None
    entry.payment_method = None
    entry.payment_notes = None


def _saved_shares(db: Session, access: svc.LedgerAccess, row: dict) -> list[LedgerDealShare]:
    """The deal's shares as rows, writing the implied one (the client's
    referrer, or the deal's pre-split figures) first if nothing is saved yet."""
    key = row["application_id"]
    saved = db.query(LedgerDealShare).filter(
        LedgerDealShare.tenant_id == access.tenant_id, LedgerDealShare.deal_key == key
    ).order_by(LedgerDealShare.sort_order).all()
    if saved or not row["shares"]:
        return saved
    entry = _entry(db, access.tenant_id, key)
    for i, sh in enumerate(row["shares"]):
        payee = _resolve_payee(db, access, sh["payee_key"])
        share = LedgerDealShare(
            tenant_id=access.tenant_id, deal_key=key, payee_id=payee.id, sort_order=i,
            share_percent=Decimal(str(sh["share_percent"])) if sh["share_percent"] is not None else None,
            share_base=sh["share_base"] or "brokerage",
            share_amount=Decimal(str(sh["share_amount"])) if sh["share_amount"] is not None else None,
            share_gst=sh["share_gst"],
            status=sh["status"],
            paid_on=date.fromisoformat(sh["paid_on"]) if sh["paid_on"] else None,
            payment_method=sh["payment_method"],
            payment_notes=sh["payment_notes"],
        )
        db.add(share)
        saved.append(share)
    _clear_legacy_payee(entry)
    db.flush()
    return saved


# ── Access ───────────────────────────────────────────────────────────────


@router.get("/access")
def get_access(access: Optional[svc.LedgerAccess] = Depends(_maybe_access)):
    """Whether to show the ledger at all — the nav asks this. Never 404s."""
    if access is None:
        return {"access": False}
    return {
        "access": True,
        "is_owner": access.is_owner,
        "scopes": sorted(access.scopes) if not access.is_owner else sorted(svc.GRANT_SCOPES) + ["payments"],
        "columns": svc.visible_columns(access),
        "scope_labels": svc.GRANT_SCOPES,
        "categories": svc.CATEGORY_KINDS,
    }


# ── Deals ────────────────────────────────────────────────────────────────


@router.get("/deals")
def list_deals(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    referrer_id: Optional[str] = Query(None),
    broker_id: Optional[str] = Query(None),
    access: svc.LedgerAccess = Depends(ledger_access),
    db: Session = Depends(get_db),
):
    """Settled deals in the range, month subtotals and the period total.
    referrer_id narrows to one payee's deals (each row then carries
    payee_share, their cut); broker_id to one team member's book."""
    if not (access.can("deals") or access.can("summary")):
        raise HTTPException(status_code=403, detail="Not shared with you")
    if referrer_id:
        access.require("referrers")
    start, end = _parse_range(date_from, date_to)
    rows = _rows(db, access, start, end, referrer_id, broker_id)
    out: dict = {"date_from": date_from, "date_to": date_to}
    if access.can("summary"):
        out.update(_report(db, access, rows, referrer_id))
    if access.can("deals"):
        key = _key(referrer_id)
        deals = []
        for r in rows:
            item = svc.redact_row(r, access)
            if key:
                share = next((sh for sh in item.get("shares", []) if sh["payee_key"] == key), None)
                item["payee_share"] = share
            deals.append(item)
        out["deals"] = deals
    return out


@router.get("/brokers")
def ledger_brokers(access: svc.LedgerAccess = Depends(ledger_access), db: Session = Depends(get_db)):
    """Team members whose books the ledger can be narrowed to."""
    users = (
        db.query(User)
        .filter(User.tenant_id == access.tenant_id, User.role.in_([UserRole.admin, UserRole.broker]), *active_user_clauses())
        .order_by(User.full_name)
        .all()
    )
    return [{"id": u.id, "full_name": u.full_name, "role": u.role.value} for u in users]


def _entry(db: Session, tenant_id: str, application_id: str) -> LedgerDeal:
    entry = db.query(LedgerDeal).filter(
        LedgerDeal.tenant_id == tenant_id, LedgerDeal.application_id == application_id
    ).first()
    if not entry:
        entry = LedgerDeal(tenant_id=tenant_id, application_id=application_id)
        db.add(entry)
    return entry


_MONEY = {"finance_amount", "brokerage", "doc_fee", "origination_fee", "vir", "volume_bonus", "share_amount"}


@router.patch("/deals/{application_id}")
def update_deal(
    application_id: str,
    data: LedgerDealUpdate,
    access: svc.LedgerAccess = Depends(ledger_access),
    db: Session = Depends(get_db),
):
    access.require_owner()
    row = _one_row(db, access, application_id)
    changes = data.model_dump(exclude_unset=True)
    manual_fields = {k for k in changes if k.startswith("manual_")}
    if manual_fields and not row["is_manual"]:
        raise HTTPException(status_code=400, detail="Those details come from the application")
    if changes.get("manual_settled_on", True) is None or changes.get("manual_customer_name", "x") in (None, ""):
        raise HTTPException(status_code=400, detail="A ledger-only deal needs a settled date and a customer")
    if changes.get("referrer_id"):
        referrer = db.query(User).filter(
            User.id == changes["referrer_id"], User.tenant_id == access.tenant_id, User.role == UserRole.referrer
        ).first()
        if not referrer:
            raise HTTPException(status_code=400, detail="Unknown referrer")
    entry = _entry(db, access.tenant_id, application_id)
    for field, value in changes.items():
        if field in _MONEY and value is not None:
            value = Decimal(str(value))
        elif field == "share_percent" and value is not None:
            value = Decimal(str(value))
        elif field in ("income_gst", "is_clawback", "referrer_set") and value is None:
            continue  # non-nullable flags: null means "leave as is"
        elif field == "share_base" and value is None:
            continue
        elif field in ("lender_name", "payment_method", "payment_notes", "notes", "manual_customer_name",
                       "manual_entity_name", "manual_broker_name") and isinstance(value, str):
            value = value.strip() or None
        setattr(entry, field, value)
    if changes.get("referrer_set") is False:
        entry.referrer_id = None
    entry.updated_by_id = access.user.id
    svc.audit(db, access, "deal_updated", {"application_id": application_id, "fields": sorted(changes)})
    db.commit()
    return _one_row(db, access, application_id)


@router.post("/deals", status_code=status.HTTP_201_CREATED)
def create_manual_deal(
    data: LedgerManualDealCreate,
    access: svc.LedgerAccess = Depends(ledger_access),
    db: Session = Depends(get_db),
):
    """Add a deal that has no portal application — history, or business
    written outside the portal."""
    access.require_owner()
    entry = LedgerDeal(
        tenant_id=access.tenant_id,
        application_id=str(uuid4()),
        is_manual=True,
        manual_settled_on=data.settled_on,
        manual_customer_name=data.customer_name.strip(),
        manual_entity_name=(data.entity_name or "").strip() or None,
        manual_category=data.category,
        manual_broker_id=data.broker_id,
        manual_broker_name=(data.broker_name or "").strip() or None,
        lender_name=(data.lender_name or "").strip() or None,
        income_gst=data.income_gst,
        is_clawback=data.is_clawback,
        new_lead=data.new_lead,
        repeat_customer=data.repeat_customer,
        notes=(data.notes or "").strip() or None,
        # No client to inherit a referrer from — payees are added as shares.
        referrer_set=True,
        updated_by_id=access.user.id,
    )
    for field in ("finance_amount", "brokerage", "doc_fee", "origination_fee", "vir", "volume_bonus"):
        value = getattr(data, field)
        setattr(entry, field, Decimal(str(value)) if value is not None else None)
    db.add(entry)
    svc.audit(db, access, "manual_deal_created", {"application_id": entry.application_id})
    db.commit()
    return _one_row(db, access, entry.application_id)


@router.put("/deals/{application_id}/shares")
def set_deal_shares(
    application_id: str,
    data: LedgerSharesUpdate,
    access: svc.LedgerAccess = Depends(ledger_access),
    db: Session = Depends(get_db),
):
    """Who is paid on this deal and how much — replaces the deal's payees.
    One deal can pay several people (e.g. 33% / 67% between partners)."""
    access.require_owner()
    _one_row(db, access, application_id)
    keys = [_key(sh.payee_key) for sh in data.shares]
    if len(set(keys)) != len(keys):
        raise HTTPException(status_code=400, detail="Each payee can only appear once on a deal")
    for sh in data.shares:
        if sh.status == "paid" and not sh.paid_on:
            raise HTTPException(status_code=400, detail="A paid share needs the date it was paid")
        if sh.status == "scheduled" and not sh.scheduled_on:
            raise HTTPException(status_code=400, detail="A scheduled payment needs its date")
    entry = _entry(db, access.tenant_id, application_id)
    db.query(LedgerDealShare).filter(
        LedgerDealShare.tenant_id == access.tenant_id, LedgerDealShare.deal_key == application_id
    ).delete()
    for i, sh in enumerate(data.shares):
        payee = _resolve_payee(db, access, sh.payee_key)
        db.add(LedgerDealShare(
            tenant_id=access.tenant_id, deal_key=application_id, payee_id=payee.id, sort_order=i,
            share_percent=Decimal(str(sh.share_percent)) if sh.share_percent is not None else None,
            share_base=sh.share_base,
            share_amount=Decimal(str(sh.share_amount)) if sh.share_amount is not None else None,
            share_gst=sh.share_gst,
            status=sh.status,
            scheduled_on=sh.scheduled_on if sh.status == "scheduled" else None,
            paid_on=sh.paid_on if sh.status == "paid" else None,
            payment_method=(sh.payment_method or "").strip() or None,
            payment_reference=(sh.payment_reference or "").strip() or None,
            payment_notes=(sh.payment_notes or "").strip() or None,
        ))
    _clear_legacy_payee(entry)
    entry.updated_by_id = access.user.id
    svc.audit(db, access, "deal_shares_set", {"application_id": application_id, "payees": len(data.shares)})
    db.commit()
    return _one_row(db, access, application_id)


@router.delete("/deals/{application_id}")
def reset_deal(
    application_id: str,
    access: svc.LedgerAccess = Depends(ledger_access),
    db: Session = Depends(get_db),
):
    """Throw away everything entered for a deal — it goes back to prefills.
    A ledger-only deal has nothing to go back to, so it is deleted."""
    access.require_owner()
    row = _one_row(db, access, application_id)
    db.query(LedgerDealShare).filter(
        LedgerDealShare.tenant_id == access.tenant_id, LedgerDealShare.deal_key == application_id
    ).delete()
    db.query(LedgerDeal).filter(
        LedgerDeal.tenant_id == access.tenant_id, LedgerDeal.application_id == application_id
    ).delete()
    svc.audit(db, access, "manual_deal_deleted" if row["is_manual"] else "deal_reset", {"application_id": application_id})
    db.commit()
    if row["is_manual"]:
        return {"deleted": True, "application_id": application_id}
    return _one_row(db, access, application_id)


@router.post("/deals/mark-paid")
def mark_paid(
    data: LedgerBulkPaid,
    access: svc.LedgerAccess = Depends(ledger_access),
    db: Session = Depends(get_db),
):
    """Set the payment status of one payee's share (or every payee's) across
    several deals — paid on a date, scheduled for one, or not payable."""
    access.require_owner()
    ids = list(dict.fromkeys(data.application_ids))
    apps = svc.settled_applications(db, access.tenant_id, None, None, ids)
    manual = svc.manual_deals(db, access.tenant_id, None, None, ids)
    rows = svc.build_rows(db, access.tenant_id, apps, manual)
    if len(rows) != len(ids):
        raise HTTPException(status_code=400, detail="Some of those deals are not settled deals of this tenant")
    target = _key(data.payee_key)
    updated = 0
    for row in rows:
        if target and target not in row["referrer_keys"]:
            raise HTTPException(status_code=400, detail=f"Not this payee's deal: {row['customer_name']}")
        shares = _saved_shares(db, access, row)
        target_payee_id = _resolve_payee(db, access, target).id if target else None
        for sh in shares:
            if target_payee_id and sh.payee_id != target_payee_id:
                continue
            sh.status = data.status
            sh.paid_on = data.paid_on if data.status == "paid" else None
            sh.scheduled_on = data.scheduled_on if data.status == "scheduled" else None
            if data.payment_method is not None:
                sh.payment_method = data.payment_method.strip() or None
            if data.payment_reference is not None:
                sh.payment_reference = data.payment_reference.strip() or None
            if data.payment_notes is not None:
                sh.payment_notes = data.payment_notes.strip() or None
            updated += 1
    svc.audit(db, access, "deals_marked_paid", {
        "application_ids": ids, "payee": target, "status": data.status, "paid_on": data.paid_on,
    })
    db.commit()
    return {"updated": updated}


# ── Referrers ────────────────────────────────────────────────────────────


@router.get("/referrers")
def referrer_report(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    access: svc.LedgerAccess = Depends(ledger_access),
    db: Session = Depends(get_db),
):
    """How many deals each referrer brought in the range, and what they're owed."""
    access.require("referrers")
    start, end = _parse_range(date_from, date_to)
    return svc.referrer_summary(_rows(db, access, start, end), include_payments=access.is_owner)


@router.get("/referrer-options")
def referrer_options(
    access: svc.LedgerAccess = Depends(ledger_access),
    db: Session = Depends(get_db),
):
    """Every referrer in the tenant, for the owner's referrer picker."""
    access.require_owner()
    users = (
        db.query(User)
        .filter(User.tenant_id == access.tenant_id, User.role == UserRole.referrer, *active_user_clauses())
        .order_by(User.full_name)
        .all()
    )
    return [{"id": u.id, "full_name": u.full_name, "organization_name": u.organization_name,
             "gst_registered": u.business_gst_registered} for u in users]


def _payee_out(payee: Optional[LedgerPayee], user: Optional[User], include_bank: bool) -> dict:
    party = svc.payee_party(payee, user, include_bank)
    return {
        "key": svc.payee_key(payee, user.id if user else None),
        "payee_id": payee.id if payee else None,
        "user_id": user.id if user else None,
        "is_portal": user is not None,
        "name": user.full_name if user else (payee.name if payee else None),
        "organization_name": user.organization_name if user else (payee.company_name if payee else None),
        "gst_registered": party.get("gst_registered"),
        "party": party,
        "phone": (user.phone if user else payee.phone) if (user or payee) else None,
        "notes": payee.notes if payee else None,
        "default_share_percent": float(payee.default_share_percent) if payee and payee.default_share_percent is not None else None,
        "default_share_base": payee.default_share_base if payee else "brokerage",
        "default_share_amount": float(payee.default_share_amount) if payee and payee.default_share_amount is not None else None,
        "is_active": (payee.is_active if payee else True),
    }


@router.get("/payees")
def list_payees(access: svc.LedgerAccess = Depends(ledger_access), db: Session = Depends(get_db)):
    """Everyone commission can be paid to: the tenant's portal referrers and
    the ledger's own off-portal payees."""
    access.require("referrers")
    users = (
        db.query(User)
        .filter(User.tenant_id == access.tenant_id, User.role == UserRole.referrer, *active_user_clauses())
        .order_by(User.full_name)
        .all()
    )
    payees = db.query(LedgerPayee).filter(LedgerPayee.tenant_id == access.tenant_id).all()
    by_user = {p.user_id: p for p in payees if p.user_id}
    out = [_payee_out(by_user.get(u.id), u, access.is_owner) for u in users]
    out += [_payee_out(p, None, access.is_owner) for p in payees if not p.user_id]
    out.sort(key=lambda p: (not p["is_active"], (p["name"] or "").lower()))
    return out


@router.post("/payees", status_code=status.HTTP_201_CREATED)
def create_payee(data: LedgerPayeeIn, access: svc.LedgerAccess = Depends(ledger_access), db: Session = Depends(get_db)):
    """Someone to pay who has no portal login."""
    access.require_owner()
    if not (data.name or "").strip() and not (data.company_name or "").strip():
        raise HTTPException(status_code=400, detail="A payee needs a name")
    payee = LedgerPayee(tenant_id=access.tenant_id)
    _apply_payee(payee, data, portal=False)
    db.add(payee)
    svc.audit(db, access, "payee_created", {"payee_id": payee.id})
    db.commit()
    return _payee_out(payee, None, True)


def _apply_payee(payee: LedgerPayee, data: LedgerPayeeIn, portal: bool) -> None:
    fields = data.model_dump(exclude_unset=True)
    # A portal referrer's identity and bank details are their own profile.
    allowed = {"notes", "default_share_percent", "default_share_base", "default_share_amount", "is_active"}
    for field, value in fields.items():
        if portal and field not in allowed:
            continue
        if isinstance(value, str):
            value = value.strip() or None
        if field in ("default_share_percent", "default_share_amount") and value is not None:
            value = Decimal(str(value))
        if field == "default_share_base" and value is None:
            continue
        if field == "is_active" and value is None:
            continue
        setattr(payee, field, value)


@router.patch("/payees/{key}")
def update_payee(key: str, data: LedgerPayeeIn, access: svc.LedgerAccess = Depends(ledger_access),
                 db: Session = Depends(get_db)):
    access.require_owner()
    payee = _resolve_payee(db, access, key)
    user = db.get(User, payee.user_id) if payee.user_id else None
    _apply_payee(payee, data, portal=user is not None)
    svc.audit(db, access, "payee_updated", {"payee_id": payee.id})
    db.commit()
    return _payee_out(payee, user, True)


# ── Receipts ─────────────────────────────────────────────────────────────


def _receipt_out(r: LedgerReceipt) -> dict:
    return {"id": r.id, "received_on": r.received_on.isoformat(), "from_name": r.from_name,
            "amount": float(r.amount), "reference": r.reference, "notes": r.notes}


@router.get("/receipts")
def list_receipts(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    access: svc.LedgerAccess = Depends(ledger_access),
    db: Session = Depends(get_db),
):
    """Money received from other parties in the range, with a total per payer."""
    access.require("income")
    start, end = _parse_range(date_from, date_to)
    q = db.query(LedgerReceipt).filter(LedgerReceipt.tenant_id == access.tenant_id)
    if start:
        q = q.filter(LedgerReceipt.received_on >= start)
    if end:
        q = q.filter(LedgerReceipt.received_on <= end)
    items = q.order_by(LedgerReceipt.received_on.desc(), LedgerReceipt.created_at.desc()).all()
    by_payer: dict[str, Decimal] = {}
    for r in items:
        by_payer[r.from_name] = by_payer.get(r.from_name, Decimal("0")) + r.amount
    return {
        "receipts": [_receipt_out(r) for r in items],
        "by_payer": [{"from_name": k, "amount": float(v)} for k, v in sorted(by_payer.items(), key=lambda kv: -kv[1])],
        "total": float(sum((r.amount for r in items), Decimal("0"))),
    }


@router.post("/receipts", status_code=status.HTTP_201_CREATED)
def create_receipt(data: LedgerReceiptIn, access: svc.LedgerAccess = Depends(ledger_access), db: Session = Depends(get_db)):
    access.require_owner()
    r = LedgerReceipt(
        tenant_id=access.tenant_id, received_on=data.received_on, from_name=data.from_name.strip(),
        amount=Decimal(str(data.amount)), reference=(data.reference or "").strip() or None,
        notes=(data.notes or "").strip() or None, created_by_id=access.user.id,
    )
    db.add(r)
    svc.audit(db, access, "receipt_created", {"amount": data.amount, "from": data.from_name})
    db.commit()
    return _receipt_out(r)


@router.put("/receipts/{receipt_id}")
def update_receipt(receipt_id: str, data: LedgerReceiptIn, access: svc.LedgerAccess = Depends(ledger_access),
                   db: Session = Depends(get_db)):
    access.require_owner()
    r = db.query(LedgerReceipt).filter(LedgerReceipt.id == receipt_id, LedgerReceipt.tenant_id == access.tenant_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Receipt not found")
    r.received_on, r.from_name, r.amount = data.received_on, data.from_name.strip(), Decimal(str(data.amount))
    r.reference = (data.reference or "").strip() or None
    r.notes = (data.notes or "").strip() or None
    svc.audit(db, access, "receipt_updated", {"receipt_id": r.id})
    db.commit()
    return _receipt_out(r)


@router.delete("/receipts/{receipt_id}")
def delete_receipt(receipt_id: str, access: svc.LedgerAccess = Depends(ledger_access), db: Session = Depends(get_db)):
    access.require_owner()
    r = db.query(LedgerReceipt).filter(LedgerReceipt.id == receipt_id, LedgerReceipt.tenant_id == access.tenant_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Receipt not found")
    svc.audit(db, access, "receipt_deleted", {"amount": float(r.amount), "from": r.from_name})
    db.delete(r)
    db.commit()
    return {"ok": True}


# ── Export ───────────────────────────────────────────────────────────────


@router.get("/export.xlsx")
def export_xlsx(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    referrer_id: Optional[str] = Query(None),
    broker_id: Optional[str] = Query(None),
    columns: Optional[str] = Query(None, max_length=2000),
    access: svc.LedgerAccess = Depends(ledger_access),
    db: Session = Depends(get_db),
):
    access.require("export")
    access.require("deals")
    if referrer_id:
        access.require("referrers")
    start, end = _parse_range(date_from, date_to)
    cols = svc.pick_columns(columns, access)
    raw = _rows(db, access, start, end, referrer_id, broker_id)
    rep_ = _report(db, access, raw, referrer_id)
    rows = [svc.redact_row(r, access) for r in raw]
    title = f"Settled deals — {svc.period_label(start, end)}"
    content = svc.to_xlsx(rows, rep_, cols, title)
    svc.audit(db, access, "exported", {"format": "xlsx", "from": start, "to": end, "columns": [c["key"] for c in cols]})
    db.commit()
    stamp = "-".join(filter(None, [date_from, date_to])) or "all"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="Settled-deals-{stamp}.xlsx"'},
    )


@router.post("/export-logged")
def log_pdf_export(
    access: svc.LedgerAccess = Depends(ledger_access),
    db: Session = Depends(get_db),
):
    """The PDF is drawn in the browser; this records that it was taken."""
    access.require("export")
    svc.audit(db, access, "exported", {"format": "pdf"})
    db.commit()
    return {"ok": True}


# ── Months ───────────────────────────────────────────────────────────────


@router.put("/months/{month}")
def set_month(
    month: str,
    data: LedgerMonthUpdate,
    access: svc.LedgerAccess = Depends(ledger_access),
    db: Session = Depends(get_db),
):
    """Record the volume bonus the aggregator paid for a month (inc GST), or
    clear it with null."""
    access.require_owner()
    try:
        datetime.strptime(month, "%Y-%m")
    except ValueError:
        raise HTTPException(status_code=400, detail="Month must be YYYY-MM")
    rec = db.query(LedgerMonth).filter(LedgerMonth.tenant_id == access.tenant_id, LedgerMonth.month == month).first()
    if not rec:
        rec = LedgerMonth(tenant_id=access.tenant_id, month=month)
        db.add(rec)
    value = data.vb_received_inc_gst
    rec.vb_received_inc_gst = Decimal(str(value)).quantize(Decimal("0.01")) if value is not None else None
    rec.updated_by_id = access.user.id
    svc.audit(db, access, "month_updated", {"month": month, "vb_received_inc_gst": value})
    db.commit()
    return {"month": month, "vb_received_inc_gst": value}


# ── Invoices ─────────────────────────────────────────────────────────────


def _invoice_out(inv: LedgerInvoice, access: svc.LedgerAccess) -> dict:
    snapshot = json.loads(inv.snapshot)
    if not access.is_owner:
        # Where the referrer is paid is the owner's business.
        for key in ("bank_account_name", "bank_name", "bank_bsb", "bank_account_number"):
            snapshot.get("supplier", {}).pop(key, None)
    return {
        "id": inv.id,
        "number": inv.number,
        "referrer_id": inv.referrer_id,
        "payee_id": inv.payee_id,
        "issue_date": inv.issue_date.isoformat(),
        "period_from": inv.period_from.isoformat() if inv.period_from else None,
        "period_to": inv.period_to.isoformat() if inv.period_to else None,
        "layout": inv.layout,
        "total_ex_gst": float(inv.total_ex_gst),
        "total_gst": float(inv.total_gst),
        "total_inc_gst": float(inv.total_inc_gst),
        "created_at": inv.created_at.isoformat(),
        **snapshot,
    }


@router.get("/invoices")
def list_invoices(
    referrer_id: Optional[str] = Query(None),
    access: svc.LedgerAccess = Depends(ledger_access),
    db: Session = Depends(get_db),
):
    access.require("invoices")
    access.require("referrers")
    q = db.query(LedgerInvoice).filter(LedgerInvoice.tenant_id == access.tenant_id)
    key = _key(referrer_id)
    if key:
        ident = key[2:]
        payee = db.query(LedgerPayee).filter(LedgerPayee.tenant_id == access.tenant_id, (
            LedgerPayee.user_id == ident) if key.startswith("u:") else (LedgerPayee.id == ident)).first()
        clauses = [LedgerInvoice.referrer_id == ident]
        if payee:
            clauses.append(LedgerInvoice.payee_id == payee.id)
        q = q.filter(or_(*clauses))
    return [_invoice_out(i, access) for i in q.order_by(LedgerInvoice.created_at.desc()).limit(500)]


@router.get("/invoices/{invoice_id}")
def get_invoice(
    invoice_id: str,
    access: svc.LedgerAccess = Depends(ledger_access),
    db: Session = Depends(get_db),
):
    access.require("invoices")
    access.require("referrers")
    inv = db.query(LedgerInvoice).filter(
        LedgerInvoice.id == invoice_id, LedgerInvoice.tenant_id == access.tenant_id
    ).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return _invoice_out(inv, access)


@router.post("/invoices", status_code=status.HTTP_201_CREATED)
def create_invoice(
    data: LedgerInvoiceCreate,
    access: svc.LedgerAccess = Depends(ledger_access),
    db: Session = Depends(get_db),
):
    """Number and keep a referrer's commission invoice for the chosen deals.

    Every deal must currently be attributed to that referrer — the invoice is
    what we owe them, so it can't carry somebody else's deal."""
    access.require_owner()
    key = _key(data.referrer_id)
    payee = _resolve_payee(db, access, key)
    user = db.get(User, payee.user_id) if payee.user_id else None
    ids = list(dict.fromkeys(data.application_ids))
    rows = svc.build_rows(
        db, access.tenant_id,
        svc.settled_applications(db, access.tenant_id, None, None, ids),
        svc.manual_deals(db, access.tenant_id, None, None, ids),
    )
    if len(rows) != len(ids):
        raise HTTPException(status_code=400, detail="Some of those deals are not settled deals of this tenant")
    stray = [r["customer_name"] for r in rows if key not in r["referrer_keys"]]
    if stray:
        raise HTTPException(status_code=400, detail=f"Not this payee's deal: {', '.join(stray)}")

    settings = access.settings
    number = f"{settings.invoice_prefix}{settings.next_invoice_number:04d}"
    settings.next_invoice_number += 1
    t = svc.invoice_totals(rows, key)
    snapshot = {
        "supplier": svc.payee_party(payee, user, include_bank=True),
        "recipient": {k: v for k, v in svc.settings_out(settings, db).items()
                      if k in ("business_name", "business_abn", "business_address", "business_email")},
        "lines": svc.invoice_lines(rows, key, data.layout, svc.period_label(data.period_from, data.period_to)),
        "deal_count": len(rows),
        "application_ids": [r["application_id"] for r in rows],
        "period_label": svc.period_label(data.period_from, data.period_to),
    }
    inv = LedgerInvoice(
        tenant_id=access.tenant_id,
        number=number,
        referrer_id=user.id if user else payee.id,
        payee_id=payee.id,
        issue_date=data.issue_date or date.today(),
        period_from=data.period_from,
        period_to=data.period_to,
        layout=data.layout,
        snapshot=json.dumps(snapshot, default=str),
        total_ex_gst=Decimal(str(t["comms_ex_gst"])),
        total_gst=Decimal(str(t["comms_gst"])),
        total_inc_gst=Decimal(str(t["comms_inc_gst"])),
        created_by_id=access.user.id,
    )
    db.add(inv)
    svc.audit(db, access, "invoice_created", {"number": number, "payee": key, "deals": len(rows)})
    db.commit()
    db.refresh(inv)
    return _invoice_out(inv, access)


@router.delete("/invoices/{invoice_id}")
def delete_invoice(
    invoice_id: str,
    access: svc.LedgerAccess = Depends(ledger_access),
    db: Session = Depends(get_db),
):
    """Void an invoice raised in error. Its number is not reused."""
    access.require_owner()
    inv = db.query(LedgerInvoice).filter(
        LedgerInvoice.id == invoice_id, LedgerInvoice.tenant_id == access.tenant_id
    ).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    svc.audit(db, access, "invoice_deleted", {"number": inv.number})
    db.delete(inv)
    db.commit()
    return {"ok": True}


# ── Settings ─────────────────────────────────────────────────────────────


@router.get("/settings")
def get_settings(access: svc.LedgerAccess = Depends(ledger_access), db: Session = Depends(get_db)):
    access.require_owner()
    return svc.settings_out(access.settings, db)


@router.put("/settings")
def update_settings(
    data: LedgerSettingsUpdate,
    access: svc.LedgerAccess = Depends(ledger_access),
    db: Session = Depends(get_db),
):
    access.require_owner()
    for field, value in data.model_dump(exclude_unset=True).items():
        if isinstance(value, str):
            value = value.strip() or None
        if field == "invoice_prefix" and value is None:
            value = ""
        if field == "next_invoice_number" and value is None:
            continue
        if field == "vb_tiers":
            # An empty list puts the defaults back.
            value = json.dumps(sorted(value, key=lambda t: t["min_volume"])) if value else None
        setattr(access.settings, field, value)
    svc.audit(db, access, "settings_updated", {"fields": sorted(data.model_dump(exclude_unset=True))})
    db.commit()
    return svc.settings_out(access.settings, db)


# ── Sharing ──────────────────────────────────────────────────────────────


def _grant_out(g: LedgerGrant, users: dict[str, User]) -> dict:
    u = users.get(g.user_id)
    now = datetime.now(timezone.utc)
    return {
        "id": g.id,
        "user_id": g.user_id,
        "user_name": u.full_name if u else "Removed user",
        "user_email": u.email if u else None,
        "user_role": u.role.value if u else None,
        "scopes": sorted(svc.parse_scopes(g.scopes)),
        "created_at": g.created_at.isoformat(),
        "active_from": svc._aware(g.active_from).isoformat(),
        "revoked_at": g.revoked_at.isoformat() if g.revoked_at else None,
        "state": "revoked" if g.revoked_at else ("active" if svc.grant_is_live(g, now) else "waiting"),
    }


@router.get("/team")
def team_options(access: svc.LedgerAccess = Depends(ledger_access), db: Session = Depends(get_db)):
    """Staff the owner could share the ledger with."""
    access.require_owner()
    users = (
        db.query(User)
        .filter(
            User.tenant_id == access.tenant_id,
            User.role == UserRole.admin,
            User.is_active.is_(True),
            User.id != access.user.id,
            *active_user_clauses(),
        )
        .order_by(User.full_name)
        .all()
    )
    return [{"id": u.id, "full_name": u.full_name, "email": u.email, "role": u.role.value} for u in users]


@router.get("/grants")
def list_grants(access: svc.LedgerAccess = Depends(ledger_access), db: Session = Depends(get_db)):
    access.require_owner()
    grants = (
        db.query(LedgerGrant)
        .filter(LedgerGrant.tenant_id == access.tenant_id)
        .order_by(LedgerGrant.created_at.desc())
        .all()
    )
    users = {u.id: u for u in db.query(User).filter(User.id.in_({g.user_id for g in grants}))} if grants else {}
    # The ledger is admin-only: a grant held by anyone who isn't an admin (made
    # before that rule, or since demoted) already opens nothing — close it so
    # the owner's list says so.
    stale = [g for g in grants if g.revoked_at is None and (users.get(g.user_id) is None or users[g.user_id].role != UserRole.admin)]
    if stale:
        now = datetime.now(timezone.utc)
        for g in stale:
            g.revoked_at = now
            svc.audit(db, access, "grant_revoked", {"user_id": g.user_id, "reason": "not an admin"})
        db.commit()
    return [_grant_out(g, users) for g in grants]


@router.post("/grants", status_code=status.HTTP_201_CREATED)
def create_grant(
    data: LedgerGrantCreate,
    access: svc.LedgerAccess = Depends(ledger_access),
    db: Session = Depends(get_db),
):
    """Share the ledger with a team member. It opens to them 24 hours from now.

    Second-factor confirmation (mobile + email codes) slots in here, before the
    grant is written — deferred for now."""
    access.require_owner()
    scopes = svc.parse_scopes(data.scopes)
    if not scopes:
        raise HTTPException(status_code=400, detail="Choose at least one thing to share")
    user = db.query(User).filter(
        User.id == data.user_id,
        User.tenant_id == access.tenant_id,
        User.role == UserRole.admin,
        User.is_active.is_(True),
    ).first()
    if not user or user.id == access.user.id:
        raise HTTPException(status_code=400, detail="Choose an admin on the team")
    existing = db.query(LedgerGrant).filter(
        LedgerGrant.tenant_id == access.tenant_id, LedgerGrant.user_id == user.id, LedgerGrant.revoked_at.is_(None)
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"{user.full_name} already has access — change it or revoke it")
    now = datetime.now(timezone.utc)
    grant = LedgerGrant(
        tenant_id=access.tenant_id,
        user_id=user.id,
        scopes=",".join(sorted(scopes)),
        granted_by_id=access.user.id,
        created_at=now,
        active_from=now + svc.LEDGER_GRANT_DELAY,
    )
    db.add(grant)
    svc.audit(db, access, "grant_created", {"user_id": user.id, "scopes": sorted(scopes)})
    db.commit()
    return _grant_out(grant, {user.id: user})


@router.patch("/grants/{grant_id}")
def update_grant(
    grant_id: str,
    data: LedgerGrantUpdate,
    access: svc.LedgerAccess = Depends(ledger_access),
    db: Session = Depends(get_db),
):
    """Narrow what a grant shows — takes effect at once. Widening it would
    skip the 24-hour wait, so that is a revoke and a fresh grant instead."""
    access.require_owner()
    grant = db.query(LedgerGrant).filter(
        LedgerGrant.id == grant_id, LedgerGrant.tenant_id == access.tenant_id, LedgerGrant.revoked_at.is_(None)
    ).first()
    if not grant:
        raise HTTPException(status_code=404, detail="Grant not found")
    scopes = svc.parse_scopes(data.scopes)
    if not scopes:
        raise HTTPException(status_code=400, detail="Choose at least one thing to share, or revoke instead")
    if not scopes <= svc.parse_scopes(grant.scopes):
        raise HTTPException(
            status_code=400,
            detail="Sharing more needs a fresh grant (and its 24-hour wait) — revoke this one and grant again",
        )
    grant.scopes = ",".join(sorted(scopes))
    svc.audit(db, access, "grant_narrowed", {"grant_id": grant.id, "scopes": sorted(scopes)})
    db.commit()
    users = {u.id: u for u in db.query(User).filter(User.id == grant.user_id)}
    return _grant_out(grant, users)


@router.delete("/grants/{grant_id}")
def revoke_grant(
    grant_id: str,
    access: svc.LedgerAccess = Depends(ledger_access),
    db: Session = Depends(get_db),
):
    access.require_owner()
    grant = db.query(LedgerGrant).filter(
        LedgerGrant.id == grant_id, LedgerGrant.tenant_id == access.tenant_id, LedgerGrant.revoked_at.is_(None)
    ).first()
    if not grant:
        raise HTTPException(status_code=404, detail="Grant not found")
    grant.revoked_at = datetime.now(timezone.utc)
    svc.audit(db, access, "grant_revoked", {"grant_id": grant.id, "user_id": grant.user_id})
    db.commit()
    return {"ok": True}


@router.get("/audit")
def audit_log(access: svc.LedgerAccess = Depends(ledger_access), db: Session = Depends(get_db)):
    access.require_owner()
    events = (
        db.query(LedgerAuditEvent)
        .filter(LedgerAuditEvent.tenant_id == access.tenant_id)
        .order_by(LedgerAuditEvent.created_at.desc())
        .limit(300)
        .all()
    )
    names = dict(db.query(User.id, User.full_name).filter(User.id.in_({e.actor_id for e in events if e.actor_id})))
    return [{
        "id": e.id,
        "action": e.action,
        "actor_name": names.get(e.actor_id or "", "—"),
        "detail": json.loads(e.detail) if e.detail else None,
        "created_at": e.created_at.isoformat(),
    } for e in events]

