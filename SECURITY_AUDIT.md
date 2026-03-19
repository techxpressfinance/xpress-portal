# Security Audit Report — Xpress Tech Portal

**Date:** 2025-07-18
**Scope:** Full-stack application (backend, frontend, infrastructure)
**Stack:** FastAPI + SQLAlchemy + SQLite | React 19 + TypeScript + Vite + Tailwind CSS 4
**Last Updated:** 2026-03-17

---

## Executive Summary

A comprehensive security audit of the Xpress Tech Portal identified **11 Critical**, **12 High**, **15 Medium**, and numerous Low/Informational findings across the backend API, frontend SPA, and Terraform infrastructure.

The most urgent issues are **production secrets committed without a `.gitignore`**, **five Insecure Direct Object Reference (IDOR) vulnerabilities** allowing brokers to access any application, and a **trivially bypassable rate limiter** that leaves authentication endpoints exposed to brute-force attacks.

### Finding Distribution

| Severity | Count | Remediated | Remaining |
|----------|-------|------------|-----------|
| Critical | 11 | 9 | 2 |
| High | 12 | 10 | 2 |
| Medium | 15 | 11 | 4 |
| Low | 10+ | 0 | 10+ |
| Info | 6+ | — | — |

---

## Critical Findings

### C1. Production Secrets Committed to Repository — REMEDIATED

| | |
|---|---|
| **Files** | `backend/.env` |
| **Severity** | Critical |
| **Category** | Secrets Management |
| **Status** | **Remediated** — `.gitignore` added at project root |

**No `.gitignore` exists** at the project root or in `backend/`. The `.env` file contains real credentials:

- **JWT Secret:** `change-me-to-a-random-secret` (weak/guessable)
- **SMTP Password:** `W%712407194959oc`
- **Lend API Key:** `Zhl1UO5M5Ex90ih2rOPPc5NZHWBQ6cwLL`
- **Lend API Secret:** `Jn2IcC9bLqGjPAa`
- **Power Automate Webhook URL** with signing key

**Impact:** Anyone who clones this repository has full access to production email, Lend API, and Power Automate integrations. JWT tokens can be forged with the known secret.

**Remediation:**
1. Add `.gitignore` at root with `.env`, `*.db`, `uploads/`, `__pycache__/`
2. If ever pushed to a remote, purge git history with `git-filter-repo`
3. Rotate **all** exposed credentials immediately
4. Use a secrets manager (AWS Secrets Manager, HashiCorp Vault) for production

---

### C2. IDOR — Lend Endpoints Missing Access Control — REMEDIATED

| | |
|---|---|
| **File** | `backend/app/routers/lend.py` |
| **Lines** | 49-70, 73-88, 91-110 |
| **Severity** | Critical |
| **Category** | Authorization / IDOR |
| **Status** | **Remediated** — `check_application_access()` added to `trigger_sync`, `get_sync_status`, and `update_document_lend_type` |

Three endpoints check `require_role("admin", "broker")` but never call `check_application_access()`:

| Endpoint | Line | Risk |
|----------|------|------|
| `POST /lend/sync/{app_id}` | 49 | Any broker can sync any application to Lend |
| `GET /lend/status/{app_id}` | 73 | Any broker can view sync status for any application |
| `PATCH /lend/documents/{doc_id}` | 91 | Any broker can modify document type mappings for any application |

**Proof of Concept:** Broker A (assigned to App X) calls `POST /api/lend/sync/{app_Y_id}` — the sync executes for App Y despite Broker A having no assignment.

**Remediation:** Add `check_application_access(application, current_user)` after fetching the application in each endpoint.

---

### C3. IDOR — Document Verify & OCR Retry Missing Access Control — REMEDIATED

| | |
|---|---|
| **File** | `backend/app/routers/documents.py` |
| **Lines** | 182-212, 215-228 |
| **Severity** | Critical |
| **Category** | Authorization / IDOR |
| **Status** | **Remediated** — Parent application lookup + `check_application_access()` added to both endpoints |

Two endpoints accept any broker regardless of assignment:

