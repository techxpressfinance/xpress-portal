"""What runs when the web process starts.

Deliberately small. Schema changes and data backfills are Alembic revisions,
applied once by `python -m app.migrate` — they used to run here on every boot,
and a repair that is right once is a data-corruption bug the hundredth time.

What is left is work that genuinely belongs to a boot, each step idempotent:

* the schema check (refuse to serve against a database that is behind)
* the PII encryption sweep — it depends on FIELD_ENCRYPTION_KEY, which changes
  by editing the environment and restarting, not by a migration
* housekeeping purges and the platform super-admin bootstrap

A failure in the schema check, the encryption sweep or the super-admin
bootstrap aborts startup. Housekeeping failures are logged at ERROR (and so
reach error tracking) but do not stop the portal from serving.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import bindparam, inspect, text

from app.config import AUTO_MIGRATE, ENVIRONMENT, FIELD_ENCRYPTION_KEY
from app.database import Base, SessionLocal, engine

logger = logging.getLogger(__name__)

_SOFT_DELETE_RETENTION_DAYS = 60


def ensure_schema() -> None:
    from app.migrate import current_revision, head_revision, migrate

    if AUTO_MIGRATE:
        migrate()
        return
    current, head = current_revision(), head_revision()
    if current != head:
        raise RuntimeError(
            f"Database schema is at {current or 'no revision'} but this build expects {head}. "
            "Take a backup, then run: python -m app.migrate"
        )


# ── PII encryption sweep ──────────────────────────────────────────────────────

def _wrong_key_error(tbl: str, col: str, row_id) -> RuntimeError:
    # Fernet-shaped but no configured key decrypts it: this is ciphertext under
    # a missing key, not legacy plaintext. Re-encrypting it would bury the data
    # a layer deeper and make it unrecoverable — refuse to start.
    return RuntimeError(
        f"{tbl}.{col} (id={row_id}) looks like Fernet ciphertext but none of the "
        "configured FIELD_ENCRYPTION_KEY keys decrypt it. If the key was rotated, keep "
        "the previous key in the ring: FIELD_ENCRYPTION_KEY=<new>,<old>. Aborting startup "
        "so no data is re-encrypted under the wrong key."
    )


def _batched_rows(conn, tbl: str, col: str, where: str, batch: int = 200):
    """Yield (id, value) without holding a whole column in memory — ocr_text
    alone can be 500KB per row."""
    ids = [r[0] for r in conn.execute(text(f"SELECT id FROM {tbl} WHERE {where}"))]
    stmt = text(f"SELECT id, {col} FROM {tbl} WHERE id IN :ids").bindparams(bindparam("ids", expanding=True))
    for i in range(0, len(ids), batch):
        yield from conn.execute(stmt, {"ids": ids[i : i + batch]})


def encryption_sweep() -> None:
    """Encrypt any plaintext left in an EncryptedString column, move values on
    older ring keys to the newest key, and trip if a column holds ciphertext no
    configured key can read. Columns are discovered from the models, so a new
    encrypted column is covered automatically. A steady-state boot with a
    single key reads one sample row per column and writes nothing."""
    if not FIELD_ENCRYPTION_KEY:
        return
    from app.models.encrypted_type import EncryptedString
    from app.services.encryption import encrypt_value, is_encrypted, looks_like_fernet_token, rotate_token

    columns = sorted(
        (table.name, column.name)
        for table in Base.metadata.tables.values()
        for column in table.columns
        if isinstance(column.type, EncryptedString)
    )
    ring_size = len([k for k in FIELD_ENCRYPTION_KEY.split(",") if k.strip()])
    encrypted = rotated = 0
    with engine.begin() as conn:
        for tbl, col in columns:
            # Fernet tokens always start with "gAAAAA", so this prefilter finds
            # plaintext without fetching any ciphertext.
            for row_id, value in _batched_rows(
                conn, tbl, col, f"{col} IS NOT NULL AND {col} != '' AND {col} NOT LIKE 'gAAAAA%'"
            ):
                if looks_like_fernet_token(value):
                    continue  # SQLite LIKE is case-insensitive; never rewrite a real token here
                conn.execute(
                    text(f"UPDATE {tbl} SET {col} = :val WHERE id = :id"),
                    {"val": encrypt_value(value), "id": row_id},
                )
                encrypted += 1

            if ring_size > 1:
                # A rotation is in flight: rewrite tokens under older keys.
                for row_id, value in _batched_rows(conn, tbl, col, f"{col} LIKE 'gAAAAA%'"):
                    if not looks_like_fernet_token(value):
                        continue  # case-insensitive LIKE on SQLite can catch plaintext
                    if not is_encrypted(value):
                        raise _wrong_key_error(tbl, col, row_id)
                    new_token = rotate_token(value)
                    if new_token:
                        conn.execute(
                            text(f"UPDATE {tbl} SET {col} = :val WHERE id = :id"),
                            {"val": new_token, "id": row_id},
                        )
                        rotated += 1
            else:
                sample = conn.execute(
                    text(f"SELECT id, {col} FROM {tbl} WHERE {col} LIKE 'gAAAAA%' LIMIT 1")
                ).fetchone()
                if sample is not None and looks_like_fernet_token(sample[1]) and not is_encrypted(sample[1]):
                    raise _wrong_key_error(tbl, col, sample[0])
    if encrypted:
        logger.info("Encrypted %d legacy plaintext values across %d columns", encrypted, len(columns))
    if rotated:
        logger.info("Rotated %d values to the newest encryption key", rotated)


# ── Bootstrap ─────────────────────────────────────────────────────────────────

def seed_super_admin() -> None:
    """Create the platform super admin if there is none."""
    from app.services.auth import hash_password

    default_password = "Admin123!"
    with engine.begin() as conn:
        if conn.execute(text("SELECT COUNT(*) FROM users WHERE role = 'super_admin'")).scalar():
            return
        email = os.getenv("SUPER_ADMIN_EMAIL", "admin@xpresstech.ai")
        password = os.getenv("SUPER_ADMIN_PASSWORD", default_password)
        if password == default_password and ENVIRONMENT != "development":
            raise RuntimeError(
                "SUPER_ADMIN_PASSWORD is still the default value. "
                "Set a strong, unique SUPER_ADMIN_PASSWORD in your .env before running in production."
            )
        now = datetime.now(timezone.utc)
        conn.execute(text(
            "INSERT INTO users (id, email, password_hash, full_name, role, is_active, email_verified, auth_method, "
            "failed_login_attempts, login_code_attempts, created_at, updated_at) "
            "VALUES (:id, :email, :pw, :name, 'super_admin', :active, :verified, 'password', 0, 0, :now, :now)"
        ), {"id": str(uuid.uuid4()), "email": email, "pw": hash_password(password), "name": "Super Admin",
            "active": True, "verified": True, "now": now})
        logger.info("Seeded super_admin user: %s (change password immediately!)", email)


# ── Housekeeping ──────────────────────────────────────────────────────────────

def purge_expired_tokens() -> None:
    with engine.begin() as conn:
        conn.execute(
            text("DELETE FROM token_blacklist WHERE expires_at < :now"),
            {"now": datetime.now(timezone.utc).replace(tzinfo=None)},
        )


def purge_soft_deleted_applications() -> None:
    """Permanently remove applications that have sat in the trash past retention."""
    from app.models.application_calculator import ApplicationCalculator
    from app.models.application_note import ApplicationNote
    from app.models.document import Document
    from app.models.document_request import DocumentRequest
    from app.models.loan_application import LoanApplication
    from app.models.task import Task
    from app.services.s3_storage import delete_file

    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=_SOFT_DELETE_RETENTION_DAYS)
    db = SessionLocal()
    try:
        expired = db.query(LoanApplication).filter(
            LoanApplication.deleted_at.isnot(None),
            LoanApplication.deleted_at < cutoff,
        ).all()
        for application in expired:
            for doc in db.query(Document).filter(Document.application_id == application.id).all():
                if doc.file_path:
                    try:
                        delete_file(doc.file_path)
                    except Exception:
                        logger.warning("Could not delete stored file for purged document %s", doc.id)
                db.delete(doc)
            db.query(ApplicationNote).filter(ApplicationNote.application_id == application.id).delete()
            db.query(DocumentRequest).filter(DocumentRequest.application_id == application.id).delete()
            db.query(ApplicationCalculator).filter(ApplicationCalculator.application_id == application.id).delete()
            db.query(Task).filter(Task.application_id == application.id).update({"application_id": None})
            db.delete(application)
        db.commit()
        if expired:
            logger.info("Purged %d soft-deleted applications older than %d days", len(expired), _SOFT_DELETE_RETENTION_DAYS)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _archive_settled_deals() -> None:
    # Also on the scheduler; this run catches up after downtime.
    from app.services.settled_deal_archiving import archive_settled_deals

    archive_settled_deals()


def run_startup_tasks() -> None:
    if "users" not in inspect(engine).get_table_names():
        raise RuntimeError("Database has no schema. Run: python -m app.migrate")
    encryption_sweep()
    seed_super_admin()
    for task in (purge_expired_tokens, purge_soft_deleted_applications, _archive_settled_deals):
        try:
            task()
        except Exception:
            logger.exception("Startup housekeeping step %s failed", task.__name__)
