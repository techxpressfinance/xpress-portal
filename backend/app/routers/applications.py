from __future__ import annotations

import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session, joinedload, selectinload

from app.config import EMAIL_ENABLED, FRONTEND_URL, LLM_ANALYSIS_ENABLED
from app.database import SessionLocal, get_db
from app.middleware.auth import get_current_user, require_role
from app.models.application_broker import ApplicationBroker
from app.models.document import DocType, Document
from app.models.external_referral import ExternalReferral, ExternalReferralStatus
from app.models.loan_application import (
    COMMERCIAL_LOAN_TYPES,
    AnalysisStatus,
    ApplicationStatus,
    LoanApplication,
    LoanType,
)
from app.models.loan_applicant import ApplicationGuarantor, LoanApplicant
from app.models.contact import ContactOrganization
from app.models.application_note import ApplicationNote
from app.models.referral import Referral, ReferralStatus
from app.models.user import User, UserRole

REQUIRED_DOC_TYPES = {DocType.id_proof, DocType.address_proof, DocType.bank_statement, DocType.payslip, DocType.tax_return}

# Canonical client-form section keys a broker can toggle, in display order.
# Must mirror APPLICATION_SECTIONS in frontend/src/lib/constants.ts.
SECTION_KEYS = (
    "loan_details", "personal", "identification", "contact", "business",
    "living", "employment", "income", "assets", "liabilities", "expenses",
    "declarations", "emergency", "documents",
)
ALLOWED_SECTIONS = set(SECTION_KEYS)
from app.constants import VALID_TRANSITIONS
from app.services.query_utils import escape_like
from app.services.access_control import check_application_access
from app.services.activity_log import log_activity
from app.services.serialization import app_with_user as _app_with_user, referrer_info_map
from app.services.email import (
    send_assignment_notification,
    send_complete_application_email,
    send_direct_engagement_client_invite,
    send_direct_engagement_referrer_thankyou,
    send_new_lead_notification,
    send_setup_account_email,
    send_status_notification,
)
from app.services.notification_service import create_notification
from app.services.organizations import find_or_create_organization_by_abn, normalize_abn
from app.services.reconciliation import find_matching_application, signature_diff
from app.schemas.loan_application import (
    CorporateGuarantorCreate,
    CorporateGuarantorOut,
    LoanApplicantCreate,
    LoanApplicantOut,
    LoanApplicationCreate,
    LoanApplicationOut,
    LoanApplicationUpdate,
    PaginatedApplications,
)
from app.services.serialization import guarantor_dict
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/applications", tags=["applications"])


