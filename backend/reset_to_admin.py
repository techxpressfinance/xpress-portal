"""
Reset database to clean state, preserving only the super_admin user.
Run from backend/ directory: python3 reset_to_admin.py
"""
import os
import sys

# Confirm before proceeding
print("WARNING: This will DELETE ALL DATA except the super_admin user.")
print("This action is irreversible.")
confirm = input("Type 'yes' to confirm: ").strip()
if confirm != "yes":
    print("Aborted.")
    sys.exit(0)

from sqlalchemy import create_engine, text
from app.config import DATABASE_URL

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {})

# Tables to clear in dependency order (children first)
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

with engine.begin() as conn:
    is_sqlite = DATABASE_URL.startswith("sqlite")

    if is_sqlite:
        conn.execute(text("PRAGMA foreign_keys = OFF"))

    for table in TABLES_TO_CLEAR:
        try:
            result = conn.execute(text(f"DELETE FROM {table}"))
            print(f"Cleared {table}: {result.rowcount} rows deleted")
        except Exception as e:
            print(f"Skipped {table}: {e}")

    # Delete all users except super_admin
    result = conn.execute(text("DELETE FROM users WHERE role != 'super_admin'"))
    print(f"Cleared users (non-admin): {result.rowcount} rows deleted")

    # Clear tenants (super_admin has no tenant_id)
    result = conn.execute(text("DELETE FROM tenants"))
    print(f"Cleared tenants: {result.rowcount} rows deleted")

    if is_sqlite:
        conn.execute(text("PRAGMA foreign_keys = ON"))

# Show remaining super_admin
with engine.connect() as conn:
    admins = conn.execute(text("SELECT id, email, full_name, role FROM users WHERE role = 'super_admin'")).fetchall()
    print("\nRemaining super_admin accounts:")
    for row in admins:
        print(f"  id={row[0]}  email={row[1]}  name={row[2]}  role={row[3]}")

# Clear uploads directory
uploads_dir = os.path.join(os.path.dirname(__file__), "uploads")
if os.path.isdir(uploads_dir):
    import shutil
    deleted = 0
    for item in os.listdir(uploads_dir):
        item_path = os.path.join(uploads_dir, item)
        try:
            if os.path.isfile(item_path):
                os.remove(item_path)
                deleted += 1
            elif os.path.isdir(item_path):
                shutil.rmtree(item_path)
                deleted += 1
        except Exception as e:
            print(f"Could not delete {item_path}: {e}")
    print(f"\nCleared uploads/: {deleted} items deleted")

print("\nDone. Restart the backend server to complete the reset.")
