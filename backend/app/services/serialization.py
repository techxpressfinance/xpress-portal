from __future__ import annotations

from typing import Iterable, Optional

from sqlalchemy.orm import Session, joinedload

from app.models.external_referral import ExternalReferral
from app.models.loan_application import LoanApplication
from app.models.referral import Referral
from app.models.user import UserRole

# Magic-link tokens grant unauthenticated form access via /api/public/apply —
# they must never appear in API responses. Single deliberate exception: the
# application detail GET rebuilds invite URLs for admin/broker viewers only
# (_attach_invite_urls in the applications router) so invites can be re-shared.
_SECRET_COLUMNS = {"client_invite_token", "invite_token"}


def _referrer_dict(user) -> dict:
    return {
        "id": user.id,
        "full_name": user.full_name,
        "email": user.email,
        "phone": user.phone,
        "organization_name": getattr(user, "organization_name", None),
    }


def referrer_info_map(db: Session, user_ids: Iterable[Optional[str]]) -> dict[str, dict]:
    """Batch-resolve referrer info for many application owners in two queries.

    An ExternalReferral takes precedence over a Referral for the same owner,
    matching the per-application lookup order in app_with_user.
    """
    ids = {uid for uid in user_ids if uid}
    result: dict[str, dict] = {}
    if not ids:
        return result
    ext_refs = (
        db.query(ExternalReferral)
        .options(joinedload(ExternalReferral.referrer))
        .filter(ExternalReferral.referred_client_id.in_(ids))
        .all()
    )
    for ext_ref in ext_refs:
        if ext_ref.referrer and ext_ref.referred_client_id not in result:
            result[ext_ref.referred_client_id] = _referrer_dict(ext_ref.referrer)
    remaining = ids - result.keys()
    if remaining:
        refs = (
            db.query(Referral)
            .options(joinedload(Referral.referrer))
            .filter(Referral.referred_user_id.in_(remaining))
            .all()
        )
        for ref in refs:
            # Referral rows are also written for admin/broker invite links —
            # only a referrer-role user counts as an actual referrer.
            if ref.referrer and ref.referrer.role == UserRole.referrer and ref.referred_user_id not in result:
                result[ref.referred_user_id] = _referrer_dict(ref.referrer)
    return result


def app_with_user(
    app: LoanApplication,
    db: Session,
    *,
    referrer_map: Optional[dict[str, dict]] = None,
) -> dict:
    """Build response dict with user info and assigned brokers list.

    For list endpoints, pass ``referrer_map`` from referrer_info_map() so the
    referrer lookup is two batched queries instead of one per application.
    """
    data = {c.name: getattr(app, c.name) for c in app.__table__.columns if c.name not in _SECRET_COLUMNS}
    if app.user:
        data["user_name"] = app.user.full_name
        data["user_email"] = app.user.email
        data["user_role"] = app.user.role.value
        # True when a placeholder client account exists but hasn't been invited yet
        data["client_account_pending"] = (
            app.user.role.value == "client"
            and app.user.password_hash in ("!", "!invited")
        )
    # Backward compat: legacy primary broker populates the legacy fields. Prefer
    # the explicit assigned_broker_id column (kept in sync on assign/unassign/
    # reassign); fall back to the first listed broker for legacy rows.
    primary = None
    if app.assigned_broker_id:
        primary = next((b for b in app.brokers if b.id == app.assigned_broker_id), None)
    if primary is None and app.brokers:
        primary = app.brokers[0]
    if primary:
        data["assigned_broker_id"] = primary.id
        data["assigned_broker_name"] = primary.full_name
    else:
        data["assigned_broker_id"] = None
        data["assigned_broker_name"] = None
    data["assigned_brokers"] = [{"id": b.id, "full_name": b.full_name} for b in app.brokers]
    # Completion info
    if app.completed_by:
        data["completed_by_name"] = app.completed_by.full_name
    else:
        data["completed_by_name"] = None
    # Referrer info
    referrer_info = None
    if app.user and app.user.role.value == "referrer":
        referrer_info = _referrer_dict(app.user)
    elif app.user:
        if referrer_map is not None:
            referrer_info = referrer_map.get(app.user_id)
        else:
            ext_ref = db.query(ExternalReferral).filter(
                ExternalReferral.referred_client_id == app.user_id,
            ).first()
            if ext_ref and ext_ref.referrer:
                referrer_info = _referrer_dict(ext_ref.referrer)
            else:
                ref = db.query(Referral).filter(
                    Referral.referred_user_id == app.user_id,
                ).first()
                if ref and ref.referrer and ref.referrer.role == UserRole.referrer:
                    referrer_info = _referrer_dict(ref.referrer)
    data["referrer"] = referrer_info
    # Additional directors (commercial loans). Relationship isn't a column, so
    # serialize it explicitly from each applicant row's columns.
    # additional_applicants holds both direct individual parties and corporate-
    # guarantor signatories; split them by application_guarantor_id.
    all_parties = app.additional_applicants
    direct_parties = [a for a in all_parties if a.application_guarantor_id is None]
    data["additional_applicants"] = [_applicant_dict(a) for a in direct_parties]

    guarantors = [guarantor_dict(g) for g in app.corporate_guarantors]
    data["corporate_guarantors"] = guarantors

    # Entity-first commercial readiness: every direct party signed, and every
    # corporate guarantor has at least one signatory and all of them signed.
    # False when there is nothing to be ready for.
    data["parties_ready"] = (
        (bool(direct_parties) or bool(guarantors))
        and all(_is_signed(a) for a in direct_parties)
        and all(g["ready"] for g in guarantors)
    )
    return data


def _is_signed(applicant) -> bool:
    return applicant.completed_at is not None and applicant.signed_at is not None


def _applicant_dict(applicant) -> dict:
    return {c.name: getattr(applicant, c.name) for c in applicant.__table__.columns if c.name not in _SECRET_COLUMNS}


def guarantor_dict(guarantor) -> dict:
    """Serialize a corporate guarantor with its company info and nested signatories."""
    signatories = guarantor.signatories
    org = guarantor.organization
    return {
        "id": guarantor.id,
        "organization_id": guarantor.organization_id,
        "organization_name": org.name if org else None,
        "organization_abn": org.abn if org else None,
        "signatories": [_applicant_dict(s) for s in signatories],
        "ready": bool(signatories) and all(_is_signed(s) for s in signatories),
    }