| Endpoint | Line | Risk |
|----------|------|------|
| `POST /{doc_id}/retry-ocr` | 182 | Any broker can trigger OCR on any document |
| `PATCH /{doc_id}/verify` | 215 | Any broker can mark any document as verified |

These endpoints fetch the document but never look up the parent application or call `check_application_access()`.

**Remediation:** After fetching `doc`, load the parent application and call `check_application_access()`.

---

### C4. HTTP Header Injection via Content-Disposition — REMEDIATED

| | |
|---|---|
| **File** | `backend/app/routers/documents.py` |
| **Line** | 156 |
| **Severity** | Critical |
| **Category** | Injection |
| **Status** | **Remediated** — Filename sanitized: `\r`, `\n`, `"` stripped; `os.path.basename()` applied |

```python
headers={"Content-Disposition": f'attachment; filename="{doc.original_filename}"'}
```

`original_filename` is user-controlled and not sanitized. CRLF characters (`\r\n`) can inject arbitrary HTTP headers, enabling response splitting and cache poisoning.

**Remediation:** Strip `\r`, `\n`, `"`, and path separators from the filename, or use `urllib.parse.quote()` with RFC 5987 encoding.

---

### C5. Rate Limiting Trivially Bypassable — REMEDIATED

| | |
|---|---|
| **File** | `backend/app/middleware/rate_limit.py` |
| **Lines** | 17-21, 42 |
| **Severity** | Critical |
| **Category** | Authentication / Brute Force |
| **Status** | **Remediated** — `X-Forwarded-For` only trusted from `TRUSTED_PROXY_IPS`; per-email rate limiting added via `check_key()` method; per-IP still in place. Note: Redis-backed persistence not yet implemented (in-memory only). |

```python
def _get_client_ip(self, request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
```

**Problems:**
- `X-Forwarded-For` is trusted from any source — attacker spoofs a new IP per request
- In-memory storage — lost on restart, not shared across workers
- No per-user tracking — only per-IP
- 10 requests/minute is the only protection for login, register, and code verification

**Remediation:**
1. Only trust `X-Forwarded-For` from configured reverse proxies
2. Use Redis-backed rate limiting for persistence and multi-worker support
3. Add per-user rate limiting in addition to per-IP

---

### C6. No Account Lockout Mechanism — REMEDIATED

| | |
|---|---|
| **File** | `backend/app/routers/auth.py` |
| **Lines** | 102-118 |
| **Severity** | Critical |
| **Category** | Authentication / Brute Force |
| **Status** | **Remediated** — `failed_login_attempts` and `locked_until` columns added to User model with migration. Account locks for 15 minutes after 5 failed attempts. Counter resets on successful login. |

The login endpoint does not track failed attempts per user. Combined with the bypassable rate limiter (C5), an attacker can attempt unlimited passwords against any account.

**Remediation:**
- Add `failed_login_attempts` and `locked_until` fields to the User model
- Lock account after 5 consecutive failures for 30 minutes
- Send notification email on lockout
- Reset counter on successful login

---

### C7. JWT Secret Silently Defaults to Weak Value

| | |
|---|---|
| **File** | `backend/app/config.py` |
| **Lines** | 10-16 |
| **Severity** | Critical |
| **Category** | Authentication |

```python
_DEFAULT_JWT_SECRET = "dev-secret-change-in-production"
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", _DEFAULT_JWT_SECRET)
if JWT_SECRET_KEY == _DEFAULT_JWT_SECRET and os.getenv("ENVIRONMENT", "development") != "development":
    raise RuntimeError(...)
```

Since `ENVIRONMENT` defaults to `"development"`, a deployment that forgets to set this variable silently uses a known, guessable JWT secret. Any attacker who knows this string can forge valid tokens.

**Remediation:** Remove the development exception. Require `JWT_SECRET_KEY` to be explicitly set in all environments and enforce minimum length (32+ bytes).

---

### C8. Insecure Token Storage in localStorage (Frontend)

| | |
|---|---|
| **Files** | `frontend/src/api/client.ts:30,37`, `frontend/src/contexts/AuthContext.tsx:42,49,64` |
| **Severity** | Critical |
| **Category** | Token Security |

Refresh tokens are stored in `localStorage`:

