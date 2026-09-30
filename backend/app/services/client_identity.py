"""Permanent, tenant-scoped links between portal clients and CRM people.

Run reconciliation at startup and keep new accounts linked in their own transaction.
Ambiguous identities get a separate, reviewable profile rather than an unsafe merge.
"""
from __future__ import annotations

import uuid

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from app.models.contact import Contact
from app.models.user import User, UserRole


def key(value: str | None) -> str:
    return " ".join((value or "").strip().lower().split())


def link_client(db: Session, user: User) -> Contact | None:
    if user.role not in (UserRole.client, "client") or user.deleted_at or not user.tenant_id:
        return None
    if user.contact_id:
        return db.query(Contact).filter(Contact.id == user.contact_id, Contact.tenant_id == user.tenant_id).first()
    contacts = db.query(Contact).filter(Contact.tenant_id == user.tenant_id).all()
    contacts += [c for c in db.new if isinstance(c, Contact) and c.tenant_id == user.tenant_id]
    candidates = [c for c in contacts if key(c.email) == key(user.email)]
    matches = [c for c in candidates if key(f"{c.first_name} {c.middle_name or ''} {c.last_name}") == key(user.full_name)
               or key(f"{c.first_name} {c.last_name}") == key(user.full_name)]
    occupied = {cid for (cid,) in db.query(User.contact_id).filter(
        User.tenant_id == user.tenant_id, User.deleted_at.is_(None), User.contact_id.isnot(None),
    )}
    occupied.update(u.contact_id for u in db.new if isinstance(u, User) and u is not user and u.contact_id)
    if len(matches) == 1 and matches[0].id not in occupied:
        contact = matches[0]
    else:
        first, _, last = user.full_name.strip().partition(" ")
        contact = Contact(id=str(uuid.uuid4()), tenant_id=user.tenant_id,
                          first_name=first or "Client", last_name=last, email=user.email,
                          phone=user.phone, needs_identity_review=bool(candidates))
        db.add(contact)
    user.contact = contact
    user.contact_id = contact.id
    return contact


def reconcile_clients(db: Session, tenant_id: str | None = None) -> dict:
    query = db.query(User).filter(User.role == UserRole.client, User.deleted_at.is_(None), User.contact_id.is_(None))
    if tenant_id:
        query = query.filter(User.tenant_id == tenant_id)
    report = {"accounts_linked": 0, "profiles_created": 0, "needs_review": 0}
    for user in query.all():
        contact = link_client(db, user)
        if contact:
            report["accounts_linked"] += 1
            report["profiles_created"] += int(contact in db.new)
            report["needs_review"] += int(bool(contact.needs_identity_review))
            db.flush()
    return report


@event.listens_for(Session, "before_flush")
def maintain_client_identity(db: Session, _context, _instances) -> None:
    # No flush inside this hook. Explicit contact UUIDs let new users and contacts
    # be inserted together, regardless of which account-creation workflow ran.
    for user in list(db.new) + list(db.dirty):
        if not isinstance(user, User) or user.deleted_at or user.role not in (UserRole.client, "client"):
            continue
        contact = link_client(db, user)
        if not contact or user in db.new:
            continue
        state = inspect(user)
        if state.attrs.full_name.history.has_changes() and not any(inspect(contact).attrs[f].history.has_changes() for f in ("first_name", "middle_name", "last_name")):
            contact.first_name, _, contact.last_name = user.full_name.strip().partition(" ")
            contact.middle_name = None
        if state.attrs.phone.history.has_changes():
            contact.phone = user.phone
        email_history = state.attrs.email.history
        if email_history.has_changes() and email_history.deleted and key(contact.email) == key(email_history.deleted[0]):
            contact.email = user.email


def reconcile_application_links(db: Session) -> dict:
    """Only attach an unlinked application when recorded identity corroborates it."""
    from app.models.loan_application import LoanApplication
    from app.models.loan_applicant import LoanApplicant
    report = {"applications_linked": 0, "applicants_linked": 0, "unresolved_applications": 0}
    by_tenant: dict[str, list[Contact]] = {}
    for c in db.query(Contact).all():
        by_tenant.setdefault(c.tenant_id, []).append(c)
    for model, label in ((LoanApplication, "applications_linked"), (LoanApplicant, "applicants_linked")):
        for row in db.query(model).filter(model.contact_id.is_(None)).all():
            tenant_id = row.tenant_id
            if model is LoanApplicant:
                app = db.get(LoanApplication, row.application_id)
                tenant_id = app.tenant_id if app else None
            name = key(f"{row.applicant_first_name or ''} {row.applicant_last_name or ''}")
            email = key(row.applicant_email)
            phone = "".join(ch for ch in (row.applicant_mobile or "") if ch.isdigit())
            matches = [c for c in by_tenant.get(tenant_id, []) if name and key(f"{c.first_name} {c.last_name}") == name
                       and ((email and key(c.email) == email) or (phone and "".join(ch for ch in (c.phone or "") if ch.isdigit()) == phone))]
            if len(matches) == 1:
                row.contact_id = matches[0].id
                report[label] += 1
            elif model is LoanApplication:
                report["unresolved_applications"] += 1
    db.flush()
    return report
