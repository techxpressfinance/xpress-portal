from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.database import get_db
from app.middleware.auth import require_role
from app.models.application_broker import ApplicationBroker
from app.models.notification_outbox import (
    NotificationAudience,
    NotificationChannel,
    NotificationOutbox,
    StageNotificationRule,
)
from app.services.stage_notifications import record_stage_notifications
from app.models.kanban import (
    ApplicationStagePlacement,
    KanbanBoard,
    KanbanColumn,
    KanbanColumnGate,
    StageGateKind,
    StageTransition,
)
from app.models.loan_applicant import ApplicationGuarantor
from app.models.loan_application import ApplicationStatus, LoanApplication
from app.models.user import User
from app.schemas.kanban import (
    ColumnReorderRequest,
    GateResponse,
    NotificationOutboxOut,
    StageGateCreate,
    StageGateUpdate,
    StageMoveRequest,
    StageNotificationCreate,
    StageNotificationOut,
    StageNotificationUpdate,
    StageTransitionOut,
    KanbanBoardCreate,
    KanbanBoardListOut,
    KanbanBoardOut,
    KanbanBoardUpdate,
    KanbanColumnCreate,
    KanbanColumnOut,
    KanbanColumnUpdate,
    StageGateOut,
)
from app.constants import BOARD_STAGE_TEMPLATES, DEFAULT_KANBAN_COLUMNS, STATUS_LABELS
from app.services.access_control import check_application_access
from app.services.activity_log import log_activity
from app.services.application_status import change_application_status
from app.services.date_filter import apply_date_range_filter
from app.services.loan_category import (
    LOAN_CATEGORIES,
    application_loan_category,
    application_sub_type,
    category_loan_types,
    parse_categories,
)
from app.services.query_utils import escape_like
from app.services.serialization import app_with_user, referrer_info_map
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/kanban", tags=["kanban"])

_VALID_STATUSES = {s.value for s in ApplicationStatus}


def _validate_mapped_status(status: str) -> None:
    if status not in _VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid mapped_status: {status}")


def _column_title(mapped_status: str) -> str:
    return STATUS_LABELS.get(mapped_status, mapped_status.replace("_", " ").title())


def _validate_loan_category(category: str) -> None:
    if category not in LOAN_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid loan_category: {category}")


def _evaluate_gates(col: KanbanColumn, responses: list[GateResponse]) -> tuple[list[dict], Optional[str], Optional[list[str]]]:
    """Check the stage's gates against what the mover answered.

    Returns the record to store on the transition, plus the lender name and
    conditions when an approval-conditions gate supplied them. Raises 400 naming
    the gate that is unsatisfied — a compliance stop must say what is missing,
    not just refuse."""
    by_id = {r.gate_id: r for r in responses}
    gates = sorted(col.gates, key=lambda g: (g.sort_order, g.created_at))
    known = {g.id for g in gates}
    for gate_id in by_id:
        if gate_id not in known:
            raise HTTPException(status_code=400, detail="A gate answer does not belong to this stage")

    record: list[dict] = []
    lender_name: Optional[str] = None
    conditions: Optional[list[str]] = None

    for gate in gates:
        answer = by_id.get(gate.id)
        entry = {"gate_id": gate.id, "kind": gate.kind.value, "label": gate.label}

        if gate.kind == StageGateKind.confirm:
            confirmed = bool(answer and answer.confirmed)
            if gate.is_required and not confirmed:
                raise HTTPException(status_code=400, detail=f"Confirm before moving: {gate.label}")
            entry["confirmed"] = confirmed
        else:
            items = [i.strip() for i in (answer.items if answer else []) if i.strip()]
            value = (answer.value or "").strip() if answer else ""
            if gate.is_required and not items:
                raise HTTPException(status_code=400, detail=f"Add at least one item to: {gate.label}")
            if gate.target == "approval_conditions":
                if gate.is_required and not value:
                    raise HTTPException(status_code=400, detail=f"A lender name is required for: {gate.label}")
                lender_name = value or None
                conditions = items or None
            entry["value"] = value or None
            entry["items"] = items

        record.append(entry)

    return record, lender_name, conditions


def _active_stage_category(board: KanbanBoard, requested: set[str]) -> Optional[str]:
    """The single category whose stages should be on screen, or None for the
    board's plain status columns.

    A stage set only makes sense when exactly one templated category is in view —
    looking at everything at once has no meaningful stage order."""
    categories = requested or set(LOAN_CATEGORIES)
    if board.loan_category:
        categories &= {board.loan_category}
    if len(categories) != 1:
        return None
    category = next(iter(categories))
    return category if category in BOARD_STAGE_TEMPLATES else None


