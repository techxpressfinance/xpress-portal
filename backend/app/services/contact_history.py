"""Shared lending history: explicit participation, never inferred from ownership."""
from __future__ import annotations

from sqlalchemy import select, union
from sqlalchemy.orm import Session

from app.models.contact import Contact
from app.models.lender import Lender
from app.models.user import User, UserRole
from app.models.loan_applicant import LoanApplicant
from app.models.loan_application import ApplicationStatus, LoanApplication
from app.models.settled_deal_snapshot import SettledDealParty, SettledDealSnapshot


def participation_rows(tenant_id: str):
    """Distinct (contact, application) pairs for counts and directory filters."""
    return union(
        select(LoanApplication.contact_id.label("contact_id"), LoanApplication.id.label("application_id")).where(
            LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None), LoanApplication.contact_id.isnot(None)),
        select(LoanApplicant.contact_id, LoanApplicant.application_id).join(
            LoanApplication, LoanApplication.id == LoanApplicant.application_id).where(
            LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None), LoanApplicant.contact_id.isnot(None)),
        select(User.contact_id, LoanApplication.id).join(LoanApplication, LoanApplication.user_id == User.id).where(
            User.tenant_id == tenant_id, User.role == UserRole.client, User.contact_id.isnot(None),
            LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None),
            LoanApplication.contact_id.is_(None), LoanApplication.applicant_first_name.is_(None),
            LoanApplication.applicant_last_name.is_(None), LoanApplication.business_organization_id.is_(None),
            (LoanApplication.applicant_type.is_(None) | (LoanApplication.applicant_type != "company"))),
        select(SettledDealParty.contact_id, SettledDealParty.application_id).where(SettledDealParty.tenant_id == tenant_id),
    ).subquery()


def settled_participation(tenant_id: str, participation=None):
    """Participation filtered to settled deals: a live settled application, or a
    settlement snapshot whose application may since have been purged."""
    participation = participation if participation is not None else participation_rows(tenant_id)
    settled_ids = union(
        select(LoanApplication.id).where(
            LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None),
            LoanApplication.status == ApplicationStatus.settled),
        select(SettledDealParty.application_id).where(SettledDealParty.tenant_id == tenant_id),
    )
    return select(participation.c.contact_id, participation.c.application_id).where(
        participation.c.application_id.in_(settled_ids)).subquery()


def loan_roles(db: Session, contact_id: str, tenant_id: str) -> dict[str, list[str]]:
    roles: dict[str, list[str]] = {}
    for app_id, applicant_type in db.query(LoanApplication.id, LoanApplication.applicant_type).filter(
        LoanApplication.tenant_id == tenant_id, LoanApplication.contact_id == contact_id,
        LoanApplication.deleted_at.is_(None),
    ):
        roles[app_id] = ["Deal contact" if applicant_type == "company" else "Main applicant"]
    for party in db.query(LoanApplicant).join(LoanApplication).filter(
        LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None), LoanApplicant.contact_id == contact_id,
    ):
        role = "Guarantor signatory" if party.application_guarantor_id else (party.role or "director").replace("_", " ").capitalize()
        if role not in roles.setdefault(party.application_id, []):
            roles[party.application_id].append(role)
    # Legacy blank drafts have only the client account as provenance. Label this
    # association explicitly; do not assert that the account holder is a borrower.
    for (app_id,) in db.query(LoanApplication.id).join(User, User.id == LoanApplication.user_id).filter(
        User.tenant_id == tenant_id, User.contact_id == contact_id, User.role == UserRole.client,
        LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None),
        LoanApplication.contact_id.is_(None), LoanApplication.applicant_first_name.is_(None),
        LoanApplication.applicant_last_name.is_(None), LoanApplication.business_organization_id.is_(None),
        (LoanApplication.applicant_type.is_(None) | (LoanApplication.applicant_type != "company")),
    ):
        roles.setdefault(app_id, []).append("Portal account")
    return roles


def snapshot_parties(db: Session, app: LoanApplication) -> None:
    db.flush()
    existing = {(p.contact_id, p.role) for p in db.query(SettledDealParty).filter(
        SettledDealParty.application_id == app.id, SettledDealParty.tenant_id == app.tenant_id)}
    parties = [(app.contact_id, "Deal contact" if app.applicant_type == "company" else "Main applicant")] if app.contact_id else []
    parties += [(p.contact_id, "Guarantor signatory" if p.application_guarantor_id else (p.role or "director").replace("_", " ").capitalize())
                for p in db.query(LoanApplicant).filter(LoanApplicant.application_id == app.id) if p.contact_id]
    if not app.contact_id and app.applicant_first_name is None and app.applicant_last_name is None and not app.business_organization_id and app.applicant_type != "company":
        owner = db.query(User).filter(User.id == app.user_id, User.tenant_id == app.tenant_id, User.role == UserRole.client).first()
        if owner and owner.contact_id:
            parties.append((owner.contact_id, "Portal account"))
    valid_ids = {cid for (cid,) in db.query(Contact.id).filter(Contact.tenant_id == app.tenant_id, Contact.id.in_([p[0] for p in parties]))}
    for cid, role in set(parties) - existing:
        if cid in valid_ids:
            db.add(SettledDealParty(tenant_id=app.tenant_id, application_id=app.id, contact_id=cid, role=role))


def contact_applications(db: Session, contact_id: str, tenant_id: str) -> list[dict]:
    roles = loan_roles(db, contact_id, tenant_id)
    apps = db.query(LoanApplication).filter(LoanApplication.id.in_(roles), LoanApplication.tenant_id == tenant_id).all() if roles else []
    result = {a.id: dict(id=a.id, loan_type=a.loan_type.value, amount=float(a.amount), status=a.status.value,
                        business_name=a.business_name, business_abn=a.business_abn,
                        created_at=a.created_at, updated_at=a.updated_at, roles=roles[a.id], source="application",
                        lender_name=a.approval_lender_name, settled_at=a.settled_at, can_open=True)
              for a in apps}
    snapshots = db.query(SettledDealSnapshot, SettledDealParty, Lender.name).join(
        SettledDealParty, (SettledDealParty.application_id == SettledDealSnapshot.application_id)
        & (SettledDealParty.tenant_id == SettledDealSnapshot.tenant_id),
    ).outerjoin(Lender, (Lender.id == SettledDealSnapshot.lender_id) & (Lender.tenant_id == tenant_id)).filter(
        SettledDealSnapshot.tenant_id == tenant_id, SettledDealParty.contact_id == contact_id,
    ).all()
    for snap, party, lender in snapshots:
        if snap.application_id in result and result[snap.application_id]["source"] == "application":
            continue
        if snap.application_id not in result:
            result[snap.application_id] = dict(id=snap.application_id, loan_type=snap.loan_type, amount=float(snap.amount),
                status="settled", business_name=None, business_abn=None, created_at=snap.settled_at or snap.archived_at,
                updated_at=snap.archived_at, roles=[], source="settlement", lender_name=lender,
                settled_at=snap.settled_at, can_open=False)
        if party.role not in result[snap.application_id]["roles"]:
            result[snap.application_id]["roles"].append(party.role)
    return sorted(result.values(), key=lambda a: (a["settled_at"] or a["created_at"]).isoformat(), reverse=True)