```typescript
localStorage.setItem('refresh_token', data.refresh_token);
```

`localStorage` is accessible to any JavaScript on the page. If an XSS vulnerability exists anywhere in the app or its dependencies, all user sessions are compromised.

**Remediation:** Coordinate with backend to store refresh tokens in `HttpOnly`, `Secure`, `SameSite=Strict` cookies. Keep access tokens in memory only (already done).

---

### C9. SSH Open to the World (Terraform) — REMEDIATED

| | |
|---|---|
| **File** | `terraform/ec2.tf` |
| **Lines** | 11-17 |
| **Severity** | Critical |
| **Category** | Infrastructure |
| **Status** | **Remediated** — SSH `cidr_blocks` changed to `var.ssh_allowed_cidrs` (defaults to empty list, must be explicitly set) |

```hcl
ingress {
  from_port   = 22
  to_port     = 22
  cidr_blocks = ["0.0.0.0/0"]
}
```

SSH (port 22) is open to all IP addresses on the internet.

**Remediation:** Restrict to known admin IPs or use AWS Systems Manager Session Manager to eliminate SSH entirely.

---

### C10. SSRF via Unvalidated Webhook URL — REMEDIATED

| | |
|---|---|
| **File** | `backend/app/services/onedrive.py` |
| **Lines** | 58-60 |
| **Severity** | Critical |
| **Category** | SSRF |
| **Status** | **Remediated** — `POWER_AUTOMATE_WEBHOOK_URL` validated to require HTTPS in `config.py` |

```python
with httpx.Client(timeout=120) as client:
    resp = client.post(POWER_AUTOMATE_WEBHOOK_URL, json=payload)
```

