from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.encoders import ENCODERS_BY_TYPE
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import inspect, text

# SQLite stores datetimes as timezone-naive text. Stamp UTC on every datetime
# before JSON serialisation so JavaScript parses them correctly.
ENCODERS_BY_TYPE[datetime] = lambda dt: (
    dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
).isoformat()

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
from app.models.lender import Lender, LenderContact  # noqa: F401 — ensure tables are created
from app.models.lender_submission import LenderSubmission  # noqa: F401 — ensure table is created
from app.models.task import Task, ChecklistItem  # noqa: F401 — ensure tables are created
from app.models.quote_sheet import QuoteSheet, QuoteOption  # noqa: F401 — ensure tables are created
from app.models.document_request import DocumentRequest  # noqa: F401 — ensure table is created
from app.models.contact import Contact, Organization, ContactOrganization  # noqa: F401 — ensure tables are created
from app.models.lending_history_entry import LendingHistoryEntry  # noqa: F401 — ensure table is created
from app.models.service_request import ServiceRequest  # noqa: F401 — ensure table is created
from app.models.application_calculator import ApplicationCalculator  # noqa: F401 — ensure table is created
from app.models.client_message import ClientMessage  # noqa: F401 — ensure table is created
from app.models.client_alert import ClientAlert  # noqa: F401 — ensure table is created
from app.constants import DEFAULT_KANBAN_COLUMNS
from app.routers import activity_logs, application_calculators, application_notes, applications, auth, broker_groups, client_alerts, client_messages, contacts, dashboard, documents, external_referrers, invitations, kanban, lenders, lender_submissions, messages, organizations, public_apply, quote_sheets, referrals, referrer, search, service_requests, standalone_quote_sheets, super_admin, tasks, tenants, users

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
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
    ("users", "email_verified", "BOOLEAN DEFAULT TRUE NOT NULL"),
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
    # Lend.com.au integration — documents
    ("documents", "lend_document_type", "VARCHAR(100)"),
    ("documents", "lend_uploaded", "BOOLEAN DEFAULT FALSE NOT NULL"),
    # Account lockout
    ("users", "failed_login_attempts", "INTEGER DEFAULT 0 NOT NULL"),
    ("users", "locked_until", "TIMESTAMP"),
    # Broker-specific fields
    ("users", "employee_id", "VARCHAR(50)"),
    ("users", "department", "VARCHAR(100)"),
    ("users", "license_number", "VARCHAR(100)"),
    # Referrer-specific fields
    ("users", "organization_name", "VARCHAR(255)"),
    ("external_referrals", "client_engagement_model", "VARCHAR(20)"),
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
    # 1:1 messaging: recipient for client_messages
    ("client_messages", "recipient_id", "VARCHAR(36) REFERENCES users(id)"),
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
    # Kanban board position (independent of workflow status)
    ("loan_applications", "kanban_column_id", "VARCHAR(36)"),
    # Extended applicant form fields
    ("loan_applications", "applicant_mobile", "VARCHAR(20)"),
    ("loan_applications", "preferred_contact_method", "VARCHAR(50)"),
    ("loan_applications", "id_expiry_date", "VARCHAR(10)"),
    ("loan_applications", "applicant_residency_status", "VARCHAR(50)"),
    ("loan_applications", "residential_status", "VARCHAR(50)"),
    ("loan_applications", "time_at_address", "VARCHAR(50)"),
    ("loan_applications", "applicant_num_dependants", "INTEGER"),
    ("loan_applications", "has_partner", "BOOLEAN"),
    ("loan_applications", "partner_working", "BOOLEAN"),
    ("loan_applications", "employment_category", "VARCHAR(30)"),
    ("loan_applications", "employer_name", "VARCHAR(200)"),
    ("loan_applications", "employer_industry", "VARCHAR(100)"),
    ("loan_applications", "job_title", "VARCHAR(100)"),
    ("loan_applications", "income_frequency", "VARCHAR(20)"),
    ("loan_applications", "gross_income", "NUMERIC(12,2)"),
    ("loan_applications", "trading_name", "VARCHAR(200)"),
    ("loan_applications", "business_structure", "VARCHAR(50)"),
    ("loan_applications", "gst_registered", "BOOLEAN"),
    ("loan_applications", "num_directors", "INTEGER"),
    ("loan_applications", "time_trading", "VARCHAR(50)"),
    ("loan_applications", "previously_declined", "BOOLEAN"),
    ("loan_applications", "change_of_circumstances", "BOOLEAN"),
    ("loan_applications", "signature_name", "VARCHAR(200)"),
    ("loan_applications", "emergency_contact_name", "VARCHAR(200)"),
    ("loan_applications", "emergency_contact_relationship", "VARCHAR(100)"),
    ("loan_applications", "emergency_contact_phone", "VARCHAR(20)"),
    ("loan_applications", "client_engagement_model", "VARCHAR(20)"),
    ("loan_applications", "applicant_email", "VARCHAR(200)"),
    # Client invite magic-link
    ("loan_applications", "client_invite_token", "VARCHAR(64)"),
    ("loan_applications", "client_invite_email", "VARCHAR(200)"),
    ("loan_applications", "client_invite_sent_at", "TIMESTAMP"),
    # Unread tracking for client messages
    ("client_messages", "is_read", "BOOLEAN DEFAULT FALSE NOT NULL"),
    # Assigned broker on service requests
    ("service_requests", "assigned_broker_id", "VARCHAR(36) REFERENCES users(id)"),
    # Broker-side notes on service requests
    ("service_requests", "broker_notes", "TEXT"),
    # Message visibility: who can read the message beyond the direct recipient
    ("client_messages", "visibility", "VARCHAR(20) DEFAULT 'all' NOT NULL"),
    # Soft delete: timestamp set when an admin/broker deletes an application
    ("loan_applications", "deleted_at", "TIMESTAMP"),
    # Company name on external referrals (for contact book)
    ("external_referrals", "company_name", "VARCHAR(200)"),
    # Password reset flow
    ("users", "password_reset_token", "VARCHAR(64)"),
    ("users", "password_reset_token_expires_at", "TIMESTAMP"),
    # Soft-delete tracking for users (admin deleted clients)
    ("users", "deleted_at", "TIMESTAMP"),
    ("users", "deleted_original_email", "VARCHAR(255)"),
    ("users", "deleted_original_name", "VARCHAR(255)"),
    # Client (all-up) interest rate per quote option
    ("quote_options", "client_interest_rate", "NUMERIC(8,4)"),
    # Broker lock — prevents client from editing the draft
    ("loan_applications", "is_locked", "BOOLEAN NOT NULL DEFAULT FALSE"),
    # Broker-selected sections the client may complete (JSON array; null = all)
    ("loan_applications", "client_sections", "TEXT"),
    # Links a fulfilled document request to the document that satisfied it
    ("document_requests", "document_id", "VARCHAR(36)"),
    # Saved client profile (encrypted JSON) for autofilling new applications
    ("users", "client_profile", "TEXT"),
    # FK to organizations — set when application's business ABN matches a Company
    ("loan_applications", "business_organization_id", "VARCHAR(36) REFERENCES organizations(id)"),
    # Separates messages composed inside a specific application from "outside" (global) conversations
    ("client_messages", "application_id", "VARCHAR(36) REFERENCES loan_applications(id)"),
    # Commercial multi-director reconciliation flags
    ("loan_applications", "needs_reconciliation", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ("loan_applications", "reconciliation_note", "TEXT"),
    # Referrer direct-engagement: hide from client portal until broker releases
    ("loan_applications", "hidden_from_client", "BOOLEAN NOT NULL DEFAULT FALSE"),
    # Corporate guarantors: a party can be a signatory of a guarantor company
    ("loan_applicants", "application_guarantor_id", "VARCHAR(36) REFERENCES application_guarantors(id)"),
]

