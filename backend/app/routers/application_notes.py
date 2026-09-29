from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.application_note import NOTE_CATEGORIES, STAFF_ONLY_CATEGORIES, VALID_VISIBILITY, ApplicationNote
from app.models.decline_reason import DeclineReason
from app.models.lender_submission import LenderSubmission
from app.models.loan_application import LoanApplication
from app.models.user import User, UserRole
from app.schemas.application_note import (
    ApplicationNoteCreate,
    ApplicationNoteOut,
    ApplicationNoteUpdate,
    ScratchpadOut,
    ScratchpadUpdate,
)
from app.services.access_control import check_application_access
from app.services.activity_log import log_activity
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/applications", tags=["application-notes"])

# Categories posted as a feed. The scratchpad is one row per loan, written only
# through the scratchpad endpoints below.
_FEED_CATEGORIES = tuple(c for c in NOTE_CATEGORIES if c != "scratchpad")


def _note_to_out(note: ApplicationNote) -> dict:
    submission = note.lender_submission
    return {
        "id": note.id,
        "application_id": note.application_id,
        "author_id": note.author_id,
        "author_name": note.author.full_name if note.author else None,
        "author_role": note.author.role.value if note.author else None,
        "content": note.content,
        "visibility": [v.strip() for v in note.visibility.split(",") if v.strip()],
        "category": note.category or "general",
        "lender_submission_id": note.lender_submission_id,
        "lender_name": submission.lender.name if submission and submission.lender else None,
        "decline_reason_id": note.decline_reason_id,
        "decline_reason": note.decline_reason.label if note.decline_reason else None,
        "created_at": note.created_at,
        "updated_at": note.updated_at,
        "updated_by_name": note.updated_by.full_name if note.updated_by else None,
    }


def _get_application(db: Session, app_id: str, tenant_id: str) -> LoanApplication:
    application = db.query(LoanApplication).filter(LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None)).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    return application


def _resolve_visibility(requested: list[str], category: str, current_user: User) -> str:
    # Staff-only categories are shared with the whole team and nobody else,
    # whatever the request asks for — the notes-history export reads them.
    if category in STAFF_ONLY_CATEGORIES:
        return "broker"
    if current_user.role == UserRole.referrer:
        visibility_set = {"personal"} if "personal" in requested else {"referrer"}
    else:
        visibility_set = {v for v in requested if v in VALID_VISIBILITY}
        if not visibility_set:
            visibility_set = {"broker"}
    return ",".join(sorted(visibility_set))


def _validate_decline_links(
    db: Session, app_id: str, tenant_id: str, lender_submission_id: Optional[str], decline_reason_id: Optional[str]
) -> None:
    if lender_submission_id:
        exists = db.query(LenderSubmission.id).filter(
            LenderSubmission.id == lender_submission_id, LenderSubmission.application_id == app_id
        ).first()
        if not exists:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That lender submission is not on this application")
    if decline_reason_id:
        exists = db.query(DeclineReason.id).filter(
            DeclineReason.id == decline_reason_id, DeclineReason.tenant_id == tenant_id
        ).first()
        if not exists:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown decline reason")


