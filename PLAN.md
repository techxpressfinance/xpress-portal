# Xpress Tech Portal - Loan Broking Platform

## Execution Plan & TODO

---

## Overview

A production-ready loan broking portal with client-facing upload & tracking, company internal operations, secure document handling, and scalable architecture.

**Stack:** FastAPI (Python) + React (TypeScript) + SQLite (upgradeable to Postgres) + Tailwind CSS

---

## Architecture

```
Frontend (React + TypeScript + Tailwind)
        |
Backend API (FastAPI + SQLAlchemy)
        |
Database (SQLite / PostgreSQL)
        |
File Storage (Local ./uploads, upgradeable to S3)
```

---

## Roles & Permissions

| Role   | Capabilities                                        |
| ------ | --------------------------------------------------- |
| Client | Upload docs, view own loan status, edit profile      |
| Broker | View assigned clients, approve/reject, add notes     |
| Admin  | Manage all users, workflows, reports, full access    |

---

## What's Already Built

### Backend
- [x] User auth (register, login, refresh tokens, JWT)
- [x] User model with roles (client/broker/admin) & KYC status
- [x] Loan application CRUD with role-based access
- [x] Document upload/download with file storage
- [x] Role-based middleware (require_role)
- [x] Activity log model (DB schema only)
- [x] Alembic migrations setup
- [x] CORS configured

### Frontend
- [x] Login & Register pages
- [x] Auth context with token refresh
- [x] Protected routes with role checking
- [x] Navigation layout with logout
- [x] Placeholder client dashboard
- [x] Placeholder admin dashboard
- [x] Axios client with auth interceptor

---

## Phase 1 - Client Experience (Core) -- COMPLETED

### Backend
- [x] `PATCH /api/users/me` - Update own profile (name, phone)
- [x] `PATCH /api/users/{id}/kyc` - Update KYC status (broker/admin only)
- [x] File upload validation (max 10MB, allowed types: pdf/jpg/png)
- [x] Proper error responses with detail messages

### Frontend
- [x] **Client Dashboard** - Fetch real stats (app count, active count, KYC status)
- [x] **New Application Page** - Form to create loan application (type, amount)
- [x] **My Applications Page** - List all own applications with status badges
- [x] **Application Detail Page** - View details, upload documents, submit for review
- [x] **Document Upload Component** - File picker with doc type selector
- [x] **Profile Page** - View/edit personal info, KYC status display
- [x] **Toast/Notification System** - Success/error feedback on actions

---

## Phase 2 - Company Operations (Broker/Admin) -- COMPLETED

### Backend
- [x] `GET /api/applications` - Filters (status, loan_type) + search by client name/email
- [x] `GET /api/applications` - Pagination (page, per_page)
- [x] `PATCH /api/applications/{id}/assign` - Assign broker to application (admin only)
- [x] `PATCH /api/applications/{id}/status` - Change status with workflow validation
- [x] `PATCH /api/applications/{id}` - Notes saved via update endpoint
- [x] `GET /api/activity-logs` - List activity logs with filters & pagination
- [x] Auto-log status changes, broker assignments, document verifications
- [x] `PATCH /api/users/{id}/role` - Change user role (admin only)
- [x] `PATCH /api/users/{id}/active` - Activate/deactivate user (admin only)

### Frontend
- [x] **Admin Dashboard** - Real stats (total/submitted/reviewing/approved/rejected), recent activity feed
- [x] **All Applications Table** - Filterable by status/loan type, searchable by client, paginated
- [x] **Application Review Page** - Client info, docs with verify button, status workflow buttons, notes
- [x] **Broker Assignment UI** - Dropdown to assign broker from review page
- [x] **Internal Notes Panel** - Edit/save notes on applications
- [x] **User Management Page** (Admin) - List users, change roles/KYC, activate/deactivate
- [x] **Search** - Search by client name/email in applications table

---

## Phase 3 - Workflow & Communication -- COMPLETED

### Backend
- [x] Email notification service (SMTP-based, sends on status changes, non-blocking via threading)
- [x] Application status workflow validation (draft -> submitted -> reviewing -> approved/rejected)
- [x] Activity log endpoints with pagination, filtering by action type, enriched with user names

### Frontend
- [x] **Status Timeline Component** - Visual step progress (draft → submitted → reviewing → approved), rejected state
- [x] **Activity Log Page** (`/admin/activity`) - Filterable by action type, paginated, shows user name, details, timestamps
- [ ] **Email Notification Preferences** - Client opt-in/out (deferred to Phase 5)

---

## Phase 4 - Compliance & Hardening -- COMPLETED

### Backend
- [x] Rate limiting on auth endpoints (10 requests/min per IP for login/register)
- [x] Request logging middleware (method, path, status, duration, client IP)
- [x] Security headers middleware (X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy)
- [x] Password strength validation (min 8 chars, uppercase, digit)
- [x] Input validation (name not empty, file type/size checks)
- [ ] File virus/malware scan on upload (requires external service - deferred)
- [ ] Database backup strategy (infrastructure task - deferred)

