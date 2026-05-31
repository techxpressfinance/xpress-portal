# Repo Optimisation Opportunities (non-DB)

A companion to `DB_OPTIMIZATIONS.md`, covering the rest of the stack: backend I/O, blocking work, HTTP caching, frontend bundle, runtime cost, and dev/build hygiene.

Status: findings only — nothing has been applied.

Items are ranked roughly by impact-per-effort. Each lists where the problem lives, what's wrong, why it matters, and a fix.

---

## Backend

### 1. SES client is rebuilt per email; emails run in raw `threading.Thread` daemons

**File:** `backend/app/services/email.py:97-131`

```python
def _send_email(to_email, subject, body, html_body=None, cc_emails=None):
    try:
        ...
        client = boto3.client("ses", region_name=SES_REGION)        # ← per-call construction
        client.send_raw_email(...)
    except Exception as e:
        logger.error("Failed to send email to %s: %s", to_email, e)

def _send_async(*args, **kwargs):
    thread = threading.Thread(target=_send_email, args=args, kwargs=kwargs, daemon=True)
    thread.start()
```

**What's wrong**

1. `boto3.client(...)` reads `~/.aws/config`, loads endpoint resolvers, and constructs a Botocore session every time. For comparison, `services/s3_storage.py` already does this correctly with a cached `_s3_client`.
2. `threading.Thread(..., daemon=True).start()` is fire-and-forget. Daemon threads are killed mid-flight when the process exits, so the email log line can lie ("sent") when the SES PUT was actually torn down. There's also no concurrency cap — a status-change broadcast that hits 100 users spawns 100 OS threads.
3. FastAPI already exposes `BackgroundTasks` for exactly this case. It runs the work *after* the response is sent, in the request thread-pool (bounded), and the lifecycle is tracked.

**Fix**

- Lazy-cache the SES client just like `_get_s3_client`:
  ```python
  _ses_client = None
  def _get_ses_client():
      global _ses_client
      if _ses_client is None:
          _ses_client = boto3.client("ses", region_name=SES_REGION)
      return _ses_client
  ```
- Switch send sites to `background_tasks.add_task(_send_email, ...)` where a `BackgroundTasks` dep is already in scope. For non-request contexts (e.g. background OCR/Lend tasks) move to a small in-process queue or a real worker (Arq, RQ, or Celery later). At minimum, cap concurrent sends with a `BoundedSemaphore` or `concurrent.futures.ThreadPoolExecutor(max_workers=...)`.

**Impact**: removes a per-email Botocore construction cost (a few ms each) and removes the fire-and-forget thread leak risk under bursts.

---

### 2. `download_all_documents` zips everything into RAM before streaming

**File:** `backend/app/routers/documents.py:158-200`

```python
zip_buffer = io.BytesIO()
with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
    for doc in docs:
        contents = download_file(doc.file_path)  # whole file → bytes
        zf.writestr(name, contents)
zip_buffer.seek(0)
return StreamingResponse(zip_buffer, ...)
```

**What's wrong**

- Every document is fully downloaded from S3 into memory.
- The entire zip is materialised in `BytesIO` before any byte is sent — peak RSS = sum of all file sizes + their compressed sizes. For an application with 30 statements + IDs + contracts, that's easily several hundred MB.
- The response is "streamed" only after the zip is complete — the client sees no progress until the whole thing is staged server-side. TTFB grows linearly with document count.

**Fix**

Use `zipstream-ng` (or `zipfly`) plus S3 streaming reads:

```python
import zipstream

def _gen():
    z = zipstream.ZipFile(mode='w', compression=zipstream.ZIP_DEFLATED)
    for doc in docs:
        # download_file streams chunks; pass an iterator into zipstream
        z.write_iter(name, _iter_s3_chunks(doc.file_path, chunk_size=1 << 20))
    yield from z

return StreamingResponse(_gen(), media_type="application/zip", headers={...})
```

Pair with `boto3`'s `get_object()['Body'].iter_chunks(1 << 20)` so each S3 object is streamed not buffered.

