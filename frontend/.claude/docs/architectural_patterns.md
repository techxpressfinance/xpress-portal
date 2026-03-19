# Architectural Patterns

## 1. Authentication: In-Memory Access Token + localStorage Refresh Token

Access tokens are stored in a module-scoped variable (never localStorage), while refresh tokens persist in localStorage for session survival across page reloads.

**Flow:**
1. Login/register → API returns `access_token` + `refresh_token` (`src/contexts/AuthContext.tsx:58-61`)
2. Access token stored via `setAccessToken()` in module closure (`src/api/client.ts:7-11`)
3. Refresh token stored in `localStorage` (`src/contexts/AuthContext.tsx:60`)
4. On page load, AuthProvider attempts silent refresh using stored refresh token (`src/contexts/AuthContext.tsx:37-55`)
5. Request interceptor attaches Bearer token to every API call (`src/api/client.ts:17-22`)
6. Response interceptor catches 401s, attempts refresh, retries original request (`src/api/client.ts:24-49`)

**Convention:** The `_retry` flag on the request config prevents infinite refresh loops (`src/api/client.ts:29`).

## 2. Context + Hook Pattern for Global State

Each piece of global state follows: Context → Provider (wraps app) → custom hook (consumes context).

| State | Context | Provider | Hook | File |
|-------|---------|----------|------|------|
| Auth | `AuthContext` | `AuthProvider` | `useAuth()` | `src/contexts/AuthContext.tsx` |
| Toast | `ToastContext` | `ToastProvider` | `useToast()` | `src/components/Toast.tsx` |
| Theme | — | — | `useTheme()` | `src/hooks/useTheme.ts` |

Provider tree order: `ErrorBoundary` → `BrowserRouter` → `AuthProvider` → `ToastProvider` (`src/App.tsx:30-33`).

Theme is a standalone hook (no context) since it only uses `localStorage` + `document.documentElement`.

## 3. Role-Based Route Protection

Routes are protected via a `<ProtectedRoute>` wrapper that accepts an optional `roles` array.

**Logic** (`src/components/ProtectedRoute.tsx:10-38`):
1. If `loading` → show spinner (prevents flash of login page)
2. If no `user` → redirect to `/login`
3. If `roles` specified and user's role not included → redirect to `/`
4. Otherwise → render children

**Role hierarchy in navigation:** The `Layout` component conditionally renders different nav items based on `user.role` (`src/components/Layout.tsx:82-114`). Admin-only routes (like `/admin/users`) have an additional role check at `src/components/Layout.tsx:107`.

## 4. UI Component Variant/Size Pattern

All UI primitives use a consistent props pattern:
- `variant` prop with `Record<Variant, string>` mapping to Tailwind classes
- `size` prop with `Record<Size, string>` mapping to Tailwind classes
- Props extend native HTML element attributes

**Examples:**
- `Button`: variants `primary|secondary|ghost|danger|success`, sizes `sm|md|lg` (`src/components/ui/Button.tsx:3-30`)
- `Badge`: uses status-to-class mapping from `src/lib/constants.ts:3-9`
- `StatCard`: accepts `gradient` string for dynamic background (`src/components/ui/StatCard.tsx`)

**Barrel export:** All UI components re-exported from `src/components/ui/index.ts`. Always import from the barrel.

## 5. Data Fetching: useEffect + Local State

Pages fetch their own data using `useEffect` on mount with the `api` client. There is no global data cache or query library.

**Standard pattern** (seen in every page component):
```
const [data, setData] = useState<Type[]>([]);
const [loading, setLoading] = useState(true);

useEffect(() => {
  api.get('/endpoint')
    .then(({ data }) => setData(data.items))
    .catch(() => {})
    .finally(() => setLoading(false));
}, []);
```

**Files using this pattern:**
- `src/pages/client/Dashboard.tsx:11-20`
- `src/pages/admin/Dashboard.tsx` (multiple fetches)
- `src/pages/client/Applications.tsx`
- `src/pages/admin/AllApplications.tsx`
- `src/pages/admin/ActivityLogs.tsx`

**Error handling in mutations:** Try/catch with `useToast()` for user feedback (`src/pages/client/NewApplication.tsx`).

## 6. Paginated API Response Convention

The backend returns paginated data as `PaginatedResponse<T>` (`src/types/index.ts:50-55`):
```ts
{ items: T[], total: number, page: number, per_page: number }
```

All list endpoints return this shape. Frontend accesses `data.items` for the array.

## 7. Status-Driven UI with Constant Maps

Display properties (colors, labels, icons) for domain enums are centralized in `src/lib/constants.ts` as `Record<EnumType, DisplayConfig>` maps:

| Map | Purpose | Line |
|-----|---------|------|
| `STATUS_BADGE` | Application status → Tailwind badge classes | `constants.ts:3` |
| `KYC_CONFIG` | KYC status → color, bg, label, gradient | `constants.ts:11` |
| `ROLE_BADGE` | User role → Tailwind badge classes | `constants.ts:17` |
| `DOC_TYPE_LABELS` | Doc type enum → human label | `constants.ts:23` |
| `LOAN_TYPE_ICONS` | Loan type → emoji | `constants.ts:32` |
| `ACTION_LABELS` | Activity action → human label | `constants.ts:39` |
| `VALID_TRANSITIONS` | Status → allowed next statuses | `constants.ts:48` |

**Convention:** When adding a new enum value, update all relevant maps in this file.

## 8. Layout Architecture

The app uses a single shared `Layout` component as a route wrapper (`src/App.tsx:37`):
- Login/Register pages render outside the layout (no sidebar)
- All other pages render inside via React Router's `<Outlet />` (`src/components/Layout.tsx:219`)
- Layout handles: collapsible sidebar, mobile hamburger menu, theme toggle, user avatar, logout
- Sidebar collapse state persists to `localStorage` (`src/components/Layout.tsx:21`)

## 9. CSS Architecture: Tailwind + CSS Custom Properties

The styling system (`src/index.css`) uses:
- **OKLch color space** for perceptually uniform theming
- **CSS custom properties** on `:root` (light) and `.dark` (dark) for all colors
- **Semantic color names**: `--primary`, `--destructive`, `--success`, `--muted`, `--sidebar-*`
- **Custom animation classes**: `stagger-children`, `page-enter`, `glass-card`, `shimmer`, `btn-press`

**Convention:** Use semantic Tailwind classes (`bg-primary`, `text-muted-foreground`) not raw color values. All colors adapt automatically to light/dark mode via CSS variables.

## 10. Form Pattern: React Hook Form

Forms use `react-hook-form` with the `register` function for field binding and built-in validation.

**Pattern** (seen in Login, Register, NewApplication):
- `useForm<FormType>()` for typed form state
- `register('field', { required: true })` spread onto `<Input>` components
- `handleSubmit(onSubmit)` on form element
- Error display via `errors.field?.message` passed to Input's `error` prop

**Reference:** `src/pages/client/NewApplication.tsx`, `src/pages/Login.tsx`, `src/pages/Register.tsx`
