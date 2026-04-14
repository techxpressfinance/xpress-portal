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
from app.middleware.tenant import TenantMiddleware
from app.models.tenant import Tenant  # noqa: F401 — ensure table is created
from app.models.application_broker import ApplicationBroker  # noqa: F401 — ensure table is created
from app.models.token_blacklist import TokenBlacklist  # noqa: F401 — ensure table is created
from app.models.kanban import KanbanBoard, KanbanColumn  # noqa: F401 — ensure tables are created
from app.models.broker_group import BrokerGroup, broker_group_members  # noqa: F401 — ensure tables are created
from app.models.external_referral import ExternalReferral  # noqa: F401 — ensure table is created
from app.models.lender import Lender  # noqa: F401 — ensure table is created
from app.models.lender_submission import LenderSubmission  # noqa: F401 — ensure table is created
from app.models.task import Task, ChecklistItem  # noqa: F401 — ensure tables are created
from app.models.quote_sheet import QuoteSheet, QuoteOption  # noqa: F401 — ensure tables are created
from app.models.contact import Contact, Organization, ContactOrganization  # noqa: F401 — ensure tables are created
from app.constants import DEFAULT_KANBAN_COLUMNS
from app.routers import activity_logs, application_notes, applications, auth, broker_groups, contacts, dashboard, documents, external_referrers, invitations, kanban, lend, lenders, lender_submissions, messages, quote_sheets, referrals, search, standalone_quote_sheets, super_admin, tasks, tenants, users

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
    # Referrer-specific fields
    ("users", "organization_name", "VARCHAR(255)"),
    # Token revocation timestamp (for bulk invalidation on password change)
    ("users", "tokens_revoked_at", "TIMESTAMP"),
    # Note visibility: comma-separated roles (replaces is_internal boolean)
    ("application_notes", "visibility", "VARCHAR(100) DEFAULT 'broker' NOT NULL"),
    # Quote sheet shared input parameters (JSON)
    ("quote_sheets", "input_parameters", "TEXT"),
    # Contact linkage on loan applications
    ("loan_applications", "contact_id", "VARCHAR(36) REFERENCES contacts(id)"),
    # Standalone quote sheets: recipient info and nullable application_id
    ("quote_sheets", "recipient_name", "VARCHAR(200)"),
    ("quote_sheets", "recipient_email", "VARCHAR(255)"),
    # Multi-tenancy: add tenant_id to all tenant-scoped tables
    ("users", "tenant_id", "VARCHAR(36) REFERENCES tenants(id)"),
    ("loan_applications", "tenant_id", "VARCHAR(36) REFERENCES tenants(id)"),
    ("documents", "tenant_id", "VARCHAR(36) REFERENCES tenants(id)"),
    ("contacts", "tenant_id", "VARCHAR(36) REFERENCES tenants(id)"),
    ("organizations", "tenant_id", "VARCHAR(36) REFERENCES tenants(id)"),
    ("contact_organizations", "tenant_id", "VARCHAR(36) REFERENCES tenants(id)"),
    ("lenders", "tenant_id", "VARCHAR(36) REFERENCES tenants(id)"),
    ("lender_submissions", "tenant_id", "VARCHAR(36) REFERENCES tenants(id)"),
    ("kanban_boards", "tenant_id", "VARCHAR(36) REFERENCES tenants(id)"),
    ("kanban_columns", "tenant_id", "VARCHAR(36) REFERENCES tenants(id)"),
    ("tasks", "tenant_id", "VARCHAR(36) REFERENCES tenants(id)"),
    ("checklist_items", "tenant_id", "VARCHAR(36) REFERENCES tenants(id)"),
    ("quote_sheets", "tenant_id", "VARCHAR(36) REFERENCES tenants(id)"),
    ("quote_options", "tenant_id", "VARCHAR(36) REFERENCES tenants(id)"),
    ("activity_logs", "tenant_id", "VARCHAR(36) REFERENCES tenants(id)"),
    ("direct_messages", "tenant_id", "VARCHAR(36) REFERENCES tenants(id)"),
    ("referrals", "tenant_id", "VARCHAR(36) REFERENCES tenants(id)"),
    ("external_referrals", "tenant_id", "VARCHAR(36) REFERENCES tenants(id)"),
    ("application_notes", "tenant_id", "VARCHAR(36) REFERENCES tenants(id)"),
    ("application_brokers", "tenant_id", "VARCHAR(36) REFERENCES tenants(id)"),
    ("broker_groups", "tenant_id", "VARCHAR(36) REFERENCES tenants(id)"),
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

