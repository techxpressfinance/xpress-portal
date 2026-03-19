from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload, selectinload

from app.config import LEND_ENABLED, LLM_ANALYSIS_ENABLED
from app.database import SessionLocal, get_db
from app.middleware.auth import get_current_user, require_role
from app.models.application_broker import ApplicationBroker
from app.models.document import DocType, Document
from app.models.loan_application import AnalysisStatus, ApplicationStatus, LoanApplication, LoanType
from app.models.application_note import ApplicationNote
from app.models.referral import Referral, ReferralStatus
from app.models.user import User, UserRole

REQUIRED_DOC_TYPES = {DocType.id_proof, DocType.address_proof, DocType.bank_statement, DocType.payslip, DocType.tax_return}
from app.services.access_control import check_application_access
from app.services.activity_log import log_activity
from app.services.email import send_status_notification
from app.schemas.loan_application import (
    LoanApplicationCreate,
    LoanApplicationOut,
    LoanApplicationUpdate,
    PaginatedApplications,
)

router = APIRouter(prefix="/api/applications", tags=["applications"])


def _app_with_user(app: LoanApplication) -> dict:
    """Build response dict with user info and assigned brokers list."""
    data = {c.name: getattr(app, c.name) for c in app.__table__.columns}
    if app.user:
        data["user_name"] = app.user.full_name
        data["user_email"] = app.user.email
    # Backward compat: first assigned broker populates the legacy fields
    if app.brokers:
        data["assigned_broker_id"] = app.brokers[0].id
        data["assigned_broker_name"] = app.brokers[0].full_name
    else:
        data["assigned_broker_id"] = None
        data["assigned_broker_name"] = None
    data["assigned_brokers"] = [{"id": b.id, "full_name": b.full_name} for b in app.brokers]
    # Completion info
    if app.completed_by:
        data["completed_by_name"] = app.completed_by.full_name
    else:
        data["completed_by_name"] = None
    return data

# Valid status transitions
VALID_TRANSITIONS = {
    "draft": ["submitted"],
    "submitted": ["reviewing", "rejected"],
    "reviewing": ["approved", "rejected"],
    "approved": [],
    "rejected": [],
}


