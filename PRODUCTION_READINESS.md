# Production Readiness Checklist

## CRITICAL — Fix before going live

- [ ] **1. Credentials in `.env` checked into repo** — SMTP password, Power Automate webhook URL are exposed (`backend/.env`)
- [ ] **2. Weak JWT secret default** — `"dev-secret-change-in-production"` fallback means auth is bypassable if env var is unset (`backend/app/config.py:9`)
- [ ] **3. SQLite in production** — no concurrent write support, no WAL mode, no connection pooling. Will corrupt under load (`backend/app/database.py`)
- [ ] **4. Refresh token in localStorage** — any XSS steals the refresh token and gets persistent access (`frontend/src/contexts/AuthContext.tsx`)
- [ ] **5. CORS allows `*` methods/headers** from hardcoded localhost origin — won't work in prod, too permissive for dev (`backend/app/main.py:53-59`)
- [ ] **6. No global exception handler** — unhandled errors return stack traces with internal paths, DB column names (`backend/app/main.py`)

## HIGH — Significant risk

- [x] **7. Broken broker access control** — brokers can view/modify ANY application, not just their assigned ones (`backend/app/routers/applications.py:108-119, 166-197`)
- [ ] **8. Path traversal in document download** — `file_path` from DB used directly in `FileResponse` without validation (`backend/app/routers/documents.py:138-154`)
- [ ] **9. No file MIME validation on upload** — only checks extension, polyglot files bypass this (`backend/app/routers/documents.py:36-43`)
- [ ] **10. No rate limiting beyond auth** — document uploads, search, messages all unthrottled. Easy DoS (`backend/app/routers/*`)
- [ ] **11. No request body size limit** — 10MB file size checked after reading into memory, no server-level cap (`backend/app/main.py`)
- [x] **12. Admin role change has no confirmation** — one misclick promotes a client to admin (`frontend/src/pages/admin/UserManagement.tsx`)
- [ ] **13. No CSP header** — neither backend security middleware nor frontend index.html set Content-Security-Policy (both)
- [ ] **14. Status-change buttons lack loading/disable state** — double-click sends duplicate approve/reject (`frontend/src/pages/admin/ReviewApplication.tsx:60-69`)

## MEDIUM — Should fix before scaling

- [ ] **15. No database indexes** on `user_id`, `status`, `application_id`, `created_at` — queries degrade with data growth (`backend/app/models/*`)
- [ ] **16. Missing cascade deletes** — deleting a user orphans applications, documents, logs (`backend/app/models/loan_application.py`)
- [ ] **17. N+1 query in activity logs** — fetches all logs then queries users separately (`backend/app/routers/activity_logs.py:36`)
- [ ] **18. `uuid4()` for verification tokens** — should use `secrets.token_urlsafe(32)` (`backend/app/routers/auth.py:40`)
- [ ] **19. No loan amount validation** — accepts negative, zero, or absurdly large values (`backend/app/schemas/loan_application.py`)
- [ ] **20. Unpinned dependencies** on both sides — `^` and `>=` allow breaking changes in CI (`requirements.txt`, `package.json`)
- [ ] **21. Failed login attempts not logged** — no way to detect brute force or credential stuffing (`backend/app/routers/auth.py`)
- [ ] **22. No HTTPS enforcement** — no HSTS header, no redirect, tokens fly in cleartext (backend middleware)
- [ ] **23. Console.error in production** — ErrorBoundary logs full errors to browser console (`frontend/src/components/ErrorBoundary.tsx:20`)

## LOW — Polish items

- [ ] **24. Missing `robots.txt`** with `noindex` (internal app shouldn't be crawled)
- [ ] **25. No debouncing on search inputs**
- [ ] **26. Toast auto-dismisses in 4s** — too fast for error messages
- [ ] **27. Date formatting inconsistent across timezones**
- [ ] **28. Missing ARIA labels** on icon buttons and modal


┌────────────────┬──────────────────────────┬────────────┐                                
  │      Name      │          Email           │  Password  │                             
  ├────────────────┼──────────────────────────┼────────────┤                                
  │ Sarah Mitchell │ sarah.broker@example.com │ Broker1234 │                             
  ├────────────────┼──────────────────────────┼────────────┤
  │ James Chen     │ james.broker@example.com │ Broker1234 │
  ├────────────────┼──────────────────────────┼────────────┤
  │ Priya Sharma   │ priya.broker@example.com │ Broker1234 │
  └────────────────┴──────────────────────────┴────────────┘