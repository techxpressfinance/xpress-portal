"""
Create the initial tenant + admin user in a fresh database.
Run on EC2 from the backend/ directory:
    source venv/bin/activate && python3 seed_admin.py
"""
import uuid
from datetime import datetime, timezone

import bcrypt

from app.database import SessionLocal, engine, Base
from app.models import Tenant, User

# ── Config ──────────────────────────────────────────────────────────────
TENANT_NAME = "Xpress Finance"
TENANT_SLUG = "xpress"

ADMIN_EMAIL    = "admin@xpressfinance.com.au"
ADMIN_NAME     = "Admin"
ADMIN_PASSWORD = "nscx4p@#gebXhqLM"
# ────────────────────────────────────────────────────────────────────────

Base.metadata.create_all(bind=engine)

db = SessionLocal()
try:
    existing = db.query(User).filter_by(email=ADMIN_EMAIL).first()
    if existing:
        print(f"User {ADMIN_EMAIL} already exists — skipping.")
    else:
        tenant = db.query(Tenant).filter_by(slug=TENANT_SLUG).first()
        if not tenant:
            tenant = Tenant(
                id=str(uuid.uuid4()),
                name=TENANT_NAME,
                slug=TENANT_SLUG,
                is_active=True,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            db.add(tenant)
            db.flush()
            print(f"Created tenant: {TENANT_NAME} (id={tenant.id})")
        else:
            print(f"Using existing tenant: {tenant.name} (id={tenant.id})")

        pw_hash = bcrypt.hashpw(ADMIN_PASSWORD.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

        admin = User(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            email=ADMIN_EMAIL,
            full_name=ADMIN_NAME,
            password_hash=pw_hash,
            role="admin",
            is_active=True,
            email_verified=True,
            auth_method="password",
            created_at=datetime.now(timezone.utc),
        )
        db.add(admin)
        db.commit()
        print(f"\n✓ Admin created:")
        print(f"  Email:    {ADMIN_EMAIL}")
        print(f"  Password: {ADMIN_PASSWORD}")
        print(f"\nChange the password after first login.")
finally:
    db.close()
