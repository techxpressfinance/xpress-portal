  ---
  Critical Product Review — Xpress Tech Portal

  Overview

  A multi-tenant finance broker portal: FastAPI backend, React 19 frontend, SQLite (upgradeable to PostgreSQL). Roles: super_admin,
  admin, broker, client, referrer. Core features: loan applications, document upload + OCR, Kanban pipeline, quote sheets, lender
  management, task tracking, messaging, referrals, and a Lend.com.au sync integration.

  ---
  Security

  Strengths:
  - JWT with 15-min access tokens + httpOnly refresh cookie with rotation/blacklisting
  - Double-submit CSRF protection applied to all state-changing requests
  - File upload validated on both extension AND magic bytes
  - Field-level PII encryption (EncryptedString) for names, DOB, addresses, ABN
  - Account lockout after 5 failed attempts with 15-min coolback
  - Security headers: CSP, HSTS, X-Frame-Options, Permissions-Policy
  - Parameterized queries throughout (SQLAlchemy ORM), LIKE-escape utility

  Issues:

  Severity: 🔴 Critical
  Issue: Power Automate webhook URL with embedded signature in .env — POWER_AUTOMATE_WEBHOOK_URL contains a signed URL (sig=de2j2...).
    If .env is ever accidentally committed or exposed, this is a live credential. Rotate it and consider fetching it from a secrets
    manager.
  ────────────────────────────────────────
  Severity: 🔴 Critical
  Issue: ENVIRONMENT not set in .env — defaults to "development". In dev mode: full stack traces are returned to clients on 500s, CSRF
    cookies are not Secure, and the default JWT key only warns instead of failing. If this is deployed as-is, it's running in dev mode
    in production. Add ENVIRONMENT=production to .env immediately.
  ────────────────────────────────────────
  Severity: 🟠 High
  Issue: /api/super-admin/login has no rate limiting — the highest-privilege endpoint has no auth_limiter. Should be the most
  protected.
  ────────────────────────────────────────
  Severity: 🟠 High
  Issue: /api/public/apply/{token} has no rate limiting — unauthenticated endpoint accepting PII. Tokens are 64 random chars so brute
    force is unlikely, but a burst of submissions is unchecked.
  ────────────────────────────────────────
  Severity: 🟡 Medium
  Issue: f-string SQL in migrations (text(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")) — table/column names are from a
  hardcoded
    list so this is safe today, but it's a pattern that will cause problems the moment it's reused with any dynamic input.
  ────────────────────────────────────────
  Severity: 🟡 Medium
  Issue: public_apply not tenant-scoped — _get_draft_by_token queries across ALL tenants. A token leak from one tenant can be confirmed

    against the global DB. Add LoanApplication.tenant_id == tenant_id filter.
  ────────────────────────────────────────
  Severity: 🟡 Medium
  Issue: CSP allows 'unsafe-inline' for styles — weakens XSS protection for styles. Low-risk but shows the CSP wasn't fully hardened.
  ────────────────────────────────────────
  Severity: 🟡 Medium
  Issue: getTenantSlug() falls back to 'default' — if subdomain resolution fails, the frontend silently uses the default tenant. A
    misconfigured deployment could expose default-tenant data to users of another tenant.

  ---
  Architecture

  Biggest concern: main.py is a 442-line startup script. Every restart runs ~130 migrations, 5+ backfills, and several seeding blocks.
  This is already slow and will break under concurrent startup (multiple workers race the same DDL). The correct solution is Alembic —
  proper versioned migrations with rollback support.

  SQLite in production (DATABASE_URL=sqlite:///./app.db in .env): SQLite serializes writes, has no connection pooling, and is not safe
  for multi-worker deployments. The rate limiter's in-memory fallback is also per-process, so multi-worker deploys effectively have no
  shared rate limiting without Redis.

  No async DB — FastAPI runs async, but SQLAlchemy sessions are synchronous and block the event loop. Under load this degrades
  throughput significantly. Consider asyncpg + SQLAlchemy async when moving to PostgreSQL.

  Background tasks tied to request lifecycle — OCR and LLM analysis use FastAPI BackgroundTasks. If the process restarts mid-task, the
  job is lost silently. A task queue (Celery, RQ, or similar) is more appropriate for anything touching financial documents.

  ---
  Data Model
  
  LoanApplication has 60+ columns — it has grown by accumulation. Every new integration (Lend, OCR, analysis, invite) added columns
  directly. Consider splitting into LoanApplicationCore + LoanApplicationLendDetails + LoanApplicationApplicantProfile as the model
  grows.

  Dual broker assignment model is fragile — assigned_broker_id (legacy single) coexists with application_brokers many-to-many.
  check_application_access only checks app.brokers (the many-to-many), not assigned_broker_id, so a broker might pass access control in
   list_applications (which filters on application_brokers) but fail on individual application access if a data inconsistency exists.

  submitted status in enum is a zombie — the migration remaps submitted → application_received, but the ApplicationStatus enum still
  contains submitted. This will confuse anyone reading the code. Remove it from the enum.

  contains submitted. This will confuse anyone reading the code. Remove it from the enum.

  ---
  Testing

  Zero application-level tests. For a financial product handling PII, ABN data, document uploads, and broker-client access control,
  this is a significant risk. The most critical paths to test first:
  1. Role-based access control (check_application_access)
  2. Tenant isolation (cross-tenant data leakage)
  3. Auth flow (login, lockout, token refresh, revocation)
  4. Status transition rules (VALID_TRANSITIONS)
  Dual broker assignment model is fragile — assigned_broker_id (legacy single) coexists with application_brokers many-to-many.
  check_application_access only checks app.brokers (the many-to-many), not assigned_broker_id, so a broker might pass access control in
   list_applications (which filters on application_brokers) but fail on individual application access if a data inconsistency exists.

  submitted status in enum is a zombie — the migration remaps submitted → application_received, but the ApplicationStatus enum still
  contains submitted. This will confuse anyone reading the code. Remove it from the enum.

  ---
  Testing

  Zero application-level tests. For a financial product handling PII, ABN data, document uploads, and broker-client access control,
  this is a significant risk. The most critical paths to test first:
  1. Role-based access control (check_application_access)
  2. Tenant isolation (cross-tenant data leakage)
  3. Auth flow (login, lockout, token refresh, revocation)
  4. Status transition rules (VALID_TRANSITIONS)

  ---
  Frontend

  Strengths:
  - Access token in memory only (not localStorage), refreshed via cookie
  - CSRF and tenant slug consistently attached to all requests
  - Proper 401 → refresh → retry queuing in the API client

  Issues:
  - useEffect(() => { fetchLender(); }, [id]) — fetchLender is recreated every render but not included in the dependency array. This is
   a React lint warning (exhaustive-deps) and will silently skip re-fetches if the function reference changes. Wrap fetchLender in
  useCallback or inline the fetch.
  - No global loading/error state management — each page re-implements loading and error handling independently. A shared pattern
  (React Query, SWR, or a shared hook) would eliminate ~30% of boilerplate.
  - No frontend input validation beyond what the API enforces — the public apply form accepts arbitrary strings for sensitive fields
  like DOB and ABN without format validation.

  ---
  Summary

  The security fundamentals are solid (JWT, CSRF, rate limiting, encryption, headers) and better than most internal tools at this
  stage. The most urgent items are:

  1. Set ENVIRONMENT=production in .env — this alone fixes stack trace exposure and CSRF cookie security
  2. Rate-limit super_admin/login
  3. Add tenant scoping to public_apply
  4. Rotate the Power Automate signed URL
  5. Move to Alembic — main.py migrations will eventually cause a production incident
  6. Write tests for auth + access control — these are the highest-risk paths with no coverage

✻ Baked for 3m 29s

※ recap: Reviewed the Xpress Tech Portal codebase. The most urgent fix is adding ENVIRONMENT=production to the backend .env file, which
   alone resolves stack trace exposure and insecure CSRF cookies. (disable recaps in /config)
