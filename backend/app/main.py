from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.encoders import ENCODERS_BY_TYPE
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# SQLite stores datetimes as timezone-naive text. Stamp UTC on every datetime
# before JSON serialisation so JavaScript parses them correctly.
ENCODERS_BY_TYPE[datetime] = lambda dt: (
    dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
).isoformat()

from app.config import CORS_ORIGINS, ENVIRONMENT
from app.middleware.csrf import CSRFMiddleware
from app.middleware.logging import RequestLoggingMiddleware
from app.middleware.security import BodySizeLimitMiddleware, SecurityHeadersMiddleware
from app.middleware.tenant import TenantMiddleware
from app import models as _models  # noqa: F401 — registers every model on Base.metadata
# Imported for its side effect: registers the before_flush hook that keeps each
# client account linked to its contact profile.
from app.services import client_identity as _client_identity  # noqa: F401
from app.routers import activity_logs, application_calculators, application_notes, applications, arrears, auth, broker_analytics, broker_groups, clawbacks, client_alerts, client_messages, commitment_schedules, contacts, dashboard, decline_reasons, documents, entity_notes, external_referrers, invitations, kanban, leads, ledger, lenders, lender_submissions, messages, notes_history, organizations, public_apply, public_track, quote_sheets, referrals, referrer, search, service_requests, settled_deals_analytics, settlement_checklists, standalone_quote_sheets, super_admin, tasks, tax_invoices, tenants, tracking_links, users

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
_logger = logging.getLogger(__name__)

# Error tracking — a no-op unless SENTRY_DSN is set. First, so it also reports
# failures during startup.
from app.observability import init_error_tracking  # noqa: E402

init_error_tracking()

# The schema is owned by Alembic (migrations/). Nothing at import time creates
# or alters tables; pending revisions are applied once each when the server
# starts (app/startup.py), or by hand with `python -m app.migrate`.

# API docs are only served in development — the OpenAPI schema enumerates the
# full attack surface and has no business being public in production.
_docs_kwargs = (
    {"docs_url": None, "redoc_url": None, "openapi_url": None}
    if ENVIRONMENT == "production"
    else {}
)
app = FastAPI(title="Xpress Finance Portal", version="0.1.0", **_docs_kwargs)


# --- Global exception handler: hide stack traces in production ---
@app.exception_handler(Exception)
async def _global_exception_handler(request: Request, exc: Exception):
    if ENVIRONMENT == "development":
        raise exc  # Show full traceback in development
    _logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


# Middleware (order matters - last added runs first)
app.add_middleware(TenantMiddleware)
app.add_middleware(CSRFMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(BodySizeLimitMiddleware)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in CORS_ORIGINS.split(",") if o.strip()],
    # http only for *.localhost; real tenant subdomains must be https
    allow_origin_regex=r"https?://[\w-]+\.localhost(:\d+)?|https://([\w-]+\.)?xpresstech\.ai",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-CSRF-Token", "X-Tenant-Slug"],
)

app.include_router(super_admin.router)
app.include_router(tenants.router)
app.include_router(auth.router)
app.include_router(invitations.router)
app.include_router(users.router)
app.include_router(applications.router)
app.include_router(application_notes.router)
app.include_router(decline_reasons.router)
app.include_router(notes_history.router)
app.include_router(client_messages.router)
app.include_router(client_alerts.router)
app.include_router(documents.router)
app.include_router(messages.router)
app.include_router(referrals.router)
app.include_router(referrer.router)
app.include_router(activity_logs.router)
app.include_router(dashboard.router)
app.include_router(broker_analytics.router)
app.include_router(settled_deals_analytics.router)
app.include_router(kanban.router)
app.include_router(leads.router)
app.include_router(search.router)
app.include_router(broker_groups.router)
app.include_router(external_referrers.router)
app.include_router(lenders.router)
app.include_router(lender_submissions.router)
app.include_router(tasks.router)
app.include_router(quote_sheets.router)
app.include_router(standalone_quote_sheets.router)
app.include_router(tax_invoices.router)
app.include_router(tax_invoices.sale_type_router)
app.include_router(settlement_checklists.router)
app.include_router(clawbacks.router)
app.include_router(ledger.router)
app.include_router(contacts.router)
app.include_router(commitment_schedules.router)
app.include_router(organizations.router)
app.include_router(entity_notes.router)
app.include_router(service_requests.router)
app.include_router(application_calculators.router)
app.include_router(arrears.router)
app.include_router(public_apply.router)
app.include_router(public_track.router)
app.include_router(tracking_links.router)