@router.post("", response_model=LoanApplicationOut, status_code=status.HTTP_201_CREATED)
def create_application(
    data: LoanApplicationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    # When staff (broker/admin) create an application on a client's behalf, mirror the
    # referrer direct-referral flow: the client owns the application and is emailed a
    # setup/complete link. (Direct engagement has its own token flow below.)
    staff_lead = (
        current_user.role in (UserRole.admin, UserRole.broker)
        and bool(data.applicant_email)
        and data.client_engagement_model != "direct_engagement"
    )
    lead_client: Optional[User] = None
    lead_is_new = False
    lead_setup_token: Optional[str] = None
    owner_id = current_user.id

    if staff_lead:
        lead_email = data.applicant_email.strip().lower()
        full_name = " ".join(filter(None, [data.applicant_first_name, data.applicant_last_name])).strip() or lead_email
        existing = db.query(User).filter(User.email == lead_email, User.tenant_id == tenant_id).first()
        if existing and existing.role != UserRole.client:
            staff_lead = False  # don't repurpose a non-client account — fall back to a staff-owned app
        elif existing:
            lead_client = existing
            owner_id = existing.id
        else:
            lead_setup_token = secrets.token_urlsafe(32)
            lead_client = User(
                email=lead_email,
                full_name=full_name,
                phone=data.applicant_mobile,
                password_hash="!",
                auth_method="password",
                role="client",
                is_active=True,
                email_verified=True,
                invited_by_id=current_user.id,
                tenant_id=tenant_id,
                email_verification_token=lead_setup_token,
                email_verification_token_expires_at=datetime.now(timezone.utc) + timedelta(hours=48),
            )
            db.add(lead_client)
            db.flush()
            lead_is_new = True
            owner_id = lead_client.id

    app_kwargs = data.model_dump()
    # Normalize ABN before storing
    if app_kwargs.get("business_abn"):
        app_kwargs["business_abn"] = normalize_abn(app_kwargs["business_abn"])

    app = LoanApplication(user_id=owner_id, tenant_id=tenant_id, **app_kwargs)
    if staff_lead and current_user.role == UserRole.broker:
        app.assigned_broker_id = current_user.id

    # Link to a Company by ABN, creating a stub if necessary
    if app.business_abn or app.business_name:
        org = find_or_create_organization_by_abn(db, tenant_id, app.business_abn, app.business_name)
        if org:
            app.business_organization_id = org.id
            # Sync denormalized business_name from the Org if it has a real name
            if org.name and org.name != "Unnamed Company":
                app.business_name = org.name

    db.add(app)
    db.flush()
    log_activity(db, current_user.id, "created", "application", app.id, {"loan_type": data.loan_type, "amount": str(data.amount)}, tenant_id=tenant_id)

    # Commercial reconciliation: if another open application already exists for the
    # same company (ABN), this is likely the same loan a different director applied
    # for. Flag it (non-destructively) for the broker to merge or keep separate.
    if app.loan_type in COMMERCIAL_LOAN_TYPES and (app.business_abn or app.business_name):
        existing = find_matching_application(
            db, tenant_id, app.business_abn, app.business_name, exclude_id=app.id
        )
        if existing:
            diffs = signature_diff(existing, app)
            if diffs:
                app.reconciliation_note = (
                    f"Possible duplicate of application {existing.id} for the same company, "
                    f"but loan details differ: {'; '.join(diffs)}."
                )
            else:
                app.reconciliation_note = (
                    f"Same company and loan details as application {existing.id} — "
                    f"likely the same loan. Consider merging the directors."
                )
            app.needs_reconciliation = True

    # Update referral status to "applied" if this user was referred
    referral = db.query(Referral).filter(
        Referral.referred_user_id == current_user.id,
        Referral.status == ReferralStatus.signed_up,
    ).first()
    if referral:
        referral.status = ReferralStatus.applied
        referral.converted_at = datetime.now(timezone.utc)

    # Update external referral status to "applied" if this user was externally referred
    ext_referral = db.query(ExternalReferral).filter(
        ExternalReferral.referred_client_id == current_user.id,
        ExternalReferral.status == ExternalReferralStatus.signed_up,
    ).first()
    if ext_referral:
        ext_referral.status = ExternalReferralStatus.applied
        ext_referral.converted_at = datetime.now(timezone.utc)

    # For direct engagement, generate invite token so client can complete the form
    direct_engagement_invite_url = None
    if data.client_engagement_model == "direct_engagement" and data.applicant_email:
        if current_user.role not in (UserRole.admin, UserRole.broker):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only brokers and admins can initiate direct engagement")
        token = secrets.token_urlsafe(32)
        app.client_invite_token = token
        app.client_invite_email = data.applicant_email.strip()
        app.client_invite_sent_at = datetime.now(timezone.utc)
        direct_engagement_invite_url = f"{FRONTEND_URL}/apply/{token}"

    db.commit()

    if direct_engagement_invite_url:
        client_name = " ".join(filter(None, [data.applicant_first_name, data.applicant_last_name])) or "there"
        referrer_name = current_user.full_name or current_user.email
        send_direct_engagement_referrer_thankyou(
            current_user.email, referrer_name, client_name, data.applicant_email.strip()
        )
        send_direct_engagement_client_invite(
            data.applicant_email.strip(), client_name, referrer_name, direct_engagement_invite_url
        )
    elif staff_lead and lead_client:
        client_name = lead_client.full_name or "there"
        if lead_is_new:
            redirect_target = quote(f"/applications/new?completeId={app.id}", safe="")
            setup_url = f"{FRONTEND_URL}/setup-account?token={lead_setup_token}&redirect={redirect_target}"
            send_setup_account_email(lead_client.email, client_name, setup_url, current_user.full_name, role="client")
        else:
            send_complete_application_email(
                to_email=lead_client.email,
                client_name=client_name,
                inviter_name=current_user.full_name,
                loan_type=data.loan_type,
                amount=str(int(data.amount)),
                application_id=app.id,
            )
        portal_url = f"{FRONTEND_URL}/admin/applications/{app.id}"
        admins = db.query(User).filter(User.role == UserRole.admin, User.tenant_id == tenant_id).all()
        for admin in admins:
            send_new_lead_notification(
                admin.email,
                admin.full_name or "Admin",
                current_user.full_name or current_user.email,
                client_name,
                data.loan_type,
                str(int(data.amount)),
                portal_url,
            )
    elif current_user.role == UserRole.referrer and data.client_engagement_model == "self_managed":
        client_name = " ".join(filter(None, [data.applicant_first_name, data.applicant_last_name])) or "Unknown"
        referrer_name = current_user.full_name or current_user.email
        portal_url = f"{FRONTEND_URL}/admin/applications/{app.id}"

        notified_ids: set[str] = set()
        broker = (
            db.query(User).filter(User.id == current_user.invited_by_id).first()
            if current_user.invited_by_id else None
        )
        if broker and broker.role.value in ("broker", "admin"):
            send_new_lead_notification(
                broker.email,
                broker.full_name or "Broker",
                referrer_name,
                client_name,
                data.loan_type,
                str(int(data.amount)),
                portal_url,
            )
            notified_ids.add(broker.id)

        admins = db.query(User).filter(User.role == UserRole.admin, User.tenant_id == tenant_id).all()
        for admin in admins:
            if admin.id not in notified_ids:
                send_new_lead_notification(
                    admin.email,
                    admin.full_name or "Admin",
                    referrer_name,
                    client_name,
                    data.loan_type,
                    str(int(data.amount)),
                    portal_url,
                )

    db.refresh(app, attribute_names=["user"])
    result = _app_with_user(app, db)
    if direct_engagement_invite_url:
        # One-time disclosure to the inviter; the token never appears on GETs
        result["invite_url"] = direct_engagement_invite_url
    return result


CLOSED_STATUSES = [ApplicationStatus.settled, ApplicationStatus.rejected, ApplicationStatus.not_proceeding]


@router.get("", response_model=PaginatedApplications)
def list_applications(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status_filter: Optional[ApplicationStatus] = Query(None, alias="status"),
    loan_type: Optional[LoanType] = None,
    search: Optional[str] = None,
    closed: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    query = db.query(LoanApplication).options(joinedload(LoanApplication.user), joinedload(LoanApplication.assigned_broker), selectinload(LoanApplication.brokers), selectinload(LoanApplication.completed_by), selectinload(LoanApplication.additional_applicants), selectinload(LoanApplication.corporate_guarantors).selectinload(ApplicationGuarantor.signatories), selectinload(LoanApplication.corporate_guarantors).joinedload(ApplicationGuarantor.organization)).filter(LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None))

    if current_user.role == UserRole.client:
        query = query.filter(
            LoanApplication.user_id == current_user.id,
            LoanApplication.hidden_from_client.is_(False),
        )
    elif current_user.role == UserRole.broker:
        # Brokers see: applications assigned to them + referrer-submitted leads + their own created leads + all drafts (tenant-wide)
        from sqlalchemy import or_
        referrer_ids = db.query(User.id).filter(User.role == UserRole.referrer, User.tenant_id == tenant_id)
        query = query.filter(
            or_(
                LoanApplication.id.in_(
                    db.query(ApplicationBroker.application_id).filter(ApplicationBroker.broker_id == current_user.id)
                ),
                LoanApplication.user_id.in_(referrer_ids),
                LoanApplication.user_id == current_user.id,
                LoanApplication.status == ApplicationStatus.draft,
            )
        )
    elif current_user.role == UserRole.referrer:
        # Referrers see: applications from clients they referred + leads they submitted directly
        referred_client_ids = (
            db.query(ExternalReferral.referred_client_id)
            .filter(
                ExternalReferral.referrer_id == current_user.id,
                ExternalReferral.referred_client_id.isnot(None),
            )
        )
        from sqlalchemy import or_
        query = query.filter(
            or_(
                LoanApplication.user_id.in_(referred_client_ids),
                LoanApplication.user_id == current_user.id,
            )
        )

    if status_filter:
        query = query.filter(LoanApplication.status == status_filter)
    elif closed is False:
        query = query.filter(LoanApplication.status.notin_(CLOSED_STATUSES))
    elif closed is True:
        query = query.filter(LoanApplication.status.in_(CLOSED_STATUSES))
    if loan_type:
        query = query.filter(LoanApplication.loan_type == loan_type)
    if search:
        safe_search = escape_like(search)
        query = query.join(User, LoanApplication.user_id == User.id).filter(
            User.full_name.ilike(f"%{safe_search}%", escape="\\") | User.email.ilike(f"%{safe_search}%", escape="\\")
        )

    total = query.count()
    items = query.order_by(LoanApplication.created_at.desc()).offset((page - 1) * per_page).limit(per_page).all()

    referrer_map = referrer_info_map(db, (app.user_id for app in items))
    return PaginatedApplications(items=[_app_with_user(app, db, referrer_map=referrer_map) for app in items], total=total, page=page, per_page=per_page)


@router.get("/analytics")
def get_application_analytics(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    from sqlalchemy import func, or_

    query = db.query(LoanApplication).filter(LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None))

    if current_user.role == UserRole.client:
        query = query.filter(
            LoanApplication.user_id == current_user.id,
            LoanApplication.hidden_from_client.is_(False),
        )
    elif current_user.role == UserRole.broker:
        referrer_ids = db.query(User.id).filter(User.role == UserRole.referrer, User.tenant_id == tenant_id)
        query = query.filter(
            or_(
                LoanApplication.id.in_(
                    db.query(ApplicationBroker.application_id).filter(ApplicationBroker.broker_id == current_user.id)
                ),
                LoanApplication.user_id.in_(referrer_ids),
                LoanApplication.status == ApplicationStatus.draft,
            )
        )
    elif current_user.role == UserRole.referrer:
        referred_client_ids = db.query(ExternalReferral.referred_client_id).filter(
            ExternalReferral.referrer_id == current_user.id,
            ExternalReferral.referred_client_id.isnot(None),
        )
        query = query.filter(
            or_(
                LoanApplication.user_id.in_(referred_client_ids),
                LoanApplication.user_id == current_user.id,
            )
        )

    active_statuses = {"application_received", "application_assessed", "submitted", "approval"}

    # All aggregations run as DB queries — no Python-side row iteration
    status_rows = (
        query
        .with_entities(LoanApplication.status, func.count().label("cnt"))
        .group_by(LoanApplication.status)
        .all()
    )
    by_status: dict[str, int] = {
        (s.value if hasattr(s, "value") else str(s)): cnt
        for s, cnt in status_rows
    }

    loan_type_rows = (
        query
        .with_entities(LoanApplication.loan_type, func.count().label("cnt"))
        .group_by(LoanApplication.loan_type)
        .all()
    )
    by_loan_type: dict[str, int] = {
        (lt.value if hasattr(lt, "value") else str(lt)): cnt
        for lt, cnt in loan_type_rows
    }

    totals = query.with_entities(
        func.count().label("total"),
        func.coalesce(func.sum(LoanApplication.amount), 0).label("total_value"),
    ).first()
    total_applications = totals.total if totals else 0
    total_value = float(totals.total_value) if totals else 0.0

    settled = (
        query
        .filter(LoanApplication.status == ApplicationStatus.settled)
        .with_entities(
            func.count().label("cnt"),
            func.coalesce(func.sum(LoanApplication.amount), 0).label("val"),
        )
        .first()
    )
    settled_count = settled.cnt if settled else 0
    settled_value = float(settled.val) if settled else 0.0

    approval_count = by_status.get("approval", 0)
    active_count = sum(by_status.get(s, 0) for s in active_statuses)

    return {
        "total_applications": total_applications,
        "total_value": total_value,
        "settled_count": settled_count,
        "settled_value": settled_value,
        "approval_count": approval_count,
        "active_count": active_count,
        "by_status": by_status,
        "by_loan_type": by_loan_type,
    }


@router.get("/deleted", response_model=list[LoanApplicationOut])
def list_deleted_applications(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Admin-only: returns all soft-deleted applications."""
    apps = (
        db.query(LoanApplication)
        .options(joinedload(LoanApplication.user), joinedload(LoanApplication.assigned_broker), selectinload(LoanApplication.brokers), selectinload(LoanApplication.completed_by), selectinload(LoanApplication.additional_applicants), selectinload(LoanApplication.corporate_guarantors).selectinload(ApplicationGuarantor.signatories), selectinload(LoanApplication.corporate_guarantors).joinedload(ApplicationGuarantor.organization))
        .filter(LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.isnot(None))
        .order_by(LoanApplication.deleted_at.desc())
        .all()
    )
    referrer_map = referrer_info_map(db, (app.user_id for app in apps))
    return [_app_with_user(app, db, referrer_map=referrer_map) for app in apps]


@router.post("/{app_id}/restore", response_model=LoanApplicationOut)
def restore_application(
    app_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Admin-only: restore a soft-deleted application."""
    application = db.query(LoanApplication).filter(
        LoanApplication.id == app_id,
        LoanApplication.tenant_id == tenant_id,
        LoanApplication.deleted_at.isnot(None),
    ).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deleted application not found")

    application.deleted_at = None
    log_activity(db, current_user.id, "restored", "application", app_id, {"loan_type": application.loan_type.value}, tenant_id=tenant_id)
    db.commit()
    db.refresh(application)
    return _app_with_user(application, db)


@router.get("/{app_id}", response_model=LoanApplicationOut)
def get_application(
    app_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    application = db.query(LoanApplication).options(joinedload(LoanApplication.user), joinedload(LoanApplication.assigned_broker), selectinload(LoanApplication.brokers), selectinload(LoanApplication.completed_by), selectinload(LoanApplication.additional_applicants), selectinload(LoanApplication.corporate_guarantors).selectinload(ApplicationGuarantor.signatories), selectinload(LoanApplication.corporate_guarantors).joinedload(ApplicationGuarantor.organization)).filter(LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None)).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user, db=db)
    result = _app_with_user(application, db)
    if current_user.role in (UserRole.admin, UserRole.broker):
        _ensure_client_invite_link(application, db)
        _attach_invite_urls(result, application)
    return result


def _setup_token_valid(user: User) -> bool:
    expires = user.email_verification_token_expires_at
    if expires is not None and expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    return bool(user.email_verification_token and expires and expires > datetime.now(timezone.utc))


def _ensure_client_invite_link(application: LoanApplication, db: Session) -> None:
    """Pre-mint the client invite link for draft apps so brokers can copy and
    share it before (or instead of) clicking Invite — like a referral link.

    Only mints the account-setup token for placeholder clients; the Invite
    action emails this same link (send endpoints reuse live tokens).
    """
    if application.status.value != "draft":
        return
    user = application.user
    if application.client_invite_token or not user:
        return
    if user.role.value != "client" or user.password_hash not in ("!", "!invited"):
        return
    if _setup_token_valid(user):
        return
    user.email_verification_token = secrets.token_urlsafe(32)
    user.email_verification_token_expires_at = datetime.now(timezone.utc) + timedelta(hours=48)
    db.commit()


def _attach_invite_urls(result: dict, application: LoanApplication) -> None:
    """Add copyable invite links for the broker/admin viewing the detail page.

    Magic-link tokens stay out of every other response (see _SECRET_COLUMNS);
    this is the deliberate exception so brokers can share an invite link
    directly. Never called for client/referrer viewers or list endpoints.
    """
    base = FRONTEND_URL.rstrip("/")
    user = application.user
    if application.client_invite_token:
        # Direct-engagement form link
        result["invite_url"] = f"{base}/apply/{application.client_invite_token}"
    elif user and user.role.value == "client" and user.password_hash in ("!", "!invited"):
        # Placeholder client — their account-setup link, shown while valid
        # (pre-minted on view for drafts, so it's visible before inviting)
        if _setup_token_valid(user):
            redirect_target = quote(f"/applications/new?completeId={application.id}", safe="")
            result["invite_url"] = f"{base}/setup-account?token={user.email_verification_token}&redirect={redirect_target}"
    elif user and user.role.value == "client" and application.status.value == "draft":
        # Set-up client — no secret needed; the portal completion link is shareable
        result["invite_url"] = f"{base}/applications/new?completeId={application.id}"

    # Director / guarantor-signatory magic links (uncompleted parties only)
    token_by_id = {
        a.id: a.invite_token
        for a in application.additional_applicants
        if a.invite_token and a.completed_at is None
    }
    for party in result.get("additional_applicants", []):
        token = token_by_id.get(party["id"])
        if token:
            party["invite_url"] = f"{base}/apply/{token}"
    for guarantor in result.get("corporate_guarantors", []):
        for sig in guarantor.get("signatories", []):
            token = token_by_id.get(sig["id"])
            if token:
                sig["invite_url"] = f"{base}/apply/{token}"


@router.patch("/{app_id}", response_model=LoanApplicationOut)
def update_application(
    app_id: str,
    data: LoanApplicationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    application = db.query(LoanApplication).filter(LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None)).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    check_application_access(application, current_user, db=db)

    is_draft = application.status.value == "draft"

    # Clients can only edit drafts
    if current_user.role == UserRole.client and not is_draft:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot edit submitted application")

    # Clients cannot edit locked applications (broker has locked it)
    if current_user.role == UserRole.client and getattr(application, "is_locked", False):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This application has been locked by your broker and cannot be edited")

    # Brokers/admins can only edit field values on drafts (notes always allowed)
    if current_user.role != UserRole.client and not is_draft:
        field_updates = data.model_dump(exclude_unset=True)
        field_updates.pop("status", None)
        _BROKER_ALLOWED_FIELDS = {
            "notes", "loan_type", "lend_product_type_id", "lend_owner_type", "lend_send_type", "lend_who_to_contact", "lend_extra_data",
            "amount", "loan_term_requested", "loan_purpose_id",
            "applicant_title", "applicant_first_name", "applicant_last_name", "applicant_middle_name",
            "applicant_dob", "applicant_gender", "applicant_marital_status",
            "applicant_address", "applicant_suburb", "applicant_state", "applicant_postcode",
            "business_abn", "business_name", "business_registration_date", "business_industry_id", "business_monthly_sales",
            "applicant_email", "applicant_mobile", "preferred_contact_method",
            "id_expiry_date", "applicant_residency_status",
            "residential_status", "time_at_address", "applicant_num_dependants", "has_partner", "partner_working",
            "employment_category", "employer_name", "employer_industry", "job_title", "income_frequency", "gross_income",
            "trading_name", "business_structure", "gst_registered", "num_directors", "time_trading",
            "previously_declined", "change_of_circumstances", "signature_name",
            "emergency_contact_name", "emergency_contact_relationship", "emergency_contact_phone",
        }
        disallowed = set(field_updates.keys()) - _BROKER_ALLOWED_FIELDS
        if disallowed:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot modify application fields after submission")

    updates = data.model_dump(exclude_unset=True)
    requested_status = updates.pop("status", None)

    # Handle draft -> application_received for any role (client submission)
    if requested_status == "application_received":
        if not is_draft:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only draft applications can be submitted")
        updates["status"] = "application_received"

        if current_user.role == UserRole.client:
            log_activity(db, current_user.id, "submitted", "application", app_id, tenant_id=tenant_id)
        else:
            # Track broker/admin completion on behalf of client
            application.completed_by_id = current_user.id
            application.completed_at = datetime.now(timezone.utc)
            log_activity(db, current_user.id, "broker_completed", "application", app_id,
                        {"on_behalf_of": application.user_id})

            # Notify the client
            client_user = db.query(User).filter(User.id == application.user_id).first()
            if client_user and client_user.role == UserRole.client and not client_user.email.endswith('@deleted.invalid'):
                send_status_notification(client_user.email, client_user.full_name, application.loan_type.value, "application_received")
                create_notification(
                    db,
                    user_id=client_user.id,
                    type="status_change",
                    title="Application received",
                    body=f"Your {application.loan_type.value} application has been received and is being reviewed.",
                    link=f"/applications/{app_id}",
                    tenant_id=tenant_id,
                )
            elif application.applicant_email:
                applicant_name = " ".join(filter(None, [application.applicant_first_name, application.applicant_last_name])) or "Applicant"
                send_status_notification(application.applicant_email, applicant_name, application.loan_type.value, "application_received")

    # Normalize ABN and re-link to a Company whenever business_abn changes
    if "business_abn" in updates:
        updates["business_abn"] = normalize_abn(updates["business_abn"])

    for key, value in updates.items():
        setattr(application, key, value)

    if "business_abn" in updates or "business_name" in updates:
        if application.business_abn or application.business_name:
            org = find_or_create_organization_by_abn(
                db, tenant_id, application.business_abn, application.business_name
            )
            if org:
                application.business_organization_id = org.id
                if org.name and org.name != "Unnamed Company":
                    application.business_name = org.name
        else:
            application.business_organization_id = None

    if updates:
        log_activity(db, current_user.id, "updated", "application", app_id, {"fields": list(updates.keys())}, tenant_id=tenant_id)

    db.commit()

    db.refresh(application, attribute_names=["user"])
    return _app_with_user(application, db)


@router.patch("/{app_id}/status", response_model=LoanApplicationOut)
def change_status(
    app_id: str,
    new_status: ApplicationStatus = Query(..., alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    application = db.query(LoanApplication).filter(LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None)).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user, db=db)

    current = application.status.value
    allowed = VALID_TRANSITIONS.get(current, [])
    if new_status.value not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot transition from '{current}' to '{new_status.value}'. Allowed: {allowed}",
        )

    old_status = current
    application.status = new_status
    log_activity(db, current_user.id, "status_changed", "application", app_id, {"from": old_status, "to": new_status.value}, tenant_id=tenant_id)
    db.commit()
    db.refresh(application)

    # Notify client via email and SMS
    client = db.query(User).filter(User.id == application.user_id).first()
    if client and client.role == UserRole.client and not client.email.endswith('@deleted.invalid'):
        send_status_notification(client.email, client.full_name, application.loan_type.value, new_status.value)
        if client.phone:
            from app.services.sms import send_status_sms
            send_status_sms(client.phone, new_status.value)
        create_notification(
            db,
            user_id=client.id,
            type="status_change",
            title=f"Application {new_status.value.replace('_', ' ')}",
            body=f"Your {application.loan_type.value} application has been updated to: {new_status.value.replace('_', ' ')}",
            link=f"/applications/{app_id}",
            tenant_id=tenant_id,
        )
        db.commit()
    elif application.applicant_email:
        applicant_name = " ".join(filter(None, [application.applicant_first_name, application.applicant_last_name])) or "Applicant"
        send_status_notification(application.applicant_email, applicant_name, application.loan_type.value, new_status.value)

    db.refresh(application, attribute_names=["user"])
    return _app_with_user(application, db)