**Impact**: constant memory regardless of bundle size, much smaller TTFB.

---

### 3. Uploads / downloads read whole files into memory

**File:** `backend/app/routers/documents.py:34-58` (`_process_upload`), `backend/app/services/s3_storage.py:46-53` (`download_file`)

```python
# routers/documents.py
contents = file.file.read()   # whole upload → bytes
...
storage_path = upload_file(contents, stored_name)

# services/s3_storage.py
def download_file(storage_path):
    resp = _get_s3_client().get_object(Bucket=S3_BUCKET_NAME, Key=storage_path)
    return resp["Body"].read()   # whole object → bytes
```

**What's wrong**

The portal handles bank statements and contracts — single uploads can be 20–50 MB. With Uvicorn's default `BodySizeLimitMiddleware` permitting these, every concurrent upload pins that many bytes in RSS, then again when re-read for OCR.

**Fix**

- Upload: stream `file.file` directly to S3 with `boto3.client.upload_fileobj(file.file, Bucket, Key)`. It chunks under the hood and handles multipart for >5 MB.
- Download (for serving): use `StreamingResponse` over `resp["Body"].iter_chunks(1 << 20)` instead of returning bytes.
- For OCR/analysis pipelines that *do* need the full file, accept that — but stash to a tempfile (`tempfile.NamedTemporaryFile`) and pass the path, not the bytes, between steps.

**Impact**: peak memory drops from `O(file size × concurrency)` to constant.

---

### 4. No HTTP caching on read endpoints

Searches for `Cache-Control`, `ETag` in `backend/app/` return only the HSTS header. Every `GET /api/applications`, `/api/users/me`, `/api/lenders`, etc. re-runs server-side and re-serialises on every navigation, and the browser cannot reuse a previous response even when the underlying data hasn't changed.

**Fix**

- For relatively static lookups (e.g. `/api/lenders`, `/api/tenants`, `/api/users/me` once authenticated), send a short `Cache-Control: private, max-age=30` with an `ETag` derived from the row count + max `updated_at`. FastAPI gives you `Response.headers` directly.
- For lists, support `If-None-Match` and reply `304 Not Modified` when the ETag matches — no body, no JSON serialisation.
- For per-resource detail (e.g. `/api/applications/{id}`), use `updated_at` as a weak ETag; on `If-None-Match` reply 304.

**Impact**: client-side and intermediary caching cuts duplicate GETs. The Layout.tsx unread-count poller (item 8 below) and tab-switch refetches are the obvious beneficiaries.

---

### 5. Sync endpoints dispatched through FastAPI threadpool, but heavy ones do CPU-bound work there

FastAPI runs `def` (non-async) endpoints in `anyio`'s thread pool. The default cap is 40 worker threads. Endpoints that do CPU-heavy work (PDF/zip generation, in-memory JSON serialisation of huge `loan_applications` rows, OCR result post-processing) hold those threads for the duration. Under burst load you can saturate the pool and stall *all* sync endpoints — including auth.

**Fix**

- Move actually-CPU-bound operations off the request path. OCR and LLM analysis already use `BackgroundTasks` — good. The remaining sinners are document zip and quote-sheet PDF generation; both should be queued and polled, not synchronous.
- For everything else (most CRUD routes), the sync-in-threadpool pattern is fine.

**Impact**: prevents pool exhaustion when one user kicks off a big download.

---

### 6. Logging middleware on every request, no sampling

`RequestLoggingMiddleware` runs on every request. For the polling `unread-count` (1/min/user) and the GA-style tracking that comes from many tabs, this adds steady log volume + I/O.

**Fix**

- Don't log `200`s for `/api/messages/unread-count` and `/api/health` (allowlist filter).
- Or: log structured (JSON) and let the log aggregator sample.

**Impact**: smaller, more readable logs; less disk I/O on a small EC2.

---

### 7. `database.py` engine has no pool sizing or `pool_pre_ping`