### Frontend
- [x] Loading skeletons (animated pulse placeholders on data-fetching pages)
- [x] Error boundary (catches React errors, shows friendly "Something went wrong" UI with retry)
- [ ] Accessibility audit (ARIA labels, keyboard nav) - deferred
- [ ] Offline/network error handling - deferred

### Infrastructure
- [x] Environment-based config (.env.example with all vars, PostgreSQL-ready DATABASE_URL)
- [ ] Migrate SQLite to PostgreSQL for production (already supported, just change DATABASE_URL)
- [ ] Move file storage to S3/GCS (deferred)
- [ ] CI/CD pipeline (deferred)

---

## Phase 5 - Future Enhancements

- [ ] AI document OCR (auto-extract info from uploaded docs)
- [ ] Auto eligibility scoring
- [ ] Lender matching engine
- [ ] In-app chat (client <-> broker)
- [ ] OTP/2FA login
- [ ] Aadhaar/PAN KYC integration
- [ ] Mobile app (React Native)
- [ ] Export reports (CSV/PDF)
- [ ] Analytics dashboard with charts

---

## Data Models

### User
| Field         | Type      | Notes                          |
| ------------- | --------- | ------------------------------ |
| id            | UUID      | Primary key                    |
| email         | String    | Unique                         |
| password_hash | String    |                                |
| full_name     | String    |                                |
| phone         | String    | Optional                       |
| role          | Enum      | client / broker / admin        |
| kyc_status    | Enum      | pending / verified / rejected  |
| is_active     | Boolean   | Default true                   |
| created_at    | DateTime  |                                |
| updated_at    | DateTime  |                                |

### LoanApplication
| Field              | Type      | Notes                                        |
| ------------------ | --------- | -------------------------------------------- |
| id                 | UUID      | Primary key                                  |
| user_id            | UUID (FK) | References User                              |
| loan_type          | Enum      | personal / home / business / vehicle         |
| amount             | Decimal   |                                              |
| status             | Enum      | draft / submitted / reviewing / approved / rejected |
| assigned_broker_id | UUID (FK) | References User (broker)                     |
| notes              | Text      | Internal notes                               |
| created_at         | DateTime  |                                              |
| updated_at         | DateTime  |                                              |

### Document
| Field             | Type      | Notes                                                  |
| ----------------- | --------- | ------------------------------------------------------ |
| id                | UUID      | Primary key                                            |
| application_id    | UUID (FK) | References LoanApplication                             |
| doc_type          | Enum      | id_proof / address_proof / bank_statement / payslip / tax_return / other |
| file_path         | String    |                                                        |
| original_filename | String    |                                                        |
| is_verified       | Boolean   | Default false                                          |
| uploaded_at       | DateTime  |                                                        |

### ActivityLog
| Field       | Type      | Notes                    |
| ----------- | --------- | ------------------------ |
| id          | UUID      | Primary key              |
| user_id     | UUID (FK) | Who performed the action |
| action      | String    | e.g. "status_changed"   |
| entity_type | String    | e.g. "application"      |
| entity_id   | String    | ID of affected entity    |
| details     | JSON      | Additional context       |
| created_at  | DateTime  |                          |

---

## API Endpoints

### Auth (`/api/auth`)
| Method | Endpoint    | Status | Description          |
| ------ | ----------- | ------ | -------------------- |
| POST   | /register   | Done   | Register new user    |
| POST   | /login      | Done   | Login, get tokens    |
| POST   | /refresh    | Done   | Refresh access token |
| GET    | /me         | Done   | Get current user     |

### Users (`/api/users`)
| Method | Endpoint        | Status  | Description                  |
| ------ | --------------- | ------- | ---------------------------- |
| GET    | /               | Done    | List users (admin/broker)    |
| GET    | /{id}           | Done    | Get user details             |
| PATCH  | /me             | TODO    | Update own profile           |
| PATCH  | /{id}/kyc       | TODO    | Update KYC (admin/broker)    |

### Applications (`/api/applications`)
| Method | Endpoint           | Status  | Description                    |
| ------ | ------------------ | ------- | ------------------------------ |
| POST   | /                  | Done    | Create application             |
| GET    | /                  | Done    | List applications              |
| GET    | /{id}              | Done    | Get application details        |
| PATCH  | /{id}              | Done    | Update application             |
| PATCH  | /{id}/assign       | TODO    | Assign broker                  |
| PATCH  | /{id}/status       | TODO    | Change status (with workflow)  |
| POST   | /{id}/notes        | TODO    | Add internal note              |

### Documents (`/api/documents`)
| Method | Endpoint                  | Status | Description              |
| ------ | ------------------------- | ------ | ------------------------ |
| POST   | /upload/{application_id}  | Done   | Upload document          |
| GET    | /application/{app_id}     | Done   | List docs for app        |
| GET    | /{id}/download            | Done   | Download document        |
| PATCH  | /{id}/verify              | Done   | Verify document          |

### Activity Logs (`/api/activity-logs`)
| Method | Endpoint | Status | Description         |
| ------ | -------- | ------ | ------------------- |
| GET    | /        | TODO   | List activity logs  |

---

## Current Sprint: Phase 1

Priority order:
1. Client dashboard with real data
2. New application form
3. My applications list
4. Application detail with document upload
5. Profile page
