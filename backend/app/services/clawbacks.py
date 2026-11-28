"""Clawbacks: brokerage a lender takes back on a settled loan.

A clawback is recorded against the file (the application) by anyone on the
team and is visible to the whole team — on the application, the client and
the entity. Recording one raises a client alert on the loan's client (the
"Client alerts" tab of the application's notes, which every one of that
client's applications shows), kept in step with the clawback while it exists.
The private ledger reads clawbacks itself (services/ledger.py) and shows each
as a negative row in the month it happened.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Iterable, Optional

from sqlalchemy.orm import Session, joinedload

from app.models.application_clawback import ApplicationClawback
from app.models.client_alert import ClientAlert
from app.models.loan_application import LoanApplication
from app.models.user import User


def _money(value: Decimal) -> str:
    return f"${value:,.2f}"


def _loan_label(app: LoanApplication) -> str:
    """"Jane Citizen's loan with Macquarie, settled 03/09/2026" — enough to
    tell which file it is from an alert shown on any of the client's loans."""
    from app.services.ledger import _customer_name

    who = _customer_name(app)
    parts = [f"{who}'s loan" if who else "Loan"]
    if app.approval_lender_name:
        parts.append(f"with {app.approval_lender_name}")
    if app.settled_at:
        parts.append(f"settled {app.settled_at.strftime('%d/%m/%Y')}")
    return " ".join(parts)


def alert_text(app: LoanApplication, cb: ApplicationClawback) -> str:
    text = (
        f"Clawback: {_money(Decimal(cb.amount))} brokerage (ex GST) clawed back on "
        f"{cb.clawback_date.strftime('%d/%m/%Y')} — {_loan_label(app)}."
    )
    if cb.reason and cb.reason.strip():
        text += f" Reason: {cb.reason.strip()}"
    return text


def _sync_alert(db: Session, app: LoanApplication, cb: ApplicationClawback, author_id: str,
                high_priority: Optional[bool]) -> None:
    """Raise the clawback's client alert, or bring its wording up to date. An
    alert someone deleted by hand is not brought back on a later edit."""
    alert = db.get(ClientAlert, cb.client_alert_id) if cb.client_alert_id else None
    if alert is None:
        if cb.client_alert_id is not None or not app.user_id:
            return
        alert = ClientAlert(
            tenant_id=cb.tenant_id, client_id=app.user_id, author_id=author_id,
            content=alert_text(app, cb), is_high_priority=True if high_priority is None else high_priority,
        )
        db.add(alert)
        db.flush()
        cb.client_alert_id = alert.id
        return
    alert.content = alert_text(app, cb)
    if high_priority is not None:
        alert.is_high_priority = high_priority


def create(db: Session, app: LoanApplication, user: User, *, clawback_date: date, amount: Decimal,
           reason: Optional[str], high_priority: bool) -> ApplicationClawback:
    cb = ApplicationClawback(
        tenant_id=app.tenant_id, application_id=app.id, clawback_date=clawback_date, amount=amount,
        reason=(reason or "").strip() or None, created_by_id=user.id, updated_by_id=user.id,
    )
    db.add(cb)
    db.flush()
    _sync_alert(db, app, cb, user.id, high_priority)
    return cb


def update(db: Session, app: LoanApplication, cb: ApplicationClawback, user: User, changes: dict) -> None:
    if "clawback_date" in changes and changes["clawback_date"] is not None:
        cb.clawback_date = changes["clawback_date"]
    if "amount" in changes and changes["amount"] is not None:
        cb.amount = changes["amount"]
    if "reason" in changes:
        cb.reason = (changes["reason"] or "").strip() or None
    cb.updated_by_id = user.id
    db.flush()
    _sync_alert(db, app, cb, user.id, changes.get("high_priority"))


def delete(db: Session, cb: ApplicationClawback) -> None:
    """Remove a clawback, its client alert, and whatever the ledger owner
    entered against its ledger row."""
    from app.models.ledger import LedgerDeal, LedgerDealShare

    if cb.client_alert_id:
        alert = db.get(ClientAlert, cb.client_alert_id)
        if alert is not None:
            db.delete(alert)
    db.query(LedgerDealShare).filter(LedgerDealShare.tenant_id == cb.tenant_id, LedgerDealShare.deal_key == cb.id).delete()
    db.query(LedgerDeal).filter(LedgerDeal.tenant_id == cb.tenant_id, LedgerDeal.application_id == cb.id).delete()
    db.delete(cb)


def serialize(cb: ApplicationClawback, app: Optional[LoanApplication] = None,
              alert_high: Optional[bool] = None) -> dict:
    app = app or cb.application
    return {
        "id": cb.id,
        "application_id": cb.application_id,
        "loan_label": _loan_label(app) if app is not None else None,
        "clawback_date": cb.clawback_date.isoformat(),
        "amount": float(cb.amount),
        "reason": cb.reason,
        "client_alert_id": cb.client_alert_id,
        "alert_high_priority": alert_high,
        "created_by_name": cb.created_by.full_name if cb.created_by else None,
        "updated_by_name": cb.updated_by.full_name if cb.updated_by else None,
        "created_at": cb.created_at.isoformat() if cb.created_at else None,
        "updated_at": cb.updated_at.isoformat() if cb.updated_at else None,
    }


def list_for(db: Session, tenant_id: str, *, application_ids: Optional[Iterable[str]] = None,
             contact_id: Optional[str] = None, organization_id: Optional[str] = None) -> list[dict]:
    """Clawbacks on one file, or across a client's or an entity's loans —
    newest first. Trashed applications are left out."""
    q = (
        db.query(ApplicationClawback)
        .join(LoanApplication, LoanApplication.id == ApplicationClawback.application_id)
        .options(joinedload(ApplicationClawback.application), joinedload(ApplicationClawback.created_by),
                 joinedload(ApplicationClawback.updated_by))
        .filter(ApplicationClawback.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None))
    )
    if application_ids is not None:
        q = q.filter(ApplicationClawback.application_id.in_(list(application_ids)))
    if contact_id is not None:
        q = q.filter(LoanApplication.contact_id == contact_id)
    if organization_id is not None:
        q = q.filter(LoanApplication.business_organization_id == organization_id)
    items = q.order_by(ApplicationClawback.clawback_date.desc(), ApplicationClawback.created_at.desc()).all()
    alert_ids = [c.client_alert_id for c in items if c.client_alert_id]
    highs = dict(db.query(ClientAlert.id, ClientAlert.is_high_priority).filter(ClientAlert.id.in_(alert_ids))) if alert_ids else {}
    return [serialize(c, c.application, highs.get(c.client_alert_id or "")) for c in items]