def ensure_stage_columns(db: Session, board: KanbanBoard, category: Optional[str], tenant_id: Optional[str]) -> None:
    """Materialise a category's stages on this board, once, on first view.

    There is no "apply the template" step: looking at Asset Finance is what
    creates its lines. Idempotent and additive — it only ever fills in template
    stages the board is missing, and seeds gates and messages for stages it
    creates, never for ones that already exist (an admin who deleted a
    confirmation must not have it come back on the next page load)."""
    if not category:
        return
    template = BOARD_STAGE_TEMPLATES.get(category)
    if not template:
        return

    existing = {c.stage_key for c in board.columns if c.loan_category == category}
    created: list[tuple[KanbanColumn, dict]] = []
    for i, stage in enumerate(template):
        if stage["stage_key"] in existing:
            continue
        col = KanbanColumn(
            board_id=board.id,
            tenant_id=tenant_id,
            loan_category=category,
            stage_key=stage["stage_key"],
            title=stage["title"],
            mapped_status=stage["mapped_status"],
            team=stage.get("team"),
            color=stage.get("color"),
            position=i,
        )
        db.add(col)
        created.append((col, stage))

    if not created:
        return
    try:
        db.flush()
        for col, stage in created:
            _sync_template_gates(db, col, stage.get("gates", []), tenant_id)
            _sync_template_notifications(db, col, stage.get("notifications", []), tenant_id)
        db.commit()
    except IntegrityError:
        # Another viewer materialised the same stages first — theirs are already
        # committed, so drop ours and read the board back.
        db.rollback()
    db.refresh(board)


def board_columns(board: KanbanBoard, category: Optional[str]) -> list[KanbanColumn]:
    """The stages on screen for the active category view, left to right."""
    if category:
        cols = [c for c in board.columns if c.loan_category == category]
        if cols:
            return sorted(cols, key=lambda c: (c.position, c.created_at))
    return sorted(
        [c for c in board.columns if c.loan_category is None],
        key=lambda c: (c.position, c.created_at),
    )


def _sync_template_notifications(db: Session, col: KanbanColumn, rule_defs: list[dict], tenant_id: Optional[str]) -> None:
    """Add a template's notification rules, keyed by audience+channel so
    re-applying a template never duplicates them and never overwrites wording the
    desk has since edited."""
    existing = {(r.audience.value, r.channel.value) for r in col.notification_rules}
    for i, rule_def in enumerate(rule_defs):
        key = (rule_def["audience"], rule_def["channel"])
        if key in existing:
            continue
        db.add(StageNotificationRule(
            column_id=col.id,
            tenant_id=tenant_id,
            audience=NotificationAudience(rule_def["audience"]),
            channel=NotificationChannel(rule_def["channel"]),
            subject=rule_def.get("subject"),
            body=rule_def["body"],
            default_enabled=rule_def.get("default_enabled", True),
            sort_order=i,
        ))


def _sync_template_gates(db: Session, col: KanbanColumn, gate_defs: list[dict], tenant_id: Optional[str]) -> None:
    """Add a template's gates to a stage, keyed by label so re-applying a template
    never duplicates them. Gates an admin added by hand are left alone."""
    existing = {g.label for g in col.gates}
    for i, gate_def in enumerate(gate_defs):
        if gate_def["label"] in existing:
            continue
        db.add(KanbanColumnGate(
            column_id=col.id,
            tenant_id=tenant_id,
            kind=StageGateKind(gate_def["kind"]),
            label=gate_def["label"],
            help_text=gate_def.get("help_text"),
            is_required=gate_def.get("is_required", True),
            target=gate_def.get("target"),
            sort_order=i,
        ))


def _fallback_column_ids(columns: list[KanbanColumn]) -> dict[str, str]:
    """status -> the column an un-placed application falls back to: the first
    (left-most) stage on the board that rolls up to that status. Applications
    that predate stage placements, or that were never dragged, are rendered from
    their status alone — this is the map that makes that work."""
    fallback: dict[str, str] = {}
    for col in columns:
        if col.mapped_status and col.mapped_status not in fallback:
            fallback[col.mapped_status] = col.id
    return fallback


def _column_application_counts(board: KanbanBoard, columns: list[KanbanColumn], db: Session, tenant_id: str) -> dict[str, int]:
    """Card count per column: placed applications, plus the un-placed ones that
    fall back to each status's first stage. Like the pre-existing counts these
    ignore the board's loan category (category needs the encrypted sub-type, so
    it can't be resolved in SQL) — they are a header hint, not a report."""
    counts: dict[str, int] = {col.id: 0 for col in columns}

    placed = (
        db.query(ApplicationStagePlacement.column_id, func.count(ApplicationStagePlacement.id))
        .join(LoanApplication, LoanApplication.id == ApplicationStagePlacement.application_id)
        .filter(
            ApplicationStagePlacement.board_id == board.id,
            LoanApplication.tenant_id == tenant_id,
            LoanApplication.deleted_at.is_(None),
        )
        .group_by(ApplicationStagePlacement.column_id)
        .all()
    )
    for col_id, count in placed:
        if col_id in counts:
            counts[col_id] = count

    fallback = _fallback_column_ids(columns)
    if fallback:
        unplaced = (
            db.query(LoanApplication.status, func.count(LoanApplication.id))
            .filter(
                LoanApplication.tenant_id == tenant_id,
                LoanApplication.deleted_at.is_(None),
                ~db.query(ApplicationStagePlacement.id)
                .filter(
                    ApplicationStagePlacement.application_id == LoanApplication.id,
                    ApplicationStagePlacement.board_id == board.id,
                )
                .exists(),
            )
            .group_by(LoanApplication.status)
            .all()
        )
        for app_status, count in unplaced:
            col_id = fallback.get(app_status.value if hasattr(app_status, "value") else app_status)
            if col_id in counts:
                counts[col_id] += count

    return counts


