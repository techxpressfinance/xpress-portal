# Xpress Tech Portal — Design System Redesign Brief

A template to hand to Claude (or any designer/agent) when you want the portal's
visual language reworked. Everything in **Part 1–4** is factual context about
this repo as it stands — leave it alone. Fill in **Part 5** with what you want
from this particular pass, then paste the whole thing.

---

## Part 0 — How to use this brief

1. Fill in Part 5 (Scope of this pass). Delete nothing else.
2. Paste this file into a Claude Code session opened at the repo root.
3. Point it at `frontend/src/index.css` and `frontend/src/components/ui/` first —
   those two are the system; the 122 `.tsx` files are consumers.
4. Ask for the token/primitive layer **before** any screen work. A redesign that
   starts at the screen level will fork the design system a third time (see §3).

**Verification loop** — there is no test suite. The only automated gates are:

```bash
cd frontend && npm run build    # tsc -b && vite build — this is the typecheck
cd frontend && npm run lint
```

CI (`.github/workflows/deploy.yml`) runs `npm run lint` + `npx tsc --noEmit` on
push to main, then deploys to EC2. Both must pass. Visual verification is manual:
`npm run dev` on :5173.

---

## Part 1 — What the product is

A **multi-tenant loan-broking portal**. Australian finance brokers process loan
applications from intake to settlement. React 19 + TypeScript + Vite +
Tailwind 4, talking to a FastAPI backend.

**Five roles, four portal surfaces** — the design must serve all of them:

| Role | Surface | Who they are | What the UI must do |
|---|---|---|---|
| `super_admin` | `src/pages/platform/` (4 pages) | Platform operators | Manage tenants; dense, utilitarian |
| `admin` / `broker` | `src/pages/admin/` (31 pages) | Brokers — the power users | All day, every day. Density and speed beat delight |
| `client` | `src/pages/client/` (8 pages) | Loan applicants | Visit 2–3 times. Clarity and reassurance beat density |
| `referrer` | `src/pages/referrer/` (8 pages) | Partners sending deals | Occasional; part broker tooling, part marketing |
| — | `src/pages/*.tsx` | Public: login, register, `PublicApply`, password reset | First impression; unauthenticated, no chrome |

The broker surface and the client surface pull in **opposite directions** —
that tension is the central design problem, not a detail. A referrer's and a
client's application views must stay visually in sync (they render the same
form sections, gated by `client_sections`).

**Tenant branding**: each tenant supplies `logo_url` and `primary_color`
(`Tenant` in `src/types/index.ts:77`). Today only the logo is honoured
(`Layout.tsx:131`); `primary_color` is stored but unused. Any new system must
have a defined answer for tenant accent colour.

---

## Part 2 — The system as it exists today

### 2.1 Where it lives

- `frontend/src/index.css` — **1,567 lines**, single file, everything: fonts,
  both token sets, ~90 component classes, keyframes.
- `frontend/src/components/ui/` — 23 primitives, barrel-exported from
  `src/components/ui/index.ts`. Always import from the barrel.
- `frontend/src/lib/constants.ts` — status/role/badge colour maps.
- `frontend/src/components/Layout.tsx` — app shell: collapsible sidebar
  (`w-64` ↔ `w-[72px]`), mobile drawer, role-driven nav.

### 2.2 Typography

Self-hosted (`/fonts/*.woff2`, latin + latin-ext only — deliberately replaced a
render-blocking Google Fonts `<link>`; **do not reintroduce webfont CDN links**).

- **Inter** 400/500/600 — UI face. `letter-spacing: -0.011em` on body.
- **JetBrains Mono** — `.led-mono`, code and IDs.
- **`AppNumbers`** — a synthetic face aliasing JetBrains Mono over
  `U+0030-0039, U+0024, U+0025` **only** (digits, `$`, `%`). Deliberately
  excludes `.` and `,` — an earlier version included them and every full stop in
  prose rendered at monospace width. Money columns still align because
  `.ledger-theme` sets `font-variant-numeric: tabular-nums`.
