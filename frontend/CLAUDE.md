# Xpress Tech Portal — Frontend

Loan management SPA with role-based access (client, broker, admin). Clients submit loan applications and upload documents; brokers/admins review, verify, and manage users.

## Tech Stack

- **Framework:** React 19 + TypeScript 5.9 (strict mode)
- **Build:** Vite 7.3 (`vite.config.ts`)
- **Styling:** Tailwind CSS 4.1 with OKLch color system (`src/index.css`)
- **Routing:** React Router DOM 7
- **Forms:** React Hook Form 7
- **HTTP:** Axios with interceptors (`src/api/client.ts`)
- **UI:** Headless UI 2.2, custom component library (`src/components/ui/`)

## Project Structure

```
src/
├── api/client.ts          — Axios instance, token management, refresh interceptor
├── components/
│   ├── ui/                — Reusable UI primitives (Button, Input, GlassCard, DataTable, etc.)
│   ├── Layout.tsx         — Sidebar + main content shell with role-based nav
│   ├── ProtectedRoute.tsx — Route guard checking auth + role
│   ├── ErrorBoundary.tsx  — Top-level error catcher
│   └── Toast.tsx          — Toast context + provider
├── contexts/
│   └── AuthContext.tsx     — Auth state, login/register/logout, token refresh on mount
├── hooks/
│   ├── useAuth.ts         — Shortcut to AuthContext
│   └── useTheme.ts        — Light/dark toggle, persisted to localStorage
├── lib/constants.ts       — Status badges, KYC config, role badges, valid transitions
├── pages/
│   ├── Login.tsx, Register.tsx
│   ├── client/            — Dashboard, Applications, NewApplication, ApplicationDetail, Profile
│   └── admin/             — Dashboard, AllApplications, ReviewApplication, UserManagement, ActivityLogs
├── types/index.ts         — All domain types (User, LoanApplication, Document, ActivityLog, etc.)
├── App.tsx                — Route definitions, provider tree
└── main.tsx               — Entry point
```

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start Vite dev server (proxies `/api` → `localhost:8000`) |
| `npm run build` | TypeScript check + production build |
| `npm run lint` | ESLint |
| `npm run preview` | Preview production build locally |

## Key Conventions

- **Types:** All domain models live in `src/types/index.ts`. Use string union types for enums (e.g., `UserRole`, `ApplicationStatus`).
- **API calls:** Always use the `api` instance from `src/api/client.ts` — never raw `axios`. It handles auth headers and token refresh automatically.
- **Route protection:** Wrap protected routes with `<ProtectedRoute roles={[...]}>`. Omit `roles` for any-authenticated-user routes.
- **State transitions:** Loan application status follows strict transitions defined in `src/lib/constants.ts:48` (`VALID_TRANSITIONS`).
- **UI components:** Import from `src/components/ui/index.ts` barrel export. Components use variant/size prop pattern (see `Button.tsx:3-4`).
- **No tests configured.** No test framework is installed.

## Roles & Route Layout

| Role | Base path | Access |
|------|-----------|--------|
| client | `/dashboard`, `/applications/*` | Own applications only |
| broker | `/admin/*` | All applications, activity logs |
| admin | `/admin/*` | Everything including `/admin/users` |

Route definitions: `src/App.tsx:34-125`

## Backend API

The backend runs on port 8000. Key endpoints (all prefixed `/api`):
- Auth: `/auth/login`, `/auth/register`, `/auth/refresh`, `/auth/me`
- Applications: `/applications` (CRUD)
- Documents: upload/verify per application
- Admin: `/admin/users`, `/admin/activity`

Proxy config: `vite.config.ts:8-10`

## Additional Documentation

Consult these when working in the relevant area:

| File | When to read |
|------|-------------|
| [Architectural Patterns](.claude/docs/architectural_patterns.md) | Adding features, refactoring, or understanding design decisions |
