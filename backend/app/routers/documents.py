import io
import os
import uuid
import zipfile
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, UploadFile, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session

from app.config import ONEDRIVE_ENABLED
from app.database import SessionLocal, get_db
from app.middleware.rate_limit import RateLimiter
from app.services.s3_storage import delete_file, download_file, file_exists, upload_file
from app.middleware.auth import get_current_user, require_role
from app.models.document import DocType, Document
from app.models.document_request import DocumentRequest
from app.models.loan_application import LoanApplication
from app.models.user import User
from app.schemas.document import DocumentOut
from app.schemas.document_request import DocumentRequestCreate, DocumentRequestOut
from app.services.access_control import check_application_access
from app.services.activity_log import log_activity
from app.services.email import send_document_request_email
from app.services.notification_service import create_notification
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/documents", tags=["documents"])

upload_limiter = RateLimiter(max_requests=20, window_seconds=60)


@router.post("/upload/{application_id}", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
def upload_document(
    application_id: str,
    doc_type: DocType,
    file: UploadFile,
    request: Request,
    background_tasks: BackgroundTasks,
    label: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    upload_limiter.check(request)
    application = db.query(LoanApplication).filter(LoanApplication.id == application_id, LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None)).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user, db=db)

    # Validate file extension
    allowed_types = {".pdf", ".jpg", ".jpeg", ".png"}
    ext = os.path.splitext(file.filename or "file")[1].lower()
    if ext not in allowed_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type '{ext}' not allowed. Allowed: {', '.join(allowed_types)}",
        )

    # Validate file size (max 10MB)
    contents = file.file.read()

    # Validate file content matches extension via magic bytes
    _MAGIC = {
        b"\x25\x50\x44\x46": {".pdf"},
        b"\xff\xd8\xff": {".jpg", ".jpeg"},
        b"\x89\x50\x4e\x47": {".png"},
    }
    content_valid = False
    for magic, valid_exts in _MAGIC.items():
        if contents[:len(magic)] == magic and ext in valid_exts:
            content_valid = True
            break
    if not content_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File content does not match its extension",
        )
    max_size = 10 * 1024 * 1024
    if len(contents) > max_size:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File size exceeds 10MB limit",
        )

    stored_name = f"{uuid.uuid4()}{ext}"
    file_path = upload_file(contents, stored_name)

    # Sanitize filename: strip path components and dangerous characters
    raw_name = file.filename or "unknown"
    safe_filename = os.path.basename(raw_name).replace("\r", "").replace("\n", "").replace("\x00", "")
    if not safe_filename:
        safe_filename = "unknown"

    # Use label as display name if provided, keeping the original extension
    if label and label.strip():
        display_name = label.strip() + ext
    else:
        display_name = safe_filename

    doc = Document(
        application_id=application_id,
        doc_type=doc_type,
        file_path=file_path,
        original_filename=display_name,
        tenant_id=tenant_id,
    )
    db.add(doc)
    db.flush()
    log_activity(db, current_user.id, "document_uploaded", "document", doc.id, {"filename": display_name, "doc_type": doc_type.value, "application_id": application_id}, tenant_id=tenant_id)
    db.commit()
    db.refresh(doc)

    if ONEDRIVE_ENABLED:
        from app.services.onedrive import upload_document_background

        customer = db.query(User).filter(User.id == application.user_id).first()
        customer_name = customer.full_name if customer else "Unknown"
        background_tasks.add_task(
            upload_document_background,
            document_id=doc.id,
            file_path=file_path,
            customer_full_name=customer_name,
            application_id=application_id,
            original_filename=doc.original_filename,
            session_factory=SessionLocal,
        )

    from app.services.ocr import run_ocr_background

    background_tasks.add_task(
        run_ocr_background,
        document_id=doc.id,
        file_path=file_path,
        session_factory=SessionLocal,
    )

    return doc


@router.get("/application/{application_id}/download-all")
def download_all_documents(
    application_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    application = db.query(LoanApplication).filter(
        LoanApplication.id == application_id, LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None)
    ).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user, db=db)

    docs = db.query(Document).filter(Document.application_id == application_id).all()
    if not docs:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No documents found for this application")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        seen: dict[str, int] = {}
        for doc in docs:
            contents = download_file(doc.file_path)
            name = doc.original_filename or f"document_{doc.id[:8]}"
            if name in seen:
                seen[name] += 1
                base, ext = os.path.splitext(name)
                name = f"{base}_{seen[name]}{ext}"
            else:
                seen[name] = 0
            zf.writestr(name, contents)
    zip_buffer.seek(0)

    first_name = application.applicant_first_name or ""
    last_name = application.applicant_last_name or ""
    applicant = f"{first_name} {last_name}".strip() or application.id[:8]
    safe = "".join(c if c.isalnum() or c in (" ", "-", "_") else "_" for c in applicant).strip()
    zip_filename = f"{safe}-documents.zip"

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_filename}"'},
    )


@router.get("/application/{application_id}", response_model=list[DocumentOut])
def list_documents(
    application_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    application = db.query(LoanApplication).filter(LoanApplication.id == application_id, LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None)).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user, db=db)
    return db.query(Document).filter(Document.application_id == application_id).all()


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    doc_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    doc = db.query(Document).filter(Document.id == doc_id, Document.tenant_id == tenant_id).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    application = db.query(LoanApplication).filter(LoanApplication.id == doc.application_id, LoanApplication.deleted_at.is_(None)).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user, db=db)
    if application.status.value != "draft":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete documents from a submitted application")

    # Remove file from storage
    delete_file(doc.file_path)

    log_activity(db, current_user.id, "document_deleted", "document", doc_id, {"filename": doc.original_filename, "doc_type": doc.doc_type.value, "application_id": doc.application_id}, tenant_id=tenant_id)
    db.delete(doc)
    db.commit()