While the project is on SQLite the engine settings are mostly moot, but the same code path will run on Postgres per `POSTGRES.md`. Without explicit `pool_size`, `max_overflow`, and `pool_pre_ping=True`, the engine reuses stale connections after a DB restart and serialises requests under burst load.

**Fix**

```python
engine = create_engine(
    DATABASE_URL,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,            # detect dropped connections
    pool_recycle=1800,             # avoid Postgres `wait_timeout` resets
    future=True,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
```

**Impact**: smooth Postgres cutover; no surprise 500s after a DB blip.

---

### 8. Startup-time work runs on every worker

`backend/app/main.py` runs migrations, backfills, seeding, default-board creation, soft-delete purge, and expired-token cleanup at *import* time — i.e. on every Uvicorn worker boot. With more than one worker (and Gunicorn fork model) all of those run N times concurrently and race each other on `INSERT`s.

**Fix**

- Gate the one-shot work behind a single startup hook using `@app.on_event("startup")` *and* a file/row lock so only one worker performs it:
  ```python
  with engine.begin() as conn:
      # SQLite: BEGIN IMMEDIATE; Postgres: SELECT pg_advisory_lock(123)
      conn.execute(text("INSERT OR IGNORE INTO startup_locks (id) VALUES ('boot')"))
      if not _already_initialised(conn):
          _run_migrations(conn)
          _backfill(conn)
          _seed_super_admin(conn)
          conn.execute(text("UPDATE startup_locks SET done = TRUE WHERE id = 'boot'"))
  ```
- Move the soft-delete purge and token cleanup into a real scheduler (cron, APScheduler, or a periodic `BackgroundTasks` task triggered by the first request after midnight). Doing them on boot means they only run when you redeploy.

**Impact**: faster cold starts, no inter-worker races, regular purges actually happen.

---

### 9. `referrer/Dashboard.tsx`-style endpoints that fan out queries

Several endpoints (e.g. `routers/messages.py:list_client_inbox`, `routers/dashboard.py:dashboard_stats`, `routers/applications.py:list_applications`) issue 8–15 queries serially per request. With SQLite locally these are <100 µs each so latency is fine, but on Postgres-over-network it adds up.

**Fix**

- Use `selectinload` / `joinedload` where dependencies follow FKs.
- For independent aggregates (dashboard counts, weekly/monthly trends, action items, leaderboards), execute them concurrently — `asyncio.gather` over `run_in_threadpool` invocations, or simply group them into one `WITH ... SELECT ... UNION ALL` if they share a base filter.

**Impact**: per-page latency cut roughly to the longest single query.

---

## Frontend

### 10. No manual chunks; `html2pdf.js` and `recharts` are in the main graph

**File:** `frontend/vite.config.ts`, `frontend/src/lib/pdfExport.ts:1`, `frontend/src/pages/admin/Dashboard.tsx:3-13`

The Vite config is the default. That means a single page route can pull `recharts` (≈ 90 KB gzip), `html2pdf.js` (which transitively bundles `html2canvas` and `jspdf` — ≈ 250 KB gzip combined) into a chunk that *might* be larger than necessary.

`lib/pdfExport.ts:1` does:

```ts
import html2pdf from 'html2pdf.js';
```

…so any module that imports `pdfExport` pulls the whole PDF toolchain into its chunk graph even if the user never clicks "Export PDF".

**Fix**

- Dynamic-import the PDF stack at call time:
  ```ts
  export async function exportPdf(element: HTMLElement, ...) {
      const { default: html2pdf } = await import('html2pdf.js');
      ...
  }
  ```
- Split `recharts` into its own chunk via Vite's `manualChunks`:
  ```ts
  build: {
      rollupOptions: {
          output: {
              manualChunks: {
                  charts: ['recharts'],
                  pdf: ['html2pdf.js'],
                  vendor: ['react', 'react-dom', 'react-router-dom'],
              },
          },
      },
  }
  ```
- Verify with `vite build --report` (or `rollup-plugin-visualizer`) before/after.