@router.post("", response_model=LoanApplicationOut, status_code=status.HTTP_201_CREATED)
def create_application(
    data: LoanApplicationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    app = LoanApplication(user_id=current_user.id, **data.model_dump())
    db.add(app)
    db.flush()
    log_activity(db, current_user.id, "created", "application", app.id, {"loan_type": data.loan_type, "amount": str(data.amount)})

    # Update referral status to "applied" if this user was referred
    referral = db.query(Referral).filter(
        Referral.referred_user_id == current_user.id,
        Referral.status == ReferralStatus.signed_up,
    ).first()
    if referral:
        referral.status = ReferralStatus.applied
        referral.converted_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(app, attribute_names=["user"])
    return _app_with_user(app)


@router.get("", response_model=PaginatedApplications)
def list_applications(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status_filter: ApplicationStatus | None = Query(None, alias="status"),
    loan_type: LoanType | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(LoanApplication).options(joinedload(LoanApplication.user), joinedload(LoanApplication.assigned_broker), selectinload(LoanApplication.brokers), selectinload(LoanApplication.completed_by))

    if current_user.role == UserRole.client:
        query = query.filter(LoanApplication.user_id == current_user.id)
    elif current_user.role == UserRole.broker:
        # Brokers only see applications they are assigned to
        query = query.filter(
            LoanApplication.id.in_(
                db.query(ApplicationBroker.application_id).filter(ApplicationBroker.broker_id == current_user.id)
            )
        )

    if status_filter:
        query = query.filter(LoanApplication.status == status_filter)
    if loan_type:
        query = query.filter(LoanApplication.loan_type == loan_type)
    if search:
        query = query.join(User, LoanApplication.user_id == User.id).filter(
            User.full_name.ilike(f"%{search}%") | User.email.ilike(f"%{search}%")
        )

    total = query.count()
    items = query.order_by(LoanApplication.created_at.desc()).offset((page - 1) * per_page).limit(per_page).all()

    return PaginatedApplications(items=[_app_with_user(app) for app in items], total=total, page=page, per_page=per_page)


@router.get("/{app_id}", response_model=LoanApplicationOut)
def get_application(
    app_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    application = db.query(LoanApplication).options(joinedload(LoanApplication.user), joinedload(LoanApplication.assigned_broker), selectinload(LoanApplication.brokers), selectinload(LoanApplication.completed_by)).filter(LoanApplication.id == app_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user)
    return _app_with_user(application)


@router.patch("/{app_id}", response_model=LoanApplicationOut)
def update_application(
    app_id: str,
    data: LoanApplicationUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    application = db.query(LoanApplication).filter(LoanApplication.id == app_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user)

    is_draft = application.status.value == "draft"

    # Clients can only edit drafts
    if current_user.role == UserRole.client and not is_draft:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot edit submitted application")

    # Brokers/admins can only edit field values on drafts (notes always allowed)
    if current_user.role != UserRole.client and not is_draft:
        field_updates = data.model_dump(exclude_unset=True)
        field_updates.pop("status", None)
        _BROKER_ALLOWED_FIELDS = {
            "notes", "lend_product_type_id", "lend_owner_type", "lend_send_type", "lend_who_to_contact", "lend_extra_data",
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

    # Handle draft -> submitted for any role
    if requested_status == "submitted":
        if not is_draft:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only draft applications can be submitted")
        uploaded_types = {
            doc.doc_type for doc in db.query(Document).filter(Document.application_id == app_id).all()
        }
        missing = REQUIRED_DOC_TYPES - uploaded_types
        if missing:
            missing_labels = [t.value.replace("_", " ").title() for t in missing]
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Missing required documents: {', '.join(missing_labels)}",
            )
        updates["status"] = "submitted"

        # Track broker/admin completion on behalf of client
        if current_user.role != UserRole.client:
            application.completed_by_id = current_user.id
            application.completed_at = datetime.now(timezone.utc)
            log_activity(db, current_user.id, "broker_completed", "application", app_id,
                        {"on_behalf_of": application.user_id})

            # Notify the client
            client_user = db.query(User).filter(User.id == application.user_id).first()
            if client_user:
                send_status_notification(client_user.email, client_user.full_name, application.loan_type.value, "submitted")

    for key, value in updates.items():
        setattr(application, key, value)

    # Detect if status just changed to submitted for Lend auto-sync
    becoming_submitted = updates.get("status") == "submitted"

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
):
    application = db.query(LoanApplication).filter(LoanApplication.id == app_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user)

    current = application.status.value
    allowed = VALID_TRANSITIONS.get(current, [])
    if new_status.value not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot transition from '{current}' to '{new_status.value}'. Allowed: {allowed}",
        )

    old_status = current
    application.status = new_status
    log_activity(db, current_user.id, "status_changed", "application", app_id, {"from": old_status, "to": new_status.value})
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
):
    """Add a broker to the application's assigned brokers."""
    application = db.query(LoanApplication).filter(LoanApplication.id == app_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    broker = db.query(User).filter(User.id == broker_id, User.role == UserRole.broker).first()
    if not broker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Broker not found")

    if any(b.id == broker_id for b in application.brokers):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Broker is already assigned to this application")

    application.brokers.append(broker)
    # Keep legacy column in sync with the first broker
    if not application.assigned_broker_id:
        application.assigned_broker_id = broker_id
    log_activity(db, current_user.id, "broker_assigned", "application", app_id, {"broker_id": broker_id, "broker_name": broker.full_name})
    db.commit()
    db.refresh(application, attribute_names=["user", "assigned_broker"])
    return _app_with_user(application)


@router.delete("/{app_id}/assign", response_model=LoanApplicationOut)
def unassign_broker(
    app_id: str,
    broker_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Remove a broker from the application's assigned brokers."""
    application = db.query(LoanApplication).filter(LoanApplication.id == app_id).first()
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
    log_activity(db, current_user.id, "broker_unassigned", "application", app_id, {"broker_id": broker_id, "broker_name": broker.full_name})
    db.commit()
    db.refresh(application, attribute_names=["user", "assigned_broker"])
    return _app_with_user(application)


@router.post("/{app_id}/analyze")
def trigger_analysis(
    app_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
):
    if not LLM_ANALYSIS_ENABLED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="LLM analysis is not configured (missing OPENAI_API_KEY)")

    application = db.query(LoanApplication).filter(LoanApplication.id == app_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user)

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
):
    application = db.query(LoanApplication).filter(LoanApplication.id == app_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user)

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
):
    application = db.query(LoanApplication).filter(LoanApplication.id == app_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user)
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

    log_activity(db, current_user.id, "deleted", "application", app_id, {"loan_type": application.loan_type.value})
    db.delete(application)
    db.commit()
