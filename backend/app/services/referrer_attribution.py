"""Which referrer partner is credited with which application — and the trail.

Credit is per application (``LoanApplication.referrer_id``): a client can come
to us through different referrers for different loans. Two things set it:

* **At creation** — the referrer who submitted it, else the referrer on the lead
  it was converted from, else the client's referrer (the partner who introduced
  the client: an ExternalReferral, else a referrer-role Referral). That
  client-level link is only ever the *default* for new applications.
* **Staff** — changing or removing it on one application, with an optional note.

Every credit is recorded in ``application_referrer_changes`` and every staff
change in the activity log. A referrer sees, is emailed about and has tracking
links for only the applications credited to them (or that they own).
"""
from __future__ import annotations

from typing import Iterable, Optional

from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.application_referrer_change import ApplicationReferrerChange
from app.models.external_referral import ExternalReferral
from app.models.lead import Lead
from app.models.loan_application import LoanApplication
from app.models.referral import Referral
from app.models.user import User, UserRole
from app.services.activity_log import log_activity

SOURCE_LABELS = {
    "created": "Credited when the application was created",
    "changed": "Changed",
    "backfill": "Carried over from the client's referrer",
}


def referrer_dict(user: Optional[User]) -> Optional[dict]:
    if user is None:
        return None
    return {
        "id": user.id,
        "full_name": user.full_name,
        "email": user.email,
        "phone": user.phone,
        "organization_name": getattr(user, "organization_name", None),
    }


def _is_referrer(user: Optional[User]) -> bool:
    return bool(user) and user.role == UserRole.referrer


def client_referrer(db: Session, user_id: Optional[str]) -> Optional[User]:
    """The partner who introduced a client — the default for their new
    applications. An ExternalReferral wins over a Referral; Referral rows are
    also written for admin/broker invite links, so only a referrer counts."""
    if not user_id:
        return None
    ext = (
        db.query(ExternalReferral)
        .filter(ExternalReferral.referred_client_id == user_id)
        .order_by(ExternalReferral.created_at)
        .first()
    )
    if ext and ext.referrer and _is_referrer(ext.referrer):
        return ext.referrer
    for ref in db.query(Referral).filter(Referral.referred_user_id == user_id).order_by(Referral.created_at):
        if _is_referrer(ref.referrer):
            return ref.referrer
    return None


def default_referrer_id(db: Session, owner: Optional[User], lead: Optional[Lead] = None) -> Optional[str]:
    """Who a new application credits: the referrer who owns (submitted) it, the
    referrer on the lead it came from, else whoever introduced the client."""
    if _is_referrer(owner):
        return owner.id
    if lead is not None and lead.referrer_id:
        return lead.referrer_id
    ref = client_referrer(db, owner.id if owner else None)
    return ref.id if ref else None


def stamp_initial_referrer(db: Session, app: LoanApplication, actor: Optional[User] = None,
                           lead: Optional[Lead] = None, referrer_id: Optional[str] = None) -> Optional[str]:
    """Credit a just-created application (flushed, so it has an id) and record
    it. ``referrer_id`` overrides the default (e.g. a clone keeps its source's)."""
    if referrer_id is None:
        owner = app.user or (db.get(User, app.user_id) if app.user_id else None)
        # A staff-made application is owned by the broker; its client is the
        # contact it was made for, whose portal account carries the referral.
        if owner is not None and owner.role not in (UserRole.client, UserRole.referrer) and app.contact_id:
            owner = db.query(User).filter(
                User.contact_id == app.contact_id, User.role == UserRole.client, User.deleted_at.is_(None),
            ).first() or owner
        referrer_id = default_referrer_id(db, owner, lead)
    app.referrer_id = referrer_id
    if referrer_id:
        db.add(ApplicationReferrerChange(
            tenant_id=app.tenant_id, application_id=app.id, from_referrer_id=None, to_referrer_id=referrer_id,
            changed_by_id=actor.id if actor else None, source="created",
        ))
    return referrer_id


def _load_referrer(db: Session, referrer_id: str, tenant_id: Optional[str]) -> User:
    referrer = db.query(User).filter(
        User.id == referrer_id,
        User.tenant_id == tenant_id,
        User.role == UserRole.referrer,
        User.deleted_at.is_(None),
    ).first()
    if not referrer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Referrer not found")
    return referrer


