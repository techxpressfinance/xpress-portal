import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../api/client';
import { useToast } from './Toast';
import { Button } from './ui';
import { getErrorMessage } from '../lib/utils';
import type {
  ChecklistPurpose,
  SettlementChecklist,
  SettlementChecklistAnswer,
  SettlementChecklistItem,
  SettlementChecklistKind,
  SettlementChecklistTemplate,
} from '../types';
import { SUPPLIER_LABEL } from '../types';

type Answers = Record<string, SettlementChecklistAnswer>;

const KIND_LABELS: Record<SettlementChecklistKind, string> = {
  consumer: 'Consumer deal',
  dealer_sale: 'Dealer sale',
  private_sale: 'Private sale',
  lender_submission: 'Lender submission',
  loan_settled: 'Loan settled',
};

// The stage each purpose's checklist stands in front of.
const PURPOSE_STAGE: Record<ChecklistPurpose, string> = {
  settlement_pack: 'Submitted to Lender',
  lender_submission: 'Submitted to Lender',
  loan_settled: 'Settled',
};

const blank: SettlementChecklistAnswer = { state: null, subs: [] };

/** Mirrors `outstanding` in backend services/settlement_checklist.py, so the
 *  continue button is only live once the server will accept the move. */
function itemComplete(item: SettlementChecklistItem, answer: SettlementChecklistAnswer): boolean {
  if (answer.state === 'na' && item.optional) return true;
  if (answer.state !== 'done') return false;
  return item.subs.every((s) => s.optional || answer.subs.includes(s.key));
}

function Tick({ checked, onChange, label, size = 'md' }: {
  checked: boolean;
  onChange: () => void;
  label: string;
  size?: 'md' | 'sm';
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={onChange}
      className={`${size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5'} shrink-0 rounded border-border accent-[var(--led-ink)] cursor-pointer`}
    />
  );
}

/** The settlement pack a deal must have ticked off before it can move to
 *  Settled. Raised by every way into Settled — the kanban board, the review
 *  page's status control and the contact page's application editor — and
 *  stored on the application, so a half-done pack can be saved and picked up
 *  again. `onComplete` runs once a complete pack is saved; the caller then
 *  makes the move itself. */
