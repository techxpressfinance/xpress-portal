"""Notes on an entity — a dated feed for the team (admins and brokers only)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.middleware.auth import require_role
from app.models.contact import Organization
from app.models.entity_note import EntityNote
from app.models.user import User, UserRole
from app.services.tenant_scope import get_in_tenant, get_tenant_id

router = APIRouter(prefix="/api/organizations/{org_id}/notes", tags=["entity-notes"])

Category = Literal["general", "financials", "compliance", "relationship"]


class EntityNoteIn(BaseModel):
    content: str = Field(min_length=1, max_length=20000)
    category: Category = "general"
    is_pinned: bool = False


class EntityNoteUpdate(BaseModel):
    content: Optional[str] = Field(None, min_length=1, max_length=20000)
    category: Optional[Category] = None
    is_pinned: Optional[bool] = None


def _out(n: EntityNote, viewer: User) -> dict:
    return {
        "id": n.id,
        "category": n.category,
        "content": n.content,
        "is_pinned": n.is_pinned,
        "author_id": n.author_id,
        "author_name": n.author.full_name if n.author else None,
        "created_at": n.created_at,
        "updated_at": n.updated_at,
        "updated_by_name": n.updated_by.full_name if n.updated_by else None,
        # The author, or an admin, may change or remove it; anyone may pin it.
        "can_edit": viewer.role == UserRole.admin or (n.author_id is not None and n.author_id == viewer.id),
    }


def _notes(db: Session, org_id: str, tenant_id: str) -> list[EntityNote]:
    return (
        db.query(EntityNote)
        .options(joinedload(EntityNote.author), joinedload(EntityNote.updated_by))
        .filter(EntityNote.organization_id == org_id, EntityNote.tenant_id == tenant_id)
        .order_by(EntityNote.is_pinned.desc(), EntityNote.created_at.desc())
        .all()
    )


def _note(db: Session, org_id: str, note_id: str, tenant_id: str) -> EntityNote:
    note = db.query(EntityNote).filter(
        EntityNote.id == note_id, EntityNote.organization_id == org_id, EntityNote.tenant_id == tenant_id
    ).first()
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")
    return note


@router.get("")
def list_entity_notes(
    org_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    get_in_tenant(db, Organization, org_id, tenant_id, detail="Entity not found")
    return [_out(n, current_user) for n in _notes(db, org_id, tenant_id)]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_entity_note(
    org_id: str,
    data: EntityNoteIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    get_in_tenant(db, Organization, org_id, tenant_id, detail="Entity not found")
    if not data.content.strip():
        raise HTTPException(status_code=422, detail="Write something first")
    db.add(EntityNote(tenant_id=tenant_id, organization_id=org_id, author_id=current_user.id,
                      category=data.category, content=data.content.strip(), is_pinned=data.is_pinned))
    db.commit()
    return [_out(n, current_user) for n in _notes(db, org_id, tenant_id)]


@router.patch("/{note_id}")
def update_entity_note(
    org_id: str,
    note_id: str,
    data: EntityNoteUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    note = _note(db, org_id, note_id, tenant_id)
    changes = data.model_dump(exclude_unset=True)
    editing = {k for k in changes if k in ("content", "category")}
    if editing and not _out(note, current_user)["can_edit"]:
        raise HTTPException(status_code=403, detail="Only the note's author or an admin can change it")
    if changes.get("content") is not None:
        text = changes["content"].strip()
        if not text:
            raise HTTPException(status_code=422, detail="A note can't be empty")
        if text != note.content:
            note.content = text
            note.updated_at = datetime.now(timezone.utc)
            note.updated_by_id = current_user.id
    if changes.get("category") is not None:
        note.category = changes["category"]
    if changes.get("is_pinned") is not None:
        note.is_pinned = changes["is_pinned"]
    db.commit()
    return [_out(n, current_user) for n in _notes(db, org_id, tenant_id)]


@router.delete("/{note_id}")
def delete_entity_note(
    org_id: str,
    note_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    note = _note(db, org_id, note_id, tenant_id)
    if not _out(note, current_user)["can_edit"]:
        raise HTTPException(status_code=403, detail="Only the note's author or an admin can delete it")
    db.delete(note)
    db.commit()
    return [_out(n, current_user) for n in _notes(db, org_id, tenant_id)]
