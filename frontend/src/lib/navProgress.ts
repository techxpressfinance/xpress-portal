/**
 * Navigation progress: whether a page change is still loading.
 *
 * React Router v7 runs navigations as transitions, so clicking through to a
 * page whose code hasn't downloaded yet leaves the old page on screen with no
 * sign anything is happening. This store starts the moment the URL's path
 * changes, follows the API requests the new page fires as it mounts, and
 * finishes once they have all come back. `TopProgressBar` draws it.
 *
 * Only requests made while a navigation is in flight are counted, so the
 * background polling (notifications, analysis status) never lights the bar.
 */

type Listener = () => void;

const SAFETY_TIMEOUT_MS = 15000;
// After the page renders, and after each request settles, wait this long
// before calling the page loaded. Pages often fire their first request a beat
// late (once auth or filters settle) or chain one off another's result; this
// catches those instead of finishing between them.
const SETTLE_MS = 250;

let active = false;
let committed = false;
let pending = 0;
let safety: ReturnType<typeof setTimeout> | undefined;
let settle: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

function finish() {
  if (!active) return;
  active = false;
  committed = false;
  pending = 0;
  clearTimeout(safety);
  clearTimeout(settle);
  emit();
}

/** Finish once nothing has been in flight for SETTLE_MS. */
function scheduleFinish() {
  clearTimeout(settle);
  if (!active || !committed || pending > 0) return;
  settle = setTimeout(() => {
    if (active && committed && pending === 0) finish();
  }, SETTLE_MS);
}

export function startNavigation() {
  committed = false;
  pending = 0;
  clearTimeout(safety);
  clearTimeout(settle);
  // A request that never settles must not leave the bar up for good.
  safety = setTimeout(finish, SAFETY_TIMEOUT_MS);
  if (!active) {
    active = true;
    emit();
  }
}

/** The new route has rendered. Its mount-time requests are already counted
 *  (child effects run before this one), so it is done once they settle. */
export function routeCommitted() {
  committed = true;
  scheduleFinish();
}

/** Called by the API client as a request goes out; returns whether it was
 *  counted, which the client passes back to `requestSettled`. */
export function requestStarted(): boolean {
  if (!active) return false;
  pending += 1;
  clearTimeout(settle);
  return true;
}

export function requestSettled() {
  pending = Math.max(0, pending - 1);
  scheduleFinish();
}

export function isNavigating() {
  return active;
}

export function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Start on every client-side change of path: link clicks and navigate() go
 * through pushState, back/forward through popstate. A query-only change (a tab
 * switch writing ?tab=) is not a page change and doesn't count.
 */
export function installNavigationHooks() {
  const wrap = (method: 'pushState' | 'replaceState') => {
    const original = history[method];
    history[method] = function (this: History, data: unknown, unused: string, url?: string | URL | null) {
      if (url != null) {
        const next = new URL(String(url), window.location.href);
        if (next.pathname !== window.location.pathname) startNavigation();
      }
      return original.call(this, data, unused, url);
    };
  };
  wrap('pushState');
  wrap('replaceState');
  window.addEventListener('popstate', startNavigation);
}
