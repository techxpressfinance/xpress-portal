"""Where an application is up to, told the way a referrer needs to hear it.

A referrer can do exactly one thing about a file in progress: chase their own
client. So they are told three things and nothing else — which phase of the
journey the application is in, whose move it is, and how long it has been
sitting there. The desk's stage titles, the team names and the lender stay on
the board: "Credit Needs More Info" and "Offshore" describe how we work, not
what a referrer should do about it.

The phase band on the board (KanbanColumn.phase) is the journey; it already
groups the stages the way a person outside the desk would describe them, and it
deliberately spans statuses, so it tracks the work rather than the label.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from app.models.kanban import ApplicationStagePlacement, KanbanColumn
from app.models.loan_application import LoanApplication

# Whose move it is. Mirrors the `awaiting` values the stage templates carry.
AWAITING_CLIENT = "client"
AWAITING_NONE = "none"

# A board with no stage template (home loans, or any board still on the plain
# status columns) has no phase to read, so the status answers instead. The
# wording matches the templates' phase bands so a referrer watching two
# different loan types sees one vocabulary.
STATUS_PHASE: dict[str, str] = {
    "draft": "Application Started",
    "application_received": "Application Started",
    "application_assessed": "Finding a Lender",
    "submitted": "With the Lender",
    "approval": "Approved",
    "settled": "Settled",
    "rejected": "Closed",
    "not_proceeding": "Closed",
}

# The same fallback for whose move it is. Coarser than a stage's own answer —
# "approval" covers everything from chasing an invoice to booking settlement —
# but it is honest about the one case that matters: a draft is with the client.
STATUS_AWAITING: dict[str, str] = {
    "draft": AWAITING_CLIENT,
    "application_received": "desk",
    "application_assessed": "desk",
    "submitted": "lender",
    "approval": "desk",
    "settled": AWAITING_NONE,
    "rejected": AWAITING_NONE,
    "not_proceeding": AWAITING_NONE,
}

# The track shown when there is no board to read phases from. Closed outcomes
# are not steps on it — they end the journey rather than advancing it, and the
# view renders them on their own.
DEFAULT_PHASES = [
    "Application Started",
    "Finding a Lender",
    "With the Lender",
    "Approved",
    "Settled",
]

CLOSED_STATUSES = {"rejected", "not_proceeding"}


def _days_since(moment: Optional[datetime]) -> Optional[int]:
    if moment is None:
        return None
    # Stored naive in UTC (see the DateTime columns), so compare like with like.
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    reference = moment.replace(tzinfo=None) if moment.tzinfo else moment
    return max((now - reference).days, 0)


def _current_column(db: Session, application: LoanApplication) -> Optional[KanbanColumn]:
    """The stage the application is actually sitting in.

    `LoanApplication.kanban_column_id` holds only the most recent move, while the
    placement rows are the source of truth per board — but a referrer sees one
    journey, not one per board, so the most recently entered placement is the
    honest single answer."""
    placement = (
        db.query(ApplicationStagePlacement)
        .filter(ApplicationStagePlacement.application_id == application.id)
        .order_by(ApplicationStagePlacement.entered_at.desc())
        .first()
    )
    if placement is None:
        return None
    return db.query(KanbanColumn).filter(KanbanColumn.id == placement.column_id).first()


def _entered_at(db: Session, application: LoanApplication, column_id: Optional[str]) -> Optional[datetime]:
    if not column_id:
        return None
    placement = (
        db.query(ApplicationStagePlacement)
        .filter(
            ApplicationStagePlacement.application_id == application.id,
            ApplicationStagePlacement.column_id == column_id,
        )
        .first()
    )
    return placement.entered_at if placement else None


def _phase_track(db: Session, column: Optional[KanbanColumn]) -> list[str]:
    """The phases of this application's own board, in board order.

    Read from the board rather than hard-coded because a desk can rename a phase
    or add a stage under a new one, and the referrer's track should follow what
    the desk actually works. Duplicates collapse — several stages share a phase,
    which is the whole point of the band."""
    if column is None:
        return list(DEFAULT_PHASES)
    columns = (
        db.query(KanbanColumn)
        .filter(
            KanbanColumn.board_id == column.board_id,
            KanbanColumn.loan_category == column.loan_category,
            KanbanColumn.card_kind == "application",
        )
        .order_by(KanbanColumn.position)
        .all()
    )
    track: list[str] = []
    for col in columns:
        # A closed outcome is not a step forward, so it never takes a slot on
        # the track — the view shows it in place of the track entirely.
        if col.mapped_status in CLOSED_STATUSES:
            continue
        phase = col.phase or None
        if phase and phase not in track:
            track.append(phase)
    return track or list(DEFAULT_PHASES)


def summary(db: Session, application: LoanApplication) -> dict:
    """The journey as a referrer sees it: the track, where on it, whose move.

    Never includes the stage title, the team or the lender."""
    column = _current_column(db, application)
    status = application.status.value if hasattr(application.status, "value") else application.status

    phase = (column.phase if column else None) or STATUS_PHASE.get(status)
    awaiting = (column.awaiting if column else None) or STATUS_AWAITING.get(status, AWAITING_NONE)
    entered_at = _entered_at(db, application, column.id if column else None)

    # A file that has been closed is not partway along anything, so neither the
    # track position nor a waiting clock applies.
    closed = status if status in CLOSED_STATUSES else None
    if closed:
        phase = "Closed"
        awaiting = AWAITING_NONE

    track = _phase_track(db, column)
    return {
        "phase": phase,
        "phases": track,
        "phase_index": track.index(phase) if phase in track else None,
        "awaiting": awaiting,
        "entered_at": entered_at.isoformat() if entered_at else None,
        # How long it has been waiting on whoever `awaiting` names. Stage-level,
        # because the waiting is: `entered_at` is the honest clock (updated_at
        # moves for any edit, not just a stage change).
        "days_waiting": _days_since(entered_at),
        "closed": closed,
    }


def summary_map(db: Session, applications: Iterable[LoanApplication]) -> dict[str, dict]:
    """`summary` for a list, without the per-row queries.

    The list needs only where each file is and whose move it is — not the track
    — so this resolves the placements and their stages in two queries and leaves
    `phases` out."""
    apps = list(applications)
    if not apps:
        return {}

    placements = (
        db.query(ApplicationStagePlacement)
        .filter(ApplicationStagePlacement.application_id.in_([a.id for a in apps]))
        .order_by(ApplicationStagePlacement.entered_at.desc())
        .all()
    )
    # Most recently entered wins, matching _current_column.
    latest: dict[str, ApplicationStagePlacement] = {}
    for placement in placements:
        latest.setdefault(placement.application_id, placement)

    column_ids = {p.column_id for p in latest.values()}
    columns = (
        {c.id: c for c in db.query(KanbanColumn).filter(KanbanColumn.id.in_(column_ids)).all()}
        if column_ids
        else {}
    )

    result: dict[str, dict] = {}
    for app in apps:
        placement = latest.get(app.id)
        column = columns.get(placement.column_id) if placement else None
        status = app.status.value if hasattr(app.status, "value") else app.status
        closed = status if status in CLOSED_STATUSES else None
        result[app.id] = {
            "phase": "Closed" if closed else ((column.phase if column else None) or STATUS_PHASE.get(status)),
            "awaiting": AWAITING_NONE if closed else (
                (column.awaiting if column else None) or STATUS_AWAITING.get(status, AWAITING_NONE)
            ),
            "entered_at": placement.entered_at.isoformat() if placement else None,
            "days_waiting": _days_since(placement.entered_at) if placement else None,
            "closed": closed,
        }
    return result