@app.get("/api/health")
def health():
    """Liveness: the process is up. Cheap; used by container health checks."""
    return {"status": "ok"}


@app.get("/api/health/ready")
def health_ready():
    """Readiness: the database answers and its schema is at the migration head.

    Point the uptime monitor here — a 503 means the portal cannot serve
    requests even though the process is running."""
    from sqlalchemy import text as _text

    from app.database import engine as _engine
    from app.migrate import schema_is_current

    try:
        with _engine.connect() as conn:
            conn.execute(_text("SELECT 1"))
        current = schema_is_current()
    except Exception:
        _logger.exception("Readiness check failed")
        return JSONResponse(status_code=503, content={"status": "unavailable", "database": "error"})
    if not current:
        return JSONResponse(status_code=503, content={"status": "unavailable", "database": "schema out of date"})
    return {"status": "ok", "database": "ok"}


# ── Startup: schema check, then the maintenance that belongs to a boot ────────
from app.startup import ensure_schema, run_startup_tasks  # noqa: E402


@app.on_event("startup")
def _prepare_database() -> None:
    ensure_schema()
    run_startup_tasks()


# ── Background scheduler: service-request due-date reminders ──────────────────
# In-process poller. Assumes a single uvicorn worker (true today); with multiple
# workers each process would run its own scheduler and could double-send.
import sys  # noqa: E402

from app.config import REMINDER_POLL_MINUTES, SCHEDULER_ENABLED  # noqa: E402
from app.services.service_request_reminders import (  # noqa: E402
    process_due_reminders,
    process_task_due_reminders,
)
from app.services.arrears import capture_completed_months  # noqa: E402
from app.services.settled_deal_archiving import archive_settled_deals  # noqa: E402

_scheduler = None
_RUNNING_TESTS = "pytest" in sys.modules

if SCHEDULER_ENABLED and not _RUNNING_TESTS:
    from apscheduler.schedulers.background import BackgroundScheduler

    _scheduler = BackgroundScheduler(daemon=True)
    _scheduler.add_job(
        process_due_reminders,
        "interval",
        minutes=REMINDER_POLL_MINUTES,
        id="sr_due_reminders",
        coalesce=True,
        max_instances=1,
    )
    _scheduler.add_job(
        process_task_due_reminders,
        "interval",
        minutes=REMINDER_POLL_MINUTES,
        id="task_due_reminders",
        coalesce=True,
        max_instances=1,
    )
    _scheduler.add_job(
        archive_settled_deals,
        "interval",
        minutes=REMINDER_POLL_MINUTES,
        id="archive_settled_deals",
        coalesce=True,
        max_instances=1,
    )
    # Freezes the arrears book at each month end. Runs on the same short
    # interval so a server that was down over a month boundary back-fills the
    # months it missed instead of losing them.
    _scheduler.add_job(
        capture_completed_months,
        "interval",
        minutes=REMINDER_POLL_MINUTES,
        id="arrears_month_snapshots",
        coalesce=True,
        max_instances=1,
    )

    @app.on_event("startup")
    def _start_scheduler() -> None:
        if _scheduler and not _scheduler.running:
            _scheduler.start()
            _logger.info("Started due-date reminder scheduler (every %s min)", REMINDER_POLL_MINUTES)

    @app.on_event("shutdown")
    def _stop_scheduler() -> None:
        if _scheduler and _scheduler.running:
            _scheduler.shutdown(wait=False)
