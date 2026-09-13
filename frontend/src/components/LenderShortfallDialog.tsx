import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './ui';
import type { LenderPricingInputs } from '../types';

/** The decision the dialog records — the shortfall slice of LenderPricingInputs. */
export type ShortfallDecision = Pick<
  LenderPricingInputs,
  'lender_accepts_shortfall' | 'lender_acceptance_notes' | 'shortfall_bypassed' | 'shortfall_bypass_notes'
>;

const labelBase = 'block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1';
const textareaBase =
  'w-full rounded-lg bg-secondary px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background border border-border';

/** Blocking pop-up raised whenever the negative-equity / over-110% alerts fire.
 *  "No" stops the pricing from being saved; the only way past it is a temporary
 *  broker/admin bypass, which demands written reasons. */
export default function LenderShortfallDialog({ open, alerts, decision, onSave, onCancel }: {
  open: boolean;
  alerts: string[];
  decision: ShortfallDecision;
  onSave: (decision: ShortfallDecision) => void;
  onCancel: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const [draft, setDraft] = useState<ShortfallDecision>(decision);

  // Re-seed from what is already recorded each time the dialog is raised.
  useEffect(() => {
    if (open) setDraft(decision);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Move focus in on open, hand it back on close.
  useEffect(() => {
    if (!open) return;
    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    panelRef.current
      ?.querySelector<HTMLElement>('input, textarea, button:not([disabled])')
      ?.focus();
    return () => restoreFocusTo.current?.focus?.();
  }, [open]);

  // Trap Tab inside the panel. Escape closes without recording a decision —
  // the save gate will raise it again.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input, select, textarea, [href], [tabindex]:not([tabindex="-1"])',
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
  }, [open, onCancel]);

  if (!open) return null;

  const setAnswer = (answer: 'yes' | 'no') =>
    setDraft(prev => ({
      ...prev,
      lender_accepts_shortfall: answer,
      // Yes retires any bypass — there is nothing left to bypass.
      shortfall_bypassed: answer === 'yes' ? false : prev.shortfall_bypassed,
      shortfall_bypass_notes: answer === 'yes' ? '' : prev.shortfall_bypass_notes,
    }));

  const saidNo = draft.lender_accepts_shortfall === 'no';
  const bypassing = saidNo && draft.shortfall_bypassed;
  const canSave =
    draft.lender_accepts_shortfall === 'yes' ||
    (bypassing && draft.shortfall_bypass_notes.trim().length > 0);

  return createPortal(
    <div className="fixed inset-0 flex items-end sm:items-center justify-center sm:p-4" style={{ zIndex: 'var(--z-modal)' }}>
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm"
        style={{ animation: 'fadeIn 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
        onClick={onCancel}
      />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-[560px] max-h-[90vh] overflow-y-auto rounded-t-[10px] sm:rounded-[10px] bg-background border border-border p-6 shadow-xl"
        style={{ animation: 'fadeInUp 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
      >
        <div className="flex items-start gap-3 mb-4">
          <span aria-hidden className="text-danger text-[18px] leading-none mt-0.5">▲</span>
          <div>
            <h3 id={titleId} className="text-[17px] font-semibold text-foreground">
              Lender acceptance required
            </h3>
            <p className="text-[12.5px] text-muted-foreground mt-0.5">
              This structure trips the desk's lending-policy limits.
            </p>
          </div>
        </div>

        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 space-y-1.5 mb-5">
          {alerts.map(msg => (
            <div key={msg} className="flex gap-2 text-[12.5px] text-foreground">
              <span aria-hidden className="text-danger">▲</span>
              <span>{msg}</span>
            </div>
          ))}
        </div>

        <p className="text-[13.5px] font-semibold text-foreground mb-2">
          Is the lender OK to accept the shortfall and negative equity?
        </p>
        <div className="flex items-center gap-5 mb-4">
          {(['yes', 'no'] as const).map(answer => (
            <label key={answer} className="inline-flex items-center gap-1.5 text-[13px] text-foreground cursor-pointer">
              <input
                type="radio"
                name="shortfall_answer"
                value={answer}
                checked={draft.lender_accepts_shortfall === answer}
                onChange={() => setAnswer(answer)}
                className="accent-primary"
              />
              {answer === 'yes' ? 'Yes' : 'No'}
            </label>
          ))}
        </div>

        {draft.lender_accepts_shortfall === 'yes' && (
          <div className="mb-5">
            <label className={labelBase}>Notes</label>
            <textarea
              className={`${textareaBase} min-h-[72px]`}
              placeholder="e.g. Confirmed with the lender's BDM — negative equity accepted given strong servicing…"
              value={draft.lender_acceptance_notes}
              onChange={e => setDraft(prev => ({ ...prev, lender_acceptance_notes: e.target.value }))}
              rows={3}
            />
          </div>
        )}

        {saidNo && (
          <div className="mb-5 rounded-md border border-danger/30 bg-danger/5 px-3 py-3">
            <p className="text-[12.5px] text-foreground">
              The lender will not accept it, so this pricing cannot be saved. A broker or admin may carry on
              temporarily by recording why.
            </p>
            <label className="mt-3 inline-flex items-center gap-2 text-[13px] font-semibold text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={draft.shortfall_bypassed}
                onChange={e => setDraft(prev => ({
                  ...prev,
                  shortfall_bypassed: e.target.checked,
                  shortfall_bypass_notes: e.target.checked ? prev.shortfall_bypass_notes : '',
                }))}
                className="accent-primary"
              />
              Bypass temporarily
            </label>
            {bypassing && (
              <div className="mt-3">
                <label className={labelBase}>
                  Reason for the bypass <span className="text-danger">(required)</span>
                </label>
                <textarea
                  className={`${textareaBase} min-h-[72px]`}
                  placeholder="e.g. Awaiting the BDM's written sign-off; structure agreed verbally, pricing recorded so the deal can progress…"
                  value={draft.shortfall_bypass_notes}
                  onChange={e => setDraft(prev => ({ ...prev, shortfall_bypass_notes: e.target.value }))}
                  rows={3}
                />
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
          <Button variant="secondary" size="md" onClick={onCancel} className="sm:w-auto w-full">
            Cancel
          </Button>
          <Button
            variant={bypassing ? 'danger' : 'primary'}
            size="md"
            onClick={() => onSave(draft)}
            disabled={!canSave}
            className="sm:w-auto w-full"
          >
            {bypassing ? 'Bypass and continue' : 'Record and continue'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
