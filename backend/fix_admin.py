"""
Inspect and fix the admin user. Run with:
    sudo /opt/xpress-tech-portal/backend/venv/bin/python3 fix_admin.py
"""
import uuid
from datetime import datetime, timezone

import bcrypt

from app.database import SessionLocal, engine, Base
from app.models import Tenant, User

ADMIN_EMAIL    = "admin@xpressfinance.com.au"
ADMIN_PASSWORD = "nscx4p@#gebXhqLM"

Base.metadata.create_all(bind=engine)

db = SessionLocal()
try:
    user = db.query(User).filter_by(email=ADMIN_EMAIL).first()

    if not user:
        print("User not found — run seed_admin.py first")
    else:
        print("Current user state:")
        print(f"  id:             {user.id}")
        print(f"  email:          {user.email}")
        print(f"  role:           {user.role}")
        print(f"  is_active:      {user.is_active}")
        print(f"  email_verified: {user.email_verified}")
        print(f"  auth_method:    {user.auth_method}")
        print(f"  tenant_id:      {user.tenant_id}")
        print(f"  password_hash:  {user.password_hash[:20]}...")

        # Fix any bad state
        pw_hash = bcrypt.hashpw(ADMIN_PASSWORD.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        user.password_hash  = pw_hash
        user.is_active      = True
        user.email_verified = True
        user.auth_method    = "password"
        user.role           = "admin"

        # Ensure tenant exists
        if user.tenant_id:
            tenant = db.query(Tenant).filter_by(id=user.tenant_id).first()
            if not tenant:
                print("  WARNING: tenant_id set but tenant row missing — creating tenant")
                tenant = Tenant(
                    id=user.tenant_id,
                    name="Xpress Finance",
                    slug="xpress",
                    is_active=True,
                    created_at=datetime.now(timezone.utc),
                    updated_at=datetime.now(timezone.utc),
                )
                db.add(tenant)
        else:
            tenant = db.query(Tenant).filter_by(slug="xpress").first()
            if not tenant:
                tenant = Tenant(
                    id=str(uuid.uuid4()),
                    name="Xpress Finance",
                    slug="xpress",
                    is_active=True,
                    created_at=datetime.now(timezone.utc),
                    updated_at=datetime.now(timezone.utc),
                )
                db.add(tenant)
                db.flush()
            user.tenant_id = tenant.id
            print(f"  Fixed: assigned tenant_id {tenant.id}")

        db.commit()
        print("\n✓ User fixed and password reset:")
        print(f"  Email:    {ADMIN_EMAIL}")
        print(f"  Password: {ADMIN_PASSWORD}")
finally:
    db.close()