@router.patch("/{app_id}/lock", response_model=LoanApplicationOut)
def set_application_lock(
    app_id: str,
    locked: bool = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Lock or unlock a draft application to prevent/allow client edits."""
    application = db.query(LoanApplication).filter(
        LoanApplication.id == app_id,
        LoanApplication.tenant_id == tenant_id,
        LoanApplication.deleted_at.is_(None),
    ).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    if application.status.value != "draft":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only draft applications can be locked")
    check_application_access(application, current_user, db=db)

    application.is_locked = locked
    action = "locked" if locked else "unlocked"
    log_activity(db, current_user.id, action, "application", app_id, {}, tenant_id=tenant_id)
    db.commit()
    db.refresh(application, attribute_names=["user"])
    return _app_with_user(application, db)


class ClientSectionsUpdate(BaseModel):
    sections: list[str]


@router.patch("/{app_id}/client-sections", response_model=LoanApplicationOut)
def set_client_sections(
    app_id: str,
    data: ClientSectionsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Set which form sections the client may complete (broker/admin, draft only)."""
    invalid = set(data.sections) - ALLOWED_SECTIONS
    if invalid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown sections: {sorted(invalid)}")

    application = db.query(LoanApplication).filter(
        LoanApplication.id == app_id,
        LoanApplication.tenant_id == tenant_id,
        LoanApplication.deleted_at.is_(None),
    ).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    if application.status.value != "draft":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only draft applications can be configured")
    check_application_access(application, current_user, db=db)

    # Dedupe and keep canonical order for stable storage.
    chosen = set(data.sections)
    selected = [s for s in SECTION_KEYS if s in chosen]
    application.client_sections = json.dumps(selected)
    log_activity(db, current_user.id, "client_sections_set", "application", app_id, {"sections": selected}, tenant_id=tenant_id)
    db.commit()
    db.refresh(application, attribute_names=["user"])
    return _app_with_user(application, db)


@router.post("/{app_id}/assign", response_model=LoanApplicationOut)
def assign_broker(
    app_id: str,
    broker_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Add a broker to the application's assigned brokers."""
    application = db.query(LoanApplication).filter(LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None)).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    broker = db.query(User).filter(User.id == broker_id, User.role == UserRole.broker, User.tenant_id == tenant_id).first()
    if not broker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Broker not found")

    if any(b.id == broker_id for b in application.brokers):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Broker is already assigned to this application")

    application.brokers.append(broker)
    # Keep legacy column in sync with the first broker
    if not application.assigned_broker_id:
        application.assigned_broker_id = broker_id
    log_activity(db, current_user.id, "broker_assigned", "application", app_id, {"broker_id": broker_id, "broker_name": broker.full_name}, tenant_id=tenant_id)
    create_notification(
        db,
        user_id=broker.id,
        type="status_change",
        title="Application assigned",
        body=f"You have been assigned to {application.applicant_first_name or 'a new'} {application.loan_type.value} application.",
        link=f"/admin/applications/{app_id}",
        tenant_id=tenant_id,
    )
    db.commit()
    db.refresh(application, attribute_names=["user", "assigned_broker"])

    # Email the newly assigned broker. The assigner performed the action in the UI
    # and doesn't need a confirmation email.
    item_label = f"{application.applicant_first_name or 'a new'} {application.loan_type.value} application"
    link = f"{FRONTEND_URL}/admin/applications/{app_id}"
    if broker.email:
        send_assignment_notification(broker.email, broker.full_name, False, item_label, current_user.full_name, link)

    return _app_with_user(application, db)


@router.delete("/{app_id}/assign", response_model=LoanApplicationOut)
def unassign_broker(
    app_id: str,
    broker_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Remove a broker (or admin) from the application's assigned brokers."""
    application = db.query(LoanApplication).filter(LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None)).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    # Allow removing both broker-role and admin-role users — legacy data may have
    # stored an admin's ID in assigned_broker_id which then got backfilled here.
    broker = db.query(User).filter(
        User.id == broker_id,
        User.role.in_([UserRole.broker, UserRole.admin]),
        User.tenant_id == tenant_id,
    ).first()
    if not broker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assigned user not found")

    if not any(b.id == broker_id for b in application.brokers):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Broker is not assigned to this application")

    application.brokers.remove(broker)
    # Keep legacy column in sync
    if application.assigned_broker_id == broker_id:
        application.assigned_broker_id = application.brokers[0].id if application.brokers else None
    log_activity(db, current_user.id, "broker_unassigned", "application", app_id, {"broker_id": broker_id, "broker_name": broker.full_name}, tenant_id=tenant_id)
    db.commit()
    db.refresh(application, attribute_names=["user", "assigned_broker"])
    return _app_with_user(application, db)


@router.post("/{app_id}/assign-group", response_model=LoanApplicationOut)
def assign_broker_group(
    app_id: str,
    group_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Assign all brokers in a broker group to the application."""
    from app.models.broker_group import BrokerGroup

    application = db.query(LoanApplication).filter(LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None)).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    group = db.query(BrokerGroup).filter(BrokerGroup.id == group_id, BrokerGroup.tenant_id == tenant_id).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Broker group not found")

    added = []
    for broker in group.members:
        if not any(b.id == broker.id for b in application.brokers):
            application.brokers.append(broker)
            added.append(broker)
            create_notification(
                db,
                user_id=broker.id,
                type="status_change",
                title="Application assigned",
                body=f"You have been assigned to {application.applicant_first_name or 'a new'} {application.loan_type.value} application.",
                link=f"/admin/applications/{app_id}",
                tenant_id=tenant_id,
            )

    if not application.assigned_broker_id and application.brokers:
        application.assigned_broker_id = application.brokers[0].id

    log_activity(db, current_user.id, "broker_group_assigned", "application", app_id,
                 {"group_id": group_id, "group_name": group.name, "brokers_added": [b.full_name for b in added]}, tenant_id=tenant_id)
    db.commit()
    db.refresh(application, attribute_names=["user", "assigned_broker"])

    # Email each newly assigned broker. The assigner performed the action in the UI
    # and doesn't need a confirmation email.
    if added:
        item_label = f"{application.applicant_first_name or 'a new'} {application.loan_type.value} application"
        link = f"{FRONTEND_URL}/admin/applications/{app_id}"
        for broker in added:
            if broker.email:
                send_assignment_notification(broker.email, broker.full_name, False, item_label, current_user.full_name, link)

    return _app_with_user(application, db)


@router.post("/{app_id}/analyze")
def trigger_analysis(
    app_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker", "referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    if not LLM_ANALYSIS_ENABLED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="LLM analysis is not configured (missing OPENAI_API_KEY)")

    application = db.query(LoanApplication).filter(LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None)).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user, db=db)

    # Prevent duplicate concurrent analysis
    if application.analysis_status == AnalysisStatus.processing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Analysis is already in progress")

    # Validate all documents have completed OCR
    docs = db.query(Document).filter(Document.application_id == app_id).all()
    if not docs:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No documents uploaded for this application")

    from app.models.document import OcrStatus

    incomplete = [d.original_filename for d in docs if d.ocr_status != OcrStatus.completed]
    if incomplete:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"OCR not completed for: {', '.join(incomplete)}",
        )

    # Set to pending and kick off background task
    application.analysis_status = AnalysisStatus.pending
    application.analysis_error = None
    log_activity(db, current_user.id, "analysis_triggered", "application", app_id, tenant_id=tenant_id)
    db.commit()

    from app.services.llm_analysis import run_analysis_background

    background_tasks.add_task(run_analysis_background, application_id=app_id, session_factory=SessionLocal)

    return {"status": "analysis_started", "application_id": app_id}


@router.get("/{app_id}/analysis")
def get_analysis(
    app_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker", "referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    application = db.query(LoanApplication).filter(LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None)).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user, db=db)

    return {
        "analysis_status": application.analysis_status.value if application.analysis_status else None,
        "analysis_result": application.analysis_result,
        "analysis_error": application.analysis_error,
        "analyzed_at": application.analyzed_at.isoformat() if application.analyzed_at else None,
    }


@router.delete("/{app_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_application(
    app_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    application = db.query(LoanApplication).filter(LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None)).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user, db=db)
    if current_user.role == UserRole.broker:
        if application.status.value != "draft":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Brokers can only delete draft applications")
    elif current_user.role != UserRole.admin:
        # Non-admin, non-broker: only own drafts (e.g. referrer cleaning up an auto-saved draft)
        if application.user_id != current_user.id or application.status.value != "draft":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins and brokers can delete applications")

    application.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
    log_activity(db, current_user.id, "deleted", "application", app_id, {"loan_type": application.loan_type.value}, tenant_id=tenant_id)
    db.commit()


class ClientInviteRequest(BaseModel):
    email: str
    portal_url: str

    @field_validator("portal_url")
    @classmethod
    def validate_portal_url(cls, v: str) -> str:
        from urllib.parse import urlsplit

        from app.config import FRONTEND_URL
        allowed = urlsplit(FRONTEND_URL)
        got = urlsplit(v)
        # Exact origin match, or a subdomain of it (tenant portals live on
        # {slug}.<frontend-host>). A prefix check on the raw string would let
        # e.g. https://<frontend-host>.evil.com through.
        host_ok = got.netloc.lower() == allowed.netloc.lower() or got.netloc.lower().endswith(
            "." + allowed.netloc.lower()
        )
        if got.scheme != allowed.scheme or not host_ok:
            raise ValueError(f"portal_url must be on the configured frontend origin ({FRONTEND_URL})")
        return v


@router.post("/{app_id}/client-invite")
def send_client_invite(
    app_id: str,
    data: ClientInviteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    application = db.query(LoanApplication).filter(
        LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None)
    ).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user, db=db)
    if application.status.value != "draft":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Can only invite for draft applications")

    if application.client_invite_sent_at:
        sent_at = application.client_invite_sent_at
        if sent_at.tzinfo is None:
            sent_at = sent_at.replace(tzinfo=timezone.utc)
        if (datetime.now(timezone.utc) - sent_at).total_seconds() < 120:
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Please wait at least 2 minutes before resending the invite")

    # Reuse an existing token (it may already be displayed/copied in the UI) so
    # the shared link stays valid; resending bumps sent_at, refreshing the TTL.
    token = application.client_invite_token or secrets.token_urlsafe(32)
    application.client_invite_token = token
    application.client_invite_email = data.email.strip()
    application.client_invite_sent_at = datetime.now(timezone.utc)
    application.hidden_from_client = False  # inviting releases it onto the client's portal
    log_activity(db, current_user.id, "client_invite_sent", "application", app_id, {"email": data.email.strip()}, tenant_id=tenant_id)
    db.commit()

    invite_url = f"{data.portal_url.rstrip('/')}/apply/{token}"
    applicant_name = " ".join(
        filter(None, [application.applicant_first_name, application.applicant_last_name])
    ) or "there"

    from app.services.email import _send_async
    if EMAIL_ENABLED:
        body = (
            f"Hi {applicant_name},\n\n"
            f"You have been invited to complete a loan application through Xpress Finance.\n\n"
            f"Please click the link below to fill in your details:\n\n"
            f"{invite_url}\n\n"
            f"This link is unique to you — please do not share it.\n\n"
            f"Best regards,\nXpress Finance Team"
        )
        _send_async(data.email.strip(), "Complete Your Loan Application — Xpress Finance", body)

    return {"success": True, "invite_url": invite_url}


# ---------------------------------------------------------------------------
# Commercial multi-director endpoints
# ---------------------------------------------------------------------------

_APPLICANT_FIELDS = set(LoanApplicantCreate.model_fields) - {"invite_email"}


def _load_commercial_app(app_id: str, current_user: User, db: Session, tenant_id: str) -> LoanApplication:
    application = db.query(LoanApplication).filter(
        LoanApplication.id == app_id,
        LoanApplication.tenant_id == tenant_id,
        LoanApplication.deleted_at.is_(None),
    ).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user, db=db)
    if application.loan_type not in COMMERCIAL_LOAN_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Directors can only be added to commercial loan applications",
        )
    return application


def _build_invited_party(
    db: Session,
    application: LoanApplication,
    tenant_id: str,
    data: LoanApplicantCreate,
    *,
    application_guarantor_id: Optional[str] = None,
) -> LoanApplicant:
    """Create a LoanApplicant row with a fresh magic-link invite token.

    Caller commits. ``invite_email`` is required — every party self-completes.
    """
    invite_email = (data.invite_email or "").strip()
    if not invite_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An email is required so the director/guarantor can be invited to complete their details",
        )
    applicant = LoanApplicant(
        tenant_id=tenant_id,
        application_id=application.id,
        application_guarantor_id=application_guarantor_id,
        is_primary=False,
        **{k: v for k, v in data.model_dump(exclude_none=True).items() if k in _APPLICANT_FIELDS},
    )
    applicant.invite_token = secrets.token_urlsafe(32)
    applicant.invite_email = invite_email
    applicant.invite_sent_at = datetime.now(timezone.utc)
    db.add(applicant)
    return applicant


def _send_party_invite(applicant: LoanApplicant, company_name: Optional[str]) -> None:
    """Email a party the magic-link to self-complete their block."""
    if not (EMAIL_ENABLED and applicant.invite_token and applicant.invite_email):
        return
    from app.services.email import _send_async
    company = company_name or "your company"
    party_label = "guarantor" if applicant.role == "guarantor" else "director"
    invite_url = f"{FRONTEND_URL.rstrip('/')}/apply/{applicant.invite_token}"
    body = (
        f"Hi,\n\n"
        f"You have been invited as a {party_label} to complete your part of a commercial "
        f"loan application for {company} through Xpress Finance.\n\n"
        f"Please click the link below to fill in your details:\n\n"
        f"{invite_url}\n\n"
        f"This link is unique to you — please do not share it.\n\n"
        f"Best regards,\nXpress Finance Team"
    )
    subject = f"Complete Your {party_label.capitalize()} Details — Xpress Finance"
    _send_async(applicant.invite_email, subject, body)


@router.post("/{app_id}/directors", response_model=LoanApplicantOut, status_code=status.HTTP_201_CREATED)
def add_director(
    app_id: str,
    data: LoanApplicantCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Add a direct individual director/guarantor to a commercial application.

    Every party is emailed a magic-link invite to self-complete their own block,
    so ``invite_email`` is required.
    """
    application = _load_commercial_app(app_id, current_user, db, tenant_id)
    applicant = _build_invited_party(db, application, tenant_id, data)
    log_activity(db, current_user.id, "director_added", "application", app_id,
                 {"role": applicant.role, "invited": True}, tenant_id=tenant_id)
    db.commit()
    db.refresh(applicant)
    _send_party_invite(applicant, application.business_name)
    # Transient attr: surfaces the copyable link on this response only
    applicant.invite_url = f"{FRONTEND_URL.rstrip('/')}/apply/{applicant.invite_token}"
    return applicant


@router.delete("/{app_id}/directors/{applicant_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_director(
    app_id: str,
    applicant_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    application = _load_commercial_app(app_id, current_user, db, tenant_id)
    applicant = db.query(LoanApplicant).filter(
        LoanApplicant.id == applicant_id,
        LoanApplicant.application_id == application.id,
    ).first()
    if not applicant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Director not found")
    db.delete(applicant)
    log_activity(db, current_user.id, "director_removed", "application", app_id, tenant_id=tenant_id)
    db.commit()
    return None


class ReconcileRequest(BaseModel):
    note: Optional[str] = None


@router.post("/{app_id}/reconcile", response_model=LoanApplicationOut)
def reconcile_application(
    app_id: str,
    data: ReconcileRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Broker resolves a flagged application: accept the divergent director(s) as-is.

    To split a director into a separate application instead, remove them with the
    DELETE endpoint and create a new application.
    """
    application = _load_commercial_app(app_id, current_user, db, tenant_id)
    application.needs_reconciliation = False
    application.reconciliation_note = data.note
    log_activity(db, current_user.id, "application_reconciled", "application", app_id,
                 {"note": data.note}, tenant_id=tenant_id)
    db.commit()
    db.refresh(application)
    return _app_with_user(application, db)


# ---------------------------------------------------------------------------
# Corporate guarantor endpoints (a company guaranteeing a commercial loan)
# ---------------------------------------------------------------------------

def _load_guarantor(
    application: LoanApplication, guarantor_id: str, db: Session
) -> ApplicationGuarantor:
    guarantor = db.query(ApplicationGuarantor).filter(
        ApplicationGuarantor.id == guarantor_id,
        ApplicationGuarantor.application_id == application.id,
    ).first()
    if not guarantor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Corporate guarantor not found")
    return guarantor


@router.post("/{app_id}/guarantors", response_model=CorporateGuarantorOut, status_code=status.HTTP_201_CREATED)
def add_corporate_guarantor(
    app_id: str,
    data: CorporateGuarantorCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Attach a company as a guarantor. Its known directors (from the contact book)
    are seeded as signatories and invited to sign; more can be added afterwards."""
    application = _load_commercial_app(app_id, current_user, db, tenant_id)

    org = find_or_create_organization_by_abn(db, tenant_id, data.business_abn, data.business_name)
    if not org:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A business name or ABN is required to add a corporate guarantor",
        )
    if org.id == application.business_organization_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The borrowing company cannot guarantee its own loan",
        )
    existing = db.query(ApplicationGuarantor).filter(
        ApplicationGuarantor.application_id == application.id,
        ApplicationGuarantor.organization_id == org.id,
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That company is already a guarantor on this application",
        )

    guarantor = ApplicationGuarantor(
        tenant_id=tenant_id, application_id=application.id, organization_id=org.id
    )
    db.add(guarantor)
    db.flush()  # need guarantor.id for the seeded signatories

    # Seed signatories from the guarantor company's known directors. Only those
    # with an email can be auto-invited; others are skipped (broker adds them).
    seeded: list[LoanApplicant] = []
    links = db.query(ContactOrganization).filter(
        ContactOrganization.organization_id == org.id,
        ContactOrganization.tenant_id == tenant_id,
    ).all()
    for link in links:
        if (link.role or "").lower() not in ("director", "guarantor"):
            continue
        contact = link.contact
        if not contact or not contact.email:
            continue
        applicant = LoanApplicant(
            tenant_id=tenant_id,
            application_id=application.id,
            application_guarantor_id=guarantor.id,
            contact_id=contact.id,
            role="director",
            applicant_first_name=contact.first_name,
            applicant_last_name=contact.last_name,
            applicant_email=contact.email,
            invite_email=contact.email,
            invite_token=secrets.token_urlsafe(32),
            invite_sent_at=datetime.now(timezone.utc),
        )
        db.add(applicant)
        seeded.append(applicant)

    log_activity(db, current_user.id, "guarantor_added", "application", app_id,
                 {"organization_id": org.id, "seeded_signatories": len(seeded)}, tenant_id=tenant_id)
    db.commit()
    db.refresh(guarantor)
    result = guarantor_dict(guarantor)
    seeded_urls = {}
    for s in seeded:
        _send_party_invite(s, org.name)
        seeded_urls[s.id] = f"{FRONTEND_URL.rstrip('/')}/apply/{s.invite_token}"
    for sig in result["signatories"]:
        if sig["id"] in seeded_urls:
            sig["invite_url"] = seeded_urls[sig["id"]]
    return result


@router.post(
    "/{app_id}/guarantors/{guarantor_id}/signatories",
    response_model=LoanApplicantOut,
    status_code=status.HTTP_201_CREATED,
)
def add_guarantor_signatory(
    app_id: str,
    guarantor_id: str,
    data: LoanApplicantCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Add a director of the guarantor company who must sign the guarantee."""
    application = _load_commercial_app(app_id, current_user, db, tenant_id)
    guarantor = _load_guarantor(application, guarantor_id, db)
    applicant = _build_invited_party(
        db, application, tenant_id, data, application_guarantor_id=guarantor.id
    )
    applicant.role = "director"  # signatories of a corporate guarantor are its directors
    log_activity(db, current_user.id, "guarantor_signatory_added", "application", app_id,
                 {"guarantor_id": guarantor.id}, tenant_id=tenant_id)
    db.commit()
    db.refresh(applicant)
    company_name = guarantor.organization.name if guarantor.organization else application.business_name
    _send_party_invite(applicant, company_name)
    applicant.invite_url = f"{FRONTEND_URL.rstrip('/')}/apply/{applicant.invite_token}"
    return applicant


@router.delete("/{app_id}/guarantors/{guarantor_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_corporate_guarantor(
    app_id: str,
    guarantor_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    application = _load_commercial_app(app_id, current_user, db, tenant_id)
    guarantor = _load_guarantor(application, guarantor_id, db)
    db.delete(guarantor)  # cascades signatory rows
    log_activity(db, current_user.id, "guarantor_removed", "application", app_id,
                 {"guarantor_id": guarantor_id}, tenant_id=tenant_id)
    db.commit()
    return None