@router.get("/{app_id}/notes", response_model=list[ApplicationNoteOut])
def list_notes(
    app_id: str,
    category: Optional[str] = Query(None, description="Only notes of this category"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    application = _get_application(db, app_id, tenant_id)
    check_application_access(application, current_user, db=db)

    query = db.query(ApplicationNote).filter(
        ApplicationNote.application_id == app_id,
        ApplicationNote.category != "scratchpad",
    )
    if category:
        query = query.filter(ApplicationNote.category == category)

    if current_user.role == UserRole.client:
        query = query.filter(ApplicationNote.visibility.contains("client"), ApplicationNote.category == "general")
    elif current_user.role == UserRole.referrer:
        # Referrers see referrer-visible notes + their own personal notes
        query = query.filter(
            ApplicationNote.category == "general",
            or_(
                ApplicationNote.visibility.contains("referrer"),
                and_(
                    ApplicationNote.visibility == "personal",
                    ApplicationNote.author_id == current_user.id,
                ),
            ),
        )
    else:
        # Brokers and admins see all notes except personal ones from other authors
        query = query.filter(
            or_(
                ApplicationNote.visibility != "personal",
                ApplicationNote.author_id == current_user.id,
            )
        )

    notes = query.order_by(ApplicationNote.created_at.asc()).all()
    return [_note_to_out(n) for n in notes]


@router.post("/{app_id}/notes", response_model=ApplicationNoteOut, status_code=status.HTTP_201_CREATED)
def create_note(
    app_id: str,
    data: ApplicationNoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker", "referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    application = _get_application(db, app_id, tenant_id)
    check_application_access(application, current_user, db=db)

    category = data.category or "general"
    if category not in _FEED_CATEGORIES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid note category: {category}")
    if category in STAFF_ONLY_CATEGORIES and current_user.role == UserRole.referrer:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only staff can add this kind of note")

    lender_submission_id = data.lender_submission_id if category == "decline" else None
    decline_reason_id = data.decline_reason_id if category == "decline" else None
    _validate_decline_links(db, app_id, tenant_id, lender_submission_id, decline_reason_id)

    note = ApplicationNote(
        application_id=app_id,
        author_id=current_user.id,
        content=data.content,
        visibility=_resolve_visibility(data.visibility, category, current_user),
        category=category,
        lender_submission_id=lender_submission_id,
        decline_reason_id=decline_reason_id,
        tenant_id=tenant_id,
    )
    db.add(note)
    db.flush()
    log_activity(db, current_user.id, "note_added", "application", app_id, {"visibility": note.visibility, "category": category}, tenant_id=tenant_id)
    db.commit()
    db.refresh(note)
    return _note_to_out(note)


@router.patch("/{app_id}/notes/{note_id}", response_model=ApplicationNoteOut)
def update_note(
    app_id: str,
    note_id: str,
    data: ApplicationNoteUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker", "referrer")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Edit a note's content and/or visibility. Authors (and admins) only."""
    _get_application(db, app_id, tenant_id)
    note = (
        db.query(ApplicationNote)
        .filter(ApplicationNote.id == note_id, ApplicationNote.application_id == app_id, ApplicationNote.category != "scratchpad")
        .first()
    )
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")

    if current_user.role != UserRole.admin and note.author_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only edit your own notes")

    if data.content is not None:
        note.content = data.content

    if data.visibility is not None:
        note.visibility = _resolve_visibility(data.visibility, note.category, current_user)

    if note.category == "decline":
        fields = data.model_fields_set
        submission_id = data.lender_submission_id if "lender_submission_id" in fields else note.lender_submission_id
        reason_id = data.decline_reason_id if "decline_reason_id" in fields else note.decline_reason_id
        _validate_decline_links(db, app_id, tenant_id, submission_id, reason_id)
        note.lender_submission_id = submission_id or None
        note.decline_reason_id = reason_id or None

    note.updated_at = datetime.now(timezone.utc)
    note.updated_by_id = current_user.id
    log_activity(db, current_user.id, "note_updated", "application", app_id, {"note_id": note_id}, tenant_id=tenant_id)
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
    _get_application(db, app_id, tenant_id)
    note = (
        db.query(ApplicationNote)
        .filter(ApplicationNote.id == note_id, ApplicationNote.application_id == app_id)
        .first()
    )
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")

    log_activity(db, current_user.id, "note_deleted", "application", app_id, {"note_id": note_id}, tenant_id=tenant_id)
    db.delete(note)
    db.commit()


def _scratchpad(db: Session, app_id: str) -> Optional[ApplicationNote]:
    return (
        db.query(ApplicationNote)
        .filter(ApplicationNote.application_id == app_id, ApplicationNote.category == "scratchpad")
        .order_by(ApplicationNote.created_at.asc())
        .first()
    )


def _scratchpad_out(pad: Optional[ApplicationNote]) -> dict:
    if not pad:
        return {"content": "", "updated_at": None, "updated_by_name": None}
    editor = pad.updated_by or pad.author
    return {
        "content": pad.content,
        "updated_at": pad.updated_at or pad.created_at,
        "updated_by_name": editor.full_name if editor else None,
    }


def _same_instant(a: Optional[datetime], b: Optional[datetime]) -> bool:
    if a is None or b is None:
        return a is b
    # SQLite hands back naive UTC; the client sends an aware timestamp.
    a = a if a.tzinfo else a.replace(tzinfo=timezone.utc)
    b = b if b.tzinfo else b.replace(tzinfo=timezone.utc)
    return abs((a - b).total_seconds()) < 0.001


@router.get("/{app_id}/scratchpad", response_model=ScratchpadOut)
def get_scratchpad(
    app_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    application = _get_application(db, app_id, tenant_id)
    check_application_access(application, current_user, db=db)
    return _scratchpad_out(_scratchpad(db, app_id))


@router.put("/{app_id}/scratchpad", response_model=ScratchpadOut)
def save_scratchpad(
    app_id: str,
    data: ScratchpadUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Replace the loan's shared scratchpad. Refused with 409 (and the current
    pad) when someone else saved after the editor last loaded it."""
    application = _get_application(db, app_id, tenant_id)
    check_application_access(application, current_user, db=db)

    pad = _scratchpad(db, app_id)
    now = datetime.now(timezone.utc)
    if pad is None:
        if not data.content.strip():
            return _scratchpad_out(None)
        pad = ApplicationNote(
            application_id=app_id,
            author_id=current_user.id,
            content=data.content,
            visibility="broker",
            category="scratchpad",
            tenant_id=tenant_id,
            created_at=now,
            updated_at=now,
            updated_by_id=current_user.id,
        )
        db.add(pad)
    else:
        current = pad.updated_at or pad.created_at
        last_editor = pad.updated_by_id or pad.author_id
        if last_editor != current_user.id and not _same_instant(current, data.base_updated_at):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"message": "Someone else has edited the scratchpad since you opened it", "scratchpad": ScratchpadOut(**_scratchpad_out(pad)).model_dump(mode="json")},
            )
        pad.content = data.content
        pad.updated_at = now
        pad.updated_by_id = current_user.id
    db.commit()
    db.refresh(pad)
    return _scratchpad_out(pad)
