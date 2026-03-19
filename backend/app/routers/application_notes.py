from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.application_note import ApplicationNote
from app.models.loan_application import LoanApplication
from app.models.user import User, UserRole
from app.schemas.application_note import ApplicationNoteCreate, ApplicationNoteOut
from app.services.access_control import check_application_access

router = APIRouter(prefix="/api/applications", tags=["application-notes"])


def _note_to_out(note: ApplicationNote) -> dict:
    return {
        "id": note.id,
        "application_id": note.application_id,
        "author_id": note.author_id,
        "author_name": note.author.full_name if note.author else None,
        "content": note.content,
        "is_internal": note.is_internal,
        "created_at": note.created_at,
    }


@router.get("/{app_id}/notes", response_model=list[ApplicationNoteOut])
def list_notes(
    app_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    application = db.query(LoanApplication).filter(LoanApplication.id == app_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    check_application_access(application, current_user)

    query = db.query(ApplicationNote).filter(ApplicationNote.application_id == app_id)

    # Clients only see non-internal (client-facing) notes
    if current_user.role == UserRole.client:
        query = query.filter(ApplicationNote.is_internal == False)  # noqa: E712

    notes = query.order_by(ApplicationNote.created_at.asc()).all()
    return [_note_to_out(n) for n in notes]


@router.post("/{app_id}/notes", response_model=ApplicationNoteOut, status_code=status.HTTP_201_CREATED)
def create_note(
    app_id: str,
    data: ApplicationNoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
):
    application = db.query(LoanApplication).filter(LoanApplication.id == app_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    check_application_access(application, current_user)

    note = ApplicationNote(
        application_id=app_id,
        author_id=current_user.id,
        content=data.content,
        is_internal=data.is_internal,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return _note_to_out(note)
