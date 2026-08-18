from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.encoders import ENCODERS_BY_TYPE
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import bindparam, inspect, text

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
from app.models.task_attachment import TaskAttachment  # noqa: F401 — ensure table is created
from app.models.quote_sheet import QuoteSheet, QuoteOption  # noqa: F401 — ensure tables are created
from app.models.document_request import DocumentRequest  # noqa: F401 — ensure table is created
from app.models.contact import Contact, Organization, ContactOrganization  # noqa: F401 — ensure tables are created
from app.models.lending_history_entry import LendingHistoryEntry  # noqa: F401 — ensure table is created
from app.models.service_request import ServiceRequest  # noqa: F401 — ensure table is created
from app.models.service_request_checklist import ServiceRequestChecklistItem  # noqa: F401 — ensure table is created
from app.models.service_request_attachment import ServiceRequestAttachment  # noqa: F401 — ensure table is created
from app.models.application_calculator import ApplicationCalculator  # noqa: F401 — ensure table is created
from app.models.client_message import ClientMessage  # noqa: F401 — ensure table is created
from app.models.client_alert import ClientAlert  # noqa: F401 — ensure table is created
from app.models.settled_deal_snapshot import SettledDealSnapshot  # noqa: F401 — ensure table is created
from app.models.trust_party import TrustParty  # noqa: F401 — ensure table is created
from app.models.arrears import (  # noqa: F401 — ensure tables are created
    ArrearsAttachment,
    ArrearsEvent,
    ArrearsRecord,
    ArrearsSnapshot,
)
from app.constants import DEFAULT_KANBAN_COLUMNS
from app.routers import activity_logs, application_calculators, application_notes, applications, arrears, auth, broker_analytics, broker_groups, client_alerts, client_messages, contacts, dashboard, documents, external_referrers, invitations, kanban, lenders, lender_submissions, messages, organizations, public_apply, quote_sheets, referrals, referrer, search, service_requests, settled_deals_analytics, standalone_quote_sheets, super_admin, tasks, tenants, users

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
    ("users", "specialties", "VARCHAR(100)"),
    # Referrer-specific fields
    ("users", "organization_name", "VARCHAR(255)"),
    # Referrer business & payment details (monthly tax invoicing)
    ("users", "business_abn", "VARCHAR(20)"),
    ("users", "business_gst_registered", "BOOLEAN"),
    ("users", "business_director_name", "VARCHAR(255)"),
    ("users", "business_address", "VARCHAR(500)"),
    ("users", "bank_account_name", "TEXT"),
    ("users", "bank_bsb", "TEXT"),
    ("users", "bank_account_number", "TEXT"),
    ("users", "business_logo_path", "VARCHAR(500)"),
    ("users", "business_logo_filename", "VARCHAR(255)"),
    ("users", "business_letterhead_path", "VARCHAR(500)"),
    ("users", "business_letterhead_filename", "VARCHAR(255)"),
    ("users", "business_details_updated_at", "TIMESTAMP"),
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
    # Legal structure of an entity (trust/trustee/company/partnership/sole_trader)
    ("organizations", "entity_type", "VARCHAR(30)"),
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
    # Urgent flag on service requests
    ("service_requests", "is_urgent", "BOOLEAN NOT NULL DEFAULT FALSE"),
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
    # Standing invite links can grant a role on signup (e.g. broker); NULL = client
    ("referrals", "invited_role", "VARCHAR(20)"),
    # High-priority client alerts surface as a banner on the application page
    ("client_alerts", "is_high_priority", "BOOLEAN NOT NULL DEFAULT FALSE"),
    # Optional due date/time on service requests
    ("service_requests", "due_at", "TIMESTAMP"),
    # Due-date reminder send tracking
    ("service_requests", "reminder_midpoint_sent_at", "TIMESTAMP"),
    ("service_requests", "reminder_due_soon_sent_at", "TIMESTAMP"),
    # Loop the request creator in on reminder emails
    ("service_requests", "created_by_id", "VARCHAR(36)"),
    # Due-date reminder send tracking on tasks (parallel to service requests)
    ("tasks", "reminder_midpoint_sent_at", "TIMESTAMP"),
    ("tasks", "reminder_due_soon_sent_at", "TIMESTAMP"),
    # Kanban boards scoped to a loan category (asset_finance | home_loan | commercial)
    ("kanban_boards", "loan_category", "VARCHAR(20)"),
    # Stamped once when status first transitions to settled — drives the monthly
    # settled-deal archiving sweep (services/settled_deal_archiving.py)
    ("loan_applications", "settled_at", "TIMESTAMP"),
    # Provenance for cloned applications (personal/company copied, loan re-entered)
    ("loan_applications", "cloned_from_id", "VARCHAR(36) REFERENCES loan_applications(id)"),
    # Trust entities: kind of trust + the "no ABN, checked with the accountant"
    # acknowledgement a broker must give before a trust can be saved without one
    ("organizations", "trust_type", "VARCHAR(30)"),
    ("organizations", "no_abn_confirmed", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ("organizations", "no_abn_confirmed_at", "TIMESTAMP"),
    ("organizations", "no_abn_confirmed_by_id", "VARCHAR(36) REFERENCES users(id)"),
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

# ── Field-level encryption: re-encrypt legacy plaintext rows ──────────────────
# Any EncryptedString column may hold plaintext written before encryption was
# enabled (or before the column switched to EncryptedString). Discover them all
# from the models so new encrypted columns are covered automatically.
# Idempotent: values that already decrypt with the configured key are left
# untouched. Runs only when FIELD_ENCRYPTION_KEY is configured.
from app.models.encrypted_type import EncryptedString as _EncryptedString  # noqa: E402

_ENCRYPTED_COLUMNS = sorted(
    (table.name, column.name)
    for table in Base.metadata.tables.values()
    for column in table.columns
    if isinstance(column.type, _EncryptedString)
)

from app.config import FIELD_ENCRYPTION_KEY as _FIELD_KEY  # noqa: E402

if _FIELD_KEY:
    from app.services.encryption import (
        encrypt_value as _encrypt_value,
        is_encrypted as _is_encrypted,
        looks_like_fernet_token as _looks_like_fernet_token,
        rotate_token as _rotate_token,
    )

    # Fernet ciphertext exceeds the original VARCHAR(20/200) limits — widen to
    # TEXT on Postgres first (SQLite doesn't enforce lengths, no change needed).
    # Only alter columns still typed VARCHAR so repeat startups take no locks.
    if _dialect != "sqlite":
        with engine.begin() as conn:
            for _tbl, _col in _ENCRYPTED_COLUMNS:
                _col_types = {c["name"]: str(c["type"]).upper() for c in _inspector.get_columns(_tbl)}
                if _col_types.get(_col, "").startswith("VARCHAR"):
                    conn.execute(text(f"ALTER TABLE {_tbl} ALTER COLUMN {_col} TYPE TEXT"))
                    _logger.info("Widened %s.%s to TEXT for encrypted storage", _tbl, _col)

    def _wrong_key_error(tbl: str, col: str, row_id) -> RuntimeError:
        # Fernet-shaped but no configured key decrypts it: this is ciphertext
        # under a missing key, not legacy plaintext. Re-encrypting it would bury
        # the data a layer deeper and make it unrecoverable — refuse to start.
        return RuntimeError(
            f"{tbl}.{col} (id={row_id}) looks like Fernet ciphertext but none of the "
            "configured FIELD_ENCRYPTION_KEY keys decrypt it. If the key was rotated, keep "
            "the previous key in the ring: FIELD_ENCRYPTION_KEY=<new>,<old>. Aborting startup "
            "so no data is re-encrypted under the wrong key."
        )

    def _batched_rows(conn, tbl: str, col: str, where: str, batch: int = 200):
        """Yield (id, value) without holding a whole column in memory — ocr_text
        alone can be 500KB per row."""
        _ids = [r[0] for r in conn.execute(text(f"SELECT id FROM {tbl} WHERE {where}"))]
        _stmt = text(f"SELECT id, {col} FROM {tbl} WHERE id IN :ids").bindparams(
            bindparam("ids", expanding=True)
        )
        for _i in range(0, len(_ids), batch):
            yield from conn.execute(_stmt, {"ids": _ids[_i : _i + batch]})

    with engine.begin() as conn:
        _existing_tables = set(_inspector.get_table_names())
        _ring_size = len([k for k in _FIELD_KEY.split(",") if k.strip()])
        _total_encrypted = 0
        _total_rotated = 0
        for _tbl, _col in _ENCRYPTED_COLUMNS:
            if _tbl not in _existing_tables:
                continue

            # Legacy plaintext pass. Fernet tokens always start with "gAAAAA",
            # so the prefilter finds plaintext without fetching any ciphertext —
            # a steady-state boot reads zero rows here.
            for _row_id, _value in _batched_rows(
                conn, _tbl, _col,
                f"{_col} IS NOT NULL AND {_col} != '' AND {_col} NOT LIKE 'gAAAAA%'",
            ):
                if _looks_like_fernet_token(_value):
                    continue  # SQLite LIKE is case-insensitive; never rewrite a real token here
                conn.execute(
                    text(f"UPDATE {_tbl} SET {_col} = :val WHERE id = :id"),
                    {"val": _encrypt_value(_value), "id": _row_id},
                )
                _total_encrypted += 1

            if _ring_size > 1:
                # Rotation pass: rewrite tokens under older ring keys to the
                # newest key. Only runs while a rotation is in flight (ring has
                # more than one key), so normal boots never read ciphertext.
                for _row_id, _value in _batched_rows(conn, _tbl, _col, f"{_col} LIKE 'gAAAAA%'"):
                    if not _looks_like_fernet_token(_value):
                        continue  # case-insensitive LIKE on SQLite can catch plaintext
                    if not _is_encrypted(_value):
                        raise _wrong_key_error(_tbl, _col, _row_id)
                    _rotated = _rotate_token(_value)
                    if _rotated:
                        conn.execute(
                            text(f"UPDATE {_tbl} SET {_col} = :val WHERE id = :id"),
                            {"val": _rotated, "id": _row_id},
                        )
                        _total_rotated += 1
            else:
                # Single-key ring: keep the wrong-key tripwire without scanning —
                # verify one sample token per column decrypts.
                _sample = conn.execute(
                    text(f"SELECT id, {_col} FROM {_tbl} WHERE {_col} LIKE 'gAAAAA%' LIMIT 1")
                ).fetchone()
                if (
                    _sample is not None
                    and _looks_like_fernet_token(_sample[1])
                    and not _is_encrypted(_sample[1])
                ):
                    raise _wrong_key_error(_tbl, _col, _sample[0])
        if _total_encrypted:
            _logger.info("Encrypted %d legacy plaintext values across %d columns", _total_encrypted, len(_ENCRYPTED_COLUMNS))
        if _total_rotated:
            _logger.info("Rotated %d values to the newest encryption key", _total_rotated)

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

# Backfill: migrate existing service_requests.assigned_broker_id into service_request_brokers
if "service_request_brokers" in {t for t in _inspector.get_table_names()}:
    with engine.begin() as conn:
        if _dialect == "sqlite":
            conn.execute(text(
                "INSERT OR IGNORE INTO service_request_brokers (tenant_id, service_request_id, broker_id, assigned_at) "
                "SELECT sr.tenant_id, sr.id, sr.assigned_broker_id, sr.updated_at FROM service_requests sr "
                "WHERE sr.assigned_broker_id IS NOT NULL "
                "AND sr.id NOT IN (SELECT service_request_id FROM service_request_brokers)"
            ))
        else:
            conn.execute(text(
                "INSERT INTO service_request_brokers (tenant_id, service_request_id, broker_id, assigned_at) "
                "SELECT sr.tenant_id, sr.id, sr.assigned_broker_id, sr.updated_at FROM service_requests sr "
                "WHERE sr.assigned_broker_id IS NOT NULL "
                "AND sr.id NOT IN (SELECT service_request_id FROM service_request_brokers) "
                "ON CONFLICT DO NOTHING"
            ))

# Backfill: migrate existing service_requests.broker_notes into the notes thread
# as a single authorless legacy note, so no data is lost on the switch.
if "service_request_notes" in {t for t in _inspector.get_table_names()}:
    with engine.begin() as conn:
        _insert_prefix = "INSERT OR IGNORE INTO" if _dialect == "sqlite" else "INSERT INTO"
        _conflict = "" if _dialect == "sqlite" else " ON CONFLICT DO NOTHING"
        conn.execute(text(
            f"{_insert_prefix} service_request_notes (id, tenant_id, service_request_id, author_id, content, created_at) "
            "SELECT "
            + ("lower(hex(randomblob(16)))" if _dialect == "sqlite" else "gen_random_uuid()::text")
            + ", sr.tenant_id, sr.id, NULL, sr.broker_notes, sr.updated_at FROM service_requests sr "
            "WHERE sr.broker_notes IS NOT NULL AND TRIM(sr.broker_notes) <> '' "
            "AND sr.id NOT IN (SELECT service_request_id FROM service_request_notes)"
            + _conflict
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

# Archive settled deals into monthly snapshots. Also runs on the interval
# schedule below (every REMINDER_POLL_MINUTES) — this startup run is just the
# one-time backfill for applications already settled before this feature
# shipped, and a catch-up in case the server was down for a while. Idempotent.
try:
    from app.services.settled_deal_archiving import archive_settled_deals as _archive_settled_deals

    _archive_settled_deals()
except Exception as _e:
    _logger.warning("Settled-deal archiving startup sweep failed: %s", _e)

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

# Reconcile kanban columns to the canonical application-status columns.
# Columns are locked to the 8 application statuses (see constants.py), but
# boards created before that lock may be missing "not_proceeding", or carry
# unmapped/duplicate columns from when custom stages were allowed. Bring every
# board to exactly one column per status and clear any kanban_column_id that
# pointed at a removed column. Idempotent.
try:
    import uuid as _uuid
    from datetime import datetime as _dt, timezone as _tz
    _valid_statuses = [c["mapped_status"] for c in DEFAULT_KANBAN_COLUMNS]
    _status_set = set(_valid_statuses)
    with engine.begin() as conn:
        _boards = conn.execute(text("SELECT id FROM kanban_boards")).fetchall()
        for (_bid,) in _boards:
            _cols = conn.execute(
                text("SELECT id, mapped_status, position FROM kanban_columns WHERE board_id = :bid ORDER BY position, created_at"),
                {"bid": _bid},
            ).fetchall()
            _kept: dict = {}
            _remove_ids = []
            _max_pos = -1
            for _cid, _mapped, _pos in _cols:
                _max_pos = max(_max_pos, _pos or 0)
                if _mapped in _status_set and _mapped not in _kept:
                    _kept[_mapped] = _cid
                else:
                    _remove_ids.append(_cid)
            for _cid in _remove_ids:
                conn.execute(text("DELETE FROM kanban_columns WHERE id = :cid"), {"cid": _cid})
                conn.execute(text("UPDATE loan_applications SET kanban_column_id = NULL WHERE kanban_column_id = :cid"), {"cid": _cid})
            for _col_def in DEFAULT_KANBAN_COLUMNS:
                _status = _col_def["mapped_status"]
                if _status in _kept:
                    conn.execute(
                        text("UPDATE kanban_columns SET title = :title WHERE id = :cid"),
                        {"title": _col_def["title"], "cid": _kept[_status]},
                    )
                    continue
                _max_pos += 1
                conn.execute(text(
                    "INSERT INTO kanban_columns (id, tenant_id, board_id, title, mapped_status, position, color, created_at) "
                    "VALUES (:id, (SELECT tenant_id FROM kanban_boards WHERE id = :bid), :bid, :title, :mapped_status, :position, :color, :now)"
                ), {"id": str(_uuid.uuid4()), "bid": _bid, "title": _col_def["title"],
                    "mapped_status": _status, "position": _max_pos, "color": _col_def["color"], "now": _dt.now(_tz.utc)})
except Exception as _e:
    _logger.debug("Kanban column reconciliation skipped (table may not exist yet): %s", _e)

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
    allow_origin_regex=r"https?://[\w-]+\.localhost(:\d+)?|https://[\w-]+\.xpresstech\.com",
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
app.include_router(broker_analytics.router)
app.include_router(settled_deals_analytics.router)
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
app.include_router(arrears.router)
app.include_router(public_apply.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


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
