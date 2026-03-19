import os
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.config import ONEDRIVE_ENABLED
from app.database import SessionLocal, get_db
from app.middleware.rate_limit import RateLimiter
from app.services.s3_storage import delete_file, download_file, file_exists, upload_file
from app.middleware.auth import get_current_user, require_role
from app.models.document import DocType, Document
from app.models.loan_application import LoanApplication
from app.models.user import User
from app.schemas.document import DocumentOut
from app.services.access_control import check_application_access
from app.services.activity_log import log_activity

router = APIRouter(prefix="/api/documents", tags=["documents"])

upload_limiter = RateLimiter(max_requests=20, window_seconds=60)


@router.post("/upload/{application_id}", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
def upload_document(
    application_id: str,
    doc_type: DocType,
    file: UploadFile,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    upload_limiter.check(request)
    application = db.query(LoanApplication).filter(LoanApplication.id == application_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user)

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

    doc = Document(
        application_id=application_id,
        doc_type=doc_type,
        file_path=file_path,
        original_filename=safe_filename,
    )
    db.add(doc)
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


@router.get("/application/{application_id}", response_model=list[DocumentOut])
def list_documents(
    application_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    application = db.query(LoanApplication).filter(LoanApplication.id == application_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user)
    return db.query(Document).filter(Document.application_id == application_id).all()


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    doc_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    application = db.query(LoanApplication).filter(LoanApplication.id == doc.application_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user)
    if application.status.value != "draft":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete documents from a submitted application")

    # Remove file from storage
    delete_file(doc.file_path)

    db.delete(doc)
    db.commit()


@router.get("/{doc_id}/download")
def download_document(
    doc_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    application = db.query(LoanApplication).filter(LoanApplication.id == doc.application_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user)

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
):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    application = db.query(LoanApplication).filter(LoanApplication.id == doc.application_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, current_user)

    return {
        "ocr_status": doc.ocr_status.value if doc.ocr_status else "pending",
        "ocr_text": doc.ocr_text,
        "ocr_error": doc.ocr_error,
    }


@router.post("/{doc_id}/retry-ocr")
def retry_ocr(
    doc_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin", "broker")),
):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    application = db.query(LoanApplication).filter(LoanApplication.id == doc.application_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, _current_user)

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
    _current_user: User = Depends(require_role("admin", "broker")),
):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    application = db.query(LoanApplication).filter(LoanApplication.id == doc.application_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    check_application_access(application, _current_user)

    doc.is_verified = True
    log_activity(db, _current_user.id, "document_verified", "document", doc_id, {"filename": doc.original_filename, "doc_type": doc.doc_type.value})
    db.commit()
    db.refresh(doc)
    return doc
