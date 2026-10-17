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

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import bearer_scheme, get_current_user
from app.models.ledger import LedgerAuditEvent, LedgerDeal, LedgerGrant, LedgerInvoice
from app.models.user import User, UserRole
from app.schemas.ledger import (
    LedgerBulkPaid,
    LedgerDealUpdate,
    LedgerGrantCreate,
    LedgerGrantUpdate,
    LedgerInvoiceCreate,
    LedgerSettingsUpdate,
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


def _rows(db: Session, access: svc.LedgerAccess, start, end, referrer_id: Optional[str] = None) -> list[dict]:
    rows = svc.build_rows(db, access.tenant_id, svc.settled_applications(db, access.tenant_id, start, end))
    if referrer_id:
        rows = [r for r in rows if r["referrer_id"] == referrer_id]
    return rows


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
    access: svc.LedgerAccess = Depends(ledger_access),
    db: Session = Depends(get_db),
):
    """Settled deals in the range, month subtotals and the period total."""
    if not (access.can("deals") or access.can("summary")):
        raise HTTPException(status_code=403, detail="Not shared with you")
    if referrer_id:
        access.require("referrers")
    start, end = _parse_range(date_from, date_to)
    rows = _rows(db, access, start, end, referrer_id)
    out: dict = {"date_from": date_from, "date_to": date_to}
    if access.can("summary"):
        out["totals"] = svc.redact_totals(svc.totals(rows), access)
        out["months"] = [{"month": m["month"], "totals": svc.redact_totals(m["totals"], access)} for m in svc.months(rows)]
    if access.can("deals"):
        out["deals"] = [svc.redact_row(r, access) for r in rows]
    return out


def _settled_app_or_404(db: Session, tenant_id: str, application_id: str):
    apps = svc.settled_applications(db, tenant_id, None, None, [application_id])
    if not apps:
        raise HTTPException(status_code=404, detail="Settled deal not found")
    return apps[0]


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
    app = _settled_app_or_404(db, access.tenant_id, application_id)
    changes = data.model_dump(exclude_unset=True)
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
        elif field in ("lender_name", "payment_method", "payment_notes") and isinstance(value, str):
            value = value.strip() or None
        setattr(entry, field, value)
    if changes.get("referrer_set") is False:
        entry.referrer_id = None
    entry.updated_by_id = access.user.id
    svc.audit(db, access, "deal_updated", {"application_id": application_id, "fields": sorted(changes)})
    db.commit()
    return svc.build_rows(db, access.tenant_id, [app])[0]


@router.delete("/deals/{application_id}")
def reset_deal(
    application_id: str,
    access: svc.LedgerAccess = Depends(ledger_access),
    db: Session = Depends(get_db),
):
    """Throw away everything entered for a deal — it goes back to prefills."""
    access.require_owner()
    app = _settled_app_or_404(db, access.tenant_id, application_id)
    db.query(LedgerDeal).filter(
        LedgerDeal.tenant_id == access.tenant_id, LedgerDeal.application_id == application_id
    ).delete()
    svc.audit(db, access, "deal_reset", {"application_id": application_id})
    db.commit()
    return svc.build_rows(db, access.tenant_id, [app])[0]


@router.post("/deals/mark-paid")
def mark_paid(
    data: LedgerBulkPaid,
    access: svc.LedgerAccess = Depends(ledger_access),
    db: Session = Depends(get_db),
):
    access.require_owner()
    apps = svc.settled_applications(db, access.tenant_id, None, None, data.application_ids)
    if len(apps) != len(set(data.application_ids)):
        raise HTTPException(status_code=400, detail="Some of those deals are not settled deals of this tenant")
    for app in apps:
        entry = _entry(db, access.tenant_id, app.id)
        entry.paid_on = data.paid_on
        if data.payment_method is not None:
            entry.payment_method = data.payment_method.strip() or None
        if data.payment_notes is not None:
            entry.payment_notes = data.payment_notes.strip() or None
        entry.updated_by_id = access.user.id
    svc.audit(db, access, "deals_marked_paid", {"application_ids": [a.id for a in apps], "paid_on": data.paid_on})
    db.commit()
    return {"updated": len(apps)}


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


