import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../Toast';
import { Button, Card } from '../ui';
import { formatDate, getErrorMessage } from '../../lib/utils';
import { formatLedgerMoney, PAYMENT_METHODS, SHARE_BASE_LABEL, SHARE_STATUS_LABEL } from '../../lib/ledger';
import type { LedgerDealRow, LedgerDealsResponse, LedgerExtraPayment, LedgerInvoice, LedgerPayee, LedgerReferrerSummary, LedgerShare, LedgerShareStatus } from '../../types';
import LedgerInvoiceModal from './LedgerInvoiceDocument';
import LedgerPayeesPanel from './LedgerPayeesPanel';
import LedgerExtraPaymentsPanel, { LedgerPaymentModal, type DealOption } from './LedgerExtraPayments';

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

const STATUS_CHIP: Record<LedgerShareStatus, string> = {
  paid: 'led-chip-success',
  scheduled: 'led-chip-info',
  unpaid: 'led-chip-warning',
  not_payable: '',
};

function StatusChip({ status, text }: { status: LedgerShareStatus | null | undefined; text: string }) {
  if (!status) return <span className="text-muted-foreground/60">—</span>;
  return <span className={`led-chip ${STATUS_CHIP[status]} !font-medium`}>{text}</span>;
}

/** Who referred how many settled deals in the range, and which team members
 *  were paid a cut — and, for one payee, every deal, client and extra payment
 *  on the same page, with the invoice built from them. */
