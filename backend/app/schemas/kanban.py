from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class StageGateCreate(BaseModel):
    kind: Literal["confirm", "checklist"]
    label: str
    help_text: Optional[str] = None
    is_required: bool = True
    target: Optional[str] = None


class StageGateUpdate(BaseModel):
    label: Optional[str] = None
    help_text: Optional[str] = None
    is_required: Optional[bool] = None
    sort_order: Optional[int] = None


class StageGateOut(BaseModel):
    id: str
    column_id: str
    kind: str
    label: str
    help_text: Optional[str] = None
    is_required: bool
    sort_order: int
    target: Optional[str] = None

    model_config = {"from_attributes": True}


class GateResponse(BaseModel):
    """One gate's answer, submitted with the card move that triggered it."""

    gate_id: str
    # confirm gates
    confirmed: bool = False
    # checklist gates — `value` is the single free-text field (the lender name on
    # an approval-conditions gate), `items` the list itself.
    value: Optional[str] = None
    items: list[str] = Field(default_factory=list)


class StageNotificationCreate(BaseModel):
    audience: Literal["client", "referrer", "broker"]
    channel: Literal["email", "sms"]
    subject: Optional[str] = None
    body: str
    default_enabled: bool = True


class StageNotificationUpdate(BaseModel):
    subject: Optional[str] = None
    body: Optional[str] = None
    default_enabled: Optional[bool] = None
    sort_order: Optional[int] = None


class StageNotificationOut(BaseModel):
    id: str
    column_id: str
    audience: str
    channel: str
    subject: Optional[str] = None
    body: str
    default_enabled: bool
    sort_order: int

    model_config = {"from_attributes": True}


class NotificationDecision(BaseModel):
    """Whether the person moving the card chose to send this rule's message."""

    rule_id: str
    send: bool


class NotificationOutboxOut(BaseModel):
    id: str
    application_id: str
    stage_transition_id: Optional[str] = None
    stage_title: Optional[str] = None
    audience: str
    channel: str
    recipient_name: Optional[str] = None
    recipient_address: Optional[str] = None
    subject: Optional[str] = None
    body: Optional[str] = None
    status: str
    status_reason: Optional[str] = None
    created_at: str
    sent_at: Optional[str] = None


class StageMoveRequest(BaseModel):
    """Payload for a card move. `gate_responses` answers the target stage's gates;
    `lender_name`/`conditions` remain for boards with no approval gate configured
    and for the /applications/{id}/status path."""

    gate_responses: list[GateResponse] = Field(default_factory=list)
    notifications: list[NotificationDecision] = Field(default_factory=list)
    lender_name: Optional[str] = None
    conditions: Optional[list[str]] = None


class StageTransitionOut(BaseModel):
    id: str
    application_id: str
    board_id: Optional[str] = None
    from_stage_title: Optional[str] = None
    to_stage_title: Optional[str] = None
    from_status: Optional[str] = None
    to_status: Optional[str] = None
    actor_id: Optional[str] = None
    actor_name: Optional[str] = None
    gate_responses: list[dict] = Field(default_factory=list)
    created_at: str


class KanbanColumnCreate(BaseModel):
    mapped_status: str
    title: Optional[str] = None
    position: int = 0
    color: Optional[str] = None
    stage_key: Optional[str] = None
    team: Optional[str] = None
    # Which category view the stage belongs to; null is the plain status set.
    loan_category: Optional[str] = None


class KanbanColumnUpdate(BaseModel):
    title: Optional[str] = None
    mapped_status: Optional[str] = None
    color: Optional[str] = None
    team: Optional[str] = None


class KanbanColumnOut(BaseModel):
    id: str
    board_id: str
    title: str
    mapped_status: Optional[str]
    position: int
    color: Optional[str]
    stage_key: Optional[str] = None
    team: Optional[str] = None
    gates: list[StageGateOut] = Field(default_factory=list)
    notifications: list[StageNotificationOut] = Field(default_factory=list)
    application_count: int = 0

    model_config = {"from_attributes": True}


class KanbanBoardCreate(BaseModel):
    name: str
    description: Optional[str] = None
    loan_category: Optional[str] = None
    columns: Optional[list[KanbanColumnCreate]] = None


class KanbanBoardUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    loan_category: Optional[str] = None
    enforce_transitions: Optional[bool] = None


class KanbanBoardOut(BaseModel):
    id: str
    name: str
    description: Optional[str]
    loan_category: Optional[str] = None
    is_default: bool
    enforce_transitions: bool = True
    # The category whose stages are on screen, or null for the status columns.
    stage_category: Optional[str] = None
    created_by_id: str
    created_by_name: Optional[str] = None
    columns: list[KanbanColumnOut] = []
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


class KanbanBoardListOut(BaseModel):
    id: str
    name: str
    description: Optional[str]
    loan_category: Optional[str] = None
    is_default: bool
    enforce_transitions: bool = True
    column_count: int = 0
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


class ColumnReorderRequest(BaseModel):
    column_ids: list[str]