# ── Export ───────────────────────────────────────────────────────────────


@router.get("/export.xlsx")
def export_xlsx(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    referrer_id: Optional[str] = Query(None),
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
    rows = [svc.redact_row(r, access) for r in _rows(db, access, start, end, referrer_id)]
    month_list = [{"month": m["month"], "totals": svc.redact_totals(m["totals"], access)} for m in svc.months(rows)]
    title = f"Settled deals — {svc.period_label(start, end)}"
    content = svc.to_xlsx(rows, month_list, svc.redact_totals(svc.totals(rows), access), cols, title)
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


# ── Invoices ─────────────────────────────────────────────────────────────


def _invoice_out(inv: LedgerInvoice, access: svc.LedgerAccess) -> dict:
    snapshot = json.loads(inv.snapshot)
    if not access.is_owner:
        # Where the referrer is paid is the owner's business.
        for key in ("bank_account_name", "bank_bsb", "bank_account_number"):
            snapshot.get("supplier", {}).pop(key, None)
    return {
        "id": inv.id,
        "number": inv.number,
        "referrer_id": inv.referrer_id,
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
    if referrer_id:
        q = q.filter(LedgerInvoice.referrer_id == referrer_id)
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
    referrer = db.query(User).filter(
        User.id == data.referrer_id, User.tenant_id == access.tenant_id, User.role == UserRole.referrer
    ).first()
    if not referrer:
        raise HTTPException(status_code=400, detail="Unknown referrer")
    apps = svc.settled_applications(db, access.tenant_id, None, None, data.application_ids)
    if len(apps) != len(set(data.application_ids)):
        raise HTTPException(status_code=400, detail="Some of those deals are not settled deals of this tenant")
    rows = svc.build_rows(db, access.tenant_id, apps)
    stray = [r["customer_name"] for r in rows if r["referrer_id"] != referrer.id]
    if stray:
        raise HTTPException(status_code=400, detail=f"Not this referrer's deal: {', '.join(stray)}")

    settings = access.settings
    number = f"{settings.invoice_prefix}{settings.next_invoice_number:04d}"
    settings.next_invoice_number += 1
    t = svc.totals(rows)
    snapshot = {
        "supplier": svc.referrer_party(referrer, include_bank=True),
        "recipient": {k: v for k, v in svc.settings_out(settings, db).items()
                      if k in ("business_name", "business_abn", "business_address", "business_email")},
        "lines": svc.invoice_lines(rows, data.layout, svc.period_label(data.period_from, data.period_to)),
        "deal_count": len(rows),
        "application_ids": [r["application_id"] for r in rows],
        "period_label": svc.period_label(data.period_from, data.period_to),
    }
    inv = LedgerInvoice(
        tenant_id=access.tenant_id,
        number=number,
        referrer_id=referrer.id,
        issue_date=data.issue_date or date.today(),
        period_from=data.period_from,
        period_to=data.period_to,
        layout=data.layout,
        snapshot=json.dumps(snapshot, default=str),
        total_ex_gst=Decimal(str(t["referrer_comms_ex_gst"])),
        total_gst=Decimal(str(t["referrer_comms_gst"])),
        total_inc_gst=Decimal(str(t["referrer_comms_inc_gst"])),
        created_by_id=access.user.id,
    )
    db.add(inv)
    svc.audit(db, access, "invoice_created", {"number": number, "referrer_id": referrer.id, "deals": len(rows)})
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
            User.role.in_([UserRole.admin, UserRole.broker]),
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
        User.role.in_([UserRole.admin, UserRole.broker]),
        User.is_active.is_(True),
    ).first()
    if not user or user.id == access.user.id:
        raise HTTPException(status_code=400, detail="Choose an admin or broker on the team")
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