_logger = logging.getLogger(__name__)
_inspector = inspect(engine)
_dialect = engine.dialect.name
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
        if _dialect == "sqlite":
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
        else:
            conn.execute(text("ALTER TABLE quote_sheets ALTER COLUMN application_id DROP NOT NULL"))
            _logger.info("Made quote_sheets.application_id nullable")

# Data migration: remap legacy ApplicationStatus values to the new vocabulary.
# Old: submitted, reviewing, approved  →  New: application_received, application_assessed, approval
# Postgres: enum is created fresh with correct values so legacy values can't exist; SQLite only.
if _dialect == "sqlite":
    with engine.begin() as conn:
        _status_remap = [
            ("submitted", "application_received"),
            ("reviewing", "application_assessed"),
            ("approved", "approval"),
        ]
        for _old, _new in _status_remap:
            conn.execute(
                text("UPDATE loan_applications SET status = :new WHERE status = :old"),
                {"old": _old, "new": _new},
            )
            conn.execute(
                text("UPDATE kanban_columns SET mapped_status = :new WHERE mapped_status = :old"),
                {"old": _old, "new": _new},
            )

# Backfill: migrate existing assigned_broker_id rows into application_brokers
# Only migrate rows where the assigned user is actually a broker (not an admin).
if "application_brokers" in {t for t in _inspector.get_table_names()}:
    with engine.begin() as conn:
        if _dialect == "sqlite":
            conn.execute(text(
                "INSERT OR IGNORE INTO application_brokers (application_id, broker_id, assigned_at) "
                "SELECT la.id, la.assigned_broker_id, la.updated_at FROM loan_applications la "
                "JOIN users u ON u.id = la.assigned_broker_id AND u.role = 'broker' "
                "WHERE la.assigned_broker_id IS NOT NULL "
                "AND la.id NOT IN (SELECT application_id FROM application_brokers)"
            ))
        else:
            conn.execute(text(
                "INSERT INTO application_brokers (application_id, broker_id, assigned_at) "
                "SELECT la.id, la.assigned_broker_id, la.updated_at FROM loan_applications la "
                "JOIN users u ON u.id = la.assigned_broker_id AND u.role = 'broker' "
                "WHERE la.assigned_broker_id IS NOT NULL "
                "AND la.id NOT IN (SELECT application_id FROM application_brokers) "
                "ON CONFLICT DO NOTHING"
            ))

