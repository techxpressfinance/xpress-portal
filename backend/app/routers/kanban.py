from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

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
from app.services.access_control import check_application_access
from app.services.activity_log import log_activity
from app.services.email import send_status_notification

router = APIRouter(prefix="/api/kanban", tags=["kanban"])

VALID_TRANSITIONS = {
    "draft": ["submitted"],
    "submitted": ["reviewing", "rejected"],
    "reviewing": ["approved", "rejected"],
    "approved": [],
    "rejected": [],
}

DEFAULT_COLUMNS = [
    {"title": "Draft", "mapped_status": "draft", "position": 0, "color": "muted-foreground"},
    {"title": "Submitted", "mapped_status": "submitted", "position": 1, "color": "primary"},
    {"title": "Reviewing", "mapped_status": "reviewing", "position": 2, "color": "chart-4"},
    {"title": "Approved", "mapped_status": "approved", "position": 3, "color": "success"},
    {"title": "Rejected", "mapped_status": "rejected", "position": 4, "color": "destructive"},
]


def _board_to_dict(board: KanbanBoard, db: Session) -> dict:
    """Serialize board with columns and application counts."""
    cols = []
    for col in board.columns:
        count = 0
        if col.mapped_status:
            count = db.query(LoanApplication).filter(LoanApplication.status == col.mapped_status).count()
        cols.append({
            "id": col.id,
            "board_id": col.board_id,
            "title": col.title,
            "mapped_status": col.mapped_status,
            "position": col.position,
            "color": col.color,
            "application_count": count,
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

    cols = data.columns if data.columns else [KanbanColumnCreate(**c) for c in DEFAULT_COLUMNS]
    for col_data in cols:
        if col_data.mapped_status:
            valid = {s.value for s in ApplicationStatus}
            if col_data.mapped_status not in valid:
                raise HTTPException(status_code=400, detail=f"Invalid mapped_status: {col_data.mapped_status}")
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
        valid = {s.value for s in ApplicationStatus}
        if data.mapped_status not in valid:
            raise HTTPException(status_code=400, detail=f"Invalid mapped_status: {data.mapped_status}")
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
        valid = {s.value for s in ApplicationStatus}
        if updates["mapped_status"] not in valid:
            raise HTTPException(status_code=400, detail=f"Invalid mapped_status: {updates['mapped_status']}")
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
    search: str | None = None,
    loan_type: str | None = None,
    broker_id: str | None = None,
    client_id: str | None = None,
    date_range: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "broker")),
):
    board = db.query(KanbanBoard).filter(KanbanBoard.id == board_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")

    from sqlalchemy.orm import joinedload, selectinload
    query = db.query(LoanApplication).options(
        joinedload(LoanApplication.user),
        selectinload(LoanApplication.brokers),
        selectinload(LoanApplication.completed_by),
    )

    # Broker access: only their assigned applications
    if current_user.role == UserRole.broker:
        query = query.filter(
            LoanApplication.id.in_(
                db.query(ApplicationBroker.application_id).filter(ApplicationBroker.broker_id == current_user.id)
            )
        )

    if search:
        query = query.join(User, LoanApplication.user_id == User.id).filter(
            User.full_name.ilike(f"%{search}%") | User.email.ilike(f"%{search}%")
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
        from datetime import datetime, timedelta, timezone
        now = datetime.now(timezone.utc)
        if date_range == "this_month":
            start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            query = query.filter(LoanApplication.created_at >= start)
        elif date_range == "last_month":
            first_this_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            start = (first_this_month - timedelta(days=1)).replace(day=1)
            query = query.filter(LoanApplication.created_at >= start, LoanApplication.created_at < first_this_month)
        elif date_range == "this_quarter":
            quarter_month = ((now.month - 1) // 3) * 3 + 1
            start = now.replace(month=quarter_month, day=1, hour=0, minute=0, second=0, microsecond=0)
            query = query.filter(LoanApplication.created_at >= start)
        elif date_range == "last_quarter":
            quarter_month = ((now.month - 1) // 3) * 3 + 1
            start_this_q = now.replace(month=quarter_month, day=1, hour=0, minute=0, second=0, microsecond=0)
            if quarter_month > 3:
                start_last_q = start_this_q.replace(month=quarter_month - 3)
            else:
                start_last_q = start_this_q.replace(year=now.year - 1, month=10)
            query = query.filter(LoanApplication.created_at >= start_last_q, LoanApplication.created_at < start_this_q)
        elif date_range == "this_year":
            start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
            query = query.filter(LoanApplication.created_at >= start)

    apps = query.order_by(LoanApplication.created_at.desc()).all()

    # Group by column
    from app.routers.applications import _app_with_user
    result = {}
    for col in board.columns:
        if col.mapped_status:
            col_apps = [_app_with_user(a) for a in apps if a.status.value == col.mapped_status]
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

    application = db.query(LoanApplication).filter(LoanApplication.id == app_id).first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    check_application_access(application, current_user)

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
    application.status = new_status
    log_activity(db, current_user.id, "status_changed", "application", app_id, {"from": old_status, "to": new_status})
    db.commit()

    # Email notification
    client = db.query(User).filter(User.id == application.user_id).first()
    if client:
        send_status_notification(client.email, client.full_name, application.loan_type.value, new_status)

    return {"status": "ok", "from": old_status, "to": new_status}
