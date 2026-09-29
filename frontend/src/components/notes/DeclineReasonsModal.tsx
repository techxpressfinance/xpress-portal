import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownIcon, ArrowUpIcon } from '@heroicons/react/24/outline';
import api from '../../api/client';
import { useToast } from '../Toast';
import { Button } from '../ui';
import { getErrorMessage } from '../../lib/utils';
import type { DeclineReason } from '../../types';

/**
 * Admin editor for the tenant's decline-reason tags. Reasons are renamed or
 * retired, never deleted — decline notes already filed under one keep it, and
 * a rename carries through to them.
 */
export default function DeclineReasonsModal({
  reasons,
  onChange,
  onClose,
}: {
  reasons: DeclineReason[];
  onChange: (reasons: DeclineReason[]) => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [newLabel, setNewLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const replace = (updated: DeclineReason) =>
    onChange(reasons.map((r) => (r.id === updated.id ? updated : r)).sort((a, b) => a.sort_order - b.sort_order));

  const patch = async (reason: DeclineReason, body: Partial<DeclineReason>) => {
    setBusyId(reason.id);
    try {
      const { data } = await api.patch<DeclineReason>(`/decline-reasons/${reason.id}`, body);
      replace(data);
      return true;
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to update reason'), 'error');
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const rename = async (reason: DeclineReason) => {
    const label = drafts[reason.id]?.trim();
    const clearDraft = () => setDrafts((d) => {
      const next = { ...d };
      delete next[reason.id];
      return next;
    });
    if (!label || label === reason.label) {
      clearDraft();
      return;
    }
    if (await patch(reason, { label })) clearDraft();
  };

  const move = async (index: number, dir: -1 | 1) => {
    const other = reasons[index + dir];
    const reason = reasons[index];
    if (!other) return;
    // Swap positions; give distinct orders if the two happened to share one.
    const a = other.sort_order === reason.sort_order ? reason.sort_order + dir : other.sort_order;
    setBusyId(reason.id);
    try {
      const [{ data: r1 }, { data: r2 }] = await Promise.all([
        api.patch<DeclineReason>(`/decline-reasons/${reason.id}`, { sort_order: a }),
        api.patch<DeclineReason>(`/decline-reasons/${other.id}`, { sort_order: reason.sort_order }),
      ]);
      onChange(reasons.map((r) => (r.id === r1.id ? r1 : r.id === r2.id ? r2 : r)).sort((x, y) => x.sort_order - y.sort_order));
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to reorder'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const add = async () => {
    if (!newLabel.trim()) return;
    setAdding(true);
    try {
      const { data } = await api.post<DeclineReason>('/decline-reasons', { label: newLabel.trim() });
      onChange([...reasons, data]);
      setNewLabel('');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to add reason'), 'error');
    } finally {
      setAdding(false);
    }
  };

  return createPortal(
    <div className="ledger-theme fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-border bg-background shadow-xl">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-[17px] font-semibold text-foreground">Decline reasons</h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            The tags brokers pick on decline notes. The notes history counts declines by these, so keep the list short.
            Retiring a reason hides it from the picker; notes already tagged keep it.
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-1.5">
          {reasons.map((r, i) => (
            <div key={r.id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${r.is_active ? '' : 'opacity-55'}`}>
              <div className="flex flex-col">
                <button type="button" disabled={i === 0 || busyId !== null} onClick={() => move(i, -1)} className="text-muted-foreground hover:text-foreground disabled:opacity-30" title="Move up">
                  <ArrowUpIcon className="h-3 w-3" strokeWidth={2.5} />
                </button>
                <button type="button" disabled={i === reasons.length - 1 || busyId !== null} onClick={() => move(i, 1)} className="text-muted-foreground hover:text-foreground disabled:opacity-30" title="Move down">
                  <ArrowDownIcon className="h-3 w-3" strokeWidth={2.5} />
                </button>
              </div>
              <input
                value={drafts[r.id] ?? r.label}
                onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                onBlur={() => rename(r)}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                className="led-input !h-9 flex-1 !text-[14px]"
                aria-label="Reason name"
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={busyId === r.id}
                onClick={() => patch(r, { is_active: !r.is_active })}
              >
                {r.is_active ? 'Retire' : 'Restore'}
              </Button>
            </div>
          ))}
        </div>
        <div className="border-t border-border px-6 py-4 space-y-3">
          <div className="flex gap-2">
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
              placeholder="New reason, e.g. Bank statement conduct"
              className="led-input !h-10 flex-1 !text-[14px]"
            />
            <Button onClick={add} loading={adding} disabled={!newLabel.trim()}>Add</Button>
          </div>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>Done</Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