# SQLite doesn't support ALTER COLUMN to drop NOT NULL.
# Rebuild quote_sheets table to make application_id nullable.
with engine.begin() as conn:
    # Check if application_id is still NOT NULL by trying an insert with NULL
    _needs_rebuild = False
    try:
        _cols = {c["name"]: c for c in _inspector.get_columns("quote_sheets")}
        if "application_id" in _cols and _cols["application_id"].get("nullable") is False:
            _needs_rebuild = True
    except Exception:
        pass

    if _needs_rebuild:
        _logger.info("Rebuilding quote_sheets table to make application_id nullable")
        conn.execute(text("""
            CREATE TABLE quote_sheets_new (
                id VARCHAR(36) PRIMARY KEY,
                application_id VARCHAR(36) REFERENCES loan_applications(id) ON DELETE CASCADE,
                version INTEGER NOT NULL DEFAULT 1,
                title VARCHAR(200),
                status VARCHAR(5) NOT NULL DEFAULT 'draft',
                created_by_id VARCHAR(36) NOT NULL REFERENCES users(id),
                broker_notes TEXT,
                input_parameters TEXT,
                recipient_name VARCHAR(200),
                recipient_email VARCHAR(255),
                sent_at DATETIME,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )
        """))
        conn.execute(text("""
            INSERT INTO quote_sheets_new
                (id, application_id, version, title, status, created_by_id,
                 broker_notes, input_parameters, recipient_name, recipient_email,
                 sent_at, created_at, updated_at)
            SELECT id, application_id, version, title, status, created_by_id,
                   broker_notes, input_parameters, recipient_name, recipient_email,
                   sent_at, created_at, updated_at
            FROM quote_sheets
        """))
        conn.execute(text("DROP TABLE quote_sheets"))
        conn.execute(text("ALTER TABLE quote_sheets_new RENAME TO quote_sheets"))
        _logger.info("quote_sheets table rebuilt successfully")

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

# Backfill: migrate is_internal → visibility for application_notes
if "application_notes" in {t for t in _inspector.get_table_names()}:
    _an_cols = {c["name"] for c in _inspector.get_columns("application_notes")}
    if "is_internal" in _an_cols and "visibility" in _an_cols:
        with engine.begin() as conn:
            # is_internal=true (broker-only) → "broker", is_internal=false (client-facing) → "broker,client,referrer"
            conn.execute(text(
                "UPDATE application_notes SET visibility = 'broker' WHERE is_internal = 1 AND visibility = 'broker'"
            ))
            conn.execute(text(
                "UPDATE application_notes SET visibility = 'broker,client,referrer' WHERE is_internal = 0 AND visibility = 'broker'"
            ))
            _logger.info("Backfilled application_notes.visibility from is_internal")

# Backfill: create default tenant and assign all existing data
with engine.begin() as conn:
    _tenant_count = conn.execute(text("SELECT COUNT(*) FROM tenants")).scalar()
    if _tenant_count == 0:
        import uuid as _uuid
        from datetime import datetime as _dt, timezone as _tz
        _default_tenant_id = str(_uuid.uuid4())
        _now = _dt.now(_tz.utc)
        conn.execute(text(
            "INSERT INTO tenants (id, name, slug, is_active, created_at, updated_at) "
            "VALUES (:id, :name, :slug, 1, :now, :now)"
        ), {"id": _default_tenant_id, "name": "Default", "slug": "default", "now": _now})
        _tenant_tables = [
            "users", "loan_applications", "documents", "contacts", "organizations",
            "contact_organizations", "lenders", "lender_submissions", "kanban_boards",
            "kanban_columns", "tasks", "checklist_items", "quote_sheets", "quote_options",
            "activity_logs", "direct_messages", "referrals", "external_referrals",
            "application_notes", "application_brokers", "broker_groups",
        ]
        for _tbl in _tenant_tables:
            try:
                conn.execute(text(f"UPDATE {_tbl} SET tenant_id = :tid WHERE tenant_id IS NULL"), {"tid": _default_tenant_id})
            except Exception:
                pass  # Table may be empty or not exist yet
        _logger.info("Created default tenant %s and backfilled all data", _default_tenant_id)

