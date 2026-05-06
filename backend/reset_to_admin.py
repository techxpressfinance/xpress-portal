"""
Reset database to clean state, preserving only the super_admin user.
Run from backend/ directory: python3 reset_to_admin.py
Uses only stdlib sqlite3 — no venv or .env needed.
"""
import os
import shutil
import sqlite3
import sys

DB_PATH = os.path.join(os.path.dirname(__file__), "app.db")

if not os.path.exists(DB_PATH):
    print(f"Database not found at {DB_PATH}")
    sys.exit(1)

print(f"Database: {DB_PATH}")
print("WARNING: This will DELETE ALL DATA except the super_admin user.")
print("This action is irreversible.")
confirm = input("Type 'yes' to confirm: ").strip()
if confirm != "yes":
    print("Aborted.")
    sys.exit(0)

TABLES_TO_CLEAR = [
    "kanban_columns",
    "checklist_items",
    "quote_options",
    "contact_organizations",
    "lender_contacts",
    "lender_submissions",
    "document_requests",
    "documents",
    "application_notes",
    "application_brokers",
    "activity_logs",
    "client_alerts",
    "client_messages",
    "direct_messages",
    "tasks",
    "quote_sheets",
    "service_requests",
    "referrals",
    "external_referrals",
    "token_blacklist",
    "loan_applications",
    "kanban_boards",
    "broker_groups",
    "organizations",
    "contacts",
    "lenders",
]

conn = sqlite3.connect(DB_PATH)
conn.execute("PRAGMA foreign_keys = OFF")

try:
    for table in TABLES_TO_CLEAR:
        try:
            cur = conn.execute(f"DELETE FROM {table}")
            print(f"Cleared {table}: {cur.rowcount} rows")
        except sqlite3.OperationalError as e:
            print(f"Skipped {table}: {e}")

    cur = conn.execute("DELETE FROM users WHERE role != 'super_admin'")
    print(f"Cleared non-admin users: {cur.rowcount} rows")

    cur = conn.execute("DELETE FROM tenants")
    print(f"Cleared tenants: {cur.rowcount} rows")

    conn.execute("PRAGMA foreign_keys = ON")
    conn.commit()
    print("\nDatabase reset committed.")
except Exception as e:
    conn.rollback()
    print(f"\nError — rolled back: {e}")
    sys.exit(1)
finally:
    conn.close()

# Show remaining super_admin accounts
conn = sqlite3.connect(DB_PATH)
rows = conn.execute("SELECT id, email, full_name, role FROM users WHERE role = 'super_admin'").fetchall()
conn.close()
print("\nRemaining super_admin accounts:")
for row in rows:
    print(f"  email={row[1]}  name={row[2]}")

# Clear uploads directory
uploads_dir = os.path.join(os.path.dirname(__file__), "uploads")
if os.path.isdir(uploads_dir):
    deleted = 0
    for item in os.listdir(uploads_dir):
        item_path = os.path.join(uploads_dir, item)
        try:
            if os.path.isfile(item_path):
                os.remove(item_path)
            elif os.path.isdir(item_path):
                shutil.rmtree(item_path)
            deleted += 1
        except Exception as e:
            print(f"Could not delete {item_path}: {e}")
    print(f"Cleared uploads/: {deleted} items deleted")

print("\nDone. Restart the backend server to re-seed the super_admin if needed.")