def _gate_to_dict(gate: KanbanColumnGate) -> dict:
    return {
        "id": gate.id,
        "column_id": gate.column_id,
        "kind": gate.kind.value,
        "label": gate.label,
        "help_text": gate.help_text,
        "is_required": gate.is_required,
        "sort_order": gate.sort_order,
        "target": gate.target,
    }


def _rule_to_dict(rule: StageNotificationRule) -> dict:
    return {
        "id": rule.id,
        "column_id": rule.column_id,
        "audience": rule.audience.value,
        "channel": rule.channel.value,
        "subject": rule.subject,
        "body": rule.body,
        "default_enabled": rule.default_enabled,
        "sort_order": rule.sort_order,
    }


def _column_to_dict(col: KanbanColumn, count: int = 0) -> dict:
    return {
        "id": col.id,
        "board_id": col.board_id,
        "title": col.title,
        "mapped_status": col.mapped_status,
        "position": col.position,
        "color": col.color,
        "stage_key": col.stage_key,
        "team": col.team,
        "gates": [_gate_to_dict(g) for g in sorted(col.gates, key=lambda g: (g.sort_order, g.created_at))],
        "notifications": [
            _rule_to_dict(r) for r in sorted(col.notification_rules, key=lambda r: (r.sort_order, r.created_at))
        ],
        "application_count": count,
    }


def _board_to_dict(
    board: KanbanBoard,
    db: Session,
    tenant_id: Optional[str] = None,
    category: Optional[str] = None,
) -> dict:
    """Serialize the board as it should appear for the active category view."""
    columns = board_columns(board, category)
    counts = _column_application_counts(board, columns, db, tenant_id) if tenant_id else {}
    cols = [_column_to_dict(col, counts.get(col.id, 0)) for col in columns]
    return {
        "id": board.id,
        "name": board.name,
        "description": board.description,
        "loan_category": board.loan_category,
        "is_default": board.is_default,
        # A stage view has its own order and several stages per status, so the
        # status transition table cannot govern moves within it.
        "enforce_transitions": board.enforce_transitions and category is None,
        "stage_category": category,
        "created_by_id": board.created_by_id,
        "created_by_name": board.created_by.full_name if board.created_by else None,
        "columns": cols,
        "created_at": board.created_at.isoformat() if board.created_at else None,
        "updated_at": board.updated_at.isoformat() if board.updated_at else None,
    }


# ── Board CRUD ──────────────────────────────────────────────

