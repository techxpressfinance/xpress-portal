"""Staff side of the no-login progress links (see services/tracking_links.py).

Every endpoint is a POST: fetching a target's link mints one if it has none, so
even "show me the link" writes a row. Admin and broker only — the link is a
credential for someone else's view, so it is never handed to clients or
referrers through the API (they receive it by email or from the desk).
"""
from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_role
from app.models.lead import Lead
from app.models.loan_application import LoanApplication
from app.models.tracking_link import TrackingLink
from app.models.user import User, UserRole
from app.services import tracking_links as links
from app.services.activity_log import log_activity
from app.services.email import send_tracking_link_email
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/tracking-links", tags=["tracking-links"])

Audience = Literal["client", "referrer"]


def _usable_email(email: Optional[str]) -> Optional[str]:
    return email if email and not email.endswith("@deleted.invalid") else None


def _out(link: TrackingLink, audience: str, recipient: Optional[User] = None, *, name: Optional[str] = None, email: Optional[str] = None) -> dict:
    return {
        "audience": audience,
        **links.link_dict(link),
        "recipient_name": recipient.full_name if recipient else name,
        "recipient_email": _usable_email(recipient.email if recipient else email),
    }


def _referrer(referrer_id: str, tenant_id: str, db: Session) -> User:
    referrer = db.query(User).filter(
        User.id == referrer_id,
        User.tenant_id == tenant_id,
        User.role == UserRole.referrer,
        User.deleted_at.is_(None),
    ).first()
    if not referrer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Referrer not found")
    return referrer


def _application(application_id: str, tenant_id: str, db: Session) -> LoanApplication:
    application = db.query(LoanApplication).filter(
        LoanApplication.id == application_id,
        LoanApplication.tenant_id == tenant_id,
        LoanApplication.deleted_at.is_(None),
    ).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    return application


def _lead(lead_id: str, tenant_id: str, db: Session) -> Lead:
    lead = db.query(Lead).filter(Lead.id == lead_id, Lead.tenant_id == tenant_id, Lead.deleted_at.is_(None)).first()
    if not lead:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    return lead


def _require_referrer(referrer: Optional[User]) -> User:
    if referrer is None or referrer.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No referrer on this deal")
    return referrer


def _send(link: TrackingLink, to: Optional[str], name: str, *, for_referrer: bool, deal_label: Optional[str]) -> None:
    to = _usable_email(to)
    if not to:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="There's no email address on file to send it to")
    if not send_tracking_link_email(to, name, links.link_url(link), for_referrer=for_referrer, deal_label=deal_label):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Email isn't configured on this server")


def _application_label(application: LoanApplication) -> str:
    name = " ".join(filter(None, [application.applicant_first_name, application.applicant_last_name])).strip()
    return f"{name}'s application" if name else "your application"


def _application_client(application: LoanApplication, db: Session) -> tuple[str, Optional[str]]:
    owner = db.query(User).filter(User.id == application.user_id).first()
    owner_is_client = owner is not None and owner.role == UserRole.client
    name = " ".join(filter(None, [application.applicant_first_name, application.applicant_last_name])).strip()
    email = application.applicant_email or (owner.email if owner_is_client else None)
    return name or (owner.full_name if owner_is_client else "") or "there", email


# ── Referrer profile link ────────────────────────────────────────────────