export default function SettlementChecklistDialog({ open, applicationId, purpose, subtitle, continueLabel = 'Save & continue', onComplete, onCancel }: {
  open: boolean;
  applicationId: string | null;
  purpose: ChecklistPurpose;
  subtitle?: string;
  continueLabel?: string;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [data, setData] = useState<SettlementChecklist | null>(null);
  const [kind, setKind] = useState<SettlementChecklistKind>('consumer');
  // Answers per kind, so flicking between checklists doesn't lose ticks.
  const [answersByKind, setAnswersByKind] = useState<Partial<Record<SettlementChecklistKind, Answers>>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<'progress' | 'complete' | null>(null);

  useEffect(() => {
    if (!open || !applicationId) return;
    let cancelled = false;
    setLoading(true);
    setData(null);
    api.get<SettlementChecklist>(`/applications/${applicationId}/settlement-checklist`, { params: { purpose } })
      .then(({ data }) => {
        if (cancelled) return;
        setData(data);
        setKind(data.kind);
        setAnswersByKind({ [data.kind]: data.answers });
      })
      .catch((err) => {
        if (cancelled) return;
        toast(getErrorMessage(err, 'Failed to load the settlement checklist'), 'error');
        onCancel();
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, applicationId, purpose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const template: SettlementChecklistTemplate | undefined = data?.templates.find((t) => t.kind === kind);
  const answers: Answers = answersByKind[kind] ?? {};
  const answerFor = (key: string) => answers[key] ?? blank;
  const setAnswer = (key: string, next: SettlementChecklistAnswer) =>
    setAnswersByKind((prev) => ({ ...prev, [kind]: { ...(prev[kind] ?? {}), [key]: next } }));

  // Ticking an item ticks its sub-items too; unticking clears them.
  const toggleItem = (item: SettlementChecklistItem) => {
    const answer = answerFor(item.key);
    setAnswer(item.key, answer.state === 'done'
      ? { state: null, subs: [] }
      : { state: 'done', subs: item.subs.map((s) => s.key) });
  };
  const toggleNa = (item: SettlementChecklistItem) => {
    const answer = answerFor(item.key);
    setAnswer(item.key, answer.state === 'na' ? { state: null, subs: [] } : { state: 'na', subs: [] });
  };
  // The item ticks itself once every required sub-item is ticked, and unticks
  // when one of them is cleared.
  const toggleSub = (item: SettlementChecklistItem, subKey: string) => {
    const answer = answerFor(item.key);
    const subs = answer.subs.includes(subKey) ? answer.subs.filter((k) => k !== subKey) : [...answer.subs, subKey];
    const allRequired = item.subs.every((s) => s.optional || subs.includes(s.key));
    setAnswer(item.key, { state: allRequired ? 'done' : null, subs });
  };

  const items = template?.items ?? [];
  const doneCount = items.filter((item) => itemComplete(item, answerFor(item.key))).length;
  const complete = items.length > 0 && doneCount === items.length;

  const save = async (mode: 'progress' | 'complete') => {
    if (!applicationId) return;
    setSaving(mode);
    try {
      const { data: saved } = await api.put<SettlementChecklist>(
        `/applications/${applicationId}/settlement-checklist`,
        { kind, answers },
        { params: { purpose } },
      );
      setData(saved);
      if (mode === 'complete') {
        if (saved.outstanding.length) {
          toast(`Still outstanding: ${saved.outstanding.join(', ')}`, 'error');
          return;
        }
        onComplete();
      } else {
        toast('Settlement checklist saved', 'success');
        onCancel();
      }
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to save the settlement checklist'), 'error');
    } finally {
      setSaving(null);
    }
  };

  return createPortal(
    <div className="fixed inset-0 flex items-end sm:items-center justify-center sm:p-4" style={{ zIndex: 'var(--z-modal)' }}>
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm"
        style={{ animation: 'fadeIn 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
        onClick={onCancel}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-[640px] max-h-[90vh] flex flex-col rounded-t-[10px] sm:rounded-[10px] bg-background border border-border shadow-xl"
        style={{ animation: 'fadeInUp 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
      >
        <div className="px-6 pt-5 pb-3 border-b border-border">
          <h3 id={titleId} className="text-[17px] font-semibold text-foreground">
            {template?.title ?? 'Settlement checklist'}
          </h3>
          <p className="text-[12.5px] text-muted-foreground mt-0.5">
            {subtitle ? `${subtitle} · ` : ''}Tick these off before this deal moves to {PURPOSE_STAGE[purpose]}.
          </p>
          {data && (
            <p className="text-[12.5px] text-muted-foreground mt-1">
              Sale type:{' '}
              {data.sale_type.sale_type ? (
                <>
                  <span className="font-medium text-foreground">{SUPPLIER_LABEL[data.sale_type.sale_type]}</span>
                  {data.sale_type.source === 'tax_invoice' && ' · from the latest tax invoice'}
                </>
              ) : (
                'not marked — set it on the Tax Invoices tab'
              )}
            </p>
          )}
          {data && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Kind of deal">
              {data.templates.length > 1 && data.templates.map((t) => (
                <button
                  key={t.kind}
                  type="button"
                  role="tab"
                  aria-selected={t.kind === kind}
                  onClick={() => setKind(t.kind)}
                  className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
                    t.kind === kind
                      ? 'border-[var(--led-ink)] bg-[var(--led-ink)] text-[var(--led-surface)]'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {KIND_LABELS[t.kind]}
                  {t.kind === data.suggested_kind && <span className="ml-1 opacity-70">· suggested</span>}
                </button>
              ))}
              <span className="ml-auto text-[12px] tabular-nums text-muted-foreground">
                {doneCount} / {items.length} done
              </span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-3">
          {loading || !template ? (
            <p className="py-8 text-center text-[13px] text-muted-foreground">Loading…</p>
          ) : (
            <ul className="divide-y divide-border">
              {template.items.map((item) => {
                const answer = answerFor(item.key);
                const isNa = answer.state === 'na';
                const itemDone = itemComplete(item, answer);
                return (
                  <li key={item.key} className="py-2.5">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5">
                        <Tick checked={answer.state === 'done'} onChange={() => toggleItem(item)} label={item.label} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className={`text-[13.5px] font-medium ${isNa ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                          {item.label}
                          {itemDone && !isNa && <span className="ml-1.5 text-[var(--led-success)]" aria-hidden>✓</span>}
                        </div>
                        {item.note && <p className="text-[12px] text-muted-foreground mt-0.5">{item.note}</p>}
                        {item.subs.length > 0 && !isNa && (
                          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                            {item.subs.map((sub) => (
                              <li key={sub.key}>
                                <label className="flex items-start gap-2 text-[12.5px] text-foreground cursor-pointer">
                                  <span className="mt-0.5">
                                    <Tick
                                      size="sm"
                                      checked={answer.subs.includes(sub.key)}
                                      onChange={() => toggleSub(item, sub.key)}
                                      label={`${item.label}: ${sub.label}`}
                                    />
                                  </span>
                                  <span>
                                    {sub.label}
                                    {sub.optional && <span className="text-muted-foreground"> · if applicable</span>}
                                  </span>
                                </label>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      {item.optional && (
                        <button
                          type="button"
                          onClick={() => toggleNa(item)}
                          aria-pressed={isNa}
                          className={`shrink-0 rounded border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
                            isNa ? 'border-[var(--led-ink)] text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          N/A
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {!!template?.follow_ups?.length && (
            <div className="mt-2 mb-1 rounded-md border border-border bg-secondary/50 px-3 py-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Follow-up tasks raised on the move
              </div>
              <ul className="mt-1.5 space-y-1">
                {template.follow_ups.map((f) => (
                  <li key={f.key} className="text-[12.5px] text-foreground">
                    {f.title}
                    <span className="text-muted-foreground"> · due {f.days_after} days after{f.note ? ` · ${f.note}` : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-muted-foreground mr-auto">
            {data?.prepared_by_name ? `Prepared by ${data.prepared_by_name}` : 'Prepared by you'}
          </span>
          <Button variant="ghost" onClick={onCancel} disabled={!!saving}>Cancel</Button>
          <Button variant="secondary" onClick={() => save('progress')} loading={saving === 'progress'} disabled={!template || !!saving}>
            Save progress
          </Button>
          <Button onClick={() => save('complete')} loading={saving === 'complete'} disabled={!complete || !!saving}>
            {continueLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