@router.get("/{doc_id}/download")
def download_document(
    doc_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    doc = db.query(Document).filter(Document.id == doc_id, Document.tenant_id == tenant_id).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    application = db.query(LoanApplication).filter(LoanApplication.id == doc.application_id, LoanApplication.deleted_at.is_(None)).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user, db=db)

    if not file_exists(doc.file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found in storage")

    file_bytes = download_file(doc.file_path)
    ext = os.path.splitext(doc.original_filename or "file")[1].lower()
    media_types = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}
    media_type = media_types.get(ext, "application/octet-stream")

    # Sanitize filename to prevent header injection
    safe_name = (doc.original_filename or "file").replace("\r", "").replace("\n", "").replace('"', "'")
    safe_name = os.path.basename(safe_name)  # Strip path components

    return Response(
        content=file_bytes,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


@router.get("/{doc_id}/ocr-text")
def get_ocr_text(
    doc_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    doc = db.query(Document).filter(Document.id == doc_id, Document.tenant_id == tenant_id).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    application = db.query(LoanApplication).filter(LoanApplication.id == doc.application_id, LoanApplication.deleted_at.is_(None)).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user, db=db)

    return {
        "ocr_status": doc.ocr_status.value if doc.ocr_status else "pending",
        "ocr_text": doc.ocr_text,
        "ocr_error": doc.ocr_error,
    }


def _serialize_request(req: DocumentRequest) -> dict:
    return {
        "id": req.id,
        "application_id": req.application_id,
        "requested_by_id": req.requested_by_id,
        "requested_by_name": req.requested_by.full_name if req.requested_by else None,
        "description": req.description,
        "status": req.status,
        "created_at": req.created_at,
        "fulfilled_at": req.fulfilled_at,
    }


@router.post("/requests/{application_id}", response_model=DocumentRequestOut, status_code=status.HTTP_201_CREATED)
def create_document_request(
    application_id: str,
    body: DocumentRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker", "referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    application = db.query(LoanApplication).filter(LoanApplication.id == application_id, LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None)).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user, db=db)

    if not body.description.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Description is required")

    req = DocumentRequest(
        application_id=application_id,
        requested_by_id=current_user.id,
        description=body.description.strip(),
        tenant_id=tenant_id,
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    log_activity(db, current_user.id, "document_requested", "application", application_id, {"description": req.description}, tenant_id=tenant_id)

    client = db.query(User).filter(User.id == application.user_id).first()
    if client:
        send_document_request_email(
            to_email=client.email,
            client_name=client.full_name,
            broker_name=current_user.full_name,
            description=req.description,
            application_id=application_id,
            loan_type=application.loan_type.value,
        )
        create_notification(
            db,
            user_id=client.id,
            type="status_change",
            title="Document requested",
            body=f"{current_user.full_name} has requested documents for your {application.loan_type.value} application.",
            link=f"/applications/{application_id}",
            tenant_id=tenant_id,
        )
        db.commit()

    return _serialize_request(req)


@router.get("/requests/{application_id}", response_model=list[DocumentRequestOut])
def list_document_requests(
    application_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    application = db.query(LoanApplication).filter(LoanApplication.id == application_id, LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None)).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user, db=db)
    requests = db.query(DocumentRequest).filter(DocumentRequest.application_id == application_id).order_by(DocumentRequest.created_at).all()
    return [_serialize_request(r) for r in requests]


@router.patch("/requests/{request_id}/fulfill", response_model=DocumentRequestOut)
def fulfill_document_request(
    request_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    req = db.query(DocumentRequest).filter(DocumentRequest.id == request_id, DocumentRequest.tenant_id == tenant_id).first()
    if not req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document request not found")

    application = db.query(LoanApplication).filter(LoanApplication.id == req.application_id, LoanApplication.deleted_at.is_(None)).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user, db=db)

    req.status = "fulfilled"
    req.fulfilled_at = datetime.now(timezone.utc)
    log_activity(db, current_user.id, "document_request_fulfilled", "application", req.application_id, {"request_id": request_id, "description": req.description}, tenant_id=tenant_id)
    db.commit()
    db.refresh(req)
    return _serialize_request(req)


@router.post("/{doc_id}/retry-ocr")
def retry_ocr(
    doc_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker", "referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    doc = db.query(Document).filter(Document.id == doc_id, Document.tenant_id == tenant_id).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    application = db.query(LoanApplication).filter(LoanApplication.id == doc.application_id, LoanApplication.deleted_at.is_(None)).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, _current_user, db=db)

    if not file_exists(doc.file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found in storage")

    from app.models.document import OcrStatus

    doc.ocr_status = OcrStatus.pending
    doc.ocr_text = None
    doc.ocr_error = None
    db.commit()

    from app.services.ocr import run_ocr_background

    background_tasks.add_task(
        run_ocr_background,
        document_id=doc.id,
        file_path=doc.file_path,
        session_factory=SessionLocal,
    )

    return {"status": "ocr_restarted", "document_id": doc_id}


@router.patch("/{doc_id}/verify", response_model=DocumentOut)
def verify_document(
    doc_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker", "referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    doc = db.query(Document).filter(Document.id == doc_id, Document.tenant_id == tenant_id).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    application = db.query(LoanApplication).filter(LoanApplication.id == doc.application_id, LoanApplication.deleted_at.is_(None)).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, _current_user, db=db)

    doc.is_verified = True
    log_activity(db, _current_user.id, "document_verified", "document", doc_id, {"filename": doc.original_filename, "doc_type": doc.doc_type.value}, tenant_id=tenant_id)
    db.commit()
    db.refresh(doc)
    return doc
