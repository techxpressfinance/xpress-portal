"""People who sign for an entity, carried onto its live applications.

When someone is recorded on an entity (company, trust, partnership…) with a
signing role — director, guarantor, signatory — they belong on every live
application that entity is part of: as a director/guarantor where the entity
borrows, and as a signatory where it guarantees someone else's loan. Before
this, the roster was only filled when an application was created or first got
its entity, so a director added to the company afterwards never reached the
deal on the board.

Settled, rejected and not-proceeding applications are left alone — their
paperwork is done. Anyone already on an application (matched by contact, email
or name, the primary director included) is not added twice. Those with an email
get their invite the same as any other party; the caller sends it after commit.
"""
from __future__ import annotations

import re
from typing import Optional

from sqlalchemy.orm import Session

from app.models.contact import Contact
from app.models.loan_applicant import ApplicationGuarantor, LoanApplicant
from app.models.loan_application import (
    APPLICANT_TYPE_COMPANY,
    COMMERCIAL_LOAN_TYPES,
    ApplicationStatus,
    LoanApplication,
)

CLOSED_STATUSES = (ApplicationStatus.settled, ApplicationStatus.rejected, ApplicationStatus.not_proceeding)

# Roles offered on the entity page, by entity type. Stored on the contact link
# as comma-separated text ("Director, Shareholder"), so one person can hold several.
ENTITY_ROLES: dict[str, list[str]] = {
    "company": ["Director", "Secretary", "Shareholder", "Guarantor", "Authorised signatory", "Beneficial owner", "Accountant", "Contact"],
    "trustee": ["Director", "Secretary", "Shareholder", "Guarantor", "Authorised signatory", "Beneficial owner", "Accountant", "Contact"],
    "trust": ["Guarantor", "Authorised signatory", "Beneficial owner", "Accountant", "Contact"],
    "partnership": ["Partner", "Guarantor", "Authorised signatory", "Accountant", "Contact"],
    "sole_trader": ["Owner", "Guarantor", "Accountant", "Contact"],
}
DEFAULT_ROLES = ["Director", "Partner", "Owner", "Guarantor", "Authorised signatory", "Secretary", "Shareholder", "Accountant", "Contact"]


def _roles(role: Optional[str]) -> list[str]:
    return [r.strip().lower() for r in re.split(r"[,;/&]|\band\b", role or "") if r.strip()]


def _signs(one: str) -> bool:
    return (
        any(word in one for word in ("director", "guarantor", "signator"))
        or one in ("partner", "owner", "sole trader", "proprietor")
    )


def is_signing_role(role: Optional[str]) -> bool:
    """A role that makes someone a party to the entity's loans. Several roles
    can be held ("Director, Shareholder"), and free text from older links
    counts too ("Sole Director", "Signatory"). A beneficial owner, secretary,
    shareholder or accountant on their own doesn't sign."""
    return any(_signs(r) for r in _roles(role))


def party_role_for(role: Optional[str]) -> str:
    """Director unless the only signing capacity held is guarantor."""
    signing = [r for r in _roles(role) if _signs(r)]
    return "guarantor" if signing and all("guarantor" in r for r in signing) else "director"


def _norm_name(first: Optional[str], last: Optional[str]) -> str:
    return " ".join(f"{first or ''} {last or ''}".lower().split())


def _already_on(contact: Contact, parties: list[LoanApplicant], app: Optional[LoanApplication]) -> bool:
    email = (contact.email or "").strip().lower()
    name = _norm_name(contact.first_name, contact.last_name)
    for p in parties:
        if p.contact_id == contact.id:
            return True
        if email and email in {(p.invite_email or "").strip().lower(), (p.applicant_email or "").strip().lower()}:
            return True
        if name and name == _norm_name(p.applicant_first_name, p.applicant_last_name):
            return True
    if app is not None:  # the primary director lives on the application itself
        if app.contact_id == contact.id:
            return True
        if email and email == (app.applicant_email or "").strip().lower():
            return True
        if name and name == _norm_name(app.applicant_first_name, app.applicant_last_name):
            return True
    return False


def add_to_live_applications(
    db: Session, tenant_id: str, org_id: str, contact: Contact, role: Optional[str]
) -> list[tuple[LoanApplication, LoanApplicant, Optional[str]]]:
    """Put a signing person onto the entity's live applications.

    Returns (application, new party, company name for the invite) for each one
    added; nothing is committed and no email is sent here.
    """
    if not is_signing_role(role):
        return []
    from app.routers.applications import _party_from_contact

    added: list[tuple[LoanApplication, LoanApplicant, Optional[str]]] = []
    party_role = party_role_for(role)

    borrowing = (
        db.query(LoanApplication)
        .filter(
            LoanApplication.tenant_id == tenant_id,
            LoanApplication.business_organization_id == org_id,
            LoanApplication.deleted_at.is_(None),
            LoanApplication.status.notin_(CLOSED_STATUSES),
        )
        .all()
    )
    for app in borrowing:
        # Only applications that carry a director roster (see _load_commercial_app).
        if app.loan_type not in COMMERCIAL_LOAN_TYPES and app.applicant_type != APPLICANT_TYPE_COMPANY:
            continue
        parties = db.query(LoanApplicant).filter(
            LoanApplicant.application_id == app.id, LoanApplicant.application_guarantor_id.is_(None)
        ).all()
        if _already_on(contact, parties, app):
            continue
        party = _party_from_contact(tenant_id, app, contact, role=party_role)
        db.add(party)
        added.append((app, party, app.business_name))

    # Where the entity guarantees someone else's loan, its signers sign for it.
    for guarantor in db.query(ApplicationGuarantor).filter(ApplicationGuarantor.organization_id == org_id).all():
        app = guarantor.application
        if (
            app is None or app.tenant_id != tenant_id or app.deleted_at is not None
            or app.status in CLOSED_STATUSES
        ):
            continue
        parties = db.query(LoanApplicant).filter(
            LoanApplicant.application_id == app.id, LoanApplicant.application_guarantor_id == guarantor.id
        ).all()
        if _already_on(contact, parties, None):
            continue
        party = _party_from_contact(tenant_id, app, contact, role="director", application_guarantor_id=guarantor.id)
        db.add(party)
        added.append((app, party, guarantor.organization.name if guarantor.organization else app.business_name))
    return added


def send_invites(added: list[tuple[LoanApplication, LoanApplicant, Optional[str]]]) -> None:
    """After commit: email each new party with an address their invite."""
    from app.routers.applications import _send_party_invite

    for _app, party, company in added:
        if party.invite_token:
            _send_party_invite(party, company)
