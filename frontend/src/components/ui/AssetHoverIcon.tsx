import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import LoanTypeIcon from './LoanTypeIcon';

export interface AssetTooltipRow {
  label: string;
  value: string | null | undefined;
}

interface AssetHoverIconProps {
  /** Loan type driving the icon (car / house / building …). Omit for external
   *  loan records with no type — falls back to a generic banknote icon. */
  loanType?: string;
  heading: string;
  rows: AssetTooltipRow[];
  className?: string;
  delay?: number;
}

/**
 * Asset / property icon that reveals a summary of what was funded on hover.
 * Rendered in lending-history tables on contact and company detail pages.
 * The tooltip is portalled to <body> with fixed positioning so it is never
 * clipped by the table's `overflow-x-auto` container.
 */
export default function AssetHoverIcon({
  loanType,
  heading,
  rows,
  className = 'h-[18px] w-[18px]',
  delay = 120,
}: AssetHoverIconProps) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);

  const show = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    timerRef.current = setTimeout(() => {
      setPos({ top: r.top, left: r.left + r.width / 2 });
    }, delay);
  };

  const hide = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPos(null);
  };

  const visibleRows = rows.filter(r => r.value != null && r.value !== '' && r.value !== '—');

  return (
    <span
      ref={triggerRef}
      className="inline-flex cursor-help text-muted-foreground align-middle"
      onMouseEnter={show}
      onMouseLeave={hide}
      aria-label={heading}
    >
      {/* Empty loanType falls through LoanTypeIcon's map to the banknote default. */}
      <LoanTypeIcon type={loanType || ''} className={className} />
      {pos &&
        createPortal(
          <div
            className="fixed z-[100] w-60 -translate-x-1/2 -translate-y-full rounded-lg bg-[var(--led-ink)] p-3 text-white shadow-xl pointer-events-none"
            style={{ top: pos.top - 8, left: pos.left, animation: 'fadeIn 0.15s ease-in-out' }}
          >
            <div className="text-[13px] font-semibold mb-1.5">{heading}</div>
            {visibleRows.length === 0 ? (
              <div className="text-[12px] text-white/60">No further details recorded.</div>
            ) : (
              <dl className="space-y-1 text-[12px]">
                {visibleRows.map(r => (
                  <div key={r.label} className="flex justify-between gap-3">
                    <dt className="text-white/60 whitespace-nowrap">{r.label}</dt>
                    <dd className="text-right font-medium break-words">{r.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
