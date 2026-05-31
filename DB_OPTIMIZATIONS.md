# Database Optimisation Opportunities

A survey of the current SQLAlchemy / SQLite layer with concrete fixes. Each item lists where the problem lives, why it's slow today, the expected query cost in the worst case, and a sketch of the fix.

Status: findings only — nothing in this document has been applied yet.

---

## 1. `app_with_user` opens a fresh DB session for every application

**File:** `backend/app/services/serialization.py:9-73`
**Hot callers:** `routers/applications.py` — every `_app_with_user(app)` call site (lines 235, 305, 416, 439, 453, 572, 624, 652, 690, 729, 765, 800)

### What it does now

```python
def app_with_user(app: LoanApplication) -> dict:
    data = {c.name: getattr(app, c.name) for c in app.__table__.columns}
    ...
    elif app.user:
        db = SessionLocal()              # ← new connection per app
        try:
            ext_ref = db.query(ExternalReferral).filter(
                ExternalReferral.referred_client_id == app.user_id,
            ).first()
            if ext_ref and ext_ref.referrer:
                referrer_info = { ... ext_ref.referrer.full_name ... }
            else:
                ref = db.query(Referral).filter(
                    Referral.referred_user_id == app.user_id,
                ).first()
                if ref and ref.referrer:
                    referrer_info = { ... ref.referrer.full_name ... }
        finally:
            db.close()
```

### Why it's slow

- A brand-new `SessionLocal()` is created per application. For a 20-row page of `list_applications`, that's **20 new connections** opened and closed. SQLite handles this cheaply, but it still bypasses the FastAPI request-scoped session that already holds a warm connection.
- For each application, **up to 2 extra queries** run (ExternalReferral, then Referral if the first misses), plus the `ext_ref.referrer` / `ref.referrer` lazy-load fires another `User` SELECT each time. Worst case: **4 queries × N applications = 80 queries** to render a 20-app page.
- Hits every paginated endpoint (`list_applications`, `list_deleted_applications`, `referrer_dashboard_apps`, etc.) and every detail GET. This is almost certainly the single most expensive line of code in the app.

### Fix

1. Take the request's `db: Session` as a parameter rather than minting a new one.
2. When called from a list endpoint, pre-batch the referrer lookup for the whole page in two `IN` queries (one against `ExternalReferral.referred_client_id IN (...)`, one against `Referral.referred_user_id IN (...)`) and pass a dict into the serializer:

```python
def app_with_user(app: LoanApplication, *, referrer_by_user_id: dict[str, dict] | None = None) -> dict:
    ...
    referrer_info = (referrer_by_user_id or {}).get(app.user_id)
    if referrer_info is None and app.user and app.user.role.value != "referrer":
        # fallback for single-app detail calls where no map was prebuilt
        referrer_info = _load_referrer_single(app.user_id, db)
    data["referrer"] = referrer_info
    return data
```

In `list_applications`, build the map once before the list comprehension:

```python
user_ids = [a.user_id for a in items if a.user_id]
ext_refs = db.query(ExternalReferral).filter(
    ExternalReferral.referred_client_id.in_(user_ids)
).options(joinedload(ExternalReferral.referrer)).all()
referrer_by_user_id = {
    r.referred_client_id: {"id": r.referrer.id, "full_name": r.referrer.full_name, ...}
    for r in ext_refs if r.referrer
}
# same for Referral, only for user_ids missing from the map
return PaginatedApplications(items=[_app_with_user(a, referrer_by_user_id=referrer_by_user_id) for a in items], ...)
```

**Expected impact:** drops `list_applications` page-render from ~80 queries to ~5 (the page + user joinedload + ExternalReferral IN + Referral IN). Lowest-risk biggest-win change in the codebase.

---

## 2. `_build_conversations` runs O(N) sub-queries per pair

**File:** `backend/app/routers/messages.py:354-390` (after my recent edits)

### What it does now