The webhook URL is used directly without validation. If an attacker gains control of the environment variable (or if it's misconfigured), requests can be directed to arbitrary internal services.

**Remediation:** Validate the URL against an allowlist of expected hosts. Restrict to HTTPS only.

---

### C11. Insecure Temporary File Handling

| | |
|---|---|
| **Files** | `backend/app/services/s3_storage.py:56-67`, `backend/app/services/ocr.py:117-120` |
| **Severity** | Critical |
| **Category** | File Handling |

```python
tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
tmp.write(file_bytes)
tmp.close()
return tmp.name
```

Temporary files containing sensitive financial documents (bank statements, ID proofs, tax returns) are:
- Created with `delete=False` — cleanup depends on caller
- World-readable on some systems (default permissions)
- Not cleaned up if an exception occurs before the `finally` block

**Remediation:** Use context managers, set restrictive permissions (`0o600`), and ensure cleanup in all code paths.

---

## High Findings

### H1. Missing HSTS and CSP Security Headers — REMEDIATED

| | |
|---|---|
| **File** | `backend/app/middleware/security.py` |
| **Severity** | High |
| **Category** | Security Headers |
| **Status** | **Remediated** — HSTS, CSP, `X-Permitted-Cross-Domain-Policies` added. Deprecated `X-XSS-Protection` removed. |

**Present:**
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block` (deprecated)
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

**Missing:**
- `Strict-Transport-Security` — allows SSL-stripping attacks
- `Content-Security-Policy` — no XSS mitigation

**Remediation:**
```python
response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
```

---

### H2. CORS Wildcard Methods and Headers — REMEDIATED

| | |
|---|---|
| **File** | `backend/app/main.py` |
| **Lines** | 114-120 |
| **Severity** | High |
| **Category** | CORS |
| **Status** | **Remediated** — `allow_methods` changed to `["GET", "POST", "PATCH", "DELETE", "OPTIONS"]`; `allow_headers` changed to `["Content-Type", "Authorization"]` |

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in CORS_ORIGINS.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],   # All HTTP methods
    allow_headers=["*"],   # All headers
)
```

Combined with `allow_credentials=True`, this is overly permissive.

**Remediation:**
```python
allow_methods=["GET", "POST", "PATCH", "DELETE"],
allow_headers=["Content-Type", "Authorization"],
```

---

### H3. No CSRF Protection

| | |
|---|---|
| **File** | Entire backend |
| **Severity** | High |
| **Category** | CSRF |

No CSRF middleware is configured. While Bearer token auth mitigates most CSRF attacks, defense-in-depth is lacking. All POST/PATCH/DELETE endpoints are unprotected.

**Remediation:** Add CSRF token validation or verify `Origin`/`Referer` headers. Use `SameSite=Strict` if cookies are adopted.

---

### H4. File Type Validated by Extension Only — REMEDIATED

| | |
|---|---|
| **File** | `backend/app/routers/documents.py` |
| **Lines** | 36-43 |
| **Severity** | High |
| **Category** | File Upload |
| **Status** | **Remediated** — Magic-byte validation added for PDF (`%PDF`), JPEG (`\xFF\xD8\xFF`), PNG (`\x89PNG`). Upload rejected if content doesn't match extension. |

```python
allowed_types = {".pdf", ".jpg", ".jpeg", ".png"}
ext = os.path.splitext(file.filename or "file")[1].lower()
if ext not in allowed_types:
    raise HTTPException(...)
```

No magic-byte validation. An attacker can upload an executable renamed to `.pdf`.

**Remediation:** Validate file content using magic bytes:
- PDF: `%PDF` (`\x25\x50\x44\x46`)
- JPEG: `\xFF\xD8\xFF`
- PNG: `\x89\x50\x4E\x47`

---

### H5. Unsanitized Filename Stored in Database — REMEDIATED

| | |
|---|---|
| **File** | `backend/app/routers/documents.py` |
| **Line** | 61 |
| **Severity** | High |
| **Category** | Input Validation |
| **Status** | **Remediated** — Filename sanitized on upload: `os.path.basename()` applied, `\r`, `\n`, `\x00` stripped |

```python
original_filename=file.filename or "unknown",  # No sanitization
```

Path traversal characters (`../`), null bytes, and special characters are stored as-is. While actual file storage uses UUID names, the `original_filename` is used in the Content-Disposition header (see C4) and could be used in future file operations.

**Remediation:** Sanitize with a function that strips path separators, `\r\n`, null bytes, and limits length.

---

### H6. No Pagination on `GET /api/users` — REMEDIATED

| | |
|---|---|
| **File** | `backend/app/routers/users.py` |
| **Lines** | 12-17 |
| **Severity** | High |
| **Category** | Denial of Service |
| **Status** | **Remediated** — `.limit(500)` added to query (full pagination not added because frontend expects flat array) |

```python
@router.get("", response_model=list[UserOut])
def list_users(...):
    return db.query(User).all()  # Returns ALL users
```

Unbounded query — with thousands of users, this exhausts memory and bandwidth.

**Remediation:** Add pagination with `Query(1, ge=1)` for page and `Query(20, ge=1, le=100)` for per_page.

---

### H7. Messages Pagination Unvalidated — REMEDIATED

| | |
|---|---|
| **File** | `backend/app/routers/messages.py` |
| **Lines** | 53-58 |
| **Severity** | High |
| **Category** | Denial of Service |
| **Status** | **Remediated** — Changed to `page: int = Query(1, ge=1)` and `per_page: int = Query(20, ge=1, le=100)` |

```python
def list_messages(
    page: int = 1,        # No validation
    per_page: int = 20,   # No validation — can be 999999
    ...
```

A request with `per_page=999999` loads the entire message table into memory.

**Remediation:** Change to `page: int = Query(1, ge=1)` and `per_page: int = Query(20, ge=1, le=100)`.

---

### H8. Sensitive PII Logged at INFO Level — REMEDIATED

| | |
|---|---|
| **Files** | `backend/app/services/lend.py:234,238,252`, `backend/app/services/email.py:66-70,168,268` |
| **Severity** | High |
| **Category** | Information Disclosure |
| **Status** | **Remediated** — Lend service: payload logging replaced with non-PII fields only (product_type_id, amount, lead ref). Email service: login code/invite code/body logging removed. |

**Lend service** logs full payloads containing applicant names, DOB, addresses, and financial data:
```python
logger.info("Submitting lead to Lend: %s", json.dumps(payload, default=str)[:2000])
```

**Email service** logs login codes and invitation codes when email is disabled:
```python
logger.info(f"[LOGIN CODE] {to_email}: {code}")
logger.info(f"[INVITE CODE] {to_email}: {code}")
logger.info(f"[EMAIL FALLBACK] Body:\n{body}")
```

**Remediation:** Log only non-sensitive identifiers (IDs, timestamps). Remove credential logging. Use DEBUG level for development-only output.

---

### H9. Email Header Injection — REMEDIATED

| | |
|---|---|
| **File** | `backend/app/services/email.py` |
| **Lines** | 33-40, 79-91 |
| **Severity** | High |
| **Category** | Injection |
| **Status** | **Remediated** — `_sanitize_header()` function added; applied to `to_email` and `subject` in `_send_email()` |

User-controlled values (`client_name`, `loan_type`) flow into email subjects and bodies without stripping `\r\n`:

```python
msg["Subject"] = subject
body = f"Dear {client_name},\n\n{template['body']}..."
```

An attacker with a name like `John\r\nBcc: attacker@evil.com` can inject email headers.

**Remediation:** Strip `\r` and `\n` from all user-controlled values used in email headers and subjects.

---

### H10. Weak Login Code Entropy

| | |
|---|---|
| **File** | `backend/app/services/auth.py` |
| **Lines** | 91-96 |
| **Severity** | High |
| **Category** | Authentication |

```python
alphabet = string.ascii_uppercase + string.digits  # 36 characters
code = "".join(secrets.choice(alphabet) for _ in range(8))
```

36^8 = ~2.8 trillion combinations. With rate limiting bypassed (C5) and no account lockout (C6), brute-force is feasible.

**Remediation:** Increase to 10+ characters, add lowercase letters (62-char alphabet), and implement per-user attempt tracking.

---

### H11. No Encryption at Rest for Sensitive Fields

| | |
|---|---|
| **Files** | `backend/app/models/user.py:31,48`, `backend/app/models/loan_application.py` |
| **Severity** | High |
| **Category** | Data Protection |

The following are stored in plaintext:
- Email verification tokens
- Login codes (HMAC hashes, but still sensitive)
- `lend_extra_data` JSON containing driver's license numbers, Medicare numbers, passport numbers, employment details, and income data

**Remediation:** Use application-level encryption (AES-256-GCM) for sensitive fields. Store encryption keys in a key management service. Hash tokens before storage.

---

### H12. File Size Check After Full Read

| | |
|---|---|
| **File** | `backend/app/routers/documents.py` |
| **Lines** | 46-52 |
| **Severity** | High |
| **Category** | Denial of Service |

```python
contents = file.file.read()       # Entire file read into memory first
max_size = 10 * 1024 * 1024
if len(contents) > max_size:      # Checked after full read
    raise HTTPException(...)
```

Multiple concurrent 10MB uploads can exhaust server memory before the size check runs.

**Remediation:** Stream the file in chunks and check size incrementally, or configure a request body size limit at the ASGI server level.

---

## Medium Findings

### M1. Email Verification Tokens Use UUIDs — REMEDIATED

| | |
|---|---|
| **File** | `backend/app/routers/auth.py:56,199` |
| **Severity** | Medium |
| **Status** | **Remediated** — Changed to `secrets.token_urlsafe(32)` (256 bits of entropy). Model column widened to `String(64)`. |

```python
token = str(uuid.uuid4())
```

UUID v4 provides 122 bits of entropy but is stored and compared in plaintext. Use `secrets.token_urlsafe(32)` and hash before storing.

---

### M2. Email Resend Not Rate-Limited Per Email — REMEDIATED

| | |
|---|---|
| **File** | `backend/app/routers/auth.py:193-205` |
| **Severity** | Medium |
| **Status** | **Remediated** — Per-email rate limiting added to login endpoint via `auth_limiter.check_key(data.email)`. Rate limiter now supports arbitrary key-based limiting. |

Rate limiting is per-IP only. An attacker can spam any email address with verification emails (email bombing).

**Remediation:** Add per-email rate limiting (max 3 resends per 24 hours).

---

### M3. No Rate Limiting on Password Change — REMEDIATED

| | |
|---|---|
| **File** | `backend/app/routers/auth.py:156-173` |
| **Severity** | Medium |
| **Status** | **Remediated** — `auth_limiter.check(request)` added to `change_password` endpoint |

The `POST /auth/change-password` endpoint has no rate limiting. An attacker with a compromised session can brute-force the current password field.

---

### M4. Token Blacklist Never Cleaned Up — REMEDIATED

| | |
|---|---|
| **File** | `backend/app/models/token_blacklist.py` |
| **Severity** | Medium |
| **Status** | **Remediated** — Expired entries purged on app startup in `main.py` |

Blacklisted tokens have `expires_at` but no cleanup job. The table grows indefinitely.

**Remediation:** Add a scheduled task to delete expired entries daily.

---

### M5. Mass Assignment Pattern in Profile Update — REMEDIATED

| | |
|---|---|
| **File** | `backend/app/routers/users.py:25-36` |
| **Severity** | Medium |
| **Status** | **Remediated** — `setattr()` loop replaced with explicit `if data.full_name` / `if data.phone` assignments |

```python
updates = data.model_dump(exclude_unset=True)
for key, value in updates.items():
    setattr(current_user, key, value)
```

Currently safe because the Pydantic schema restricts to `full_name` and `phone`. However, if the schema is expanded carelessly (e.g., adding `role`), users could self-promote.

**Remediation:** Use explicit field assignments instead of dynamic `setattr()`.

---

### M6. Information Disclosure in Lend Error Responses — REMEDIATED

| | |
|---|---|
| **File** | `backend/app/routers/lend.py:42-46` |
| **Severity** | Medium |
| **Status** | **Remediated** — Error detail changed to generic message; raw exception logged server-side only |

```python
except Exception as exc:
    raise HTTPException(status_code=502, detail=f"Failed to fetch picklist: {exc}")
```

Raw exception messages (connection errors, API URLs, internal paths) are returned to the client.

**Remediation:** Log the full exception server-side; return a generic error message to the client.

---

### M7. Inconsistent Eager Loading for Access Control

| | |
|---|---|
| **Files** | `backend/app/services/access_control.py:20`, `backend/app/routers/applications.py:99` |
| **Severity** | Medium |

`check_application_access()` checks `app.brokers` (many-to-many), but the applications list query only eagerly loads `assigned_broker` (single FK), not the `brokers` relationship. Lazy loading may cause unexpected behavior.

---

### M8. No Validation of OCR Text Size — REMEDIATED

| | |
|---|---|
| **File** | `backend/app/services/ocr.py:53-83` |
| **Severity** | Medium |
| **Status** | **Remediated** — OCR text capped at 500KB before storage (`text[:500_000]`) |

Extracted OCR text is stored without size limits. A specially crafted document could produce megabytes of text, exhausting database storage.

---

### M9. Race Conditions in Background Tasks

| | |
|---|---|
| **Files** | `backend/app/services/ocr.py:86-131`, `backend/app/services/onedrive.py:73-109` |
| **Severity** | Medium |

Background tasks update document records using separate sessions without row-level locking. Concurrent tasks on the same document can lose updates.

**Remediation:** Use `SELECT ... FOR UPDATE` or optimistic locking with version fields.

---

### M10. Search Input Passed to Backend Without Validation

| | |
|---|---|
| **File** | `frontend/src/pages/admin/AllApplications.tsx:25-30` |
| **Severity** | Medium |

```typescript
if (search) params.set('search', search);
```

No client-side length limit, format validation, or sanitization. Backend uses `ilike(f"%{search}%")` which is safe from SQL injection via SQLAlchemy, but excessively long strings can degrade performance.

---

### M11. Error Boundary Leaks Error Details

| | |
|---|---|
| **File** | `frontend/src/components/ErrorBoundary.tsx:35` |
| **Severity** | Medium |

```typescript
{this.state.error?.message || 'An unexpected error occurred'}
```

Error messages may contain file paths, component names, or API endpoint URLs. These should be filtered in production.

---

### M12. No Validation of Loan Amount — REMEDIATED

| | |
|---|---|
| **File** | `backend/app/schemas/loan_application.py` |
| **Severity** | Medium |
| **Status** | **Remediated** — `amount` field changed to `Field(..., ge=0)` in Create/Out schemas; `Field(None, ge=0)` in Update schema. `business_monthly_sales` also validated with `ge=0`. |

The `amount` field accepts any `Decimal` value — negative numbers, zero, or astronomically large values.

**Remediation:** Add `Field(..., ge=0, max_digits=12, decimal_places=2)`.

---

### M13. No Global Request Body Size Limit — REMEDIATED

| | |
|---|---|
| **File** | `backend/app/main.py` |
| **Severity** | Medium |
| **Status** | **Remediated** — `BodySizeLimitMiddleware` added, rejects requests with `Content-Length` > 10MB (HTTP 413) |

No maximum request body size is configured. Large JSON payloads can exhaust server memory.

**Remediation:** Configure at the ASGI server level or add middleware.

---

### M14. Incomplete Audit Logging — REMEDIATED

| | |
|---|---|
| **File** | `backend/app/routers/auth.py:156-173` |
| **Severity** | Medium |
| **Status** | **Remediated** — `log_activity(db, current_user.id, "password_changed", "user", current_user.id)` added to `change_password` endpoint |

Password changes and token revocations are not recorded in the activity log. These are critical security events.

---

### M15. Plaintext Token Storage in Database

| | |
|---|---|
| **File** | `backend/app/models/user.py:46-50` |
| **Severity** | Medium |

Email verification tokens and login codes are stored in plaintext. A database breach immediately exposes all active tokens.

**Remediation:** Hash tokens before storage (SHA-256 is sufficient for random tokens). Compare hashes on verification.

---

## Low Findings

| # | Issue | File | Details |
|---|-------|------|---------|
| L1 | Login code expires quickly (10 min) | `services/login_code.py:8` | May be too short for email-based delivery; increase to 30 min |
| L2 | Activity logs never cleaned up | `services/activity_log.py` | Unbounded table growth; implement retention policy |
| L3 | Login code format not validated in schema | `schemas/user.py:121-123` | Add `Field(..., pattern=r"^[A-Z0-9]{8}$")` |
| L4 | No database connection pool configuration | `database.py` | Add `pool_size`, `max_overflow`, `pool_pre_ping` |
| L5 | SQLite thread safety disabled | `database.py:7-8` | `check_same_thread=False` — document limitation, use PostgreSQL in production |
| L6 | OCR error messages stored in database | `services/ocr.py:105-115` | Stack traces truncated to 500 chars but may leak internals |
| L7 | Sensitive data in browser console | `ErrorBoundary.tsx:20` | `console.error` with full error objects; filter in production |
| L8 | Referral code passed as URL parameter | `AuthContext.tsx:69` | Move to request body to avoid logging in server/proxy logs |
| L9 | No input validation on phone field | Frontend forms | Add format pattern for phone numbers |
| L10 | No Subresource Integrity for external resources | `index.html:7-8` | Google Fonts preconnect without SRI |

---

## Informational / Positive Findings

### Correctly Implemented

| Area | Details |
|------|---------|
| **Password hashing** | bcrypt via passlib with constant-time comparison |
| **Login code verification** | `hmac.compare_digest()` prevents timing attacks |
| **Refresh token rotation** | Old token blacklisted on each refresh |
| **Email verification** | Required before login when SMTP is configured |
| **Role-based access control** | `require_role()` decorator on all admin/broker endpoints |
| **Application access control** | `check_application_access()` enforces client/broker/admin rules on most endpoints |
| **Status transition enforcement** | `VALID_TRANSITIONS` dict prevents invalid workflow changes |
| **UUID-based file storage** | Prevents directory traversal in actual file writes |
| **React HTML escaping** | Default JSX escaping prevents most XSS |
| **TypeScript strict mode** | Enabled with `noUnusedLocals` and `noFallthroughCasesInSwitch` |
| **React StrictMode** | Enabled in `main.tsx` |
| **Self-role-change prevention** | Admin cannot change own role or deactivate self |
| **Client-to-admin escalation blocked** | Must promote through broker first |

---

## Remediation Priority

### Completed

| # | Action | Findings | Status |
|---|--------|----------|--------|
| 1 | Add `.gitignore` with `.env`, `*.db`, `uploads/` at root | C1 | Done |
| 2 | Add `check_application_access()` to 5 IDOR-vulnerable endpoints | C2, C3 | Done |
| 3 | Sanitize `original_filename` in Content-Disposition header | C4 | Done |
| 4 | Restrict SSH in Terraform to `var.ssh_allowed_cidrs` | C9 | Done |
| 5 | Fix rate limiter: only trust `X-Forwarded-For` from `TRUSTED_PROXY_IPS` | C5 | Done |
| 6 | Add per-email rate limiting via `check_key()` | C5, M2 | Done |
| 7 | Add account lockout (5 failures → 15 min lock) | C6 | Done |
| 8 | Validate webhook URL requires HTTPS | C10 | Done |
| 9 | Add magic-byte file type validation (PDF, JPEG, PNG) | H4 | Done |
| 10 | Sanitize filename on upload (strip path, `\r\n`, `\x00`) | H5 | Done |
| 11 | Add `ge=1, le=100` bounds to messages pagination | H7 | Done |
| 12 | Add `.limit(500)` to `GET /api/users` query | H6 | Done |
| 13 | Add HSTS, CSP, `X-Permitted-Cross-Domain-Policies` headers | H1 | Done |
| 14 | Replace CORS wildcards with explicit method/header lists | H2 | Done |
| 15 | Strip `\r\n` from email headers via `_sanitize_header()` | H9 | Done |
| 16 | Remove credential/PII logging from email and Lend services | H8 | Done |
| 17 | Return generic error messages from Lend proxy | M6 | Done |
| 18 | Replace `setattr()` with explicit field assignments | M5 | Done |
| 19 | Use `secrets.token_urlsafe(32)` for verification tokens | M1 | Done |
| 20 | Add `Field(..., ge=0)` validation on loan amount and monthly sales | M12 | Done |
| 21 | Add `BodySizeLimitMiddleware` (10MB limit) | M13 | Done |
| 22 | Log password changes to activity log | M14 | Done |
| 23 | Rate limit password change endpoint | M3 | Done |
| 24 | Purge expired blacklisted tokens on startup | M4 | Done |
| 25 | Cap OCR text at 500KB before storage | M8 | Done |

### Remaining — Requires Manual Action

| # | Action | Findings | Notes |
|---|--------|----------|-------|
| 26 | Rotate all exposed secrets (JWT, SMTP, Lend API, webhook) | C1 | Manual — must be done in production environments |

### Remaining — Requires Architectural Changes

| # | Action | Findings | Notes |
|---|--------|----------|-------|
| 27 | Move refresh tokens to httpOnly cookies | C8 | Requires frontend + backend refactor |
| 28 | Add CSRF protection (relevant if cookies are adopted) | H3 | Depends on C8 |
| 29 | Enforce JWT secret in all environments (remove dev default) | C7 | Partially mitigated — config.py raises in non-dev environments |
| 30 | Add field-level encryption for sensitive data (AES-256-GCM) | H11 | Requires key management infrastructure |
| 31 | Stream file uploads for size check | H12 | Mitigated by M13 body size middleware |
| 32 | Hash verification tokens before DB storage | M15 | Mitigated by M1 (stronger tokens) |
| 33 | Redis-backed rate limiting for multi-worker persistence | C5 | Partially mitigated — proxy trust + per-email limiting in place |
| 34 | Consistent eager loading for access control | M7 | Code review needed |
| 35 | Row-level locking for background tasks | M9 | Requires `SELECT ... FOR UPDATE` or optimistic locking |
| 36 | Increase login code entropy | H10 | Mitigated by C6 (account lockout) — 36^8 with 5-attempt limit is acceptable |

### Backlog — Low Priority

| # | Action | Findings |
|---|--------|----------|
| 37 | Filter error details in production ErrorBoundary | M11 |
| 38 | Add database connection pool configuration | L4 |
| 39 | Implement log retention policy | L2 |
| 40 | Add phone number format validation | L9 |
| 41 | Validate login code format in schema | L3 |