def set_application_referrer(db: Session, app: LoanApplication, referrer_id: Optional[str], actor: User,
                             note: Optional[str] = None) -> bool:
    """Staff change one application's referrer (None = no referrer). Recorded
    in the history and the activity log. Returns False when nothing changed."""
    if referrer_id:
        _load_referrer(db, referrer_id, app.tenant_id)
    previous = app.referrer_id
    if previous == referrer_id:
        return False
    note = (note or "").strip() or None
    app.referrer_id = referrer_id
    db.add(ApplicationReferrerChange(
        tenant_id=app.tenant_id, application_id=app.id, from_referrer_id=previous, to_referrer_id=referrer_id,
        changed_by_id=actor.id, source="changed", note=note,
    ))
    log_activity(db, actor.id, "application_referrer_changed", "application", app.id,
                 {"from_referrer_id": previous, "to_referrer_id": referrer_id, "note": note}, tenant_id=app.tenant_id)
    return True


def referrer_history(db: Session, tenant_id: str, app_ids: Iterable[str]) -> list[dict]:
    """The credit trail for these applications, newest first, with names."""
    ids = [i for i in set(app_ids) if i]
    if not ids:
        return []
    rows = (
        db.query(ApplicationReferrerChange)
        .filter(ApplicationReferrerChange.tenant_id == tenant_id, ApplicationReferrerChange.application_id.in_(ids))
        .order_by(ApplicationReferrerChange.created_at.desc())
        .all()
    )
    user_ids = {u for r in rows for u in (r.from_referrer_id, r.to_referrer_id, r.changed_by_id) if u}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids))} if user_ids else {}

    def name(uid: Optional[str]) -> Optional[str]:
        u = users.get(uid) if uid else None
        return (u.full_name or u.email) if u else None

    return [{
        "id": r.id,
        "application_id": r.application_id,
        "from_referrer": {"id": r.from_referrer_id, "full_name": name(r.from_referrer_id)} if r.from_referrer_id else None,
        "to_referrer": {"id": r.to_referrer_id, "full_name": name(r.to_referrer_id),
                        "organization_name": getattr(users.get(r.to_referrer_id), "organization_name", None)}
        if r.to_referrer_id else None,
        "changed_by_name": name(r.changed_by_id),
        "source": r.source,
        "source_label": SOURCE_LABELS.get(r.source, r.source),
        "note": r.note,
        "created_at": r.created_at,
    } for r in rows]


def referrer_users_map(db: Session, referrer_ids: Iterable[Optional[str]]) -> dict[str, dict]:
    """Referrer info for many applications in one query, keyed by referrer id."""
    ids = {i for i in referrer_ids if i}
    if not ids:
        return {}
    return {u.id: referrer_dict(u) for u in db.query(User).filter(User.id.in_(ids))}


def credited_application_filter(referrer_id: str):
    """SQL filter: the applications a referrer may see — credited to them, or
    their own (a self-managed referrer submits in their own name)."""
    return or_(LoanApplication.referrer_id == referrer_id, LoanApplication.user_id == referrer_id)


def referrer_client_ids(db: Session, referrer_id: str) -> set[str]:
    """Clients a referrer is connected to: introduced by them, or with an
    application credited to them. Used for messaging between the two."""
    ids = {r[0] for r in db.query(ExternalReferral.referred_client_id).filter(
        ExternalReferral.referrer_id == referrer_id, ExternalReferral.referred_client_id.isnot(None))}
    ids |= {r[0] for r in db.query(Referral.referred_user_id).filter(
        Referral.referrer_id == referrer_id, Referral.referred_user_id.isnot(None))}
    # A credited application's client: its owner when a client owns it, else
    # (staff-made applications are owned by the broker) the portal account of
    # the contact it was made for.
    credited = db.query(LoanApplication.user_id, LoanApplication.contact_id).filter(
        LoanApplication.referrer_id == referrer_id, LoanApplication.deleted_at.is_(None)).all()
    owner_ids = {u for u, _ in credited if u and u != referrer_id}
    contact_ids = {c for _, c in credited if c}
    if owner_ids or contact_ids:
        ids |= {u.id for u in db.query(User.id).filter(
            User.role == UserRole.client,
            or_(User.id.in_(owner_ids), User.contact_id.in_(contact_ids)),
        )}
    return ids
