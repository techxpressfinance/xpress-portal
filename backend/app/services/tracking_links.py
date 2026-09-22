"""No-login progress links — for referrers who ring the desk, and borrowers.

A referrer has one standing link that lists every deal they are credited with;
a deal has one link for its borrower. Both open a read-only page and nothing
else: no session is issued, nothing can be changed, and the page shows only
what the person it was sent to already knows plus where the deal is up to.
Anyone holding the link sees that page, which is the trade made for "no login"
— so what goes on it is kept to the progress and the basics of the loan, and a
leaked link is killed by regenerating it.

What each page may show:
- Referrer: per deal, the client's name, the loan type and amount, the journey
  (phase, whose move, how long) and any documents still outstanding. Never the
  stage title, the team or the lender — the same rule as the referrer portal
  (see services/journey.py).
- Borrower: their own deal's basics, the journey told to them, what we are
  waiting on from them, and who their broker is. No personal details beyond
  their name: no DOB, ID, income, address or bank details.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import FRONTEND_URL
from app.models.document_request import DocumentRequest
from app.models.external_referral import ExternalReferral
from app.models.lead import Lead, LeadStatus
from app.models.loan_application import LoanApplication
from app.models.referral import Referral
from app.models.tracking_link import TrackingLink
from app.models.user import SETUP_PLACEHOLDER_HASHES, User, UserRole
from app.services import journey
from app.services.loan_category import application_asset_details, application_loan_category, application_sub_type

KIND_REFERRER = "referrer"
KIND_DEAL = "deal"

CATEGORY_LABELS = {"asset_finance": "Asset Finance", "home_loan": "Home Loan", "commercial": "Commercial"}


# ── Links ────────────────────────────────────────────────────────────────


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def link_url(link: TrackingLink) -> str:
    return f"{FRONTEND_URL}/track/{link.token}"


def _active_query(db: Session, tenant_id: str, kind: str, **target: Optional[str]):
    query = db.query(TrackingLink).filter(
        TrackingLink.tenant_id == tenant_id,
        TrackingLink.kind == kind,
        TrackingLink.revoked_at.is_(None),
    )
    for column in ("referrer_id", "application_id", "lead_id"):
        value = target.get(column)
        attr = getattr(TrackingLink, column)
        query = query.filter(attr == value if value else attr.is_(None))
    return query


def get_or_create(
    db: Session,
    tenant_id: str,
    kind: str,
    *,
    referrer_id: Optional[str] = None,
    application_id: Optional[str] = None,
    lead_id: Optional[str] = None,
    created_by_id: Optional[str] = None,
) -> TrackingLink:
    """The target's live link, minting one if it has none. Flushes, does not
    commit."""
    target = {"referrer_id": referrer_id, "application_id": application_id, "lead_id": lead_id}
    link = _active_query(db, tenant_id, kind, **target).order_by(TrackingLink.created_at.desc()).first()
    if link:
        return link
    token = secrets.token_urlsafe(24)
    link = TrackingLink(
        tenant_id=tenant_id,
        kind=kind,
        token=token,
        token_hash=_hash(token),
        created_by_id=created_by_id,
        **target,
    )
    db.add(link)
    db.flush()
    return link


def regenerate(
    db: Session,
    tenant_id: str,
    kind: str,
    *,
    referrer_id: Optional[str] = None,
    application_id: Optional[str] = None,
    lead_id: Optional[str] = None,
    created_by_id: Optional[str] = None,
) -> TrackingLink:
    """Kill every live link for the target and mint a fresh one — for a link
    that has gone somewhere it shouldn't. Does not commit."""
    target = {"referrer_id": referrer_id, "application_id": application_id, "lead_id": lead_id}
    now = datetime.now(timezone.utc)
    for old in _active_query(db, tenant_id, kind, **target).all():
        old.revoked_at = now
    db.flush()
    return get_or_create(db, tenant_id, kind, created_by_id=created_by_id, **target)


def resolve(db: Session, tenant_id: str, token: str) -> Optional[TrackingLink]:
    if not token or len(token) > 100:
        return None
    return (
        db.query(TrackingLink)
        .filter(
            TrackingLink.token_hash == _hash(token),
            TrackingLink.tenant_id == tenant_id,
            TrackingLink.revoked_at.is_(None),
        )
        .first()
    )


def link_dict(link: TrackingLink) -> dict:
    return {
        "url": link_url(link),
        "created_at": link.created_at,
        "last_opened_at": link.last_opened_at,
        "open_count": link.open_count,
    }


# ── Who the referrer is ──────────────────────────────────────────────────


