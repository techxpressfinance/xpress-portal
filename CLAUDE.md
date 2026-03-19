# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Xpress Tech Portal is a loan broking platform. Clients upload documents and submit loan applications; brokers review and manage applications; admins have full access including user management.

**Stack:** FastAPI + SQLAlchemy + SQLite (backend) | React 19 + TypeScript + Vite + Tailwind CSS 4 (frontend)

## Commands

### Backend (run from `backend/`)
```bash
# Start dev server
python3 -m uvicorn app.main:app --reload

# Install dependencies
pip install -r requirements.txt

# System dependency for OCR
brew install tesseract
```

### Frontend (run from `frontend/`)
```bash
npm run dev       # Vite dev server (proxies /api → localhost:8000)
npm run build     # TypeScript check + production build
npm run lint      # ESLint
```

Use `python3` on this machine (not `python`).

## Architecture

```
backend/
├── app/
│   ├── main.py          — App factory, middleware stack, idempotent ALTER TABLE migrations
│   ├── config.py        — Env vars (DATABASE_URL, JWT, SMTP, OpenAI, OneDrive)
│   ├── database.py      — SQLAlchemy engine, SessionLocal, get_db dependency
│   ├── models/          — SQLAlchemy ORM models (User, LoanApplication, Document, ActivityLog, etc.)
│   ├── schemas/         — Pydantic request/response schemas
│   ├── routers/         — FastAPI route handlers (auth, users, applications, documents, etc.)
│   ├── services/        — Business logic (auth/JWT, email, OCR, LLM analysis, OneDrive upload)
│   └── middleware/      — Auth (get_current_user, require_role), rate limiting, logging, security headers
frontend/
├── src/
│   ├── api/client.ts    — Axios instance with auth interceptor and token refresh
│   ├── contexts/        — AuthContext (JWT token management)
│   ├── components/ui/   — Reusable UI primitives (import from barrel index.ts)
│   ├── components/      — Layout, ProtectedRoute, ErrorBoundary, Toast, DocumentPreviewModal
│   ├── pages/client/    — Client-facing pages (Dashboard, Applications, ApplicationDetail, Profile)
│   ├── pages/admin/     — Admin/broker pages (Dashboard, AllApplications, ReviewApplication, UserManagement, ActivityLogs)
│   ├── types/index.ts   — All domain types (string unions for enums)
│   └── lib/constants.ts — Status badge configs, valid transitions, display label maps
```

## Key Patterns

### Backend

- **Auth middleware:** `get_current_user` for any authenticated user. `require_role("admin", "broker")` for role-gated endpoints.
- **Background tasks:** Follow the `ocr.py` pattern — each DB step creates its own `SessionLocal()` session with try/finally close. Pass `session_factory=SessionLocal` to background functions.
- **DB migrations:** `create_all` won't ALTER existing tables. Add new columns via the `_MIGRATIONS` list in `main.py` which runs idempotent `ALTER TABLE` statements checked against `inspect(engine).get_columns()`.
- **Response serialization:** `_app_with_user()` in the applications router serializes all model columns via `app.__table__.columns`, so new columns automatically appear in responses.
- **Roles:** `client`, `broker`, `admin`. Workflow: draft → submitted → reviewing → approved/rejected.

### Frontend

- **API calls:** Always use `api` from `src/api/client.ts` (never raw axios). The Vite proxy handles `/api` prefix.
- **UI imports:** Import from `../../components/ui` barrel. Components use variant/size prop pattern.
- **Types:** All domain models in `src/types/index.ts`. Use string unions for enums.
- **Constants:** Badge/label configs follow `Record<EnumValue, { label, className }>` pattern in `src/lib/constants.ts`. When adding enum values, update all relevant maps.
- **Route protection:** `<ProtectedRoute roles={[...]}>` wrapper. Client routes under `/dashboard`, `/applications`; admin/broker routes under `/admin`.
- **Data fetching:** `useEffect` + local state pattern. No query library. Paginated responses use `{ items, total, page, per_page }` shape.
- **Forms:** React Hook Form with `register` + `handleSubmit`.
- **No test framework installed.**

### Optional Services (disabled if env vars missing)
- **Email:** SMTP-based notifications on status changes (`SMTP_HOST`, `SMTP_USER`)
- **OCR:** Tesseract-based text extraction on document upload (requires `brew install tesseract`)
- **LLM Analysis:** OpenAI-powered application analysis (`OPENAI_API_KEY`)
- **OneDrive:** Document sync via Power Automate webhook (`POWER_AUTOMATE_WEBHOOK_URL`)

## Additional Documentation

- `frontend/CLAUDE.md` — Detailed frontend architecture, component patterns, route structure
- `frontend/.claude/docs/architectural_patterns.md` — Deep dive into auth flow, state management, CSS architecture