**Impact**: first-paint JS payload typically drops 200–400 KB transferred; admin/client/referrer routes that don't render charts skip the chart code entirely.

---

### 11. Unread-count poller keeps running on hidden tabs

**File:** `frontend/src/components/Layout.tsx:79-88`

```ts
useEffect(() => {
    fetchUnreadCount();
    unreadIntervalRef.current = setInterval(fetchUnreadCount, 60_000);
    const onEvent = () => fetchUnreadCount();
    // ...
}, [fetchUnreadCount]);
```

**What's wrong**

The interval fires every minute even when the tab is hidden, the laptop is on battery, or the user is logged out. Multiplied across staff who keep the portal open in a side-tab, that's continuous DB+network work for nothing.

**Fix**

- Skip the request when `document.visibilityState !== 'visible'`.
- Re-fetch immediately on `visibilitychange` → `visible`.
- Stop the interval when an auth failure occurs (currently it logs 401s forever after token expiry/logout race).

```ts
useEffect(() => {
    function tick() {
        if (document.visibilityState !== 'visible') return;
        fetchUnreadCount();
    }
    tick();
    const id = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
        clearInterval(id);
        document.removeEventListener('visibilitychange', tick);
    };
}, [fetchUnreadCount]);
```

**Impact**: real-world request volume drops by ~70 % (typical share of time tabs spend hidden); browser power profiling stops yelling.

---

### 12. Several monster route files (2 000–2 700 LOC) with little memoisation

**Files (LOC, partial sample):**
- `client/NewApplication.tsx` — 2 683
- `admin/ReviewApplication.tsx` — ~2 700
- `client/ApplicationDetail.tsx` — 2 221
- `referrer/AddLead.tsx` — 1 762
- `referrer/ApplicationDetail.tsx` — 2 060

A `grep` over `ReviewApplication.tsx` finds only ~2 `useMemo`/`useCallback`/`memo` usages in the whole file. These pages render dozens of children that take new closure props on every render, so any keystroke in any input re-renders the whole tree.

**Fix**

- For per-row children (note list, document list, message list, alert list), extract them to small components wrapped in `React.memo`. Pass primitive props or stable callbacks via `useCallback`.
- For the forms themselves, `react-hook-form` is already in deps. Confirm the heavy pages use it (it isolates renders to the field being typed in). The huge `NewApplication.tsx` and `AddLead.tsx` are the highest-value migration targets if they aren't already.
- Pull derived data (`useMemo`) for the filter/sort lists currently recomputed every render.

**Impact**: typing latency in long forms stops correlating with row count further down the page; opening dropdowns no longer hitches.

---

### 13. Sequential `api.*` calls where parallel would do

Spot-checked `admin/ReviewApplication.tsx` — 16 distinct `api.get`/`api.post` calls, the initial-load section has only one `Promise.all`. The rest are individual awaits or naked `.then` chains, which serialise their HTTP requests.

**Fix**

Audit each `useEffect(() => { ... }, [id])` and consolidate independent initial-load fetches into a single `Promise.allSettled`:

```ts
useEffect(() => {
    if (!id) return;
    Promise.allSettled([
        api.get(`/applications/${id}`),
        api.get(`/applications/${id}/notes`),
        api.get(`/documents/application/${id}`),
        api.get(`/documents/requests/${id}`),
        api.get(`/applications/${id}/quote-sheets`),
        api.get(`/applications/${id}/calculators`),
    ]).then(([app, notes, docs, reqs, quotes, calcs]) => { ... });
}, [id]);
```

The admin dashboard already does this (`pages/admin/Dashboard.tsx:139`) — good pattern, just apply consistently.

**Impact**: detail-page first-render TTI drops from `Σ latencies` to `max(latencies)`.

---

### 14. No HTTP request deduplication or response cache on the client

The `api/client.ts` axios wrapper has no notion of an in-flight request map, response cache, or stale-while-revalidate. When two components on the same page each `api.get('/users/me')` during initial load (which happens — `useAuth` plus a header), both fire over the wire.