def application_referrer(db: Session, application: LoanApplication) -> Optional[User]:
    """The referrer partner credited with an application, or None.

    In order: the owner themselves when a referrer submitted it; the owner's
    client-level credit (an ExternalReferral, else a referrer-role Referral —
    the same precedence as referrer_info_map); else the referrer tagged on the
    lead it was converted from, since a converted lead's application is
    staff-owned and carries no client-level credit."""
    owner = db.query(User).filter(User.id == application.user_id).first()
    if owner and owner.role == UserRole.referrer:
        return owner
    ext = (
        db.query(ExternalReferral)
        .filter(ExternalReferral.referred_client_id == application.user_id)
        .first()
    )
    if ext and ext.referrer:
        return ext.referrer
    ref = db.query(Referral).filter(Referral.referred_user_id == application.user_id).first()
    if ref and ref.referrer and ref.referrer.role == UserRole.referrer:
        return ref.referrer
    lead = (
        db.query(Lead)
        .filter(Lead.converted_application_id == application.id, Lead.referrer_id.isnot(None))
        .first()
    )
    return lead.referrer if lead else None


def referrer_deals(db: Session, tenant_id: str, referrer_id: str) -> tuple[list[LoanApplication], list[Lead]]:
    """Every live application and unconverted lead a referrer is credited with."""
    ext_clients = db.query(ExternalReferral.referred_client_id).filter(
        ExternalReferral.referrer_id == referrer_id,
        ExternalReferral.referred_client_id.isnot(None),
    )
    ref_clients = db.query(Referral.referred_user_id).filter(
        Referral.referrer_id == referrer_id,
        Referral.referred_user_id.isnot(None),
    )
    lead_apps = db.query(Lead.converted_application_id).filter(
        Lead.tenant_id == tenant_id,
        Lead.referrer_id == referrer_id,
        Lead.converted_application_id.isnot(None),
    )
    applications = (
        db.query(LoanApplication)
        .filter(
            LoanApplication.tenant_id == tenant_id,
            LoanApplication.deleted_at.is_(None),
            or_(
                LoanApplication.user_id == referrer_id,
                LoanApplication.user_id.in_(ext_clients),
                LoanApplication.user_id.in_(ref_clients),
                LoanApplication.id.in_(lead_apps),
            ),
        )
        .order_by(LoanApplication.created_at.desc())
        .all()
    )
    leads = (
        db.query(Lead)
        .filter(
            Lead.tenant_id == tenant_id,
            Lead.referrer_id == referrer_id,
            Lead.deleted_at.is_(None),
            Lead.status.in_([LeadStatus.open, LeadStatus.lost]),
        )
        .order_by(Lead.created_at.desc())
        .all()
    )
    return applications, leads


# ── What the pages show ──────────────────────────────────────────────────


def _humanize(value: Optional[str]) -> Optional[str]:
    return value.replace("_", " ").capitalize() if value else None


def _amount(value) -> Optional[float]:
    return float(value) if value is not None else None


def _asset_line(application: LoanApplication) -> Optional[str]:
    asset = application_asset_details(application)
    if not asset:
        return None
    vehicle = " ".join(str(asset[k]) for k in ("year", "make", "model") if asset.get(k))
    return vehicle or asset.get("description") or _humanize(asset.get("equipment_type"))


def _broker(db: Session, application: Optional[LoanApplication] = None, lead: Optional[Lead] = None) -> Optional[dict]:
    broker: Optional[User] = None
    if application is not None:
        broker = application.brokers[0] if application.brokers else None
        if broker is None and application.assigned_broker_id:
            broker = db.query(User).filter(User.id == application.assigned_broker_id).first()
    elif lead is not None:
        broker = lead.assigned_broker
    if broker is None:
        return None
    return {"name": broker.full_name, "email": broker.email, "phone": broker.phone}


def _outstanding_documents(db: Session, application: LoanApplication) -> list[str]:
    rows = (
        db.query(DocumentRequest.description)
        .filter(DocumentRequest.application_id == application.id, DocumentRequest.status == "pending")
        .order_by(DocumentRequest.created_at)
        .all()
    )
    return [description for (description,) in rows]


def application_card(db: Session, application: LoanApplication) -> dict:
    name = " ".join(filter(None, [application.applicant_first_name, application.applicant_last_name])).strip()
    category = application_loan_category(application)
    status = application.status.value if hasattr(application.status, "value") else application.status
    return {
        "type": "application",
        "reference": application.id[:8].upper(),
        "client_name": name or application.business_name or None,
        "business_name": application.business_name,
        "category": CATEGORY_LABELS.get(category or "", None),
        "loan_type": _humanize(application_sub_type(application)) or _humanize(application.loan_type.value),
        "amount": _amount(application.amount),
        "term_months": application.loan_term_requested,
        "asset": _asset_line(application),
        "created_at": application.created_at,
        "settled": status == "settled",
        "journey": journey.summary(db, application),
        "outstanding_documents": _outstanding_documents(db, application),
    }


def lead_card(db: Session, lead: Lead) -> dict:
    return {
        "type": "lead",
        "reference": lead.id[:8].upper(),
        "client_name": " ".join(filter(None, [lead.first_name, lead.last_name])).strip() or None,
        "business_name": lead.company_name,
        "category": CATEGORY_LABELS.get(lead.loan_category),
        "loan_type": _humanize(lead.sub_type),
        "amount": _amount(lead.amount),
        "term_months": None,
        "asset": None,
        "created_at": lead.created_at,
        "settled": False,
        "journey": journey.lead_summary(db, lead),
        "outstanding_documents": [],
    }


