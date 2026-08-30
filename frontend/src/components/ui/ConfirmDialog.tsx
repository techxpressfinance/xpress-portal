import { createPortal } from 'react-dom';
import { useEffect, useId, useRef } from 'react';
import Button from './Button';

type Variant = 'primary' | 'danger' | 'success';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: Variant;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'primary',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const messageId = useId();

  // Move focus into the dialog on open and hand it back to whatever opened it
  // on close, so keyboard users are not dropped at the top of the document.
  useEffect(() => {
    if (!open) return;
    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    const first = panelRef.current?.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
    return () => restoreFocusTo.current?.focus?.();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      // Trap Tab inside the dialog. Without this, focus walks out into the
      // page behind the scrim, which is invisible but still interactive.
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables?.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, loading, onCancel]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 flex items-end sm:items-center justify-center sm:p-4" style={{ zIndex: 'var(--z-modal)' }}>
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm"
        style={{ animation: 'fadeIn 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
        onClick={() => !loading && onCancel()}
      />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
        className="relative w-full max-w-[420px] rounded-t-[10px] sm:rounded-[10px] bg-background border border-border p-6 pb-8 sm:pb-6 shadow-xl"
        style={{ animation: 'fadeInUp 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
      >
        <h3 id={titleId} className="text-[17px] font-semibold text-foreground mb-1">{title}</h3>
        {message && (
          <div id={messageId} className="text-[14px] text-muted-foreground mb-6">{message}</div>
        )}
        <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
          <Button variant="secondary" size="md" onClick={onCancel} disabled={loading} className="sm:w-auto w-full h-11 sm:h-auto">
            {cancelText}
          </Button>
          <Button variant={variant} size="md" onClick={onConfirm} loading={loading} className="sm:w-auto w-full h-11 sm:h-auto">
            {confirmText}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
