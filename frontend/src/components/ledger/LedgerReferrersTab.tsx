import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../Toast';
import { Button, Card } from '../ui';
import { formatDate, getErrorMessage } from '../../lib/utils';
import { formatLedgerMoney, PAYMENT_METHODS, SHARE_BASE_LABEL, SHARE_STATUS_LABEL } from '../../lib/ledger';
import type { LedgerDealRow, LedgerDealsResponse, LedgerInvoice, LedgerPayee, LedgerReferrerSummary, LedgerShare, LedgerShareStatus } from '../../types';
import LedgerInvoiceModal from './LedgerInvoiceDocument';
import LedgerPayeesPanel from './LedgerPayeesPanel';

function shareText(s: LedgerShare | null | undefined, d: LedgerDealRow): string {
  if (!s) return '—';
  const split = (d.shares?.length ?? 0) > 1 ? ' · split deal' : '';
  if (s.share_amount != null) return `Fixed amount${split}`;
  if (s.share_percent != null) return `${s.share_percent}% ${SHARE_BASE_LABEL[s.share_base ?? 'brokerage']}${split}`;
  return `Not set${split}`;
}

function statusText(s: LedgerShare | null | undefined): string {
  if (!s?.status) return '—';
  if (s.status === 'paid') return s.paid_on ? `Paid ${formatDate(s.paid_on)}` : 'Paid';
  if (s.status === 'scheduled') return s.scheduled_on ? `Scheduled ${formatDate(s.scheduled_on)}` : 'Scheduled';
  return SHARE_STATUS_LABEL[s.status];
}

/** Who referred how many settled deals in the range — and, for one referrer,
 *  every deal and client on the same page, with the invoice built from them. */