@router.get("/boards", response_model=list[KanbanBoardListOut])
def list_boards(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    boards = db.query(KanbanBoard).filter(KanbanBoard.tenant_id == tenant_id).order_by(KanbanBoard.created_at).all()
    return [
        {
            "id": b.id,
            "name": b.name,
            "description": b.description,
            "loan_category": b.loan_category,
            "is_default": b.is_default,
            "enforce_transitions": b.enforce_transitions,
            "column_count": len(b.columns),
            "created_at": b.created_at.isoformat() if b.created_at else None,
            "updated_at": b.updated_at.isoformat() if b.updated_at else None,
        }
        for b in boards
    ]


@router.post("/boards", response_model=KanbanBoardOut, status_code=status.HTTP_201_CREATED)
def create_board(
    data: KanbanBoardCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    if data.loan_category:
        _validate_loan_category(data.loan_category)
    # Every board starts as one column per application status. A category's
    # stages are created the first time somebody looks at that category — see
    # ensure_stage_columns — so there is nothing to opt into here.
    board = KanbanBoard(
        name=data.name,
        description=data.description,
        loan_category=data.loan_category,
        created_by_id=current_user.id,
        tenant_id=tenant_id,
    )
    db.add(board)
    db.flush()

    cols = data.columns or [KanbanColumnCreate(**c) for c in DEFAULT_KANBAN_COLUMNS]
    for col_data in cols:
        _validate_mapped_status(col_data.mapped_status)
        db.add(KanbanColumn(
            board_id=board.id,
            title=(col_data.title or "").strip() or _column_title(col_data.mapped_status),
            mapped_status=col_data.mapped_status,
            position=col_data.position,
            color=col_data.color,
            tenant_id=tenant_id,
        ))

    log_activity(db, current_user.id, "board_created", "kanban_board", board.id, {"name": data.name}, tenant_id=tenant_id)
    db.commit()
    db.refresh(board)
    return _board_to_dict(board, db, tenant_id)


@router.get("/boards/{board_id}", response_model=KanbanBoardOut)
def get_board(
    board_id: str,
    category: Optional[str] = Query(None, description="Loan category slug(s) in view, comma-separated"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    board = db.query(KanbanBoard).filter(KanbanBoard.id == board_id, KanbanBoard.tenant_id == tenant_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    try:
        requested = set(parse_categories(category))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # Viewing a category with a stage template is what creates its stages.
    stage_category = _active_stage_category(board, requested)
    ensure_stage_columns(db, board, stage_category, tenant_id)
    return _board_to_dict(board, db, tenant_id, stage_category)


@router.patch("/boards/{board_id}", response_model=KanbanBoardOut)
def update_board(
    board_id: str,
    data: KanbanBoardUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    board = db.query(KanbanBoard).filter(KanbanBoard.id == board_id, KanbanBoard.tenant_id == tenant_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    updates = data.model_dump(exclude_unset=True)
    if updates.get("loan_category"):
        _validate_loan_category(updates["loan_category"])
    for key, value in updates.items():
        setattr(board, key, value)
    log_activity(db, current_user.id, "board_updated", "kanban_board", board.id, updates, tenant_id=tenant_id)
    db.commit()
    db.refresh(board)
    return _board_to_dict(board, db, tenant_id)


@router.delete("/boards/{board_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_board(
    board_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    board = db.query(KanbanBoard).filter(KanbanBoard.id == board_id, KanbanBoard.tenant_id == tenant_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    total = db.query(KanbanBoard).filter(KanbanBoard.tenant_id == tenant_id).count()
    if total <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the only board")
    log_activity(db, current_user.id, "board_deleted", "kanban_board", board.id, {"name": board.name}, tenant_id=tenant_id)
    db.delete(board)
    db.commit()


# ── Column CRUD ─────────────────────────────────────────────

@router.post("/boards/{board_id}/columns", response_model=KanbanColumnOut, status_code=status.HTTP_201_CREATED)
def add_column(
    board_id: str,
    data: KanbanColumnCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    board = db.query(KanbanBoard).filter(KanbanBoard.id == board_id, KanbanBoard.tenant_id == tenant_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    _validate_mapped_status(data.mapped_status)
    # A stage added while looking at a category belongs to that category's set,
    # not to the board's plain status columns.
    category = data.loan_category or None
    if category:
        _validate_loan_category(category)
    siblings = [c for c in board.columns if c.loan_category == category]
    # Several stages may share a status — that is the point of a stage view.
    max_pos = max((c.position for c in siblings), default=-1)
    col = KanbanColumn(
        board_id=board_id,
        loan_category=category,
        title=(data.title or "").strip() or _column_title(data.mapped_status),
        mapped_status=data.mapped_status,
        position=max_pos + 1,
        color=data.color,
        stage_key=data.stage_key,
        team=data.team,
        tenant_id=tenant_id,
    )
    db.add(col)
    db.flush()
    log_activity(db, current_user.id, "column_created", "kanban_column", col.id, {"title": col.title, "mapped_status": data.mapped_status, "board_id": board_id}, tenant_id=tenant_id)
    db.commit()
    db.refresh(col)
    return _column_to_dict(col)


@router.patch("/boards/{board_id}/columns/{column_id}", response_model=KanbanColumnOut)
def update_column(
    board_id: str,
    column_id: str,
    data: KanbanColumnUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    col = db.query(KanbanColumn).filter(KanbanColumn.id == column_id, KanbanColumn.board_id == board_id).first()
    if not col:
        raise HTTPException(status_code=404, detail="Column not found")
    updates = data.model_dump(exclude_unset=True)
    new_mapped = updates.get("mapped_status") or col.mapped_status
    _validate_mapped_status(new_mapped)
    col.mapped_status = new_mapped
    if "title" in updates:
        title = (updates["title"] or "").strip()
        if not title:
            raise HTTPException(status_code=400, detail="Stage name cannot be empty")
        col.title = title
    elif not col.title:
        col.title = _column_title(new_mapped)
    if "color" in updates:
        col.color = updates["color"]
    if "team" in updates:
        col.team = (updates["team"] or "").strip() or None
    log_activity(db, current_user.id, "column_updated", "kanban_column", col.id, updates, tenant_id=tenant_id)
    db.commit()
    db.refresh(col)
    return _column_to_dict(col)


@router.delete("/boards/{board_id}/columns/{column_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_column(
    board_id: str,
    column_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    board = db.query(KanbanBoard).filter(KanbanBoard.id == board_id, KanbanBoard.tenant_id == tenant_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    col = db.query(KanbanColumn).filter(KanbanColumn.id == column_id, KanbanColumn.board_id == board_id).first()
    if not col:
        raise HTTPException(status_code=404, detail="Column not found")
    # Cards are never silently relocated — an occupied stage must be emptied
    # first, so nobody loses track of where a deal went. This counts what is
    # actually rendered there, which includes cards sitting on the status
    # fallback and not just the ones with a placement row.
    columns = board_columns(board, col.loan_category)
    on_screen = _column_application_counts(board, columns, db, tenant_id).get(col.id, 0)
    if on_screen:
        raise HTTPException(status_code=400, detail=f"Move the {on_screen} card(s) out of '{col.title}' before deleting it")
    # Removing the only stage for a status would strand every application in
    # that status — they would have nowhere to fall back to. Siblings are only
    # those in the same set; the other set's columns are a different view.
    siblings = [
        c for c in columns
        if c.mapped_status == col.mapped_status and c.id != column_id
    ]
    if not siblings:
        raise HTTPException(
            status_code=400,
            detail=f"'{col.title}' is the only stage for status '{col.mapped_status}' — add another before deleting it",
        )
    log_activity(db, current_user.id, "column_deleted", "kanban_column", col.id, {"title": col.title, "board_id": board_id}, tenant_id=tenant_id)
    db.delete(col)
    db.commit()


# ── Stage gates ─────────────────────────────────────────────
# What a stage asks before it will accept a card. Admin-managed so a new
# compliance stop is a board edit, not a deploy.

def _get_column_for_gate(board_id: str, column_id: str, tenant_id: str, db: Session) -> KanbanColumn:
    board = db.query(KanbanBoard).filter(KanbanBoard.id == board_id, KanbanBoard.tenant_id == tenant_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    col = db.query(KanbanColumn).filter(KanbanColumn.id == column_id, KanbanColumn.board_id == board_id).first()
    if not col:
        raise HTTPException(status_code=404, detail="Stage not found")
    return col


@router.post("/boards/{board_id}/columns/{column_id}/gates", response_model=StageGateOut, status_code=status.HTTP_201_CREATED)
def add_gate(
    board_id: str,
    column_id: str,
    data: StageGateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    col = _get_column_for_gate(board_id, column_id, tenant_id, db)
    label = data.label.strip()
    if not label:
        raise HTTPException(status_code=400, detail="Gate label cannot be empty")
    if data.target and data.target != "approval_conditions":
        raise HTTPException(status_code=400, detail=f"Unknown gate target: {data.target}")
    if data.target and data.kind != "checklist":
        raise HTTPException(status_code=400, detail="Only a checklist gate can have a target")
    max_order = max((g.sort_order for g in col.gates), default=-1)
    gate = KanbanColumnGate(
        column_id=col.id,
        tenant_id=tenant_id,
        kind=StageGateKind(data.kind),
        label=label,
        help_text=data.help_text,
        is_required=data.is_required,
        target=data.target,
        sort_order=max_order + 1,
    )
    db.add(gate)
    db.flush()
    log_activity(db, current_user.id, "stage_gate_created", "kanban_column", col.id, {"label": label, "kind": data.kind}, tenant_id=tenant_id)
    db.commit()
    db.refresh(gate)
    return _gate_to_dict(gate)


@router.patch("/boards/{board_id}/columns/{column_id}/gates/{gate_id}", response_model=StageGateOut)
def update_gate(
    board_id: str,
    column_id: str,
    gate_id: str,
    data: StageGateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    _get_column_for_gate(board_id, column_id, tenant_id, db)
    gate = db.query(KanbanColumnGate).filter(KanbanColumnGate.id == gate_id, KanbanColumnGate.column_id == column_id).first()
    if not gate:
        raise HTTPException(status_code=404, detail="Gate not found")
    updates = data.model_dump(exclude_unset=True)
    if "label" in updates:
        label = (updates["label"] or "").strip()
        if not label:
            raise HTTPException(status_code=400, detail="Gate label cannot be empty")
        gate.label = label
    if "help_text" in updates:
        gate.help_text = updates["help_text"]
    if "is_required" in updates:
        gate.is_required = updates["is_required"]
    if "sort_order" in updates:
        gate.sort_order = updates["sort_order"]
    log_activity(db, current_user.id, "stage_gate_updated", "kanban_column", column_id, updates, tenant_id=tenant_id)
    db.commit()
    db.refresh(gate)
    return _gate_to_dict(gate)


@router.delete("/boards/{board_id}/columns/{column_id}/gates/{gate_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_gate(
    board_id: str,
    column_id: str,
    gate_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    _get_column_for_gate(board_id, column_id, tenant_id, db)
    gate = db.query(KanbanColumnGate).filter(KanbanColumnGate.id == gate_id, KanbanColumnGate.column_id == column_id).first()
    if not gate:
        raise HTTPException(status_code=404, detail="Gate not found")
    # Past answers live on the transition records, which keep their own copy of
    # the label — deleting a gate never rewrites what an earlier move attested.
    log_activity(db, current_user.id, "stage_gate_deleted", "kanban_column", column_id, {"label": gate.label}, tenant_id=tenant_id)
    db.delete(gate)
    db.commit()


# ── Stage notifications ─────────────────────────────────────
# Who the desk tells when a card enters a stage. A rule only ever puts a
# confirmation in front of the mover — see record_stage_notifications.

@router.post("/boards/{board_id}/columns/{column_id}/notifications", response_model=StageNotificationOut, status_code=status.HTTP_201_CREATED)
def add_notification_rule(
    board_id: str,
    column_id: str,
    data: StageNotificationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    col = _get_column_for_gate(board_id, column_id, tenant_id, db)
    body = (data.body or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    clash = next(
        (r for r in col.notification_rules if r.audience.value == data.audience and r.channel.value == data.channel),
        None,
    )
    if clash:
        raise HTTPException(
            status_code=400,
            detail=f"The {data.audience} already has {data.channel} on this stage",
        )
    max_order = max((r.sort_order for r in col.notification_rules), default=-1)
    rule = StageNotificationRule(
        column_id=col.id,
        tenant_id=tenant_id,
        audience=NotificationAudience(data.audience),
        channel=NotificationChannel(data.channel),
        subject=(data.subject or "").strip() or None,
        body=body,
        default_enabled=data.default_enabled,
        sort_order=max_order + 1,
    )
    db.add(rule)
    db.flush()
    log_activity(db, current_user.id, "stage_notification_created", "kanban_column", col.id, {"audience": data.audience, "channel": data.channel}, tenant_id=tenant_id)
    db.commit()
    db.refresh(rule)
    return _rule_to_dict(rule)


@router.patch("/boards/{board_id}/columns/{column_id}/notifications/{rule_id}", response_model=StageNotificationOut)
def update_notification_rule(
    board_id: str,
    column_id: str,
    rule_id: str,
    data: StageNotificationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    _get_column_for_gate(board_id, column_id, tenant_id, db)
    rule = db.query(StageNotificationRule).filter(
        StageNotificationRule.id == rule_id, StageNotificationRule.column_id == column_id
    ).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Notification rule not found")
    updates = data.model_dump(exclude_unset=True)
    if "body" in updates:
        body = (updates["body"] or "").strip()
        if not body:
            raise HTTPException(status_code=400, detail="Message cannot be empty")
        rule.body = body
    if "subject" in updates:
        rule.subject = (updates["subject"] or "").strip() or None
    if "default_enabled" in updates:
        rule.default_enabled = updates["default_enabled"]
    if "sort_order" in updates:
        rule.sort_order = updates["sort_order"]
    log_activity(db, current_user.id, "stage_notification_updated", "kanban_column", column_id, updates, tenant_id=tenant_id)
    db.commit()
    db.refresh(rule)
    return _rule_to_dict(rule)


@router.delete("/boards/{board_id}/columns/{column_id}/notifications/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_notification_rule(
    board_id: str,
    column_id: str,
    rule_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: str = Depends(get_tenant_id),
):
    _get_column_for_gate(board_id, column_id, tenant_id, db)
    rule = db.query(StageNotificationRule).filter(
        StageNotificationRule.id == rule_id, StageNotificationRule.column_id == column_id
    ).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Notification rule not found")
    # Outbox rows keep their own rendered copy, so past messages are unaffected.
    log_activity(db, current_user.id, "stage_notification_deleted", "kanban_column", column_id, {"audience": rule.audience.value, "channel": rule.channel.value}, tenant_id=tenant_id)
    db.delete(rule)
    db.commit()


@router.get("/applications/{app_id}/notifications", response_model=list[NotificationOutboxOut])
def list_application_notifications(
    app_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Every message this application's stage moves composed — sent, queued,
    suppressed or declined. While stage communications are switched off this is
    the record of what would have gone out."""
    application = db.query(LoanApplication).filter(
        LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id
    ).first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    check_application_access(application, current_user, db=db)

    rows = (
        db.query(NotificationOutbox)
        .filter(NotificationOutbox.application_id == app_id, NotificationOutbox.tenant_id == tenant_id)
        .order_by(NotificationOutbox.created_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "application_id": r.application_id,
            "stage_transition_id": r.stage_transition_id,
            "stage_title": r.stage_title,
            "audience": r.audience.value,
            "channel": r.channel.value,
            "recipient_name": r.recipient_name,
            "recipient_address": r.recipient_address,
            "subject": r.subject,
            "body": r.body,
            "status": r.status.value,
            "status_reason": r.status_reason,
            "created_at": r.created_at.isoformat() if r.created_at else "",
            "sent_at": r.sent_at.isoformat() if r.sent_at else None,
        }
        for r in rows
    ]


@router.get("/applications/{app_id}/transitions", response_model=list[StageTransitionOut])
def list_stage_transitions(
    app_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    """The application's stage history — the compliance trail of who moved it
    where, and what they attested to on the way."""
    application = db.query(LoanApplication).filter(
        LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id
    ).first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    check_application_access(application, current_user, db=db)

    rows = (
        db.query(StageTransition)
        .filter(StageTransition.application_id == app_id, StageTransition.tenant_id == tenant_id)
        .order_by(StageTransition.created_at.desc())
        .all()
    )
    out = []
    for row in rows:
        try:
            responses = json.loads(row.gate_responses) if row.gate_responses else []
        except ValueError:
            responses = []
        out.append({
            "id": row.id,
            "application_id": row.application_id,
            "board_id": row.board_id,
            "from_stage_title": row.from_stage_title,
            "to_stage_title": row.to_stage_title,
            "from_status": row.from_status,
            "to_status": row.to_status,
            "actor_id": row.actor_id,
            "actor_name": row.actor_name,
            "gate_responses": responses if isinstance(responses, list) else [],
            "created_at": row.created_at.isoformat() if row.created_at else "",
        })
    return out


@router.put("/boards/{board_id}/columns/reorder")
def reorder_columns(
    board_id: str,
    data: ColumnReorderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    board = db.query(KanbanBoard).filter(KanbanBoard.id == board_id, KanbanBoard.tenant_id == tenant_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    # Reordering happens inside one category view, so the payload names that
    # view's columns — not every column on the board.
    col_map = {c.id: c for c in board.columns if c.id in set(data.column_ids)}
    if set(data.column_ids) != set(col_map.keys()):
        raise HTTPException(status_code=400, detail="column_ids must all belong to this board")
    categories = {c.loan_category for c in col_map.values()}
    if len(categories) > 1:
        raise HTTPException(status_code=400, detail="Stages from different category views cannot be reordered together")
    expected = {c.id for c in board.columns if c.loan_category == next(iter(categories))}
    if set(data.column_ids) != expected:
        raise HTTPException(status_code=400, detail="column_ids must contain every stage in this view")
    for i, cid in enumerate(data.column_ids):
        col_map[cid].position = i
    log_activity(db, current_user.id, "columns_reordered", "kanban_board", board_id, tenant_id=tenant_id)
    db.commit()
    return {"status": "ok"}


# ── Applications grouped by column ──────────────────────────

@router.get("/boards/{board_id}/applications")
def get_board_applications(
    board_id: str,
    search: Optional[str] = None,
    loan_type: Optional[str] = None,
    category: Optional[str] = Query(None, description="Loan category slug(s), comma-separated"),
    sub_type: Optional[str] = None,
    broker_id: Optional[str] = None,
    client_id: Optional[str] = None,
    date_range: Optional[Literal["this_month", "last_month", "this_quarter", "last_quarter", "this_year"]] = None,
    updated_range: Optional[Literal["this_month", "last_month", "this_quarter", "last_quarter", "this_year"]] = None,
    min_days_in_stage: Optional[int] = Query(None, ge=1, le=365),
    per_column: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    board = db.query(KanbanBoard).filter(KanbanBoard.id == board_id, KanbanBoard.tenant_id == tenant_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")

    query = db.query(LoanApplication).options(
        joinedload(LoanApplication.user),
        selectinload(LoanApplication.brokers),
        joinedload(LoanApplication.completed_by),
        selectinload(LoanApplication.additional_applicants),
        selectinload(LoanApplication.corporate_guarantors).selectinload(ApplicationGuarantor.signatories),
        selectinload(LoanApplication.corporate_guarantors).joinedload(ApplicationGuarantor.organization),
    ).filter(LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None))

    # Brokers can view every application on the board — no assignment filter.

    if search:
        safe_search = escape_like(search)
        query = query.filter(
            LoanApplication.user_id.in_(
                db.query(User.id).filter(
                    User.full_name.ilike(f"%{safe_search}%", escape="\\") | User.email.ilike(f"%{safe_search}%", escape="\\")
                )
            )
        )
    if loan_type:
        query = query.filter(LoanApplication.loan_type == loan_type)
    # Category scope: the request filter (one or more categories, e.g. a broker
    # viewing their specialties) intersected with the board's own category.
    # Narrow in SQL by the loan_type values those categories can produce, then
    # refine by the recorded sub-type below (the sub-type lives in encrypted
    # JSON, so it can't be matched in SQL).
    try:
        requested = set(parse_categories(category))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    categories = requested or set(LOAN_CATEGORIES)
    if board.loan_category:
        categories &= {board.loan_category}
    # Same resolution as the board endpoint, so the cards and the stages they are
    # grouped into always come from the same view.
    stage_category = _active_stage_category(board, requested)
    ensure_stage_columns(db, board, stage_category, tenant_id)
    if categories != set(LOAN_CATEGORIES):
        query = query.filter(LoanApplication.loan_type.in_(category_loan_types(categories)))
    if broker_id:
        query = query.filter(
            LoanApplication.id.in_(
                db.query(ApplicationBroker.application_id).filter(ApplicationBroker.broker_id == broker_id)
            )
        )
    if client_id:
        query = query.filter(LoanApplication.user_id == client_id)

    # Date range filter (created_at)
    if date_range:
        query = apply_date_range_filter(query, LoanApplication.created_at, date_range)

    # Updated range filter (updated_at)
    if updated_range:
        query = apply_date_range_filter(query, LoanApplication.updated_at, updated_range)

    # Stage age filter: cards updated more than N days ago
    if min_days_in_stage:
        cutoff = datetime.now(timezone.utc) - timedelta(days=min_days_in_stage)
        query = query.filter(LoanApplication.updated_at <= cutoff)

    apps = query.order_by(LoanApplication.created_at.desc()).all()

    if categories != set(LOAN_CATEGORIES):
        apps = [a for a in apps if application_loan_category(a) in categories]
    if sub_type:
        apps = [a for a in apps if application_sub_type(a) == sub_type]

    # Cards sit where they were last placed in *this* stage view; anything never
    # dragged here (or dragged before stages existed) falls back to the first
    # stage for its status, so every application is always on the board exactly
    # once. A placement pointing at a stage since removed falls back too.
    columns = board_columns(board, stage_category)
    result: dict[str, list] = {col.id: [] for col in columns}
    fallback = _fallback_column_ids(columns)

    placements: dict[str, tuple[str, datetime]] = {}
    if apps:
        for app_id, col_id, entered_at in (
            db.query(
                ApplicationStagePlacement.application_id,
                ApplicationStagePlacement.column_id,
                ApplicationStagePlacement.entered_at,
            )
            .filter(
                ApplicationStagePlacement.board_id == board_id,
                ApplicationStagePlacement.application_id.in_([a.id for a in apps]),
            )
            .all()
        ):
            placements[app_id] = (col_id, entered_at)

    referrer_map = referrer_info_map(db, (app.user_id for app in apps))
    for app in apps:
        placed_col_id, entered_at = placements.get(app.id, (None, None))
        col_id = placed_col_id if placed_col_id in result else fallback.get(app.status.value)
        if col_id:
            card = app_with_user(app, db, referrer_map=referrer_map)
            card["stage_entered_at"] = entered_at.isoformat() if entered_at and placed_col_id == col_id else None
            result[col_id].append(card)

    # Apply per_column limit
    for col_id in result:
        result[col_id] = result[col_id][:per_column]

    return result


# ── Move card (drag-and-drop) ───────────────────────────────

@router.post("/boards/{board_id}/columns/{column_id}/move/{app_id}")
def move_card(
    board_id: str,
    column_id: str,
    app_id: str,
    payload: Optional[StageMoveRequest] = Body(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
    tenant_id: str = Depends(get_tenant_id),
):
    board = db.query(KanbanBoard).filter(KanbanBoard.id == board_id, KanbanBoard.tenant_id == tenant_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    col = db.query(KanbanColumn).filter(KanbanColumn.id == column_id, KanbanColumn.board_id == board_id).first()
    if not col:
        raise HTTPException(status_code=404, detail="Column not found")
    if not col.mapped_status:
        raise HTTPException(status_code=400, detail="This column is not mapped to an application status")
    new_status = ApplicationStatus(col.mapped_status)

    application = db.query(LoanApplication).filter(
        LoanApplication.id == app_id, LoanApplication.tenant_id == tenant_id
    ).first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    check_application_access(application, current_user, db=db)

    placement = db.query(ApplicationStagePlacement).filter(
        ApplicationStagePlacement.application_id == app_id,
        ApplicationStagePlacement.board_id == board_id,
    ).first()
    # Where the card is *on this board*: its placement, or the stage it has been
    # rendering in via the status fallback. `kanban_column_id` is not consulted —
    # it is a single legacy value that may point at another board entirely, and
    # the audit record must name the stage the mover actually saw.
    old_col_id = (
        placement.column_id if placement
        else _fallback_column_ids(board_columns(board, col.loan_category)).get(application.status.value)
    )
    if old_col_id == column_id:
        return {"status": "ok", "column_id": column_id, "column_title": col.title, "application_status": application.status.value}

    # The stage's gates are checked before anything is written, so a refused move
    # leaves no trace of a half-transition.
    gate_record, gate_lender, gate_conditions = _evaluate_gates(col, payload.gate_responses if payload else [])
    lender_name = gate_lender or (payload.lender_name if payload else None)
    conditions = gate_conditions or (payload.conditions if payload else None)

    from_col = db.query(KanbanColumn).filter(KanbanColumn.id == old_col_id).first() if old_col_id else None
    from_status = application.status.value

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if placement:
        placement.column_id = column_id
        placement.entered_at = now
        placement.moved_by_id = current_user.id
    else:
        db.add(ApplicationStagePlacement(
            application_id=app_id,
            board_id=board_id,
            column_id=column_id,
            tenant_id=tenant_id,
            entered_at=now,
            moved_by_id=current_user.id,
        ))
    application.kanban_column_id = column_id

    # The durable compliance record: stage titles and the actor's name are copied
    # in, so a later rename or deactivation can't rewrite what this move said.
    transition = StageTransition(
        application_id=app_id,
        tenant_id=tenant_id,
        board_id=board_id,
        from_column_id=old_col_id,
        to_column_id=column_id,
        from_stage_title=from_col.title if from_col else None,
        to_stage_title=col.title,
        from_status=from_status,
        to_status=new_status.value,
        actor_id=current_user.id,
        actor_name=current_user.full_name,
        gate_responses=json.dumps(gate_record) if gate_record else None,
        created_at=now,
    )
    db.add(transition)
    db.flush()

    # Compose whatever this stage tells the client, referrer or brokers, honouring
    # the mover's confirmations. Nothing is sent while stage communications are
    # off — the rows are the record of intent either way.
    notified = record_stage_notifications(
        db,
        application,
        col,
        decisions={d.rule_id: d.send for d in (payload.notifications if payload else [])},
        transition_id=transition.id,
        actor_id=current_user.id,
        tenant_id=tenant_id,
    )

    # Attestations and comms decisions go into the activity log too, so they show
    # on the application's Activity tab without a second place to look.
    details: dict = {"to_column": col.title, "from_column": from_col.title if from_col else None}
    attested = [e["label"] for e in gate_record if e.get("confirmed")]
    if attested:
        details["attested"] = attested
    told = sorted({f"{r.audience.value} ({r.channel.value})" for r in notified if r.status.value in ("queued", "suppressed")})
    withheld = sorted({f"{r.audience.value} ({r.channel.value})" for r in notified if r.status.value == "skipped"})
    if told:
        details["notified"] = told
    if withheld:
        details["not_notified"] = withheld
    log_activity(db, current_user.id, "kanban_moved", "application", app_id, details, tenant_id=tenant_id)

    # Several stages roll up to one status: a move within a status changes only
    # the stage, and must not re-run the status side-effects (client email/SMS,
    # the approval-conditions rebuild).
    if application.status != new_status:
        change_application_status(
            db, application, new_status, current_user.id, tenant_id,
            lender_name=lender_name,
            conditions=conditions,
            # A stage view carries several stages per status in its own order,
            # so the status transition table cannot govern a move within it.
            enforce_transitions=board.enforce_transitions and col.loan_category is None,
        )
    else:
        db.commit()

    return {"status": "ok", "column_id": column_id, "column_title": col.title, "application_status": new_status.value}
