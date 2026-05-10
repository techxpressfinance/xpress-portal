#!/usr/bin/env python3
"""One-time migration: copies data from SQLite into the existing PostgreSQL schema."""

import os
import sqlite3
import sys
from urllib.parse import urlparse

try:
    import psycopg2
except ImportError:
    print("Run: pip install psycopg2-binary")
    sys.exit(1)

SQLITE_PATH = os.getenv("SQLITE_PATH", "./app.db")
DATABASE_URL = os.getenv("DATABASE_URL", "")

# Remap old status values that were renamed before Postgres enum was defined
STATUS_REMAP = {
    "submitted": "application_received",
    "reviewing": "application_assessed",
    "approved": "approval",
}
STATUS_COLS = {"status", "mapped_status"}

# FK-safe insertion order
TABLE_ORDER = [
    "tenants",
    "users",
    "broker_groups",
    "broker_group_members",
    "loan_applications",
    "application_brokers",
    "application_notes",
    "documents",
    "direct_messages",
    "referrals",
    "external_referrals",
    "contacts",
    "organizations",
    "contact_organizations",
    "lenders",
    "lender_contacts",
    "lender_submissions",
    "kanban_boards",
    "kanban_columns",
    "tasks",
    "checklist_items",
    "quote_sheets",
    "quote_options",
    "activity_logs",
    "token_blacklist",
    "service_requests",
    "application_calculators",
    "client_messages",
    "client_alerts",
]


def migrate():
    if not DATABASE_URL.startswith("postgresql"):
        print("ERROR: DATABASE_URL must be a postgresql:// URL")
        sys.exit(1)

    if not os.path.exists(SQLITE_PATH):
        print(f"ERROR: SQLite file not found at {SQLITE_PATH}")
        sys.exit(1)

    parsed = urlparse(DATABASE_URL)
    pg = psycopg2.connect(
        host=parsed.hostname,
        port=parsed.port or 5432,
        database=parsed.path.lstrip("/"),
        user=parsed.username,
        password=parsed.password,
    )
    pg.autocommit = False
    cur = pg.cursor()

    sq = sqlite3.connect(SQLITE_PATH)
    sq.row_factory = sqlite3.Row
    sq_cur = sq.cursor()

    sq_cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    existing = {row[0] for row in sq_cur.fetchall()}

    ordered = [t for t in TABLE_ORDER if t in existing]
    ordered += [t for t in existing if t not in TABLE_ORDER]

    # Wipe auto-seeded Postgres data so SQLite IDs/FKs insert cleanly
    print("Clearing auto-seeded Postgres data...")
    cur.execute("TRUNCATE TABLE tenants CASCADE")
    cur.execute("TRUNCATE TABLE token_blacklist")
    pg.commit()
    print("Cleared.\n")

    total_inserted = total_skipped = 0

    for table in ordered:
        sq_cur.execute(f"SELECT * FROM {table}")
        rows = sq_cur.fetchall()
        if not rows:
            print(f"  {table}: empty, skipping")
            continue

        cols = [d[0] for d in sq_cur.description]
        placeholders = ", ".join(["%s"] * len(cols))
        col_list = ", ".join(f'"{c}"' for c in cols)
        sql = f'INSERT INTO "{table}" ({col_list}) VALUES ({placeholders}) ON CONFLICT DO NOTHING'

        # Find which column indices are boolean in Postgres
        cur.execute("""
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s AND data_type = 'boolean'
        """, (table,))
        bool_indices = {cols.index(r[0]) for r in cur.fetchall() if r[0] in cols}

        inserted = skipped = 0
        for row in rows:
            values = list(row)
            for i, col in enumerate(cols):
                if col in STATUS_COLS and values[i] in STATUS_REMAP:
                    values[i] = STATUS_REMAP[values[i]]
                if i in bool_indices and values[i] is not None:
                    values[i] = bool(values[i])

            cur.execute("SAVEPOINT row_sp")
            try:
                cur.execute(sql, values)
                cur.execute("RELEASE SAVEPOINT row_sp")
                if cur.rowcount > 0:
                    inserted += 1
                else:
                    skipped += 1  # ON CONFLICT DO NOTHING — row already exists
            except Exception as e:
                cur.execute("ROLLBACK TO SAVEPOINT row_sp")
                skipped += 1
                if skipped <= 2:
                    print(f"    SKIP [{table}]: {str(e)[:120]}")

        pg.commit()
        print(f"  {table}: {inserted} inserted, {skipped} skipped")
        total_inserted += inserted
        total_skipped += skipped

    pg.close()
    sq.close()
    print(f"\nDone — {total_inserted} rows inserted, {total_skipped} skipped")


if __name__ == "__main__":
    migrate()
