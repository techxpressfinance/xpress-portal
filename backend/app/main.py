from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import inspect, text

from app.config import CORS_ORIGINS, DATABASE_URL, ENVIRONMENT
from app.database import Base, engine
from app.middleware.csrf import CSRFMiddleware
from app.middleware.logging import RequestLoggingMiddleware
from app.middleware.security import BodySizeLimitMiddleware, SecurityHeadersMiddleware
from app.models.application_broker import ApplicationBroker  # noqa: F401 — ensure table is created
from app.models.token_blacklist import TokenBlacklist  # noqa: F401 — ensure table is created
from app.routers import activity_logs, application_notes, applications, auth, documents, invitations, lend, messages, referrals, users

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

Base.metadata.create_all(bind=engine)

# Idempotent migrations for columns added after initial create_all
_MIGRATIONS = [
    ("loan_applications", "analysis_status", "VARCHAR(10)"),
    ("loan_applications", "analysis_result", "TEXT"),
    ("loan_applications", "analysis_error", "VARCHAR(500)"),
    ("loan_applications", "analyzed_at", "TIMESTAMP"),
    ("documents", "ocr_status", "VARCHAR(10) DEFAULT 'pending' NOT NULL"),
    ("documents", "ocr_text", "TEXT"),
    ("documents", "ocr_error", "VARCHAR(500)"),
    ("users", "email_verified", "BOOLEAN DEFAULT 1 NOT NULL"),
    ("users", "email_verification_token", "VARCHAR(36)"),
    ("users", "email_verification_token_expires_at", "TIMESTAMP"),
    ("loan_applications", "completed_by_id", "VARCHAR(36) REFERENCES users(id)"),
    ("loan_applications", "completed_at", "TIMESTAMP"),
    ("users", "auth_method", "VARCHAR(10) DEFAULT 'password' NOT NULL"),
    ("users", "login_code", "VARCHAR(64)"),
    ("users", "login_code_expires_at", "TIMESTAMP"),
    ("users", "login_code_attempts", "INTEGER DEFAULT 0 NOT NULL"),
    ("users", "invited_by_id", "VARCHAR(36) REFERENCES users(id)"),
    # Lend.com.au integration — loan_applications
    ("loan_applications", "applicant_title", "VARCHAR(20)"),
    ("loan_applications", "applicant_first_name", "VARCHAR(100)"),
    ("loan_applications", "applicant_last_name", "VARCHAR(100)"),
    ("loan_applications", "applicant_middle_name", "VARCHAR(100)"),
    ("loan_applications", "applicant_dob", "VARCHAR(10)"),
    ("loan_applications", "applicant_gender", "VARCHAR(20)"),
    ("loan_applications", "applicant_marital_status", "VARCHAR(30)"),
    ("loan_applications", "applicant_address", "VARCHAR(255)"),
    ("loan_applications", "applicant_suburb", "VARCHAR(100)"),
    ("loan_applications", "applicant_state", "VARCHAR(10)"),
    ("loan_applications", "applicant_postcode", "VARCHAR(10)"),
    ("loan_applications", "business_abn", "VARCHAR(20)"),
    ("loan_applications", "business_name", "VARCHAR(200)"),
    ("loan_applications", "business_registration_date", "VARCHAR(10)"),
    ("loan_applications", "business_industry_id", "INTEGER"),
    ("loan_applications", "business_monthly_sales", "NUMERIC(12,2)"),
    ("loan_applications", "loan_purpose_id", "INTEGER"),
    ("loan_applications", "loan_term_requested", "INTEGER"),
    ("loan_applications", "lend_extra_data", "TEXT"),
    ("loan_applications", "lend_product_type_id", "INTEGER"),
    ("loan_applications", "lend_owner_type", "VARCHAR(50)"),
    ("loan_applications", "lend_send_type", "VARCHAR(20)"),
    ("loan_applications", "lend_who_to_contact", "VARCHAR(20)"),
    ("loan_applications", "lend_ref", "VARCHAR(20)"),
    ("loan_applications", "lend_sync_status", "VARCHAR(20)"),
    ("loan_applications", "lend_sync_error", "TEXT"),
    ("loan_applications", "lend_synced_at", "TIMESTAMP"),
    # Lend.com.au integration — documents
    ("documents", "lend_document_type", "VARCHAR(100)"),
    ("documents", "lend_uploaded", "BOOLEAN DEFAULT 0 NOT NULL"),
    # Account lockout
    ("users", "failed_login_attempts", "INTEGER DEFAULT 0 NOT NULL"),
    ("users", "locked_until", "TIMESTAMP"),
    # Broker-specific fields
    ("users", "employee_id", "VARCHAR(50)"),
    ("users", "department", "VARCHAR(100)"),
    ("users", "license_number", "VARCHAR(100)"),
]

_logger = logging.getLogger(__name__)
_inspector = inspect(engine)
_column_cache: dict[str, set[str]] = {}
with engine.begin() as conn:
    for table, col, col_type in _MIGRATIONS:
        if table not in _column_cache:
            _column_cache[table] = {c["name"] for c in _inspector.get_columns(table)}
        if col not in _column_cache[table]:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}"))
            _logger.info("Added column %s.%s", table, col)

# Backfill: migrate existing assigned_broker_id rows into application_brokers
if "application_brokers" in {t for t in _inspector.get_table_names()}:
    _dialect = engine.dialect.name
    with engine.begin() as conn:
        if _dialect == "sqlite":
            conn.execute(text(
                "INSERT OR IGNORE INTO application_brokers (application_id, broker_id, assigned_at) "
                "SELECT id, assigned_broker_id, updated_at FROM loan_applications "
                "WHERE assigned_broker_id IS NOT NULL "
                "AND id NOT IN (SELECT application_id FROM application_brokers)"
            ))
        else:
            conn.execute(text(
                "INSERT INTO application_brokers (application_id, broker_id, assigned_at) "
                "SELECT id, assigned_broker_id, updated_at FROM loan_applications "
                "WHERE assigned_broker_id IS NOT NULL "
                "AND id NOT IN (SELECT application_id FROM application_brokers) "
                "ON CONFLICT DO NOTHING"
            ))

# Purge expired blacklisted tokens on startup
with engine.begin() as conn:
    if DATABASE_URL.startswith("sqlite"):
        conn.execute(text("DELETE FROM token_blacklist WHERE expires_at < datetime('now')"))
    else:
        conn.execute(text("DELETE FROM token_blacklist WHERE expires_at < NOW()"))
    _logger.info("Purged expired blacklisted tokens")

app = FastAPI(title="Xpress Tech Portal", version="0.1.0")


# --- Global exception handler: hide stack traces in production ---
@app.exception_handler(Exception)
async def _global_exception_handler(request: Request, exc: Exception):
    if ENVIRONMENT == "development":
        raise exc  # Show full traceback in development
    _logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


# Middleware (order matters - last added runs first)
app.add_middleware(CSRFMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(BodySizeLimitMiddleware)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in CORS_ORIGINS.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-CSRF-Token"],
)

app.include_router(auth.router)
app.include_router(invitations.router)
app.include_router(users.router)
app.include_router(applications.router)
app.include_router(application_notes.router)
app.include_router(documents.router)
app.include_router(messages.router)
app.include_router(referrals.router)
app.include_router(activity_logs.router)
app.include_router(lend.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