def deal_target(db: Session, link: TrackingLink) -> tuple[Optional[LoanApplication], Optional[Lead]]:
    """What a deal link points at now. A lead link follows its lead into the
    application it became; a deleted target is no deal at all."""
    lead = None
    application_id = link.application_id
    if link.lead_id:
        lead = db.query(Lead).filter(Lead.id == link.lead_id, Lead.deleted_at.is_(None)).first()
        if lead is None:
            return None, None
        application_id = application_id or lead.converted_application_id
    if application_id:
        application = (
            db.query(LoanApplication)
            .filter(LoanApplication.id == application_id, LoanApplication.deleted_at.is_(None))
            .first()
        )
        return application, None
    return None, lead


def _closed_last(card: dict) -> tuple:
    """Live deals first, newest first; then settled and closed ones."""
    done = card["settled"] or bool(card["journey"].get("closed"))
    created = card["created_at"]
    return (done, -(created.timestamp() if created else 0))


# ── Referrer portal login ────────────────────────────────────────────────
# The progress link and the portal login travel together in one email, but the
# link itself never logs anyone in: it is a bearer link that gets forwarded, so
# the most a holder can do is have a password link sent to the referrer's own
# inbox. Setup and reset tokens are only ever emailed, never returned.

LOGIN_SETUP_PENDING = "setup_pending"
LOGIN_ACTIVE = "active"
LOGIN_INACTIVE = "inactive"

# Sent by the desk, often with the referrer on the phone, so they last long
# enough to be used later that day or week. Self-serve requests from the
# progress page keep the standard forgot-password window.
STAFF_SETUP_TTL = timedelta(days=7)
STAFF_RESET_TTL = timedelta(hours=24)
SELF_SERVE_SETUP_TTL = timedelta(hours=48)
SELF_SERVE_RESET_TTL = timedelta(hours=1)


def login_state(user: User) -> str:
    if not user.is_active:
        return LOGIN_INACTIVE
    if user.password_hash in SETUP_PLACEHOLDER_HASHES:
        return LOGIN_SETUP_PENDING
    return LOGIN_ACTIVE


def issue_login_link(user: User, *, staff: bool) -> Optional[dict]:
    """Mint the link that gets this user into the portal, or None for an
    inactive account.

    Never set up → a fresh setup link, which replaces any earlier invite (the
    setup endpoint only honours the newest token). Already set up → a password
    reset link. Returned for emailing only — callers must not send it back
    over the API."""
    state = login_state(user)
    if state == LOGIN_INACTIVE:
        return None
    now = datetime.now(timezone.utc)
    token = secrets.token_urlsafe(32)
    if state == LOGIN_SETUP_PENDING:
        ttl = STAFF_SETUP_TTL if staff else SELF_SERVE_SETUP_TTL
        user.email_verification_token = token
        user.email_verification_token_expires_at = now + ttl
        return {"action": "setup", "url": f"{FRONTEND_URL}/setup-account?token={token}", "ttl": ttl}
    ttl = STAFF_RESET_TTL if staff else SELF_SERVE_RESET_TTL
    user.password_reset_token = token
    user.password_reset_token_expires_at = now + ttl
    return {"action": "reset", "url": f"{FRONTEND_URL}/reset-password?token={token}", "ttl": ttl}


def mask_email(email: str) -> str:
    """j•••@acme.com — enough for the person to recognise their own inbox, not
    enough for whoever holds a forwarded link to learn the address."""
    local, _, domain = email.partition("@")
    return f"{local[:1]}•••@{domain}" if domain else "your email"


def referrer_page(db: Session, tenant_id: str, referrer: User) -> dict:
    applications, leads = referrer_deals(db, tenant_id, referrer.id)
    cards = [application_card(db, a) for a in applications] + [lead_card(db, lead) for lead in leads]
    cards.sort(key=_closed_last)
    return {
        "kind": KIND_REFERRER,
        "referrer": {
            "name": referrer.full_name,
            "organization_name": getattr(referrer, "organization_name", None),
            # Only whether to say "set up" or "log in" — no address, no token.
            "has_login": login_state(referrer) == LOGIN_ACTIVE,
        },
        "deals": cards,
    }


def deal_page(db: Session, application: Optional[LoanApplication], lead: Optional[Lead]) -> dict:
    card = application_card(db, application) if application is not None else lead_card(db, lead)
    first_name = application.applicant_first_name if application is not None else lead.first_name
    return {
        "kind": KIND_DEAL,
        "first_name": first_name,
        "deal": card,
        "broker": _broker(db, application=application, lead=lead),
    }


def record_open(link: TrackingLink) -> None:
    link.last_opened_at = datetime.now(timezone.utc)
    link.open_count = (link.open_count or 0) + 1
