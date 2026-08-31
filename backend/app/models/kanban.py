from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class KanbanBoard(Base):
    __tablename__ = "kanban_boards"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Scope board to one loan category (asset_finance | home_loan | commercial); NULL = all applications
    loan_category: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    created_by_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Whether card moves must obey VALID_TRANSITIONS. Boards built from a stage
    # template have several stages per status, so a move can legitimately jump a
    # status the transition table forbids — those boards turn the check off.
    enforce_transitions: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    columns = relationship("KanbanColumn", back_populates="board", cascade="all, delete-orphan", order_by="KanbanColumn.position")
    created_by = relationship("User", foreign_keys=[created_by_id])


class KanbanColumn(Base):
    """A stage on a board. Stages are *not* application statuses: several stages
    can roll up to the same `mapped_status`, which stays the coarse, client-facing
    lifecycle value. `stage_key` identifies a stage from a template (see
    BOARD_STAGE_TEMPLATES) so the template can be re-applied without duplicating."""

    __tablename__ = "kanban_columns"
    # Stages are created on demand the first time a category is viewed, so two
    # concurrent viewers can race to insert the same set. This makes the loser's
    # insert fail loudly instead of silently doubling the board. NULLs compare as
    # distinct, so the plain status columns (no stage_key) are unaffected.
    __table_args__ = (
        Index("uq_column_board_category_stage", "board_id", "loan_category", "stage_key", unique=True),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    board_id: Mapped[str] = mapped_column(String(36), ForeignKey("kanban_boards.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    mapped_status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    stage_key: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    # Which category view this stage belongs to. NULL is the board's default set
    # (one column per application status), shown when no templated category is in
    # view. A board holds one set per category and renders whichever is active.
    loan_category: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, index=True)
    # Team that owns the stage, e.g. "Melbourne" / "Offshore" — display only.
    team: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    color: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    board = relationship("KanbanBoard", back_populates="columns")
    gates = relationship(
        "KanbanColumnGate",
        back_populates="column",
        cascade="all, delete-orphan",
        order_by="KanbanColumnGate.sort_order",
        lazy="selectin",
    )
    notification_rules = relationship(
        "StageNotificationRule",
        back_populates="column",
        cascade="all, delete-orphan",
        order_by="StageNotificationRule.sort_order",
        lazy="selectin",
    )


class ApplicationStagePlacement(Base):
    """Where an application sits on one board. Placement is per (application, board)
    because the same application can appear on more than one board (its category
    board and a general one), and those boards have different stages.

    `LoanApplication.kanban_column_id` predates this and holds a single column id;
    it is kept in sync for the application's most recent move but the placement
    rows are the source of truth for board rendering."""

    __tablename__ = "application_stage_placements"
    __table_args__ = (UniqueConstraint("application_id", "board_id", name="uq_placement_app_board"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    application_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("loan_applications.id", ondelete="CASCADE"), nullable=False, index=True
    )
    board_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("kanban_boards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    column_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("kanban_columns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # When the card entered this stage — the honest basis for days-in-stage
    # (updated_at moves for any edit, not just a stage change).
    entered_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    moved_by_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)


class StageGateKind(str, enum.Enum):
    """What a stage asks for before a card may enter it.

    confirm   — a blocking acknowledgement the mover must tick ("the client has
                signed the privacy consent"). This is the compliance popup.
    checklist — a list captured on entry, e.g. the lender's approval conditions,
                which the team then works through.
    """

    confirm = "confirm"
    checklist = "checklist"


class KanbanColumnGate(Base):
    """A question a stage puts to whoever drags a card into it.

    Gates are data, not code: a compliance step added by an admin needs no
    deploy, and each answer is recorded against the move (see StageTransition)."""

    __tablename__ = "kanban_column_gates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    column_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("kanban_columns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[StageGateKind] = mapped_column(Enum(StageGateKind), nullable=False)
    label: Mapped[str] = mapped_column(String(300), nullable=False)
    help_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_required: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Where a checklist gate's answer goes. "approval_conditions" feeds the
    # application's lender name and approval-condition checklist; NULL keeps the
    # answer on the transition record alone.
    target: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    column = relationship("KanbanColumn", back_populates="gates")


class StageTransition(Base):
    """An immutable record of one card move: who moved what, when, and what they
    attested to on the way through.

    Stage titles and the actor's name are denormalised deliberately. This is a
    compliance record — renaming a stage or deactivating a user years later must
    not silently rewrite what a past move said."""

    __tablename__ = "stage_transitions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    application_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("loan_applications.id", ondelete="CASCADE"), nullable=False, index=True
    )
    board_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    from_column_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    to_column_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    from_stage_title: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    to_stage_title: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    from_status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    to_status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    actor_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    actor_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    # JSON list of {gate_id, kind, label, confirmed, value, items} as answered.
    gate_responses: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc), index=True, nullable=False
    )
