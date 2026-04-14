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
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/applications", tags=["application-notes"])


def _note_to_out(note: ApplicationNote) -> dict:
    return {
        "id": note.id,
        "application_id": note.application_id,
        "author_id": note.author_id,
        "author_name": note.author.full_name if note.author else None,
        "author_role": note.author.role.value if note.author else None,
        "content": note.content,
        "visibility": [v.strip() for v in note.visibility.split(",") if v.strip()],
        "created_at": note.created_at,
    }


@router.get("/{app_id}/notes", response_model=list[ApplicationNoteOut])
def list_notes(
    app_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    application = db.query(LoanApplication).filter(LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    check_application_access(application, current_user, db=db)

    query = db.query(ApplicationNote).filter(ApplicationNote.application_id == app_id)

    # Non-admin/broker users only see notes where their role is in the visibility list
    if current_user.role == UserRole.client:
        query = query.filter(ApplicationNote.visibility.contains("client"))
    elif current_user.role == UserRole.referrer:
        query = query.filter(ApplicationNote.visibility.contains("referrer"))
    # Brokers and admins see all notes (broker-visible + everything else)

    notes = query.order_by(ApplicationNote.created_at.asc()).all()
    return [_note_to_out(n) for n in notes]


@router.post("/{app_id}/notes", response_model=ApplicationNoteOut, status_code=status.HTTP_201_CREATED)
def create_note(
    app_id: str,
    data: ApplicationNoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    application = db.query(LoanApplication).filter(LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    check_application_access(application, current_user, db=db)

    from app.models.application_note import VALID_VISIBILITY
    visibility_set = {v for v in data.visibility if v in VALID_VISIBILITY}
    if not visibility_set:
        visibility_set = {"broker"}

    note = ApplicationNote(
        application_id=app_id,
        author_id=current_user.id,
        content=data.content,
        visibility=",".join(sorted(visibility_set)),
        tenant_id=tenant_id,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return _note_to_out(note)


@router.delete("/{app_id}/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(
    app_id: str,
    note_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    note = (
        db.query(ApplicationNote)
        .filter(ApplicationNote.id == note_id, ApplicationNote.application_id == app_id)
        .first()
    )
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")

    db.delete(note)
    db.commit()