```python
for client_id, peer_id, client_name, peer_name in pairs:
    last_msg = (
        db.query(ClientMessage)
        .filter(
            ClientMessage.client_id == client_id,
            ClientMessage.tenant_id == tenant_id,
            ClientMessage.application_id.is_(None),
            or_(ClientMessage.author_id == peer_id, ClientMessage.recipient_id == peer_id),
        )
        .order_by(ClientMessage.created_at.desc())
        .first()
    )
    msg_count = (
        db.query(ClientMessage).filter(...).count()  # same filter, second round-trip
    )
```

### Why it's slow

- For every (client, peer) pair the function runs **2 queries** (last + count), and there is a separate loop above (`list_client_inbox`) that does another `db.query(User).filter(User.id == pid).first()` per pair (`messages.py:411, 421, 441, 474`).
- A referrer with 30 conversations triggers **~120 round trips** just to render the inbox. Latency adds up: even at 0.3 ms per SQLite query that's 36 ms of pure I/O before any rendering work, and on Postgres-over-network it would be much worse.

### Fix

Pull last message + count for *all* pairs in two queries using window functions / subqueries. SQLite ≥ 3.25 supports `ROW_NUMBER() OVER`:

```python
peer_ids = [p[1] for p in pairs]
client_ids = [p[0] for p in pairs]

# Single query: latest message per (client_id, peer_id) tuple
ranked = (
    db.query(
        ClientMessage,
        func.row_number().over(
            partition_by=[ClientMessage.client_id, _peer_expr],
            order_by=ClientMessage.created_at.desc(),
        ).label("rn"),
    )
    .filter(
        ClientMessage.tenant_id == tenant_id,
        ClientMessage.application_id.is_(None),
        ClientMessage.client_id.in_(client_ids),
        or_(ClientMessage.author_id.in_(peer_ids), ClientMessage.recipient_id.in_(peer_ids)),
    )
    .subquery()
)
last_msgs = db.query(ClientMessage).join(ranked, ranked.c.id == ClientMessage.id).filter(ranked.c.rn == 1).all()

# Counts in one grouped query
count_rows = (
    db.query(ClientMessage.client_id, _peer_expr, func.count(ClientMessage.id))
    .filter(...)
    .group_by(ClientMessage.client_id, _peer_expr)
    .all()
)
```

Then key both results by `(client_id, peer_id)` and zip them up. Also batch the `User` loads with a single `User.id.in_(...)` query and cache by id.

**Expected impact:** inbox render drops from `2N + N + N` queries to a constant 3–4 queries regardless of conversation count.

---

## 3. `_contact_with_count` runs a `COUNT(*)` per row

**File:** `backend/app/routers/contacts.py:37-58` (called from list and detail endpoints, line 100 / 108 / 129)

### What it does now

```python
def _contact_with_count(contact: Contact, db: Session) -> dict:
    app_count = db.query(func.count(LoanApplication.id)).filter(
        LoanApplication.contact_id == contact.id
    ).scalar() or 0
    return { ..., "application_count": app_count, ... }
```

### Why it's slow

- `list_contacts` returns 20 contacts → **21 queries** (the page + 20 COUNTs). Each COUNT has its own filter so the planner can't merge them.

### Fix

Compute counts for the whole page in one query, then look them up in a dict:

```python
ids = [c.id for c in items]
count_rows = (
    db.query(LoanApplication.contact_id, func.count(LoanApplication.id))
    .filter(LoanApplication.contact_id.in_(ids))
    .group_by(LoanApplication.contact_id)
    .all()
)
counts = {cid: n for cid, n in count_rows}

def _serialize(c: Contact) -> dict:
    return { ..., "application_count": counts.get(c.id, 0), ... }

return PaginatedContacts(items=[_serialize(c) for c in items], total=total, ...)
```

**Expected impact:** 21 queries → 2 for the contacts page.

---

## 4. Dashboard average turnaround pulls every completed row into Python