- Scale is expressed in **px literals**, not Tailwind steps: `22px/600` page
  titles (`.led-h-page`), `14px` body, `13px` labels, `12px` captions.

### 2.3 Colour — two token sets, both live

**Set A — legacy shadcn-style semantic tokens.** `:root` and `.dark` in
`index.css:135` and `:172`, re-exported through `@theme inline` so Tailwind
generates `bg-card`, `text-muted-foreground`, `border-border`, etc.

```
--background --foreground --card --popover --primary --secondary
--muted --accent --destructive --success --warning --border --input --ring
--sidebar* --chart-1..5 --radius: 0.375rem
```

**Set B — the Ledger language.** Scoped to a `.ledger-theme` subtree
(`index.css:452`, dark at `:506`). This is the newer, intended direction.

```
--led-bg --led-bg-2 --led-surface --led-surface-2
--led-ink --led-ink-2 --led-muted --led-muted-2
--led-line --led-line-2 --led-line-strong
--led-accent --led-accent-hover --led-accent-tint --led-accent-tint-2 --led-accent-ink
--led-success/-tint --led-warning/-tint --led-danger/-tint --led-info/-tint --led-violet/-tint
--led-shadow-sm --led-shadow-md --led-shadow-lg
```

Accent is `oklch(0.35 0.1 260)` deep navy in light, flipping to a light
slate-ice `oklch(0.85 0.03 260)` in dark. Semantic colours are hex.

**Dark mode** is a `.dark` class on `<html>`, driven by `src/hooks/useTheme.ts`
(localStorage, falling back to `prefers-color-scheme`). Tailwind sees it via
`@custom-variant dark (&:is(.dark *))` at `index.css:133`. Ledger dark tokens
require **both**: `.dark .ledger-theme`. Note the ordering trap — a component
portalled to `document.body` escapes the `.ledger-theme` host and loses every
`--led-*` value. Existing modals work around this by re-wrapping
(`ArrearsDetailPanel.tsx:815`, `KanbanBoard.tsx:518`). Any new overlay must too.

### 2.4 The `.led-*` component vocabulary

~90 classes. The grammar to preserve:

- **Chips** `.led-chip` + `-accent -success -warning -danger -info -violet`,
  with `.led-chip-dot` for status.
- **Buttons** `.led-btn` + `-primary -accent -ghost -outline -danger`,
  `.led-btn-sm`, `.led-btn-icon`.
- **Inputs** `.led-input` (incl. `:-webkit-autofill` overrides).
- **Surfaces** `.led-card`, `.led-popover`, `.led-popover-item`.
- **Tables** `.led-table-wrap .led-table .led-sort-head .led-pagination .led-empty`.
- **Kanban** `.led-kanban-board/-scroller/-col/-card/…`, plus drop states
  `.led-drop-valid/-invalid/-same`.
- **Navigation** `.led-tabs .led-tab .led-nav-group .led-nav-title
  .led-filter-pill .led-search .led-segment`.
- **Misc** `.led-avatar` (+ `-stack`), `.led-sdot`, `.led-flash-row`,
  `.led-fade-up`.

### 2.5 Primitive contracts (do not break these APIs)

These are consumed across 122 files; changing a prop signature is a large,
separate refactor. Restyle freely — re-sign only if the brief says so.

```tsx
<Card padding="none|sm|md|lg" interactive />          // renders .led-card
<Button variant="primary|secondary|ghost|danger|success" size="sm|md|lg" loading />
<Badge type="status|role|custom" value label />        // renders .led-chip
<Input label error suffix />                           // password reveal built in
<Select label error />
<PageHeader title subtitle action />
<StatCard /> <EmptyState /> <Skeleton /> <Breadcrumbs /> <DatePicker />
<ConfirmDialog /> <TableSkeleton|ListSkeleton|DetailSkeleton|ChartSkeleton />
```

