from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session, joinedload, selectinload

from app.config import EMAIL_ENABLED, LEND_ENABLED, LLM_ANALYSIS_ENABLED
from app.database import SessionLocal, get_db
from app.middleware.auth import get_current_user, require_role
from app.models.application_broker import ApplicationBroker
from app.models.document import DocType, Document
from app.models.external_referral import ExternalReferral, ExternalReferralStatus
from app.models.loan_application import AnalysisStatus, ApplicationStatus, LoanApplication, LoanType
from app.models.application_note import ApplicationNote
from app.models.referral import Referral, ReferralStatus
from app.models.user import User, UserRole

REQUIRED_DOC_TYPES = {DocType.id_proof, DocType.address_proof, DocType.bank_statement, DocType.payslip, DocType.tax_return}
from app.constants import VALID_TRANSITIONS
from app.services.query_utils import escape_like
from app.services.access_control import check_application_access
from app.services.activity_log import log_activity
from app.services.serialization import app_with_user as _app_with_user
from app.services.email import send_status_notification
from app.schemas.loan_application import (
    LoanApplicationCreate,
    LoanApplicationOut,
    LoanApplicationUpdate,
    PaginatedApplications,
)
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/applications", tags=["applications"])


@router.post("", response_model=LoanApplicationOut, status_code=status.HTTP_201_CREATED)
def create_application(
    data: LoanApplicationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    app = LoanApplication(user_id=current_user.id, tenant_id=tenant_id, **data.model_dump())
    db.add(app)
    db.flush()
    log_activity(db, current_user.id, "created", "application", app.id, {"loan_type": data.loan_type, "amount": str(data.amount)}, tenant_id=tenant_id)

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

    db.commit()
    db.refresh(app, attribute_names=["user"])
    return _app_with_user(app)


@router.get("", response_model=PaginatedApplications)
def list_applications(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status_filter: Optional[ApplicationStatus] = Query(None, alias="status"),
    loan_type: Optional[LoanType] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    query = db.query(LoanApplication).options(joinedload(LoanApplication.user), joinedload(LoanApplication.assigned_broker), selectinload(LoanApplication.brokers), selectinload(LoanApplication.completed_by)).filter(LoanApplication.tenant_id == tenant_id)

    if current_user.role == UserRole.client:
        query = query.filter(LoanApplication.user_id == current_user.id)
    elif current_user.role == UserRole.broker:
        # Brokers see: applications assigned to them + referrer-submitted leads + their own created leads
        from sqlalchemy import or_
        referrer_ids = db.query(User.id).filter(User.role == UserRole.referrer, User.tenant_id == tenant_id)
        query = query.filter(
            or_(
                LoanApplication.id.in_(
                    db.query(ApplicationBroker.application_id).filter(ApplicationBroker.broker_id == current_user.id)
                ),
                LoanApplication.user_id.in_(referrer_ids),
                LoanApplication.user_id == current_user.id,
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
    if loan_type:
        query = query.filter(LoanApplication.loan_type == loan_type)
    if search:
        safe_search = escape_like(search)
        query = query.join(User, LoanApplication.user_id == User.id).filter(
            User.full_name.ilike(f"%{safe_search}%", escape="\\") | User.email.ilike(f"%{safe_search}%", escape="\\")
        )

    total = query.count()
    items = query.order_by(LoanApplication.created_at.desc()).offset((page - 1) * per_page).limit(per_page).all()

    return PaginatedApplications(items=[_app_with_user(app) for app in items], total=total, page=page, per_page=per_page)


@router.get("/analytics")
def get_application_analytics(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    from sqlalchemy import func, or_

    query = db.query(LoanApplication).filter(LoanApplication.tenant_id == tenant_id)

    if current_user.role == UserRole.client:
        query = query.filter(LoanApplication.user_id == current_user.id)
    elif current_user.role == UserRole.broker:
        referrer_ids = db.query(User.id).filter(User.role == UserRole.referrer, User.tenant_id == tenant_id)
        query = query.filter(
            or_(
                LoanApplication.id.in_(
                    db.query(ApplicationBroker.application_id).filter(ApplicationBroker.broker_id == current_user.id)
                ),
                LoanApplication.user_id.in_(referrer_ids),
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


@router.get("/{app_id}", response_model=LoanApplicationOut)
def get_application(
    app_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    application = db.query(LoanApplication).options(joinedload(LoanApplication.user), joinedload(LoanApplication.assigned_broker), selectinload(LoanApplication.brokers), selectinload(LoanApplication.completed_by)).filter(LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user, db=db)
    return _app_with_user(application)


@router.patch("/{app_id}", response_model=LoanApplicationOut)
def update_application(
    app_id: str,
    data: LoanApplicationUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    application = db.query(LoanApplication).filter(LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    check_application_access(application, current_user, db=db)

    is_draft = application.status.value == "draft"

    # Clients can only edit drafts
    if current_user.role == UserRole.client and not is_draft:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot edit submitted application")

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
            "client_engagement_model",
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
            if client_user:
                send_status_notification(client_user.email, client_user.full_name, application.loan_type.value, "application_received")

    for key, value in updates.items():
        setattr(application, key, value)

    if updates:
        log_activity(db, current_user.id, "updated", "application", app_id, {"fields": list(updates.keys())}, tenant_id=tenant_id)

    # Detect if status just changed to application_received for Lend auto-sync
    becoming_submitted = updates.get("status") == "application_received"

    db.commit()

    # Auto-sync to Lend on submission
    if becoming_submitted and LEND_ENABLED:
        from app.services.lend import sync_to_lend_background
        background_tasks.add_task(sync_to_lend_background, application_id=app_id, session_factory=SessionLocal)

    db.refresh(application, attribute_names=["user"])
    return _app_with_user(application)


@router.patch("/{app_id}/status", response_model=LoanApplicationOut)
def change_status(
    app_id: str,
    new_status: ApplicationStatus = Query(..., alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    application = db.query(LoanApplication).filter(LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id).first()
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
    if client:
        send_status_notification(client.email, client.full_name, application.loan_type.value, new_status.value)
        if client.phone:
            from app.services.sms import send_status_sms
            send_status_sms(client.phone, new_status.value)

    db.refresh(application, attribute_names=["user"])
    return _app_with_user(application)


@router.post("/{app_id}/assign", response_model=LoanApplicationOut)
def assign_broker(
    app_id: str,
    broker_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Add a broker to the application's assigned brokers."""
    application = db.query(LoanApplication).filter(LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id).first()
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
    db.commit()
    db.refresh(application, attribute_names=["user", "assigned_broker"])
    return _app_with_user(application)


@router.delete("/{app_id}/assign", response_model=LoanApplicationOut)
def unassign_broker(
    app_id: str,
    broker_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Remove a broker from the application's assigned brokers."""
    application = db.query(LoanApplication).filter(LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    broker = db.query(User).filter(User.id == broker_id, User.role == UserRole.broker).first()
    if not broker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Broker not found")

    if not any(b.id == broker_id for b in application.brokers):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Broker is not assigned to this application")

    application.brokers.remove(broker)
    # Keep legacy column in sync
    if application.assigned_broker_id == broker_id:
        application.assigned_broker_id = application.brokers[0].id if application.brokers else None
    log_activity(db, current_user.id, "broker_unassigned", "application", app_id, {"broker_id": broker_id, "broker_name": broker.full_name}, tenant_id=tenant_id)
    db.commit()
    db.refresh(application, attribute_names=["user", "assigned_broker"])
    return _app_with_user(application)


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

    application = db.query(LoanApplication).filter(LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    group = db.query(BrokerGroup).filter(BrokerGroup.id == group_id, BrokerGroup.tenant_id == tenant_id).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Broker group not found")

    added = []
    for broker in group.members:
        if not any(b.id == broker.id for b in application.brokers):
            application.brokers.append(broker)
            added.append(broker.full_name)

    if not application.assigned_broker_id and application.brokers:
        application.assigned_broker_id = application.brokers[0].id

    log_activity(db, current_user.id, "broker_group_assigned", "application", app_id,
                 {"group_id": group_id, "group_name": group.name, "brokers_added": added}, tenant_id=tenant_id)
    db.commit()
    db.refresh(application, attribute_names=["user", "assigned_broker"])
    return _app_with_user(application)


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

    application = db.query(LoanApplication).filter(LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id).first()
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
    application = db.query(LoanApplication).filter(LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id).first()
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
    application = db.query(LoanApplication).filter(LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user, db=db)
    if application.status.value != "draft":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only draft applications can be deleted")

    # Delete associated documents and their files via the storage abstraction
    from app.services.s3_storage import delete_file

    docs = db.query(Document).filter(Document.application_id == app_id).all()
    for doc in docs:
        if doc.file_path:
            delete_file(doc.file_path)
        db.delete(doc)

    # Delete associated notes
    db.query(ApplicationNote).filter(ApplicationNote.application_id == app_id).delete()

    log_activity(db, current_user.id, "deleted", "application", app_id, {"loan_type": application.loan_type.value}, tenant_id=tenant_id)
    db.delete(application)
    db.commit()


class ClientInviteRequest(BaseModel):
    email: str
    portal_url: str

    @field_validator("portal_url")
    @classmethod
    def validate_portal_url(cls, v: str) -> str:
        from app.config import FRONTEND_URL
        allowed = FRONTEND_URL.rstrip("/")
        if not v.rstrip("/").startswith(allowed):
            raise ValueError(f"portal_url must be within the configured frontend origin ({allowed})")
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
        LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id
    ).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user, db=db)
    if application.status.value != "draft":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Can only invite for draft applications")

    token = secrets.token_urlsafe(32)
    application.client_invite_token = token
    application.client_invite_email = data.email.strip()
    application.client_invite_sent_at = datetime.now(timezone.utc)
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