# Cleanup: remove any admin-role users that were previously backfilled into
# application_brokers (the old backfill had no role filter). Admins should not
# appear as assigned brokers.
if "application_brokers" in {t for t in _inspector.get_table_names()}:
    with engine.begin() as conn:
        conn.execute(text(
            "DELETE FROM application_brokers "
            "WHERE broker_id IN (SELECT id FROM users WHERE role = 'admin')"
        ))
        # Also clear the legacy column where it points at an admin.
        conn.execute(text(
            "UPDATE loan_applications SET assigned_broker_id = NULL "
            "WHERE assigned_broker_id IN (SELECT id FROM users WHERE role = 'admin')"
        ))

# Backfill: migrate is_internal → visibility for application_notes
if "application_notes" in {t for t in _inspector.get_table_names()}:
    _an_cols = {c["name"] for c in _inspector.get_columns("application_notes")}
    if "is_internal" in _an_cols and "visibility" in _an_cols:
        with engine.begin() as conn:
            # is_internal=true (broker-only) → "broker", is_internal=false (client-facing) → "broker,client,referrer"
            conn.execute(text(
                "UPDATE application_notes SET visibility = 'broker' WHERE is_internal = TRUE AND visibility = 'broker'"
            ))
            conn.execute(text(
                "UPDATE application_notes SET visibility = 'broker,client,referrer' WHERE is_internal = FALSE AND visibility = 'broker'"
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
            "VALUES (:id, :name, :slug, :active, :now, :now)"
        ), {"id": _default_tenant_id, "name": "Default", "slug": "default", "active": True, "now": _now})
        _tenant_tables = [
            "users", "loan_applications", "documents", "contacts", "organizations",
            "contact_organizations", "lenders", "lender_submissions", "kanban_boards",
            "kanban_columns", "tasks", "checklist_items", "quote_sheets", "quote_options",
            "activity_logs", "direct_messages", "referrals", "external_referrals",
            "application_notes", "application_brokers", "broker_groups",
            "client_messages", "client_alerts",
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

# Permanently purge soft-deleted applications older than 60 days
try:
    from datetime import timedelta as _timedelta
    from app.database import SessionLocal as _SessionLocal
    from app.models.loan_application import LoanApplication as _LoanApplication
    from app.models.document import Document as _Document
    from app.models.application_note import ApplicationNote as _ApplicationNote
    from app.models.document_request import DocumentRequest as _DocumentRequest
    from app.models.application_calculator import ApplicationCalculator as _ApplicationCalculator
    from app.models.task import Task as _Task
    from app.services.s3_storage import delete_file as _delete_file

    _cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - _timedelta(days=60)
    _purge_session = _SessionLocal()
    try:
        _expired = _purge_session.query(_LoanApplication).filter(
            _LoanApplication.deleted_at.isnot(None),
            _LoanApplication.deleted_at < _cutoff,
        ).all()
        for _app in _expired:
            _docs = _purge_session.query(_Document).filter(_Document.application_id == _app.id).all()
            for _doc in _docs:
                if _doc.file_path:
                    try:
                        _delete_file(_doc.file_path)
                    except Exception:
                        pass
                _purge_session.delete(_doc)
            _purge_session.query(_ApplicationNote).filter(_ApplicationNote.application_id == _app.id).delete()
            _purge_session.query(_DocumentRequest).filter(_DocumentRequest.application_id == _app.id).delete()
            _purge_session.query(_ApplicationCalculator).filter(_ApplicationCalculator.application_id == _app.id).delete()
            _purge_session.query(_Task).filter(_Task.application_id == _app.id).update({"application_id": None})
            _purge_session.delete(_app)
        _purge_session.commit()
        if _expired:
            _logger.info("Purged %d soft-deleted applications older than 60 days", len(_expired))
    except Exception as _e:
        _purge_session.rollback()
        _logger.warning("Failed to purge soft-deleted applications: %s", _e)
    finally:
        _purge_session.close()
except Exception as _e:
    _logger.warning("Soft-delete purge setup failed: %s", _e)

# Seed super_admin user if none exists
with engine.begin() as conn:
    _sa_count = conn.execute(text("SELECT COUNT(*) FROM users WHERE role = 'super_admin'")).scalar()
    if _sa_count == 0:
        import os as _os
        import uuid as _uuid
        from datetime import datetime as _dt, timezone as _tz
        from app.services.auth import hash_password as _hash_pw
        _DEFAULT_SA_PASSWORD = "Admin123!"
        _sa_email = _os.getenv("SUPER_ADMIN_EMAIL", "admin@xpresstech.com")
        _sa_password = _os.getenv("SUPER_ADMIN_PASSWORD", _DEFAULT_SA_PASSWORD)
        if _sa_password == _DEFAULT_SA_PASSWORD and ENVIRONMENT != "development":
            raise RuntimeError(
                "SUPER_ADMIN_PASSWORD is still the default value. "
                "Set a strong, unique SUPER_ADMIN_PASSWORD in your .env before running in production."
            )
        _now = _dt.now(_tz.utc)
        conn.execute(text(
            "INSERT INTO users (id, email, password_hash, full_name, role, is_active, email_verified, auth_method, "
            "failed_login_attempts, login_code_attempts, created_at, updated_at) "
            "VALUES (:id, :email, :pw, :name, 'super_admin', :active, :verified, 'password', 0, 0, :now, :now)"
        ), {"id": str(_uuid.uuid4()), "email": _sa_email, "pw": _hash_pw(_sa_password), "name": "Super Admin",
            "active": True, "verified": True, "now": _now})
        _logger.info("Seeded super_admin user: %s (change password immediately!)", _sa_email)

# Seed a default Kanban board per tenant if they don't have one
try:
    import uuid as _uuid
    from datetime import datetime as _dt, timezone as _tz
    with engine.begin() as conn:
        _tenants = conn.execute(text("SELECT id FROM tenants WHERE is_active = TRUE")).fetchall()
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
                "VALUES (:id, :tid, :name, :desc, :creator, :is_default, :now, :now)"
            ), {"id": _board_id, "tid": _tid, "name": "Default Pipeline", "desc": "Default application pipeline board",
                "creator": _creator_id, "is_default": True, "now": _now})
            for col_def in DEFAULT_KANBAN_COLUMNS:
                conn.execute(text(
                    "INSERT INTO kanban_columns (id, tenant_id, board_id, title, mapped_status, position, color, created_at) "
                    "VALUES (:id, :tid, :board_id, :title, :mapped_status, :position, :color, :now)"
                ), {"id": str(_uuid.uuid4()), "tid": _tid, "board_id": _board_id, **col_def, "now": _now})
            _logger.info("Seeded default Kanban board for tenant %s", _tid)
except Exception:
    _logger.debug("Kanban board seeding skipped (table may not exist yet)")

app = FastAPI(title="Xpress Finance Portal", version="0.1.0")


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
app.include_router(client_messages.router)
app.include_router(client_alerts.router)
app.include_router(documents.router)
app.include_router(messages.router)
app.include_router(referrals.router)
app.include_router(referrer.router)
app.include_router(activity_logs.router)
app.include_router(dashboard.router)
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
app.include_router(organizations.router)
app.include_router(service_requests.router)
app.include_router(application_calculators.router)
app.include_router(public_apply.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