**File:** `backend/app/routers/dashboard.py:97-106`

### What it does now

```python
completed = scoped(
    db.query(LoanApplication.created_at, LoanApplication.updated_at).filter(
        LoanApplication.status.in_([ApplicationStatus.settled, ApplicationStatus.rejected])
    )
).all()
if completed:
    total_secs = sum((r.updated_at - r.created_at).total_seconds() for r in completed)
    avg_turnaround_days = round(total_secs / len(completed) / 86400, 1)
```

### Why it's slow

Every settled/rejected row is shipped over the SQLite wire to compute one float. With a few hundred apps it doesn't matter; with tens of thousands it becomes the slowest line on the dashboard.

### Fix (SQLite-flavoured)

```python
avg_days = scoped(
    db.query(
        func.avg(func.julianday(LoanApplication.updated_at) - func.julianday(LoanApplication.created_at))
    ).filter(LoanApplication.status.in_([ApplicationStatus.settled, ApplicationStatus.rejected]))
).scalar()
avg_turnaround_days = round(avg_days, 1) if avg_days is not None else None
```

Postgres equivalent: `func.avg(LoanApplication.updated_at - LoanApplication.created_at)` returns an interval; convert with `extract('epoch', ...) / 86400`.

**Expected impact:** O(N) network → O(1).

---

## 5. Monthly / daily trend buckets are computed in Python

**File:** `backend/app/routers/dashboard.py:108-142`

### What it does now

Fetches every `created_at` in the time window and counts into `dict[str, int]` in Python.

### Fix

Group in SQL:

```python
month_rows = scoped(
    db.query(
        func.strftime("%Y-%m", LoanApplication.created_at).label("ym"),
        func.count(LoanApplication.id),
    ).filter(LoanApplication.created_at >= start_month)
    .group_by("ym")
).all()
month_counts = {ym: n for ym, n in month_rows}
# then fill in any missing buckets with 0
```

Same shape for the 30-day trend with `%Y-%m-%d`. Postgres swap: `func.to_char(LoanApplication.created_at, 'YYYY-MM')`.

**Expected impact:** order-of-magnitude reduction in rows shipped on the dashboard. Low priority today, important at scale.

---

## 6. Missing indexes on hot foreign-key and filter columns

SQLite only auto-indexes `PRIMARY KEY` and `UNIQUE` constraints — it does **not** auto-index foreign keys. Several FK/filter columns on the busiest tables have no index today. The audit:

### `loan_applications` (filtered by nearly every endpoint)
| Column | Why it matters | Status |
|---|---|---|
| `user_id` | Client view, broker scoping, `_app_with_user` referrer joins | **Missing** |
| `assigned_broker_id` | Legacy broker scoping, still queried | **Missing** |
| `contact_id` | Contact detail / counts | **Missing** |
| `business_organization_id` | Company detail page | **Missing** |
| `completed_by_id` | Rare; OK to skip | Missing (low pri) |
| `status` | Every list filter, dashboard group-by | **Missing** |
| `created_at` | Every `order_by(... desc())` and trend bucket | **Missing** |
| `deleted_at` | Every list filter uses `IS NULL` | **Missing** |
| `tenant_id` | Already indexed | ✓ |

### `tasks`
- `assigned_to_id`, `application_id`, `created_by_id` — **missing**, all are filter targets.

### `external_referrals` / `referrals`
- `referrer_id`, `referred_client_id`, `referred_user_id` — **missing**, queried in every messages-related and applications-list endpoint.

### Others
- `direct_messages.created_at` — needed for inbox ordering, missing.
- `activity_logs.user_id` — missing.
- `kanban_columns.board_id` — missing.
- `broker_groups.created_by_id` — missing.
- `users.invited_by_id` — used to find the inviting broker on referrer-submitted leads.

### How to add

Add idempotent `CREATE INDEX IF NOT EXISTS` statements next to the `_MIGRATIONS` block in `backend/app/main.py`:

