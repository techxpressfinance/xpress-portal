import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/** A toolbar button that opens a panel beneath it; closes on an outside click
 *  or Escape. `children` may be a function given `close`. */
export default function LedgerMenu({ label, children, width = 'w-72', align = 'right' }: {
  label: ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  width?: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="led-btn led-btn-outline led-btn-sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {label}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} z-30 mt-1.5 ${width} max-h-[65vh] overflow-y-auto rounded-lg border border-border bg-[var(--led-surface)] p-2 shadow-[var(--led-shadow-lg)]`}>
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}
