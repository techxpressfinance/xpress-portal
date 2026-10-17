import { useEffect, useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** The ledger's dialogs: a title, a scrolling body and a footer of actions. */
export default function LedgerModal({ title, subtitle, onClose, footer, children, wide = false }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative w-full ${wide ? 'max-w-[920px]' : 'max-w-[640px]'} max-h-[92vh] flex flex-col rounded-t-[10px] sm:rounded-[10px] bg-background border border-border shadow-xl`}
      >
        <div className="px-6 pt-5 pb-3 border-b border-border">
          <h3 id={titleId} className="text-[17px] font-semibold text-foreground">{title}</h3>
          {subtitle && <p className="text-[12.5px] text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer && <div className="px-6 py-3 border-t border-border flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