**Status semantics** (`src/lib/constants.ts`) — the meaning is fixed, the
palette is yours to change. Eight application statuses:

```
draft → (none)          application_received → info      application_assessed → violet
submitted → accent      approval → warning               settled → success
rejected → danger       not_proceeding → (none)
```

Same pattern for `ROLE_BADGE`, `OCR_STATUS_BADGE`, `ANALYSIS_STATUS_BADGE`,
`RISK_LEVEL_BADGE`, `RECOMMENDATION_BADGE`. All follow
`Record<Status, { label: string; className: string }>`. Two statuses currently
render with **no colour at all** (`draft`, `not_proceeding`) — decide whether
that is intent or a gap.

### 2.6 Motion

Keyframes in `index.css:282`: `fadeIn fadeInUp fadeInDown slideInRight
slideInLeft scaleIn shimmer toast-in toast-out`. House easing is
`cubic-bezier(0.25, 0.46, 0.45, 0.94)`; page transitions use
`cubic-bezier(0.22, 0.61, 0.36, 1)` at `0.18s`. `.btn-press` scales to `0.97`.
Loading is **shaped skeletons**, not spinners (`Skeletons.tsx`).
Scrollbars are 4px and transparent until hover. Focus is a 2px
`--primary` outline at 2px offset.

---

## Part 3 — Known problems (the actual brief)

Measured in this repo, not guessed. A redesign that fixes only #1 is already worth shipping.

1. **The system is forked in two and mid-migration.** Of 122 `.tsx` files:
   **38** use `--led-*`, **78** still use legacy `bg-card` / `text-muted-foreground`
   / `border-border` / `bg-background`, and **12 use both in the same file**.
   The primitives are already Ledger-native (`Card` → `.led-card`, `Button` →
   `.led-btn`) while their own internals still reach for legacy utilities —
   `Input.tsx` labels use `text-foreground`, `Badge`'s fallback is `bg-muted`.
   Two greys, two borders, two surfaces, resolving differently depending on
   whether an element happens to sit inside a `.ledger-theme` subtree.
2. **`.ledger-theme` is applied inconsistently.** It wraps `Layout`, the auth
   pages, `KanbanBoard`, `AllApplications` and the arrears modals — and nothing
   else. Most admin pages inherit it only through `Layout`; anything portalled
   out of that tree silently loses the palette. There is no rule for when to
   apply it.
3. **168 raw hex literals across `.tsx` files.** Worst: `client/ApplicationDetail.tsx`
   (28), `admin/ReviewApplication.tsx` (28), `QuoteSheetComparison.tsx` (22),
   `TaxInvoicePanel.tsx` (11). These are the surfaces most likely to break in
   dark mode, because a literal cannot flip.
4. **Layout escape hatches.** Full-bleed pages fight the shell with negative
   margins — `AllApplications.tsx:251` uses `margin: -24`, `KanbanBoard.tsx:1244`
   uses `-m-4 sm:-m-6 lg:-m-10`. There is no supported "full-bleed page" variant.
5. **Typography is px literals, not a scale.** No named steps, so every new
   screen re-picks sizes by eye.
6. **`primary_color` per tenant is captured and ignored.** Multi-tenant branding
   is a product promise the design system does not currently keep.
7. **One 1,567-line CSS file** holds fonts, two token systems, 90 component
   classes and all keyframes, with no internal boundaries.

---

## Part 4 — Hard constraints

- **Tailwind 4, CSS-first.** Tokens live in `@theme inline` in `index.css`.
  There is no `tailwind.config.js` and reintroducing one is not wanted.
- **Dark mode is class-based** (`.dark` on `<html>`), not `prefers-color-scheme`
  alone. Every colour must be defined in both. Never let a colour's only
  definition live in a dark block.
- **Self-hosted fonts only.** No CDN `<link>` — that regression was deliberately
  removed. New faces mean new `.woff2` files in `frontend/public/fonts/`.
- **Tabular numerals are non-negotiable** anywhere money appears: loan amounts,
  quote sheets, tax invoices, settlement figures, arrears ledgers.
