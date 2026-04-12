from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload, selectinload

from app.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.application_broker import ApplicationBroker
from app.models.kanban import KanbanBoard, KanbanColumn
from app.models.loan_application import ApplicationStatus, LoanApplication
from app.models.user import User, UserRole
from app.schemas.kanban import (
    ColumnReorderRequest,
    KanbanBoardCreate,
    KanbanBoardListOut,
    KanbanBoardOut,
    KanbanBoardUpdate,
    KanbanColumnCreate,
    KanbanColumnOut,
    KanbanColumnUpdate,
)
from app.constants import DEFAULT_KANBAN_COLUMNS, VALID_TRANSITIONS
from app.services.access_control import check_application_access
from app.services.activity_log import log_activity
from app.services.date_filter import apply_date_range_filter
from app.services.email import send_status_notification
from app.services.query_utils import escape_like
from app.services.serialization import app_with_user

router = APIRouter(prefix="/api/kanban", tags=["kanban"])

_VALID_STATUSES = {s.value for s in ApplicationStatus}


def _validate_mapped_status(status: str) -> None:
    if status not in _VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid mapped_status: {status}")


def _board_to_dict(board: KanbanBoard, db: Session) -> dict:
    """Serialize board with columns."""
    cols = []
    for col in board.columns:
        cols.append({
            "id": col.id,
            "board_id": col.board_id,
            "title": col.title,
            "mapped_status": col.mapped_status,
            "position": col.position,
            "color": col.color,
            "application_count": 0,
        })
    return {
        "id": board.id,
        "name": board.name,
        "description": board.description,
        "is_default": board.is_default,
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
):
    boards = db.query(KanbanBoard).order_by(KanbanBoard.created_at).all()
    return [
        {
            "id": b.id,
            "name": b.name,
            "description": b.description,
            "is_default": b.is_default,
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
):
    board = KanbanBoard(name=data.name, description=data.description, created_by_id=current_user.id)
    db.add(board)
    db.flush()

    cols = data.columns if data.columns else [KanbanColumnCreate(**c) for c in DEFAULT_KANBAN_COLUMNS]
    for col_data in cols:
        if col_data.mapped_status:
            _validate_mapped_status(col_data.mapped_status)
        col = KanbanColumn(
            board_id=board.id,
            title=col_data.title,
            mapped_status=col_data.mapped_status,
            position=col_data.position,
            color=col_data.color,
        )
        db.add(col)

    log_activity(db, current_user.id, "board_created", "kanban_board", board.id, {"name": data.name})
    db.commit()
    db.refresh(board)
    return _board_to_dict(board, db)


@router.get("/boards/{board_id}", response_model=KanbanBoardOut)
def get_board(
    board_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
):
    board = db.query(KanbanBoard).filter(KanbanBoard.id == board_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    return _board_to_dict(board, db)


@router.patch("/boards/{board_id}", response_model=KanbanBoardOut)
def update_board(
    board_id: str,
    data: KanbanBoardUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    board = db.query(KanbanBoard).filter(KanbanBoard.id == board_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    updates = data.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(board, key, value)
    log_activity(db, current_user.id, "board_updated", "kanban_board", board.id, updates)
    db.commit()
    db.refresh(board)
    return _board_to_dict(board, db)


@router.delete("/boards/{board_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_board(
    board_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    board = db.query(KanbanBoard).filter(KanbanBoard.id == board_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    total = db.query(KanbanBoard).count()
    if total <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the only board")
    log_activity(db, current_user.id, "board_deleted", "kanban_board", board.id, {"name": board.name})
    db.delete(board)
    db.commit()


# ── Column CRUD ─────────────────────────────────────────────

@router.post("/boards/{board_id}/columns", response_model=KanbanColumnOut, status_code=status.HTTP_201_CREATED)
def add_column(
    board_id: str,
    data: KanbanColumnCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    board = db.query(KanbanBoard).filter(KanbanBoard.id == board_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    if data.mapped_status:
        _validate_mapped_status(data.mapped_status)
    max_pos = max((c.position for c in board.columns), default=-1)
    col = KanbanColumn(
        board_id=board_id,
        title=data.title,
        mapped_status=data.mapped_status,
        position=max_pos + 1,
        color=data.color,
    )
    db.add(col)
    log_activity(db, current_user.id, "column_created", "kanban_column", col.id, {"title": data.title, "board_id": board_id})
    db.commit()
    db.refresh(col)
    count = 0
    if col.mapped_status:
        count = db.query(LoanApplication).filter(LoanApplication.status == col.mapped_status).count()
    return {**{c.name: getattr(col, c.name) for c in col.__table__.columns}, "application_count": count}


@router.patch("/boards/{board_id}/columns/{column_id}", response_model=KanbanColumnOut)
def update_column(
    board_id: str,
    column_id: str,
    data: KanbanColumnUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    col = db.query(KanbanColumn).filter(KanbanColumn.id == column_id, KanbanColumn.board_id == board_id).first()
    if not col:
        raise HTTPException(status_code=404, detail="Column not found")
    updates = data.model_dump(exclude_unset=True)
    if "mapped_status" in updates and updates["mapped_status"]:
        _validate_mapped_status(updates["mapped_status"])
    for key, value in updates.items():
        setattr(col, key, value)
    log_activity(db, current_user.id, "column_updated", "kanban_column", col.id, updates)
    db.commit()
    db.refresh(col)
    count = 0
    if col.mapped_status:
        count = db.query(LoanApplication).filter(LoanApplication.status == col.mapped_status).count()
    return {**{c.name: getattr(col, c.name) for c in col.__table__.columns}, "application_count": count}


@router.delete("/boards/{board_id}/columns/{column_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_column(
    board_id: str,
    column_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    col = db.query(KanbanColumn).filter(KanbanColumn.id == column_id, KanbanColumn.board_id == board_id).first()
    if not col:
        raise HTTPException(status_code=404, detail="Column not found")
    board = db.query(KanbanBoard).filter(KanbanBoard.id == board_id).first()
    if len(board.columns) <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last column")
    log_activity(db, current_user.id, "column_deleted", "kanban_column", col.id, {"title": col.title})
    db.delete(col)
    # Reorder remaining columns
    remaining = db.query(KanbanColumn).filter(KanbanColumn.board_id == board_id, KanbanColumn.id != column_id).order_by(KanbanColumn.position).all()
    for i, c in enumerate(remaining):
        c.position = i
    db.commit()


@router.put("/boards/{board_id}/columns/reorder")
def reorder_columns(
    board_id: str,
    data: ColumnReorderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    board = db.query(KanbanBoard).filter(KanbanBoard.id == board_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    col_map = {c.id: c for c in board.columns}
    if set(data.column_ids) != set(col_map.keys()):
        raise HTTPException(status_code=400, detail="column_ids must contain all column IDs for this board")
    for i, cid in enumerate(data.column_ids):
        col_map[cid].position = i
    log_activity(db, current_user.id, "columns_reordered", "kanban_board", board_id)
    db.commit()
    return {"status": "ok"}


# ── Applications grouped by column ──────────────────────────

@router.get("/boards/{board_id}/applications")
def get_board_applications(
    board_id: str,
    search: Optional[str] = None,
    loan_type: Optional[str] = None,
    broker_id: Optional[str] = None,
    client_id: Optional[str] = None,
    date_range: Optional[Literal["this_month", "last_month", "this_quarter", "last_quarter", "this_year"]] = None,
    per_column: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
):
    board = db.query(KanbanBoard).filter(KanbanBoard.id == board_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")

    query = db.query(LoanApplication).options(
        joinedload(LoanApplication.user),
        selectinload(LoanApplication.brokers),
        joinedload(LoanApplication.completed_by),
    )

    # Broker access: only their assigned applications
    if current_user.role == UserRole.broker:
        query = query.filter(
            LoanApplication.id.in_(
                db.query(ApplicationBroker.application_id).filter(ApplicationBroker.broker_id == current_user.id)
            )
        )

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
    if broker_id:
        query = query.filter(
            LoanApplication.id.in_(
                db.query(ApplicationBroker.application_id).filter(ApplicationBroker.broker_id == broker_id)
            )
        )
    if client_id:
        query = query.filter(LoanApplication.user_id == client_id)

    # Date range filter
    if date_range:
        query = apply_date_range_filter(query, LoanApplication.created_at, date_range)

    apps = query.order_by(LoanApplication.created_at.desc()).all()

    # Group by column
    result = {}
    for col in board.columns:
        if col.mapped_status:
            col_apps = [app_with_user(a) for a in apps if a.status.value == col.mapped_status][:per_column]
        else:
            col_apps = []
        result[col.id] = col_apps

    return result


# ── Move card (drag-and-drop) ───────────────────────────────

@router.post("/boards/{board_id}/columns/{column_id}/move/{app_id}")
def move_card(
    board_id: str,
    column_id: str,
    app_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
):
    col = db.query(KanbanColumn).filter(KanbanColumn.id == column_id, KanbanColumn.board_id == board_id).first()
    if not col:
        raise HTTPException(status_code=404, detail="Column not found")

    application = db.query(LoanApplication).options(
        selectinload(LoanApplication.brokers),
        joinedload(LoanApplication.user),
    ).filter(LoanApplication.id == app_id).first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    check_application_access(application, current_user, db=db)

    if not col.mapped_status:
        return {"status": "ok", "message": "Column has no mapped status — no change"}

    current = application.status.value
    new_status = col.mapped_status

    if current == new_status:
        return {"status": "ok", "message": "Already in this status"}

    allowed = VALID_TRANSITIONS.get(current, [])
    if new_status not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot transition from '{current}' to '{new_status}'. Allowed: {allowed}",
        )

    old_status = current
    application.status = ApplicationStatus(new_status)
    log_activity(db, current_user.id, "status_changed", "application", app_id, {"from": old_status, "to": new_status})
    db.commit()

    # Email notification
    if application.user:
        send_status_notification(application.user.email, application.user.full_name, application.loan_type.value, new_status)

    return {"status": "ok", "from": old_status, "to": new_status}
