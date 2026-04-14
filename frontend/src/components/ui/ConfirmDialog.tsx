import { createPortal } from 'react-dom';
import { useEffect } from 'react';
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, loading, onCancel]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm"
        style={{ animation: 'fadeIn 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
        onClick={() => !loading && onCancel()}
      />
      <div
        className="relative w-full max-w-[420px] rounded-2xl bg-background border border-border p-6 shadow-xl"
        style={{ animation: 'fadeInUp 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
      >
        <h3 className="text-[17px] font-semibold text-foreground mb-1">{title}</h3>
        {message && (
          <div className="text-[14px] text-muted-foreground mb-6">{message}</div>
        )}
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" size="md" onClick={onCancel} disabled={loading}>
            {cancelText}
          </Button>
          <Button variant={variant} size="md" onClick={onConfirm} loading={loading}>
            {confirmText}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
