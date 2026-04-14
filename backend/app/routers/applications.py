from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload, selectinload

from app.config import LEND_ENABLED, LLM_ANALYSIS_ENABLED
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
        # Brokers only see applications they are assigned to
        query = query.filter(
            LoanApplication.id.in_(
                db.query(ApplicationBroker.application_id).filter(ApplicationBroker.broker_id == current_user.id)
            )
        )
    elif current_user.role == UserRole.referrer:
        # Referrers only see applications from clients they referred
        referred_client_ids = (
            db.query(ExternalReferral.referred_client_id)
            .filter(
                ExternalReferral.referrer_id == current_user.id,
                ExternalReferral.referred_client_id.isnot(None),
            )
        )
        query = query.filter(LoanApplication.user_id.in_(referred_client_ids))

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

    # Referrers have read-only access
    if current_user.role == UserRole.referrer:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Referrers have read-only access")

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

        # Track broker/admin completion on behalf of client
        if current_user.role != UserRole.client:
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

    # Send email notification to client
    client = db.query(User).filter(User.id == application.user_id).first()
    if client:
        send_status_notification(client.email, client.full_name, application.loan_type.value, new_status.value)

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
    current_user: User = Depends(require_role("admin", "broker")),
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
    db.commit()

    from app.services.llm_analysis import run_analysis_background

    background_tasks.add_task(run_analysis_background, application_id=app_id, session_factory=SessionLocal)

    return {"status": "analysis_started", "application_id": app_id}


@router.get("/{app_id}/analysis")
def get_analysis(
    app_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
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