# Purge expired blacklisted tokens on startup
with engine.begin() as conn:
    if DATABASE_URL.startswith("sqlite"):
        conn.execute(text("DELETE FROM token_blacklist WHERE expires_at < datetime('now')"))
    else:
        conn.execute(text("DELETE FROM token_blacklist WHERE expires_at < NOW()"))
    _logger.info("Purged expired blacklisted tokens")

# Seed super_admin user if none exists
with engine.begin() as conn:
    _sa_count = conn.execute(text("SELECT COUNT(*) FROM users WHERE role = 'super_admin'")).scalar()
    if _sa_count == 0:
        import os as _os
        import uuid as _uuid
        from datetime import datetime as _dt, timezone as _tz
        from app.services.auth import hash_password as _hash_pw
        _sa_email = _os.getenv("SUPER_ADMIN_EMAIL", "admin@xpresstech.com")
        _sa_password = _os.getenv("SUPER_ADMIN_PASSWORD", "Admin123!")
        _now = _dt.now(_tz.utc)
        conn.execute(text(
            "INSERT INTO users (id, email, password_hash, full_name, role, kyc_status, is_active, email_verified, auth_method, "
            "failed_login_attempts, login_code_attempts, created_at, updated_at) "
            "VALUES (:id, :email, :pw, :name, 'super_admin', 'verified', 1, 1, 'password', 0, 0, :now, :now)"
        ), {"id": str(_uuid.uuid4()), "email": _sa_email, "pw": _hash_pw(_sa_password), "name": "Super Admin", "now": _now})
        _logger.info("Seeded super_admin user: %s (change password immediately!)", _sa_email)

# Seed a default Kanban board per tenant if they don't have one
try:
    import uuid as _uuid
    from datetime import datetime as _dt, timezone as _tz
    with engine.begin() as conn:
        _tenants = conn.execute(text("SELECT id FROM tenants WHERE is_active = 1")).fetchall()
        for _tenant_row in _tenants:
            _tid = _tenant_row[0]
            _board_exists = conn.execute(
                text("SELECT COUNT(*) FROM kanban_boards WHERE tenant_id = :tid"), {"tid": _tid}
            ).scalar()
            if _board_exists > 0:
                continue
            _admin_row = conn.execute(
                text("SELECT id FROM users WHERE role='admin' AND tenant_id = :tid LIMIT 1"), {"tid": _tid}
            ).first()
            if not _admin_row:
                continue
            _now = _dt.now(_tz.utc)
            _board_id = str(_uuid.uuid4())
            _creator_id = _admin_row[0]
            conn.execute(text(
                "INSERT INTO kanban_boards (id, tenant_id, name, description, created_by_id, is_default, created_at, updated_at) "
                "VALUES (:id, :tid, :name, :desc, :creator, 1, :now, :now)"
            ), {"id": _board_id, "tid": _tid, "name": "Default Pipeline", "desc": "Default application pipeline board", "creator": _creator_id, "now": _now})
            for col_def in DEFAULT_KANBAN_COLUMNS:
                conn.execute(text(
                    "INSERT INTO kanban_columns (id, tenant_id, board_id, title, mapped_status, position, color, created_at) "
                    "VALUES (:id, :tid, :board_id, :title, :mapped_status, :position, :color, :now)"
                ), {"id": str(_uuid.uuid4()), "tid": _tid, "board_id": _board_id, **col_def, "now": _now})
            _logger.info("Seeded default Kanban board for tenant %s", _tid)
except Exception:
    _logger.debug("Kanban board seeding skipped (table may not exist yet)")

app = FastAPI(title="Xpress Tech Portal", version="0.1.0")


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
    allow_origin_regex=r"https?://[\w-]+\.(localhost(:\d+)?|xpresstech\.com)",
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
app.include_router(documents.router)
app.include_router(messages.router)
app.include_router(referrals.router)
app.include_router(activity_logs.router)
app.include_router(dashboard.router)
app.include_router(lend.router)
app.include_router(kanban.router)
app.include_router(search.router)
app.include_router(broker_groups.router)
app.include_router(external_referrers.router)
app.include_router(lenders.router)
app.include_router(lender_submissions.router)
app.include_router(tasks.router)
app.include_router(quote_sheets.router)
app.include_router(standalone_quote_sheets.router)
app.include_router(contacts.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
