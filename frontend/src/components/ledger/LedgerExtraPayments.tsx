import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../Toast';
import { useConfirm } from '../../hooks/useConfirm';
import { Button, Card } from '../ui';
import { formatDate, getErrorMessage } from '../../lib/utils';
import { extraPaymentStatusText, formatLedgerMoney, PAYMENT_CATEGORY_LABEL, PAYMENT_METHODS } from '../../lib/ledger';
import type { LedgerExtraPayment, LedgerPayee, LedgerPaymentCategory } from '../../types';
import LedgerModal from './LedgerModal';

export interface DealOption { key: string; label: string }

/** A deal from any month, as /ledger/deal-options gives it. */
interface DealOptionOut { key: string; label: string; settled_on: string | null; is_pipeline: boolean }

const dealOptionLabel = (d: DealOptionOut) =>
  [d.label || 'Unnamed deal', d.is_pipeline ? '(pipeline)' : d.settled_on ? `settled ${formatDate(d.settled_on)}` : null]
    .filter(Boolean).join(' · ');

const toNum = (s: string): number | null => {
  const t = s.replace(/[$,\s]/g, '');
  if (t === '' || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

const payeeOptionLabel = (p: LedgerPayee) =>
  `${p.name || p.organization_name || 'Unnamed'}${p.organization_name && p.name ? ` · ${p.organization_name}` : ''}${p.is_portal ? '' : ' (off-portal)'}`;

/** A payee picker split into referrers and staff. */
export function PayeeSelect({ payees, value, onChange, className, placeholder = 'Choose…', exclude }: {
  payees: LedgerPayee[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
  placeholder?: string;
  exclude?: Set<string>;
}) {
  const shown = payees.filter((p) => (p.is_active || p.key === value) && !exclude?.has(p.key));
  const referrers = shown.filter((p) => p.kind !== 'staff');
  const staff = shown.filter((p) => p.kind === 'staff');
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {referrers.length > 0 && (
        <optgroup label="Referrers">
          {referrers.map((p) => <option key={p.key} value={p.key}>{payeeOptionLabel(p)}</option>)}
        </optgroup>
      )}
      {staff.length > 0 && (
        <optgroup label="Staff">
          {staff.map((p) => <option key={p.key} value={p.key}>{payeeOptionLabel(p)}</option>)}
        </optgroup>
      )}
    </select>
  );
}

/** Add or change one extra payment: a one-off to a referrer or staff member —
 *  extra work, a split of a mandate fee, a staff bonus, a payment made months
 *  after a deal. It may be linked to a deal from any month, or to none; either
 *  way it counts in the month of its date and comes off that month's final profit. */
export function LedgerPaymentModal({ payment, payees, dealOptions, defaultPayeeKey, onClose, onSaved }: {
  payment: LedgerExtraPayment | null;
  payees: LedgerPayee[];
  dealOptions: DealOption[];
  defaultPayeeKey?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [payeeKey, setPayeeKey] = useState(payment?.payee_key ?? defaultPayeeKey ?? '');
  const [date, setDate] = useState(payment?.payment_date ?? today());
  const [category, setCategory] = useState<LedgerPaymentCategory>(payment?.category ?? 'extra_service');
  const [description, setDescription] = useState(payment?.description ?? '');
  const [amount, setAmount] = useState(payment ? String(payment.amount_ex_gst) : '');
  const [gst, setGst] = useState<'auto' | 'yes' | 'no'>(payment?.gst_set ? (payment.gst ? 'yes' : 'no') : 'auto');
  const [dealKey, setDealKey] = useState(payment?.deal_key ?? '');
  const [status, setStatus] = useState<'unpaid' | 'scheduled' | 'paid'>(payment?.status ?? 'unpaid');
  const [scheduledOn, setScheduledOn] = useState(payment?.scheduled_on ?? '');
  const [paidOn, setPaidOn] = useState(payment?.paid_on ?? '');
  const [method, setMethod] = useState(payment?.payment_method ?? '');
  const [reference, setReference] = useState(payment?.payment_reference ?? '');
  const [notes, setNotes] = useState(payment?.notes ?? '');
  const [saving, setSaving] = useState(false);
  // Every deal from any month, so a payment made long after can still be linked.
  const [allDeals, setAllDeals] = useState<DealOption[] | null>(null);
  const [dealSearch, setDealSearch] = useState('');
  useEffect(() => {
    api.get<DealOptionOut[]>('/ledger/deal-options')
      .then(({ data }) => setAllDeals(data.map((d) => ({ key: d.key, label: dealOptionLabel(d) }))))
      .catch(() => setAllDeals(null)); // fall back to this period's deals
  }, []);

  const payee = payees.find((p) => p.key === payeeKey);
  const ex = toNum(amount) ?? 0;
  const gstOn = gst === 'auto' ? Boolean(payee?.gst_registered) : gst === 'yes';
  const gstAmount = gstOn ? round2(ex * 0.1) : 0;
  // A staff member's payment is usually a bonus; a referrer's, extra work.
  const pickPayee = (key: string) => {
    setPayeeKey(key);
    const p = payees.find((x) => x.key === key);
    if (!payment && p?.kind === 'staff' && category === 'extra_service') setCategory('staff_bonus');
  };

  const save = async () => {
    if (!payeeKey) { toast('Choose who is paid', 'error'); return; }
    if (toNum(amount) == null) { toast('Enter the amount (ex GST)', 'error'); return; }
    if (status === 'paid' && !paidOn) { toast('Enter the date it was paid', 'error'); return; }
    if (status === 'scheduled' && !scheduledOn) { toast('Enter the date it is scheduled for', 'error'); return; }
    const body = {
      payee_key: payeeKey,
      payment_date: date,
      category,
      description: description.trim() || null,
      amount: toNum(amount),
      gst: gst === 'auto' ? null : gst === 'yes',
      deal_key: dealKey || null,
      status,
      scheduled_on: status === 'scheduled' ? scheduledOn : null,
      paid_on: status === 'paid' ? paidOn : null,
      payment_method: method || null,
      payment_reference: reference.trim() || null,
      notes: notes.trim() || null,
    };
    setSaving(true);
    try {
      if (payment) await api.put(`/ledger/payments/${payment.id}`, body);
      else await api.post('/ledger/payments', body);
      toast('Saved', 'success');
      onSaved();
      onClose();
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to save'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!payment) return;
    const ok = await confirm({ title: 'Delete this extra payment?', message: `${payment.payee_name || 'Unnamed'} · ${formatLedgerMoney(payment.amount_inc_gst)} inc GST`, confirmText: 'Delete', variant: 'danger' });
    if (!ok) return;
    try {
      await api.delete(`/ledger/payments/${payment.id}`);
      toast('Deleted', 'success');
      onSaved();
      onClose();
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to delete'), 'error');
    }
  };

  const inputCls = 'led-input !h-9 w-full text-[13px]';
  const labelCls = 'mb-1 block text-[12px] font-medium text-[var(--led-ink-2)]';
  const dealSource = allDeals ?? dealOptions;
  const q = dealSearch.trim().toLowerCase();
  const matching = q ? dealSource.filter((d) => d.label.toLowerCase().includes(q)) : dealSource;
  // The linked deal stays choosable even when the search hides it.
  const linked = dealKey ? dealSource.find((d) => d.key === dealKey) ?? { key: dealKey, label: payment?.deal_name || 'Linked deal' } : null;
  const dealChoices = linked && !matching.some((d) => d.key === linked.key) ? [linked, ...matching] : matching;

  return (
    <LedgerModal
      title={payment ? 'Extra payment' : 'Add an extra payment'}
      subtitle="A one-off payment to a referrer or staff member. Link it to a deal from any month, or leave it on its own — it counts in the month of its date and comes off that month's final profit."
      onClose={onClose}
      wide
      footer={
        <>
          {payment && <Button variant="ghost" onClick={remove} className="mr-auto">Delete</Button>}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving}>Save</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block sm:col-span-2">
          <span className={labelCls}>Paid to</span>
          <PayeeSelect payees={payees} value={payeeKey} onChange={pickPayee} className={inputCls} />
        </label>
        <label className="block">
          <span className={labelCls}>Month / date it belongs to</span>
          <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="block">
          <span className={labelCls}>What for</span>
          <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value as LedgerPaymentCategory)}>
            {(Object.keys(PAYMENT_CATEGORY_LABEL) as LedgerPaymentCategory[]).map((k) => <option key={k} value={k}>{PAYMENT_CATEGORY_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className={labelCls}>Description</span>
          <input className={inputCls} value={description} placeholder="e.g. prepared FY25 financials for the lender" onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="block">
          <span className={labelCls}>Amount (ex GST)</span>
          <input className={inputCls} inputMode="decimal" value={amount} placeholder="0.00" onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="block">
          <span className={labelCls}>GST</span>
          <select className={inputCls} value={gst} onChange={(e) => setGst(e.target.value as typeof gst)}>
            <option value="auto">Follow the payee ({payee?.gst_registered ? 'GST registered' : 'not registered'})</option>
            <option value="yes">Add GST</option>
            <option value="no">No GST</option>
          </select>
        </label>
      </div>
      <div className="mt-3">
        <span className={labelCls}>Linked deal (optional) — any month</span>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,220px)_1fr]">
          <input
            className={inputCls}
            value={dealSearch}
            placeholder={allDeals ? `Search ${allDeals.length} deals…` : 'Search deals…'}
            aria-label="Search deals"
            onChange={(e) => setDealSearch(e.target.value)}
          />
          <select className={inputCls} value={dealKey} onChange={(e) => setDealKey(e.target.value)} aria-label="Linked deal">
            <option value="">Not linked to a deal</option>
            {dealChoices.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </div>
        {q && matching.length === 0 && <p className="mt-1 text-[11.5px] text-muted-foreground">No deal matches “{dealSearch.trim()}”.</p>}
        {dealKey && (
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            Shown against that deal for reference — it still counts in {date ? new Date(`${date}T00:00:00`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }) : 'the month of its date'}, not the deal&rsquo;s month.
          </p>
        )}
      </div>
      <p className="mt-2 text-[12.5px] text-foreground">
        {formatLedgerMoney(ex)} ex GST{gstOn && <> + {formatLedgerMoney(gstAmount)} GST = <span className="font-medium">{formatLedgerMoney(ex + gstAmount)}</span></>}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <label className="block">
          <span className={labelCls}>Payment</span>
          <select className={inputCls} value={status} onChange={(e) => {
            const next = e.target.value as typeof status;
            setStatus(next);
            if (next === 'paid' && !paidOn) setPaidOn(today());
          }}>
            <option value="unpaid">Unpaid</option>
            <option value="scheduled">Scheduled</option>
            <option value="paid">Paid</option>
          </select>
        </label>
        {status === 'scheduled' && (
          <label className="block">
            <span className={labelCls}>Scheduled for</span>
            <input type="date" className={inputCls} value={scheduledOn} onChange={(e) => setScheduledOn(e.target.value)} />
          </label>
        )}
        {status === 'paid' && (
          <label className="block">
            <span className={labelCls}>Paid on</span>
            <input type="date" className={inputCls} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </label>
        )}
        {status !== 'unpaid' && (
          <>
            <label className="block">
              <span className={labelCls}>Payment type</span>
              <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="">—</option>
                {[...new Set([...PAYMENT_METHODS, ...(method ? [method] : [])])].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={labelCls}>Reference</span>
              <input className={inputCls} value={reference} onChange={(e) => setReference(e.target.value)} />
            </label>
          </>
        )}
      </div>
      <label className="mt-3 block">
        <span className={labelCls}>Notes — why this payment was made</span>
        <textarea
          className="led-input w-full min-h-[70px] py-2 text-[13px]"
          value={notes}
          placeholder="e.g. agreed with Paras on 12/09 to split the $2,000 mandate fee 50/50"
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
    </LedgerModal>
  );
}

/** Every extra payment in the period, for the owner to add to and keep up. */
export default function LedgerExtraPaymentsPanel({ range, isOwner, payees, dealOptions, refreshKey, onChanged }: {
  range: { from: string; to: string };
  isOwner: boolean;
  payees: LedgerPayee[];
  dealOptions: DealOption[];
  refreshKey: number;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<LedgerExtraPayment[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<LedgerExtraPayment | 'new' | null>(null);
  const params = useMemo(() => ({ date_from: range.from || undefined, date_to: range.to || undefined }), [range]);

  // Reloads keep the current list on screen until the new one arrives.
  useEffect(() => {
    api.get<{ payments: LedgerExtraPayment[]; totals: Record<string, number> }>('/ledger/payments', { params })
      .then(({ data }) => { setItems(data.payments); setTotals(data.totals); })
      .catch((err) => toast(getErrorMessage(err, 'Failed to load extra payments'), 'error'))
      .finally(() => setLoading(false));
  }, [params, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (p: LedgerExtraPayment) => {
    const ok = await confirm({ title: 'Delete this extra payment?', message: `${p.payee_name} · ${formatLedgerMoney(p.amount_inc_gst)}`, confirmText: 'Delete', variant: 'danger' });
    if (!ok) return;
    try {
      await api.delete(`/ledger/payments/${p.id}`);
      onChanged();
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to delete'), 'error');
    }
  };

  return (
    <Card padding="none">
      <div className="px-4 py-3 border-b border-border flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[14px] font-semibold text-foreground">Extra payments</h2>
          <p className="text-[12px] text-muted-foreground">
            One-off payments outside a deal&rsquo;s agreed comms — extra services, a split of a mandate fee, a staff bonus,
            or a payment made months later. Linked to a deal or not, each comes off the final profit of the month it was paid.
          </p>
        </div>
        {isOwner && <Button size="sm" onClick={() => setEditing('new')}>Add extra payment</Button>}
      </div>
      {loading ? (
        <p className="px-4 py-6 text-[13px] text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="px-4 py-6 text-[13px] text-muted-foreground">No extra payments in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-[12.5px]">
            <thead className="bg-[var(--led-surface-2)] text-[11.5px] text-[var(--led-ink-2)]">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Paid to</th>
                <th className="px-3 py-2 text-left">What for</th>
                <th className="px-3 py-2 text-left">Deal</th>
                <th className="px-3 py-2 text-right">Ex GST</th>
                <th className="px-3 py-2 text-right">GST</th>
                <th className="px-3 py-2 text-right">Inc GST</th>
                {isOwner && <th className="px-3 py-2 text-left">Payment</th>}
                {isOwner && <th className="px-3 py-2 text-left">Notes</th>}
                {isOwner && <th />}
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(p.payment_date)}</td>
                  <td className="px-3 py-2">
                    <span className="font-medium text-foreground">{p.payee_name || 'Unnamed'}</span>
                    <span className="ml-1.5 rounded border border-border px-1.5 py-px text-[10.5px] text-muted-foreground">{p.payee_kind === 'staff' ? 'Staff' : 'Referrer'}</span>
                  </td>
                  <td className="px-3 py-2">
                    {p.category_label}
                    {p.description && <div className="text-muted-foreground">{p.description}</div>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{p.deal_name || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatLedgerMoney(p.amount_ex_gst)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatLedgerMoney(p.gst_amount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{formatLedgerMoney(p.amount_inc_gst)}</td>
                  {isOwner && <td className="px-3 py-2 whitespace-nowrap">{extraPaymentStatusText(p)}</td>}
                  {isOwner && <td className="px-3 py-2 max-w-[260px] truncate" title={p.notes ?? undefined}>{p.notes || '—'}</td>}
                  {isOwner && (
                    <td className="px-2 py-1 text-right whitespace-nowrap">
                      <button type="button" className="led-btn led-btn-ghost led-btn-sm" onClick={() => setEditing(p)}>Edit</button>
                      <button type="button" className="led-btn led-btn-ghost led-btn-sm" onClick={() => remove(p)}>Delete</button>
                    </td>
                  )}
                </tr>
              ))}
              <tr className="border-t border-border bg-[var(--led-surface-2)] font-semibold">
                <td className="px-3 py-2" colSpan={4}>Total · {items.length}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatLedgerMoney(totals.extra_payments_ex_gst)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatLedgerMoney(totals.extra_payments_gst)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatLedgerMoney(totals.extra_payments_inc_gst)}</td>
                {isOwner && <td colSpan={3} />}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <LedgerPaymentModal
          payment={editing === 'new' ? null : editing}
          payees={payees}
          dealOptions={dealOptions}
          onClose={() => setEditing(null)}
          onSaved={onChanged}
        />
      )}
    </Card>
  );
}
