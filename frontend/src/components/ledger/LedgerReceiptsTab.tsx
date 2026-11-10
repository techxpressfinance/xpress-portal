import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../Toast';
import { useConfirm } from '../../hooks/useConfirm';
import { Button, Card } from '../ui';
import { formatDate, getErrorMessage } from '../../lib/utils';
import { formatLedgerMoney } from '../../lib/ledger';
import type { LedgerReceipt, LedgerReceiptsResponse } from '../../types';
import LedgerModal from './LedgerModal';

type Draft = { id?: string; received_on: string; from_name: string; amount: string; reference: string; notes: string };

const blank = (): Draft => ({ received_on: new Date().toISOString().slice(0, 10), from_name: '', amount: '', reference: '', notes: '' });

/** Money received from other parties — commission passed on by another broker
 *  or aggregator, a split settled up — with a total per payer, to reconcile
 *  against what they owed. */
export default function LedgerReceiptsTab({ range, isOwner }: { range: { from: string; to: string }; isOwner: boolean }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<LedgerReceiptsResponse | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const params = useMemo(() => ({ date_from: range.from || undefined, date_to: range.to || undefined }), [range]);

  const load = useCallback(() => {
    api.get<LedgerReceiptsResponse>('/ledger/receipts', { params })
      .then(({ data }) => setData(data))
      .catch((err) => toast(getErrorMessage(err, 'Failed to load receipts'), 'error'));
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!draft) return;
    const amount = Number(draft.amount.replace(/[$,\s]/g, ''));
    if (!draft.from_name.trim() || !draft.received_on || draft.amount.trim() === '' || Number.isNaN(amount)) {
      toast('Enter the date, who it came from and the amount', 'error');
      return;
    }
    setSaving(true);
    const body = { received_on: draft.received_on, from_name: draft.from_name, amount, reference: draft.reference || null, notes: draft.notes || null };
    try {
      if (draft.id) await api.put(`/ledger/receipts/${draft.id}`, body);
      else await api.post('/ledger/receipts', body);
      setDraft(null);
      load();
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to save'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r: LedgerReceipt) => {
    const ok = await confirm({ title: 'Delete this receipt?', message: `${formatLedgerMoney(r.amount)} from ${r.from_name} on ${formatDate(r.received_on)}.`, confirmText: 'Delete', variant: 'danger' });
    if (!ok) return;
    try {
      await api.delete(`/ledger/receipts/${r.id}`);
      load();
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to delete'), 'error');
    }
  };

  const inputCls = 'led-input !h-9 w-full text-[13px]';
  const labelCls = 'mb-1 block text-[12px] font-medium text-[var(--led-ink-2)]';

  return (
    <div className="space-y-4">
      {data && data.by_payer.length > 0 && (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <Card padding="sm">
            <p className="text-[11.5px] text-muted-foreground">Received in the period</p>
            <p className="text-[20px] font-semibold tabular-nums text-foreground">{formatLedgerMoney(data.total)}</p>
          </Card>
          {data.by_payer.slice(0, 7).map((p) => (
            <Card key={p.from_name} padding="sm">
              <p className="text-[11.5px] text-muted-foreground">From {p.from_name}</p>
              <p className="text-[20px] font-semibold tabular-nums text-foreground">{formatLedgerMoney(p.amount)}</p>
            </Card>
          ))}
        </div>
      )}
      <Card padding="none">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
          <h2 className="text-[14px] font-semibold text-foreground">Money received</h2>
          {isOwner && <Button size="sm" onClick={() => setDraft(blank())}>Record a receipt</Button>}
        </div>
        {!data ? (
          <p className="px-4 py-6 text-[13px] text-muted-foreground">Loading…</p>
        ) : data.receipts.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-muted-foreground">Nothing received in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-[12.5px]">
              <thead className="bg-[var(--led-surface-2)] text-[11.5px] text-[var(--led-ink-2)]">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">From</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Reference</th>
                  <th className="px-3 py-2 text-left">Notes</th>
                  {isOwner && <th />}
                </tr>
              </thead>
              <tbody>
                {data.receipts.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.received_on)}</td>
                    <td className="px-3 py-2 font-medium">{r.from_name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatLedgerMoney(r.amount)}</td>
                    <td className="px-3 py-2">{r.reference || '—'}</td>
                    <td className="px-3 py-2 max-w-[320px]">{r.notes || '—'}</td>
                    {isOwner && (
                      <td className="px-2 py-1 text-right whitespace-nowrap">
                        <button type="button" className="led-btn led-btn-ghost led-btn-sm" onClick={() => setDraft({ id: r.id, received_on: r.received_on, from_name: r.from_name, amount: String(r.amount), reference: r.reference ?? '', notes: r.notes ?? '' })}>Edit</button>
                        <button type="button" className="led-btn led-btn-ghost led-btn-sm" onClick={() => remove(r)}>Delete</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {draft && (
        <LedgerModal
          title={draft.id ? 'Edit receipt' : 'Record a receipt'}
          onClose={() => setDraft(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
              <Button onClick={save} loading={saving}>Save</Button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={labelCls}>Received on</span>
              <input type="date" className={inputCls} value={draft.received_on} onChange={(e) => setDraft({ ...draft, received_on: e.target.value })} />
            </label>
            <label className="block">
              <span className={labelCls}>Amount</span>
              <input className={inputCls} inputMode="decimal" value={draft.amount} placeholder="0.00" onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
            </label>
            <label className="block sm:col-span-2">
              <span className={labelCls}>From</span>
              <input className={inputCls} value={draft.from_name} placeholder="e.g. Paradigm Financial" onChange={(e) => setDraft({ ...draft, from_name: e.target.value })} />
            </label>
            <label className="block sm:col-span-2">
              <span className={labelCls}>Reference</span>
              <input className={inputCls} value={draft.reference} onChange={(e) => setDraft({ ...draft, reference: e.target.value })} />
            </label>
            <label className="block sm:col-span-2">
              <span className={labelCls}>Notes</span>
              <textarea className="led-input w-full min-h-[60px] py-2 text-[13px]" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            </label>
          </div>
        </LedgerModal>
      )}
    </div>
  );
}