@router.post("/referrers/{referrer_id}")
def referrer_link(
    referrer_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    referrer = _referrer(referrer_id, tenant_id, db)
    link = links.get_or_create(db, tenant_id, links.KIND_REFERRER, referrer_id=referrer.id, created_by_id=current_user.id)
    db.commit()
    return _out(link, "referrer", referrer)


@router.post("/referrers/{referrer_id}/regenerate")
def regenerate_referrer_link(
    referrer_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    referrer = _referrer(referrer_id, tenant_id, db)
    link = links.regenerate(db, tenant_id, links.KIND_REFERRER, referrer_id=referrer.id, created_by_id=current_user.id)
    log_activity(db, current_user.id, "tracking_link_regenerated", "user", referrer.id, {"kind": "referrer"}, tenant_id=tenant_id)
    db.commit()
    return _out(link, "referrer", referrer)


@router.post("/referrers/{referrer_id}/email")
def email_referrer_link(
    referrer_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    referrer = _referrer(referrer_id, tenant_id, db)
    link = links.get_or_create(db, tenant_id, links.KIND_REFERRER, referrer_id=referrer.id, created_by_id=current_user.id)
    _send(link, referrer.email, referrer.full_name, for_referrer=True, deal_label=None)
    log_activity(db, current_user.id, "tracking_link_emailed", "user", referrer.id, {"kind": "referrer"}, tenant_id=tenant_id)
    db.commit()
    return _out(link, "referrer", referrer)


# ── Deal links ───────────────────────────────────────────────────────────
# "Send to referrer" on a deal sends the referrer's one standing link — it
# already lists this deal — so only the borrower has a per-deal link.


@router.post("/applications/{application_id}")
def application_link(
    application_id: str,
    audience: Audience = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    application = _application(application_id, tenant_id, db)
    if audience == "referrer":
        referrer = _require_referrer(links.application_referrer(db, application))
        link = links.get_or_create(db, tenant_id, links.KIND_REFERRER, referrer_id=referrer.id, created_by_id=current_user.id)
        db.commit()
        return _out(link, audience, referrer)
    name, email = _application_client(application, db)
    link = links.get_or_create(db, tenant_id, links.KIND_DEAL, application_id=application.id, created_by_id=current_user.id)
    db.commit()
    return _out(link, audience, name=name, email=email)


@router.post("/applications/{application_id}/regenerate")
def regenerate_application_link(
    application_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    application = _application(application_id, tenant_id, db)
    name, email = _application_client(application, db)
    link = links.regenerate(db, tenant_id, links.KIND_DEAL, application_id=application.id, created_by_id=current_user.id)
    log_activity(db, current_user.id, "tracking_link_regenerated", "application", application.id, {"kind": "deal"}, tenant_id=tenant_id)
    db.commit()
    return _out(link, "client", name=name, email=email)


@router.post("/applications/{application_id}/email")
def email_application_link(
    application_id: str,
    audience: Audience = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    application = _application(application_id, tenant_id, db)
    label = _application_label(application)
    if audience == "referrer":
        referrer = _require_referrer(links.application_referrer(db, application))
        link = links.get_or_create(db, tenant_id, links.KIND_REFERRER, referrer_id=referrer.id, created_by_id=current_user.id)
        _send(link, referrer.email, referrer.full_name, for_referrer=True, deal_label=label)
        result = _out(link, audience, referrer)
    else:
        name, email = _application_client(application, db)
        link = links.get_or_create(db, tenant_id, links.KIND_DEAL, application_id=application.id, created_by_id=current_user.id)
        _send(link, email, name, for_referrer=False, deal_label="loan application")
        result = _out(link, audience, name=name, email=email)
    log_activity(db, current_user.id, "tracking_link_emailed", "application", application.id, {"audience": audience}, tenant_id=tenant_id)
    db.commit()
    return result


@router.post("/leads/{lead_id}")
def lead_link(
    lead_id: str,
    audience: Audience = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    lead = _lead(lead_id, tenant_id, db)
    if audience == "referrer":
        referrer = _require_referrer(lead.referrer)
        link = links.get_or_create(db, tenant_id, links.KIND_REFERRER, referrer_id=referrer.id, created_by_id=current_user.id)
        db.commit()
        return _out(link, audience, referrer)
    link = links.get_or_create(db, tenant_id, links.KIND_DEAL, lead_id=lead.id, created_by_id=current_user.id)
    db.commit()
    return _out(link, audience, name=lead.first_name, email=lead.email)


@router.post("/leads/{lead_id}/regenerate")
def regenerate_lead_link(
    lead_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    lead = _lead(lead_id, tenant_id, db)
    link = links.regenerate(db, tenant_id, links.KIND_DEAL, lead_id=lead.id, created_by_id=current_user.id)
    log_activity(db, current_user.id, "tracking_link_regenerated", "lead", lead.id, {"kind": "deal"}, tenant_id=tenant_id)
    db.commit()
    return _out(link, "client", name=lead.first_name, email=lead.email)


@router.post("/leads/{lead_id}/email")
def email_lead_link(
    lead_id: str,
    audience: Audience = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    lead = _lead(lead_id, tenant_id, db)
    if audience == "referrer":
        referrer = _require_referrer(lead.referrer)
        link = links.get_or_create(db, tenant_id, links.KIND_REFERRER, referrer_id=referrer.id, created_by_id=current_user.id)
        name = " ".join(filter(None, [lead.first_name, lead.last_name])).strip()
        _send(link, referrer.email, referrer.full_name, for_referrer=True, deal_label=f"{name}'s inquiry" if name else None)
        result = _out(link, audience, referrer)
    else:
        link = links.get_or_create(db, tenant_id, links.KIND_DEAL, lead_id=lead.id, created_by_id=current_user.id)
        _send(link, lead.email, lead.first_name, for_referrer=False, deal_label="loan inquiry")
        result = _out(link, audience, name=lead.first_name, email=lead.email)
    log_activity(db, current_user.id, "tracking_link_emailed", "lead", lead.id, {"audience": audience}, tenant_id=tenant_id)
    db.commit()
    return result