```python
_INDEXES = [
    ("idx_loan_apps_user", "loan_applications", "user_id"),
    ("idx_loan_apps_status", "loan_applications", "status"),
    ("idx_loan_apps_created", "loan_applications", "created_at"),
    ("idx_loan_apps_deleted", "loan_applications", "deleted_at"),
    ("idx_loan_apps_contact", "loan_applications", "contact_id"),
    ("idx_loan_apps_org", "loan_applications", "business_organization_id"),
    ("idx_loan_apps_assigned_broker", "loan_applications", "assigned_broker_id"),
    ("idx_tasks_assigned", "tasks", "assigned_to_id"),
    ("idx_tasks_app", "tasks", "application_id"),
    ("idx_tasks_created_by", "tasks", "created_by_id"),
    ("idx_ext_ref_referrer", "external_referrals", "referrer_id"),
    ("idx_ext_ref_client", "external_referrals", "referred_client_id"),
    ("idx_ref_referrer", "referrals", "referrer_id"),
    ("idx_ref_user", "referrals", "referred_user_id"),
    ("idx_dm_created", "direct_messages", "created_at"),
    ("idx_activity_user", "activity_logs", "user_id"),
    ("idx_kanban_cols_board", "kanban_columns", "board_id"),
    ("idx_broker_groups_creator", "broker_groups", "created_by_id"),
    ("idx_users_invited_by", "users", "invited_by_id"),
]
with engine.begin() as conn:
    for name, table, col in _INDEXES:
        conn.execute(text(f"CREATE INDEX IF NOT EXISTS {name} ON {table}({col})"))
```

Also update the model files to add `index=True` so the same indexes get created on a fresh `Base.metadata.create_all(engine)` (e.g. fresh dev DBs / future Postgres switch).

### Composite indexes worth considering

These help only after the singles are in place:

- `loan_applications(tenant_id, status, deleted_at)` — the canonical `list_applications` filter shape; lets the planner use a single index covering the most common page query.
- `client_messages(client_id, application_id)` — covers both the per-app fetch and the per-conversation outside fetch.
- `external_referrals(referrer_id, referred_client_id)` — covers both directions of the referrer ↔ client lookup.

**Expected impact:** mid-five-figure-row tables move from sequential scans to index seeks. SQLite's planner won't lie to you — run `EXPLAIN QUERY PLAN` on a few hot queries before/after to confirm.

---

## 7. SQLite engine pragmas not set

**File:** `backend/app/database.py` (or wherever the engine is created)

By default `aiosqlite`/`sqlite3` uses `journal_mode=DELETE` and `synchronous=FULL`. For a multi-user admin portal this is the wrong tradeoff: writes block reads, and `fsync` happens on every commit.

### Fix

Add a one-time pragma run at engine creation:

```python
from sqlalchemy import event

@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_conn, _record):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")          # concurrent reads while writing
    cur.execute("PRAGMA synchronous=NORMAL")        # safe with WAL, ~10× faster commits
    cur.execute("PRAGMA cache_size=-65536")         # 64 MB page cache (negative = KB)
    cur.execute("PRAGMA temp_store=MEMORY")         # avoid /tmp for sort spills
    cur.execute("PRAGMA foreign_keys=ON")           # SQLite ships with FKs off by default
    cur.close()
```

`PRAGMA foreign_keys=ON` in particular is worth verifying — without it the `ON DELETE CASCADE` clauses on `application_brokers`, `checklist_items`, `lender_contacts`, and `kanban_columns` are no-ops and you can orphan rows.

**Expected impact:** WAL alone is the single biggest engine-level change. Concurrent admin sessions stop blocking each other on writes; commit latency drops noticeably. Cache size bump pays for itself any time a query scans more than a few hundred rows.

---

## 8. Wide `loan_applications` row pulled for every list

