import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';

export interface TourStep {
  target?: string;
  title: string;
  body: string;
  route?: string;
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'auto';
}

interface Props {
  steps: TourStep[];
  open: boolean;
  onClose: () => void;
  onFinish?: () => void;
}

const TOOLTIP_W = 340;
const TOOLTIP_GAP = 14;
const HIGHLIGHT_PAD = 8;

// Easing curves
const EASE_OUT = 'cubic-bezier(0.32, 0.72, 0, 1)'; // smooth, slightly springy
const EASE_IN_OUT = 'cubic-bezier(0.4, 0, 0.2, 1)';

// Durations (ms)
const DUR_FADE = 260;
const DUR_SPOTLIGHT = 480;
const DUR_TOOLTIP = 380;
const DUR_CONTENT = 220;

export default function OnboardingTour({ steps, open, onClose, onFinish }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // Mount/visible state for fade-in/out
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  // Content key bumps each step → re-triggers content fade animation
  const [contentKey, setContentKey] = useState(0);
  const [, force] = useState(0);
  const prevIndexRef = useRef(index);

  const step = steps[index];

  // Handle mount/unmount with fade
  useEffect(() => {
    if (open) {
      setMounted(true);
      // Next frame, flip visible to trigger fade-in
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }
    if (!open && mounted) {
      setVisible(false);
      const id = setTimeout(() => setMounted(false), DUR_FADE);
      return () => clearTimeout(id);
    }
  }, [open, mounted]);

  // Reset index when (re-)opening
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  // Bump content key on step change to re-run content fade animation
  useEffect(() => {
    if (prevIndexRef.current !== index) {
      setContentKey((k) => k + 1);
      prevIndexRef.current = index;
    }
  }, [index]);

  // Navigate to step's route if needed. Only clear `ready` so we wait for the
  // new target; keep `rect` so the spotlight transitions smoothly to the new
  // position instead of flashing to the corner.
  useEffect(() => {
    if (!open || !step) return;
    if (!step.target) {
      // Centered modal — clear spotlight so backdrop fades to solid
      setRect(null);
    }
    if (step.route && location.pathname !== step.route) {
      navigate(step.route);
    }
  }, [open, index]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve target element (retry until DOM ready)
  useLayoutEffect(() => {
    if (!open || !step) return;
    if (!step.target) {
      setRect(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempt = (tries = 0) => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (el) {
        try {
          el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        } catch {
          el.scrollIntoView();
        }
        timer = setTimeout(() => {
          if (cancelled) return;
          setRect(el.getBoundingClientRect());
        }, 260);
      } else if (tries < 30) {
        timer = setTimeout(() => attempt(tries + 1), 100);
      } else {
        setRect(null);
      }
    };
    attempt();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, index, location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recalc rect on resize/scroll
  useEffect(() => {
    if (!open || !step?.target) return;
    const recalc = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (el) setRect(el.getBoundingClientRect());
      force((n) => n + 1);
    };
    window.addEventListener('resize', recalc);
    window.addEventListener('scroll', recalc, true);
    return () => {
      window.removeEventListener('resize', recalc);
      window.removeEventListener('scroll', recalc, true);
    };
  }, [open, step]);

  const next = useCallback(() => {
    if (index < steps.length - 1) {
      setIndex((i) => i + 1);
    } else {
      onFinish?.();
      onClose();
    }
  }, [index, steps.length, onClose, onFinish]);

  const back = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, next, back, onClose]);

  if (!mounted || !step) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const isMobile = vw < 640;

  // Compute tooltip position
  let tooltipStyle: React.CSSProperties = {};
  const isCenter = !rect;

  if (isMobile) {
    tooltipStyle = {
      left: 12,
      right: 12,
      bottom: 12,
      width: 'auto',
      maxWidth: 'calc(100vw - 24px)',
    };
  } else if (isCenter) {
    tooltipStyle = {
      left: vw / 2 - TOOLTIP_W / 2,
      top: vh / 2 - 100,
      width: TOOLTIP_W,
    };
  } else {
    const placements: Array<NonNullable<TourStep['placement']>> =
      step.placement && step.placement !== 'auto'
        ? [step.placement]
        : ['bottom', 'right', 'top', 'left'];

    const TOOLTIP_H_ESTIMATE = 200;
    let chosen: { top: number; left: number } | null = null;

    for (const p of placements) {
      let t = 0;
      let l = 0;
      if (p === 'bottom') {
        t = rect.bottom + TOOLTIP_GAP;
        l = rect.left + rect.width / 2 - TOOLTIP_W / 2;
        if (t + TOOLTIP_H_ESTIMATE <= vh - 8) {
          chosen = { top: t, left: l };
          break;
        }
      } else if (p === 'top') {
        t = rect.top - TOOLTIP_GAP - TOOLTIP_H_ESTIMATE;
        l = rect.left + rect.width / 2 - TOOLTIP_W / 2;
        if (t >= 8) {
          chosen = { top: t, left: l };
          break;
        }
      } else if (p === 'right') {
        t = rect.top + rect.height / 2 - TOOLTIP_H_ESTIMATE / 2;
        l = rect.right + TOOLTIP_GAP;
        if (l + TOOLTIP_W <= vw - 8) {
          chosen = { top: t, left: l };
          break;
        }
      } else if (p === 'left') {
        t = rect.top + rect.height / 2 - TOOLTIP_H_ESTIMATE / 2;
        l = rect.left - TOOLTIP_GAP - TOOLTIP_W;
        if (l >= 8) {
          chosen = { top: t, left: l };
          break;
        }
      }
    }

    if (!chosen) {
      chosen = {
        top: vh / 2 - TOOLTIP_H_ESTIMATE / 2,
        left: vw / 2 - TOOLTIP_W / 2,
      };
    }

    tooltipStyle = {
      left: Math.max(8, Math.min(chosen.left, vw - TOOLTIP_W - 8)),
      top: Math.max(8, Math.min(chosen.top, vh - TOOLTIP_H_ESTIMATE - 8)),
      width: TOOLTIP_W,
    };
  }

  const showSpotlight = !!rect;

  // Tooltip enter transform: subtle scale-up on mount
  const tooltipTransform = visible ? 'scale(1)' : 'scale(0.96)';

  return createPortal(
    <div
      className="fixed inset-0 z-[100]"
      style={{
        pointerEvents: 'auto',
        opacity: visible ? 1 : 0,
        transition: `opacity ${DUR_FADE}ms ${EASE_IN_OUT}`,
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Onboarding tour"
    >
      {/* Backdrop: a solid layer below + a spotlight cutout above.
          The solid layer always exists, so the spotlight can slide
          between targets without the dim background flashing. */}
      <div
        className="absolute inset-0"
        style={{
          background: 'rgba(0,0,0,0.55)',
          opacity: showSpotlight ? 0 : 1,
          transition: `opacity ${DUR_FADE}ms ${EASE_IN_OUT}`,
          pointerEvents: 'none',
        }}
      />

      {/* Spotlight box with the giant box-shadow creating the cutout */}
      <div
        className="absolute rounded-xl"
        style={{
          left: rect ? rect.left - HIGHLIGHT_PAD : vw / 2 - 40,
          top: rect ? rect.top - HIGHLIGHT_PAD : vh / 2 - 40,
          width: rect ? rect.width + HIGHLIGHT_PAD * 2 : 80,
          height: rect ? rect.height + HIGHLIGHT_PAD * 2 : 80,
          opacity: showSpotlight ? 1 : 0,
          boxShadow:
            '0 0 0 9999px rgba(0,0,0,0.55), 0 0 0 2px var(--led-accent, #2563eb), 0 0 22px 6px rgba(37,99,235,0.35)',
          transition: `left ${DUR_SPOTLIGHT}ms ${EASE_OUT}, top ${DUR_SPOTLIGHT}ms ${EASE_OUT}, width ${DUR_SPOTLIGHT}ms ${EASE_OUT}, height ${DUR_SPOTLIGHT}ms ${EASE_OUT}, opacity ${DUR_FADE}ms ${EASE_IN_OUT}`,
          pointerEvents: 'none',
          willChange: 'left, top, width, height',
        }}
      />

      {/* Tooltip */}
      <div
        className="absolute rounded-2xl border shadow-2xl p-5"
        style={{
          ...tooltipStyle,
          background: 'var(--led-surface, #ffffff)',
          borderColor: 'var(--led-line, #e5e7eb)',
          color: 'var(--led-ink, #111827)',
          opacity: visible ? 1 : 0,
          transform: tooltipTransform,
          transformOrigin: 'center',
          transition: `left ${DUR_TOOLTIP}ms ${EASE_OUT}, top ${DUR_TOOLTIP}ms ${EASE_OUT}, right ${DUR_TOOLTIP}ms ${EASE_OUT}, bottom ${DUR_TOOLTIP}ms ${EASE_OUT}, opacity ${DUR_FADE}ms ${EASE_IN_OUT}, transform ${DUR_FADE}ms ${EASE_OUT}`,
          willChange: 'left, top, opacity, transform',
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: 'var(--led-muted)' }}
          >
            Step {index + 1} of {steps.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] font-medium opacity-70 hover:opacity-100 transition-opacity"
            style={{ color: 'var(--led-muted)' }}
          >
            Skip tour
          </button>
        </div>

        {/* Content fades between steps via key-driven remount */}
        <div
          key={contentKey}
          className="tour-content-fade"
          style={{ animation: `tourContentIn ${DUR_CONTENT}ms ${EASE_OUT} both` }}
        >
          <h3
            className="text-[17px] font-semibold tracking-[-0.01em] mb-1.5"
            style={{ color: 'var(--led-ink)' }}
          >
            {step.title}
          </h3>
          <p
            className="text-[13px] leading-[1.5] mb-5"
            style={{ color: 'var(--led-muted)' }}
          >
            {step.body}
          </p>
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={back}
            disabled={index === 0}
            className="rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: 'var(--led-ink)' }}
          >
            Back
          </button>
          <div className="flex gap-1.5">
            {steps.map((_, i) => (
              <span
                key={i}
                className="h-1.5 rounded-full"
                style={{
                  width: i === index ? 18 : 6,
                  background:
                    i === index
                      ? 'var(--led-accent, #2563eb)'
                      : 'var(--led-line, #d1d5db)',
                  transition: `width ${DUR_TOOLTIP}ms ${EASE_OUT}, background-color ${DUR_FADE}ms ${EASE_IN_OUT}`,
                }}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={next}
            className="rounded-lg px-4 py-1.5 text-[13px] font-semibold shadow-sm transition-all hover:opacity-90 active:scale-95"
            style={{
              background: 'var(--led-accent, #2563eb)',
              color: 'var(--led-accent-ink, #ffffff)',
            }}
          >
            {index === steps.length - 1 ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>

      {/* Local keyframes for content fade */}
      <style>{`
        @keyframes tourContentIn {
          0%   { opacity: 0; transform: translateY(4px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>,
    document.body
  );
}