**Fix**

- Smallest possible change: a tiny in-module Map keyed by `method+URL+stringified-params` whose values are the in-flight `Promise`. On a duplicate request before the first resolves, return the cached promise.
- Larger but more useful: adopt `@tanstack/react-query`. Built-in dedupe, cache, stale-time, retry, mutation states. Removes a lot of `useEffect(..., [id])` plumbing.

**Impact**: fewer duplicate calls during navigation; smoother optimistic updates.

---

### 15. No `loading="lazy"` / image responsiveness audit (informational)

There's nothing user-supplied being rendered as `<img>` in the routes I've sampled (this is a forms-heavy app). Worth scanning for raw `<img>` tags before the next round of design work — set `loading="lazy"` and `decoding="async"` on any below-the-fold images, and use `srcSet` if uploaded assets vary in DPR.

No immediate action — flag for future.

---

### 16. Bundle compression at the edge

Vite produces uncompressed JS in `dist/`. Whatever serves it (Nginx, S3+CloudFront) needs to be configured to send `Content-Encoding: br` (preferred) or `gzip`. Verify in DevTools' Network panel that responses for `/assets/*.js` come back with `content-encoding: br`. If not, either flip the server flag or precompress with `vite-plugin-compression`.

---

## Build / dev hygiene

### 17. No bundle analyser in the build

Add `rollup-plugin-visualizer` so each `pnpm build` produces a `stats.html` — invaluable when chasing item #10.

```ts
import { visualizer } from 'rollup-plugin-visualizer';
plugins: [react(), tailwindcss(), visualizer({ open: false, filename: 'dist/stats.html' })]
```

### 18. TypeScript `tsc -b` runs before `vite build`

The `build` script in `frontend/package.json` is `tsc -b && vite build`. Vite already type-checks via the IDE/eslint; running `tsc -b` on every CI build is the right choice for safety but doubles cold-build time. If CI build minutes ever bite, switch to `vite build` only and run `tsc -b` in a separate, parallel CI job. (Don't drop type-checking — just stop serialising it.)

### 19. CI: no caching key for `pip` / `pnpm`

Not visible in the repo snapshot, but worth confirming `.github/workflows/*` caches:
- `actions/setup-python` with `cache: 'pip'`
- `actions/setup-node` with `cache: 'pnpm'`

Saves 30–90s per CI run.

### 20. `cookies.txt` and `login-ssh.pem` in repo root

Not an "optimisation" but a flag: these look like they may have been committed by accident. `cookies.txt` is harmless if it's a sample; `login-ssh.pem` looks like a real private key. If it is, rotate it immediately and add both to `.gitignore`. Check with `git log -- login-ssh.pem` for the history.

---

## Suggested rollout order

1. **#11 Layout poller** — single file, immediate win in real-world request volume.
2. **#1 SES client + email background tasks** — single file, removes unbounded threading.
3. **#10 Bundle splitting + dynamic PDF import + #17 visualiser** — one Vite config change + one import change; observable JS payload drop.
4. **#8 Startup work behind a lock + scheduler** — important before scaling to multiple workers.
5. **#4 HTTP caching on stable GETs** — pair with the unread-count work for compounding wins.
6. **#7 engine pool sizing** — do this before the Postgres cutover, not after.
7. **#2 streaming zip + #3 streaming upload/download** — defer until a customer hits memory pressure or a large bundle export.
8. **#13 `Promise.all` consolidation, #12 memoisation, #14 client cache** — incremental UX wins per page, do alongside route refactors.
9. **#5 / #6 / #9 / #15 / #16 / #18 / #19** — opportunistic, no urgency.
10. **#20 secrets in repo root** — verify and rotate immediately if real.

For each change, the validation is the same: measure before, measure after, in the same way. Network panel for #10/#11/#13/#14. `time curl …` or the request-log timing column for backend items. `du -sh dist/assets` or the visualiser HTML for bundle work.
