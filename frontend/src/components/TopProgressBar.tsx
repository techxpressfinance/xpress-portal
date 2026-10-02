import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { isNavigating, routeCommitted, subscribe } from '../lib/navProgress';

// Under this, a page change is quick enough that a bar would only flicker.
const SHOW_DELAY_MS = 120;

/**
 * A thin bar across the top of the window while a page is loading — from the
 * click until the new page and the data it asked for have arrived. It creeps
 * toward the end while waiting (no real percentage is known), then fills and
 * fades out.
 */
export default function TopProgressBar() {
  const navigating = useSyncExternalStore(subscribe, isNavigating);
  const { pathname } = useLocation();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const shownRef = useRef(false);

  // This runs after the new page's own effects, so its first requests are
  // already counted by the time the route is reported as rendered.
  useEffect(() => {
    routeCommitted();
  }, [pathname]);

  useEffect(() => {
    if (navigating) {
      const show = setTimeout(() => {
        shownRef.current = true;
        setVisible(true);
        setWidth(12);
      }, SHOW_DELAY_MS);
      // Ease toward 90% — each step covers part of what's left, so it slows
      // down rather than stalling at a fixed point.
      const creep = setInterval(() => {
        setWidth((w) => (w === 0 ? w : w + (90 - w) * 0.08));
      }, 200);
      return () => {
        clearTimeout(show);
        clearInterval(creep);
      };
    }
    if (!shownRef.current) return;
    // Done: fill, then fade, then reset off-screen for the next one.
    const fill = setTimeout(() => setWidth(100), 0);
    const hide = setTimeout(() => setVisible(false), 250);
    const reset = setTimeout(() => {
      shownRef.current = false;
      setWidth(0);
    }, 550);
    return () => {
      clearTimeout(fill);
      clearTimeout(hide);
      clearTimeout(reset);
    };
  }, [navigating]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[9999] h-[3px]"
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 300ms ease' }}
    >
      <div
        className="h-full bg-[var(--led-accent)] shadow-[0_0_8px_var(--led-accent)]"
        style={{
          width: `${width}%`,
          transition: width === 0 ? 'none' : 'width 200ms ease-out',
        }}
      />
    </div>
  );
}