**File:** `backend/app/models/loan_application.py` (≈85 columns including text/JSON blobs like `analysis_result`, `lend_extra_data`, `client_sections`)

### Why it can hurt

Every `list_applications` page fetches the full row even though the table view only needs ~12 columns. With a 20-row page that's ~1700 columns serialized per request, including potentially-large JSON text fields.

### Fix

Use SQLAlchemy `load_only` on list endpoints:

```python
from sqlalchemy.orm import load_only

query = db.query(LoanApplication).options(
    load_only(
        LoanApplication.id, LoanApplication.user_id, LoanApplication.loan_type,
        LoanApplication.amount, LoanApplication.status, LoanApplication.created_at,
        LoanApplication.updated_at, LoanApplication.client_engagement_model,
        LoanApplication.business_name, LoanApplication.deleted_at,
        LoanApplication.kanban_column_id,
    ),
    joinedload(LoanApplication.user).load_only(User.id, User.full_name, User.email, User.role),
    selectinload(LoanApplication.brokers).load_only(User.id, User.full_name),
)
```

This also fixes `_app_with_user`'s `app.__table__.columns` walk — it'll still walk all column names, but unloaded columns won't have triggered the bytes-over-the-wire cost.

**Expected impact:** smaller payload, faster JSON serialise, less wire traffic. Useful on any list view.

---

## 9. Contact search fallback loads up to 2000 rows

**File:** `backend/app/routers/contacts.py:86-104`

### What it does

When the structured search (on the unencrypted `email` column) returns zero rows, it falls back to loading 2000 contacts and decrypting/scanning in Python.

### Why it exists

`first_name`, `last_name`, `phone` are stored encrypted. SQL `LIKE` can't operate on ciphertext.

### Options

1. **Add a separate searchable column** — store a lowercased, non-encrypted "search blob" (e.g. SHA-256 of the lowercased fragment, or a separate `search_name` column populated on write). Lets you index it.
2. **Use SQLite FTS5** virtual table mirroring decrypted searchable fields, keyed by `contact_id`. Decrypt-on-write, index-driven query.
3. **Cap the cap** — 2000 is arbitrary; consider 500 with a UI hint to refine search. Not a real fix, but contains the blast radius.

This isn't a problem today at small tenant size — flag it for when any tenant gets past ~1000 contacts.

---

## 10. Migration list is starting to sprawl

**File:** `backend/app/main.py:54-214` (≈ 160 columns added via idempotent `ALTER TABLE`)

### Current state

The startup-time migration list is already 160 entries. It's cached per-table via `_column_cache`, so the runtime cost is fine — but maintaining it is getting unwieldy, and there is no story for renames, drops, type changes, or down-migrations.

### Suggestion

If/when you switch to Postgres (per `POSTGRES.md`), introduce Alembic. The current list becomes an `op.add_column` sweep in one baseline migration, and every future schema change is a real diff with an associated revision. Until then, the existing pattern is fine.

---

## Suggested rollout order

Apply in this order — each step is independently revertible:

1. **#7 engine pragmas** (one file, biggest single engine win, enables `ON DELETE CASCADE`).
2. **#6 indexes** (idempotent `CREATE INDEX IF NOT EXISTS`, observable wins on any list page).
3. **#1 `app_with_user`** (touches one service + one router file, removes a per-row DB session leak).
4. **#3 contacts count**, **#2 conversation builder** (both are local N+1 fixes in their respective routers).
5. **#8 `load_only`** on list endpoints.
6. **#4 / #5 dashboard SQL aggregates** when the dashboard starts to feel slow.
7. **#9 / #10** when the relevant ceiling is in sight.

Validation: for each change, run `EXPLAIN QUERY PLAN` on the affected hot query before and after, and check that previously-`SCAN TABLE` lines became `SEARCH TABLE ... USING INDEX`. The SQL log (`echo=True` on the engine, locally) is the cheapest way to confirm N+1 fixes — count round-trips per request before and after.