export default function LedgerReferrersTab({ range, isOwner, canInvoice, onEditDeal, refreshKey, payees, onPayeesChanged }: {
  range: { from: string; to: string };
  isOwner: boolean;
  canInvoice: boolean;
  onEditDeal?: (row: LedgerDealRow) => void;
  refreshKey: number;
  payees: LedgerPayee[];
  onPayeesChanged: () => void;
}) {
  const { toast } = useToast();
  const [summary, setSummary] = useState<LedgerReferrerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [deals, setDeals] = useState<LedgerDealRow[]>([]);
  const [dealsLoading, setDealsLoading] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [layout, setLayout] = useState<'breakdown' | 'single'>('breakdown');
  const [creating, setCreating] = useState(false);
  const [invoices, setInvoices] = useState<LedgerInvoice[]>([]);
  const [openInvoice, setOpenInvoice] = useState<LedgerInvoice | null>(null);
  const [bulkStatus, setBulkStatus] = useState<LedgerShareStatus>('paid');
  const [bulkDate, setBulkDate] = useState(new Date().toISOString().slice(0, 10));
  const [bulkMethod, setBulkMethod] = useState('Bank transfer');
  const [bulkReference, setBulkReference] = useState('');
  const [marking, setMarking] = useState(false);

  const params = useMemo(() => ({ date_from: range.from || undefined, date_to: range.to || undefined }), [range]);

  useEffect(() => {
    setLoading(true);
    api.get<LedgerReferrerSummary[]>('/ledger/referrers', { params })
      .then(({ data }) => setSummary(data))
      .catch((err) => toast(getErrorMessage(err, 'Failed to load referrers'), 'error'))
      .finally(() => setLoading(false));
  }, [params, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadReferrer = useCallback(async (id: string) => {
    setDealsLoading(true);
    try {
      const [{ data }, inv] = await Promise.all([
        api.get<LedgerDealsResponse>('/ledger/deals', { params: { ...params, referrer_id: id } }),
        canInvoice ? api.get<LedgerInvoice[]>('/ledger/invoices', { params: { referrer_id: id } }) : Promise.resolve({ data: [] as LedgerInvoice[] }),
      ]);
      const rows = data.deals ?? [];
      setDeals(rows);
      setInvoices(inv.data);
      // Start with what hasn't been paid yet — what an invoice is usually for.
      setTicked(new Set(rows.filter((r) => {
        const st = r.payee_share?.status;
        return st === 'unpaid' || st === 'scheduled';
      }).map((r) => r.application_id)));
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to load deals'), 'error');
    } finally {
      setDealsLoading(false);
    }
  }, [params, canInvoice]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (selected) loadReferrer(selected); }, [selected, loadReferrer, refreshKey]);

  const current = summary.find((s) => s.referrer_id === selected);
  const tickedRows = deals.filter((d) => ticked.has(d.application_id));
  const tickedTotal = tickedRows.reduce((a, d) => a + (d.payee_share?.comms_inc_gst ?? 0), 0);

  const markTicked = async () => {
    if (!selected || !tickedRows.length) return;
    setMarking(true);
    try {
      const { data } = await api.post<{ updated: number }>('/ledger/deals/mark-paid', {
        application_ids: tickedRows.map((d) => d.application_id),
        payee_key: selected,
        status: bulkStatus,
        paid_on: bulkStatus === 'paid' ? bulkDate : null,
        scheduled_on: bulkStatus === 'scheduled' ? bulkDate : null,
        payment_method: bulkStatus === 'paid' || bulkStatus === 'scheduled' ? bulkMethod : null,
        payment_reference: bulkReference.trim() || null,
      });
      toast(`${data.updated} deal${data.updated === 1 ? '' : 's'} marked ${SHARE_STATUS_LABEL[bulkStatus].toLowerCase()}`, 'success');
      setBulkReference('');
      loadReferrer(selected);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to update'), 'error');
    } finally {
      setMarking(false);
    }
  };

  const createInvoice = async () => {
    if (!selected || !tickedRows.length) return;
    setCreating(true);
    try {
      const { data } = await api.post<LedgerInvoice>('/ledger/invoices', {
        referrer_id: selected,
        application_ids: tickedRows.map((d) => d.application_id),
        layout,
        period_from: range.from || null,
        period_to: range.to || null,
      });
      setOpenInvoice(data);
      loadReferrer(selected);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to create the invoice'), 'error');
    } finally {
      setCreating(false);
    }
  };

  const toggle = (id: string) => setTicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="space-y-4">
      <Card padding="none">
        <div className="px-4 py-3 border-b border-border flex items-baseline justify-between">
          <h2 className="text-[14px] font-semibold text-foreground">Deals by referrer</h2>
          <span className="text-[12px] text-muted-foreground">{summary.length} referrer{summary.length === 1 ? '' : 's'}</span>
        </div>
        {loading ? (
          <p className="px-4 py-6 text-[13px] text-muted-foreground">Loading…</p>
        ) : summary.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-muted-foreground">No referred deals settled in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-[12.5px]">
              <thead className="bg-[var(--led-surface-2)] text-[11.5px] text-[var(--led-ink-2)]">
                <tr>
                  <th className="px-3 py-2 text-left">Referrer</th>
                  <th className="px-3 py-2 text-right">Deals</th>
                  <th className="px-3 py-2 text-right">Settled volume</th>
                  <th className="px-3 py-2 text-right">Comms ex GST</th>
                  <th className="px-3 py-2 text-right">GST</th>
                  <th className="px-3 py-2 text-right">Comms inc GST</th>
                  {isOwner && <th className="px-3 py-2 text-right">Unpaid</th>}
                </tr>
              </thead>
              <tbody>
                {summary.map((s) => (
                  <tr
                    key={s.referrer_id}
                    onClick={() => setSelected(s.referrer_id === selected ? null : s.referrer_id)}
                    className={`border-t border-border cursor-pointer ${s.referrer_id === selected ? 'bg-[var(--led-surface-2)]' : 'hover:bg-[var(--led-surface-2)]/50'}`}
                  >
                    <td className="px-3 py-2">
                      <span className="font-medium text-foreground">{s.referrer_name || 'Unnamed referrer'}</span>
                      {s.referrer_organization && <span className="text-muted-foreground"> · {s.referrer_organization}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.deals}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatLedgerMoney(s.finance_amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatLedgerMoney(s.referrer_comms_ex_gst)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatLedgerMoney(s.referrer_comms_gst)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{formatLedgerMoney(s.referrer_comms_inc_gst)}</td>
                    {isOwner && (
                      <td className="px-3 py-2 text-right tabular-nums">
                        {s.unpaid_deals ? `${s.unpaid_deals} · ${formatLedgerMoney(s.unpaid_comms_inc_gst)}` : 'All paid'}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected && current && (
        <Card padding="none">
          <div className="px-4 py-3 border-b border-border flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[14px] font-semibold text-foreground">
              {current.referrer_name} — {current.deals} settled deal{current.deals === 1 ? '' : 's'}
            </h2>
            {selected.startsWith('u:') ? (
              <Link to={`/admin/referrers/${selected.slice(2)}`} className="text-[12px] text-[var(--led-accent)] hover:underline">Referrer profile</Link>
            ) : (
              <span className="text-[12px] text-muted-foreground">Off-portal payee</span>
            )}
          </div>
          {dealsLoading ? (
            <p className="px-4 py-6 text-[13px] text-muted-foreground">Loading…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-[12.5px]">
                <thead className="bg-[var(--led-surface-2)] text-[11.5px] text-[var(--led-ink-2)]">
                  <tr>
                    {isOwner && <th className="px-3 py-2 w-8" aria-label="Include on invoice" />}
                    <th className="px-3 py-2 text-left">Settled</th>
                    <th className="px-3 py-2 text-left">Client</th>
                    <th className="px-3 py-2 text-left">Entity</th>
                    <th className="px-3 py-2 text-left">Lender</th>
                    <th className="px-3 py-2 text-right">Finance amount</th>
                    <th className="px-3 py-2 text-left">Share</th>
                    <th className="px-3 py-2 text-right">Their comms inc GST</th>
                    {isOwner && <th className="px-3 py-2 text-left">Payment</th>}
                    {onEditDeal && <th />}
                  </tr>
                </thead>
                <tbody>
                  {deals.map((d) => (
                    <tr key={d.application_id} className={`border-t border-border ${d.is_clawback ? 'text-[var(--led-danger)]' : ''}`}>
                      {isOwner && (
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={ticked.has(d.application_id)} onChange={() => toggle(d.application_id)} aria-label={`Include ${d.customer_name}`} />
                        </td>
                      )}
                      <td className="px-3 py-2 whitespace-nowrap">{formatDate(d.settled_on)}</td>
                      <td className="px-3 py-2">
                        {d.is_manual ? (
                          <span className="font-medium text-foreground">{d.customer_name}</span>
                        ) : (
                          <Link to={`/admin/applications/${d.application_id}`} className="font-medium text-foreground hover:underline">{d.customer_name}</Link>
                        )}
                      </td>
                      <td className="px-3 py-2">{d.entity_name || '—'}</td>
                      <td className="px-3 py-2">{d.lender_name || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatLedgerMoney(d.finance_amount)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{shareText(d.payee_share, d)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatLedgerMoney(d.payee_share?.comms_inc_gst)}</td>
                      {isOwner && (
                        <td className="px-3 py-2 whitespace-nowrap" title={[d.payee_share?.payment_reference, d.payee_share?.payment_notes].filter(Boolean).join(' · ') || undefined}>
                          <span className={d.payee_share?.status === 'unpaid' ? 'text-muted-foreground' : ''}>{statusText(d.payee_share)}</span>
                        </td>
                      )}
                      {onEditDeal && (
                        <td className="px-2 py-1 text-right">
                          <button type="button" onClick={() => onEditDeal(d)} className="led-btn led-btn-ghost led-btn-sm">Edit</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {isOwner && deals.length > 0 && (
            <div className="px-4 py-3 border-t border-border flex flex-wrap items-center gap-3">
              <span className="text-[12.5px] text-foreground">
                {tickedRows.length} deal{tickedRows.length === 1 ? '' : 's'} · {formatLedgerMoney(tickedTotal)} inc GST
              </span>
              <div className="inline-flex rounded-md border border-border p-0.5" role="radiogroup" aria-label="Invoice layout">
                {([['breakdown', 'Itemise each deal'], ['single', 'One overall figure']] as const).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={layout === v}
                    onClick={() => setLayout(v)}
                    className={`rounded px-3 py-1 text-[12.5px] ${layout === v ? 'bg-[var(--led-ink)] text-[var(--led-surface)]' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Button size="sm" onClick={createInvoice} loading={creating} disabled={!tickedRows.length} className="ml-auto">
                Create invoice
              </Button>
            </div>
          )}

          {isOwner && deals.length > 0 && (
            <div className="px-4 py-3 border-t border-border flex flex-wrap items-end gap-2 text-[12.5px]">
              <span className="pb-2 text-muted-foreground">Mark the ticked deals</span>
              <select className="led-input !h-8 !w-auto text-[12.5px]" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value as LedgerShareStatus)}>
                {(Object.keys(SHARE_STATUS_LABEL) as LedgerShareStatus[]).map((k) => <option key={k} value={k}>{SHARE_STATUS_LABEL[k]}</option>)}
              </select>
              {(bulkStatus === 'paid' || bulkStatus === 'scheduled') && (
                <>
                  <input type="date" className="led-input !h-8 !w-auto text-[12.5px]" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} aria-label={bulkStatus === 'paid' ? 'Paid on' : 'Scheduled for'} />
                  <select className="led-input !h-8 !w-auto text-[12.5px]" value={bulkMethod} onChange={(e) => setBulkMethod(e.target.value)}>
                    {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </>
              )}
              <input className="led-input !h-8 !w-56 text-[12.5px]" value={bulkReference} placeholder="Reference, e.g. one transfer of $17,501.75" onChange={(e) => setBulkReference(e.target.value)} />
              <Button size="sm" variant="secondary" onClick={markTicked} loading={marking} disabled={!tickedRows.length}>Apply</Button>
            </div>
          )}

          {canInvoice && invoices.length > 0 && (
            <div className="px-4 py-3 border-t border-border">
              <p className="text-[12px] font-medium text-[var(--led-ink-2)] mb-1.5">Invoices for {current.referrer_name}</p>
              <div className="flex flex-wrap gap-2">
                {invoices.map((inv) => (
                  <button key={inv.id} type="button" onClick={() => setOpenInvoice(inv)} className="led-btn led-btn-outline led-btn-sm">
                    {inv.number} · {formatLedgerMoney(inv.total_inc_gst)} · {formatDate(inv.issue_date)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      <LedgerPayeesPanel payees={payees} isOwner={isOwner} onChanged={onPayeesChanged} />

      {openInvoice && (
        <LedgerInvoiceModal
          invoice={openInvoice}
          isOwner={isOwner}
          onClose={() => setOpenInvoice(null)}
          onPaid={() => { if (selected) loadReferrer(selected); }}
        />
      )}
    </div>
  );
}