export default function LedgerReferrersTab({ range, isOwner, canInvoice, onEditDeal, refreshKey, payees, onPayeesChanged, dealOptions, onChanged }: {
  range: { from: string; to: string };
  isOwner: boolean;
  canInvoice: boolean;
  onEditDeal?: (row: LedgerDealRow) => void;
  refreshKey: number;
  payees: LedgerPayee[];
  onPayeesChanged: () => void;
  dealOptions: DealOption[];
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [summary, setSummary] = useState<LedgerReferrerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [deals, setDeals] = useState<LedgerDealRow[]>([]);
  const [dealsLoading, setDealsLoading] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [extras, setExtras] = useState<LedgerExtraPayment[]>([]);
  const [tickedExtras, setTickedExtras] = useState<Set<string>>(new Set());
  const [addingExtra, setAddingExtra] = useState(false);
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
      const mine = data.extra_payments ?? [];
      setDeals(rows);
      setExtras(mine);
      setInvoices(inv.data);
      // Start with what hasn't been paid yet — what an invoice is usually for.
      setTicked(new Set(rows.filter((r) => {
        const st = r.payee_share?.status;
        return st === 'unpaid' || st === 'scheduled';
      }).map((r) => r.application_id)));
      setTickedExtras(new Set(mine.filter((p) => p.status !== 'paid').map((p) => p.id)));
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to load deals'), 'error');
    } finally {
      setDealsLoading(false);
    }
  }, [params, canInvoice]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (selected) loadReferrer(selected); }, [selected, loadReferrer, refreshKey]);

  const current = summary.find((s) => s.referrer_id === selected);
  const tickedRows = deals.filter((d) => ticked.has(d.application_id));
  const tickedExtraRows = extras.filter((p) => tickedExtras.has(p.id));
  const tickedCount = tickedRows.length + tickedExtraRows.length;
  const tickedTotal = tickedRows.reduce((a, d) => a + (d.payee_share?.comms_inc_gst ?? 0), 0)
    + tickedExtraRows.reduce((a, p) => a + p.amount_inc_gst, 0);

  const markTicked = async () => {
    if (!selected || !tickedCount) return;
    setMarking(true);
    try {
      const { data } = await api.post<{ updated: number }>('/ledger/deals/mark-paid', {
        application_ids: tickedRows.map((d) => d.application_id),
        payment_ids: tickedExtraRows.map((p) => p.id),
        payee_key: selected,
        status: bulkStatus,
        paid_on: bulkStatus === 'paid' ? bulkDate : null,
        scheduled_on: bulkStatus === 'scheduled' ? bulkDate : null,
        payment_method: bulkStatus === 'paid' || bulkStatus === 'scheduled' ? bulkMethod : null,
        payment_reference: bulkReference.trim() || null,
      });
      toast(`${data.updated} item${data.updated === 1 ? '' : 's'} marked ${SHARE_STATUS_LABEL[bulkStatus].toLowerCase()}`, 'success');
      setBulkReference('');
      loadReferrer(selected);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to update'), 'error');
    } finally {
      setMarking(false);
    }
  };

  const createInvoice = async () => {
    if (!selected || !tickedCount) return;
    setCreating(true);
    try {
      const { data } = await api.post<LedgerInvoice>('/ledger/invoices', {
        referrer_id: selected,
        application_ids: tickedRows.map((d) => d.application_id),
        payment_ids: tickedExtraRows.map((p) => p.id),
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
  const toggleExtra = (id: string) => setTickedExtras((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="space-y-4">
      <Card padding="none">
        <div className="px-4 py-3 border-b border-border flex items-baseline justify-between">
          <h2 className="text-[14px] font-semibold text-foreground">Commission by referrer &amp; staff</h2>
          <span className="text-[12px] text-muted-foreground">
            {summary.length} payee{summary.length === 1 ? '' : 's'}{summary.length > 0 ? ' · click one to see their deals and invoice them' : ''}
          </span>
        </div>
        {loading ? (
          <p className="px-4 py-6 text-[13px] text-muted-foreground">Loading…</p>
        ) : summary.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-muted-foreground">Nobody was paid on deals settled in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-[12.5px]">
              <thead className="bg-[var(--led-surface-2)] text-[11.5px] text-[var(--led-ink-2)]">
                <tr>
                  <th className="px-3 py-2 text-left">Paid to</th>
                  <th className="px-3 py-2 text-right">Deals</th>
                  <th className="px-3 py-2 text-right">Settled volume</th>
                  <th className="px-3 py-2 text-right">Comms ex GST</th>
                  <th className="px-3 py-2 text-right">GST</th>
                  <th className="px-3 py-2 text-right">Comms inc GST</th>
                  <th className="px-3 py-2 text-right">Extra payments inc GST</th>
                  <th className="px-3 py-2 text-right">Total inc GST</th>
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
                      <span className="font-medium text-foreground">{s.referrer_name || 'Unnamed payee'}</span>
                      {s.referrer_organization && <span className="text-muted-foreground"> · {s.referrer_organization}</span>}
                      <span className={`ml-2 led-chip !h-[18px] !px-1.5 !text-[10.5px] ${s.payee_kind === 'staff' ? 'led-chip-violet' : ''}`}>{s.payee_kind === 'staff' ? 'Staff' : 'Referrer'}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.deals}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatLedgerMoney(s.finance_amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatLedgerMoney(s.referrer_comms_ex_gst)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatLedgerMoney(s.referrer_comms_gst)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatLedgerMoney(s.referrer_comms_inc_gst)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.extra_payments ? formatLedgerMoney(s.extra_payments_inc_gst) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{formatLedgerMoney(s.total_inc_gst)}</td>
                    {isOwner && (
                      <td className="px-3 py-2 text-right tabular-nums">
                        {(s.unpaid_deals || s.unpaid_extra_payments)
                          ? <span className="led-chip led-chip-warning !font-medium tabular-nums">{formatLedgerMoney(s.unpaid_comms_inc_gst)}</span>
                          : <span className="led-chip led-chip-success !font-medium">All paid</span>}
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
              {current.extra_payments > 0 && <> · {current.extra_payments} extra payment{current.extra_payments === 1 ? '' : 's'}</>}
            </h2>
            <div className="flex items-center gap-3">
              {isOwner && <Button size="sm" variant="secondary" onClick={() => setAddingExtra(true)}>Add extra payment</Button>}
              {selected.startsWith('u:') && current.payee_kind !== 'staff' ? (
                <Link to={`/admin/referrers/${selected.slice(2)}`} className="text-[12px] text-[var(--led-accent)] hover:underline">Referrer profile</Link>
              ) : (
                <span className="text-[12px] text-muted-foreground">{current.payee_kind === 'staff' ? 'Team member' : 'Off-portal payee'}</span>
              )}
            </div>
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
                          <StatusChip status={d.payee_share?.status} text={statusText(d.payee_share)} />
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

          {extras.length > 0 && (
            <div className="border-t border-border overflow-x-auto">
              <p className="px-4 pt-3 text-[12px] font-medium text-[var(--led-ink-2)]">Extra payments</p>
              <table className="min-w-full text-[12.5px]">
                <tbody>
                  {extras.map((p) => (
                    <tr key={p.id} className="border-t border-border first:border-t-0">
                      {isOwner && (
                        <td className="px-3 py-2 w-8">
                          <input type="checkbox" checked={tickedExtras.has(p.id)} onChange={() => toggleExtra(p.id)} aria-label={`Include ${p.category_label}`} />
                        </td>
                      )}
                      <td className="px-3 py-2 whitespace-nowrap">{formatDate(p.payment_date)}</td>
                      <td className="px-3 py-2">
                        {p.category_label}
                        {p.description && <span className="text-muted-foreground"> — {p.description}</span>}
                        {p.deal_name && <div className="text-muted-foreground">Re: {p.deal_name}</div>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatLedgerMoney(p.amount_inc_gst)} inc GST</td>
                      {isOwner && (
                        <td className="px-3 py-2 whitespace-nowrap" title={p.notes ?? undefined}>
                          <StatusChip
                            status={p.status === 'paid' ? 'paid' : p.status === 'scheduled' ? 'scheduled' : 'unpaid'}
                            text={p.status === 'paid' ? `Paid${p.paid_on ? ` ${formatDate(p.paid_on)}` : ''}` : p.status === 'scheduled' ? 'Scheduled' : 'Unpaid'}
                          />
                        </td>
                      )}
                      {isOwner && <td className="px-3 py-2 text-muted-foreground max-w-[280px] truncate" title={p.notes ?? undefined}>{p.notes || ''}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {isOwner && (deals.length > 0 || extras.length > 0) && (
            <div className="border-t border-border bg-[var(--led-surface-2)] px-4 py-3 space-y-3 text-[12.5px]">
              <p className="font-medium text-foreground">
                {tickedCount ? <>{tickedCount} ticked · <span className="tabular-nums">{formatLedgerMoney(tickedTotal)}</span> inc GST</> : 'Tick the deals and payments to invoice or mark paid'}
              </p>
              <div className="grid gap-3 lg:grid-cols-[auto_1fr]">
                <div className="space-y-1.5">
                  <p className="led-label">Invoice</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="led-segment" role="radiogroup" aria-label="Invoice layout">
                      {([['breakdown', 'Itemise each deal'], ['single', 'One overall figure']] as const).map(([v, label]) => (
                        <button key={v} type="button" role="radio" aria-checked={layout === v} className={layout === v ? 'led-active' : ''} onClick={() => setLayout(v)}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <Button size="sm" onClick={createInvoice} loading={creating} disabled={!tickedCount}>Create invoice</Button>
                  </div>
                </div>
                <div className="space-y-1.5 lg:border-l lg:border-border lg:pl-4">
                  <p className="led-label">Record payment</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <select className="led-input !h-8 !w-auto text-[12.5px]" aria-label="Mark as" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value as LedgerShareStatus)}>
                      {(Object.keys(SHARE_STATUS_LABEL) as LedgerShareStatus[]).map((k) => <option key={k} value={k}>{SHARE_STATUS_LABEL[k]}</option>)}
                    </select>
                    {(bulkStatus === 'paid' || bulkStatus === 'scheduled') && (
                      <>
                        <input type="date" className="led-input !h-8 !w-auto text-[12.5px]" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} aria-label={bulkStatus === 'paid' ? 'Paid on' : 'Scheduled for'} />
                        <select className="led-input !h-8 !w-auto text-[12.5px]" aria-label="Method" value={bulkMethod} onChange={(e) => setBulkMethod(e.target.value)}>
                          {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
                        </select>
                      </>
                    )}
                    <input className="led-input !h-8 !w-56 text-[12.5px]" value={bulkReference} placeholder="Reference (optional)" onChange={(e) => setBulkReference(e.target.value)} />
                    <Button size="sm" variant="secondary" onClick={markTicked} loading={marking} disabled={!tickedCount}>Apply</Button>
                  </div>
                </div>
              </div>
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

      <LedgerExtraPaymentsPanel range={range} isOwner={isOwner} payees={payees} dealOptions={dealOptions} refreshKey={refreshKey} onChanged={onChanged} />

      <LedgerPayeesPanel payees={payees} isOwner={isOwner} onChanged={onPayeesChanged} />

      {addingExtra && selected && (
        <LedgerPaymentModal
          payment={null}
          payees={payees}
          dealOptions={dealOptions}
          defaultPayeeKey={selected}
          onClose={() => setAddingExtra(false)}
          onSaved={onChanged}
        />
      )}

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