- **Print/PDF surfaces** (`src/components/print/`) export via html2pdf with 10mm
  margins; page-break avoidance fails on grid children, so break-avoid classes
  must sit on block wrappers and print layouts cap around 1040px. Restyling these
  can silently break exports.
- **Portalled overlays must re-wrap in `.ledger-theme`** (§2.3).
- **Client and referrer application views must stay in sync.**
- **Barrel imports only** (`../../components/ui`), and `api` from
  `src/api/client.ts` — never raw axios.
- Australian finance context: AUD, `DD/MM/YYYY`, ABN/ACN formatting, GST.
- Accessibility floor: WCAG AA contrast in **both** themes, visible focus on all
  interactive elements, real `<label>`s, `aria-invalid`/`aria-describedby` on
  errors (the `Input` primitive already models this — match it).

---

## Part 5 — Scope of this pass  ✏️ *fill this in*

**Surfaces in scope:**
> _e.g. "the whole admin surface", "just the token layer + primitives", "client portal only"_

**Explicitly out of scope:**
> _e.g. "don't touch Kanban", "leave print/PDF alone", "no primitive API changes"_

**The problem I actually want solved:**
> _e.g. "it looks dated", "dark mode is patchy", "too cramped for clients",
> "doesn't feel like a $50k/yr product", "our tenants want their own branding"_

**Direction / references:**
> _Products whose feel you want. Name what specifically — density, restraint,
> typography, colour, motion. "Linear's density with Stripe's forms" is useful;
> "modern and clean" is not._

**Must survive untouched:**
> _Anything you like as-is._

**Appetite:**
> _"Token layer only, one afternoon" vs "systematic rebuild across all 122 files"._
> _This governs whether #1 in Part 3 is fixed properly or just contained._

---

## Part 6 — What to deliver

Work in this order. Do not skip to screens.

1. **Resolve the fork first.** Pick one token system and state the migration
   path for the other. Ledger is the intended direction — the strong default is
   to make `--led-*` canonical, redefine the legacy semantic tokens as aliases
   pointing at it (so all 78 legacy files keep working and drift toward
   correctness for free), then migrate files opportunistically. If you propose
   the reverse, justify it.
2. **A token layer**, both themes, every value semantic. Include the answer for
   tenant `primary_color`: which tokens it may drive, and how contrast is kept
   safe when a tenant picks something illegible.
3. **A named type scale** replacing px literals, with the tabular-numeral rule
   stated as part of it.
4. **Spacing, radius, elevation, border scales** — named steps, with the
   density difference between broker and client surfaces made explicit.
5. **Component specs** for the primitives in §2.5, covering **every state**:
   default, hover, active, focus-visible, disabled, loading, error, empty,
   skeleton — in both themes. States are where this system is currently thinnest.
6. **The shell**: sidebar expanded/collapsed/mobile-drawer, page header, and a
   supported full-bleed page variant that kills the negative-margin hacks (#4).
7. **A status-colour system** covering all eight statuses plus role, OCR,
   analysis, risk and recommendation badges — one coherent set, with a decided
   position on the two currently-colourless statuses.
8. **Motion rules**: which of the nine existing keyframes survive, and a stated
   `prefers-reduced-motion` position (there is currently none).
9. **A migration plan**: what changes in `index.css`, which files to convert in
   what order, and how to kill the 168 hex literals — highest-count files first.

**Rules for the receiving agent**

- Do not introduce a third design system. Extend or replace — never add.
- Every colour is a token. No new hex literals in `.tsx`.
- Show it in both themes or it isn't specified.
- Prefer changing `index.css` and `components/ui/` over touching 122 files.
- Run `npm run build` and `npm run lint` before claiming completion.
- Where the existing system already made a considered decision (the `AppNumbers`
  unicode-range, self-hosted fonts, shaped skeletons over spinners), keep it or
  argue explicitly against it. Those comments in `index.css` record real bugs.
