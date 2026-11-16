# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multi-tenant loan-broking portal ("Xpress Tech"): FastAPI + SQLAlchemy backend (`backend/`), React 19 + TypeScript + Vite + Tailwind 4 frontend (`frontend/`). Backend tests live in `backend/tests/` (pytest); the frontend has none. CI (`.github/workflows/deploy.yml`) runs frontend `npm run lint` + `npx tsc --noEmit` and backend `pytest` on push to main, then deploys to EC2. One Python version everywhere: 3.12 (`.python-version`; the Dockerfile and CI follow it).

## Commands

### Backend (from `backend/`)
```bash
source venv/bin/activate            # always use the venv; use python3, never system pip
uvicorn app.main:app --reload --port 8000
ruff check app                      # lint
python3 -m pytest -q                # tests (build their DB through Alembic)
python3 -m app.migrate              # bring the DB schema to head (dev also does this on startup)
alembic revision --autogenerate -m "add foo to bar"   # write a migration after changing a model
python3 create_admin.py             # bootstrap an admin user (also: reset_password.py)
```
`backend/.env` must set `ENVIRONMENT=development` locally — `ENVIRONMENT` defaults to **production** (fail-closed), which hard-errors on default `JWT_SECRET_KEY` and missing `FIELD_ENCRYPTION_KEY`.

### Frontend (from `frontend/`)
```bash
npm run dev        # Vite on :5173, proxies /api → localhost:8000
npm run build      # tsc -b && vite build — run this to typecheck
npm run lint
```

### Docker (full stack with Postgres)
`docker-compose.yml` at repo root: Postgres 16 + backend + nginx frontend on :80. Native dev uses SQLite (`sqlite:///./app.db`) by default; production uses Postgres via `DATABASE_URL`. Code must work on both dialects.

## Architecture

### Backend layout (`backend/app/`)
- `main.py` — app assembly only: middleware stack, router registration, health endpoints, APScheduler startup. It never touches the schema.
- `startup.py` — what runs at boot: pending migrations, encryption-key sweep, super-admin bootstrap, housekeeping purges. `migrate.py` — the migration entrypoint. `observability.py` — Sentry (inert without `SENTRY_DSN`).
- `routers/` — one file per resource; `models/` — SQLAlchemy; `schemas/` — Pydantic; `services/` — email, OCR, LLM analysis, encryption, S3, search cache, etc.; `middleware/` — tenant, auth, CSRF, rate-limit, security headers.

### Schema migrations (Alembic)
The schema is owned by Alembic (`backend/migrations/`, config in `backend/alembic.ini`). Each revision runs once and is recorded in `alembic_version`. To change the schema: edit the model, run `alembic revision --autogenerate -m "..."` against an up-to-date dev DB, review the generated file, commit it. `tests/test_migrations.py` fails if models and migrations disagree.

- Pending revisions are applied when the server starts (`AUTO_MIGRATE`, on by default — single worker), so a deploy is just pull + restart. `python -m app.migrate` does the same by hand; with `AUTO_MIGRATE=false` the app refuses to start on a stale schema instead.
- Migrations must work on both Postgres and SQLite (`render_as_batch` is on for SQLite). Data backfills go in a revision too — never in startup code, where they would re-run on every boot.
- `app/legacy_migrations.py` is the frozen pre-Alembic upgrade path, run once for a database that predates Alembic. Do not add to it.
- New model modules under `app/models/` are picked up automatically (the package imports every module).

### Multi-tenancy
`TenantMiddleware` resolves the tenant from subdomain, `X-Tenant-Slug` header, or `?tenant=` query param (dev fallbacks) and puts it on `request.state`; requests without a resolvable tenant get 400 (auth/super-admin/branding/health paths are exempt). All domain data is tenant-scoped — every query must filter by tenant.

### Auth
JWT bearer access tokens (15 min, held in memory by the frontend) + refresh-token cookie with auto-refresh queue in `frontend/src/api/client.ts`. Cookie flows require CSRF token; **Bearer auth bypasses CSRF** (useful for API testing: Bearer token + `X-Tenant-Slug` header). Dependencies: `get_current_user` (any authenticated user), `require_role("admin", "broker")`, `require_super_admin`. Roles: `super_admin` (platform), `admin`, `broker`, `client`, `referrer` — mirroring `frontend/src/pages/{platform,admin,client,referrer}/`. Tenant admins can impersonate tenant users via a view-only `imp`-claim token (sessionStorage session).

### PII encryption
Sensitive columns use `EncryptedString` (`models/encrypted_type.py`); encrypted columns are auto-discovered from `Base.metadata` and must be excluded from SQL `LIKE` search — global search matches them through the decrypted-fields cache in `services/search_cache.py`. `FIELD_ENCRYPTION_KEY` is a comma-separated key ring (newest first); startup re-encrypts old-key rows.

### Optional integrations (all gated by env vars, silently disabled when unset)
Amazon SES email (boto3 `send_raw_email`, no SMTP; IAM role on EC2), S3 file storage (falls back to local `uploads/`), OpenAI document analysis, OCR (tesseract/easyocr), OneDrive via Power Automate, Twilio SMS, Redis rate limiting, ABR company lookup. See `app/config.py` for the full list.

### Background work
- Follow the `services/ocr.py` pattern: FastAPI `BackgroundTasks`, pass `session_factory=SessionLocal`, and open/close a fresh `SessionLocal()` per DB step (try/finally).
- APScheduler runs in-process in `main.py` for service-request due-date reminders — it is the app's only scheduler and assumes a single uvicorn worker.

### Frontend conventions
- Always use `api` from `src/api/client.ts` — never raw axios (it handles auth refresh, CSRF, tenant slug, impersonation).
- Domain types live in `src/types/index.ts` (string unions for enums). UI primitives import from the `src/components/ui` barrel; `Badge` supports `type="custom"` for arbitrary styles. Status-badge configs follow `Record<Status, { label: string; className: string }>`.
- Client and referrer application views must stay in sync — form-section visibility (`client_sections`) is gated frontend-only via `sectionVisible`.

### Serialization
`_app_with_user()` in `routers/applications.py` serializes all model columns via `app.__table__.columns`, so new `LoanApplication` columns appear in API responses automatically.
