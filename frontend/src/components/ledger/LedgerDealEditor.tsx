import { useMemo, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../Toast';
import { useConfirm } from '../../hooks/useConfirm';
import { Button } from '../ui';
import { getErrorMessage, formatDate } from '../../lib/utils';
import { CATEGORY_STYLE, formatLedgerMoney, PAYMENT_METHODS, SHARE_BASE_LABEL, SHARE_STATUS_LABEL } from '../../lib/ledger';
import type { LedgerBroker, LedgerCategory, LedgerDealRow, LedgerPayee, LedgerShare, LedgerShareBase, LedgerShareStatus } from '../../types';
import LedgerModal from './LedgerModal';

type MoneyField = 'finance_amount' | 'brokerage' | 'doc_fee' | 'origination_fee' | 'vir' | 'volume_bonus';

const MONEY_FIELDS: { key: MoneyField; label: string }[] = [
  { key: 'finance_amount', label: 'Finance amount' },
  { key: 'brokerage', label: 'Brokerage (ex GST)' },
  { key: 'doc_fee', label: 'Doc fee (ex GST)' },
  { key: 'origination_fee', label: 'Origination fee (ex GST)' },
  { key: 'vir', label: 'VIR — vehicle inspection (ex GST)' },
  { key: 'volume_bonus', label: 'Possible volume bonus (ex GST)' },
];
// Figures the application can prefill; the rest start blank.
const PREFILLABLE = new Set<MoneyField>(['finance_amount', 'brokerage', 'doc_fee', 'origination_fee', 'vir', 'volume_bonus']);

/** How the volume bonus estimate was reached, for the hint under the field. */
function vbHint(deal: LedgerDealRow): string {
  const base = 'For reference — final profit uses the bonus actually received for the month.';
  if (deal.vb_rate == null) return `No VBI rate for this lender/deal — type one in, or set the rate on the lender. ${base}`;
  return `Estimate: finance amount ex GST × ${deal.vb_rate}% VBI × ${deal.vb_share ?? 0}% our share (month settled ${formatLedgerMoney(deal.vb_month_volume ?? 0)}). ${base}`;
}

const toNum = (s: string): number | null => {
  const t = s.replace(/[$,\s]/g, '');
  if (t === '' || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

/** One payee's share as the form holds it. */
interface ShareDraft {
  uid: number;
  payeeKey: string;
  mode: 'percent' | 'dollar';
  percent: string;
  base: LedgerShareBase;
  amount: string;
  gst: 'auto' | 'yes' | 'no';
  status: LedgerShareStatus;
  scheduledOn: string;
  paidOn: string;
  method: string;
  reference: string;
  notes: string;
}

let nextUid = 1;

function draftFromShare(s: LedgerShare): ShareDraft {
  return {
    uid: nextUid++,
    payeeKey: s.payee_key,
    mode: s.share_amount != null ? 'dollar' : 'percent',
    percent: s.share_percent != null ? String(s.share_percent) : '',
    base: s.share_base ?? 'brokerage',
    amount: s.share_amount != null ? String(s.share_amount) : '',
    gst: s.share_gst_set ? (s.share_gst ? 'yes' : 'no') : 'auto',
    status: s.status ?? 'unpaid',
    scheduledOn: s.scheduled_on ?? '',
    paidOn: s.paid_on ?? '',
    method: s.payment_method ?? '',
    reference: s.payment_reference ?? '',
    notes: s.payment_notes ?? '',
  };
}

function draftForPayee(p: LedgerPayee | undefined, key: string): ShareDraft {
  return {
    uid: nextUid++,
    payeeKey: key,
    mode: p?.default_share_amount != null ? 'dollar' : 'percent',
    percent: p?.default_share_percent != null ? String(p.default_share_percent) : '',
    base: p?.default_share_base ?? 'brokerage',
    amount: p?.default_share_amount != null ? String(p.default_share_amount) : '',
    gst: 'auto',
    status: 'unpaid',
    scheduledOn: '',
    paidOn: '',
    method: '',
    reference: '',
    notes: '',
  };
}

const payeeLabel = (p: LedgerPayee) =>
  `${p.name || p.organization_name || 'Unnamed'}${p.organization_name && p.name ? ` · ${p.organization_name}` : ''}${p.is_portal ? '' : ' (off-portal)'}`;

/** The owner's editor for one deal: what the deal is (ledger-only deals),
 *  our income, everyone who shares in it and how much, and where each payment
 *  stands. Blank figures fall back to what the application says. */
export default function LedgerDealEditor({ deal, payees, brokers, onClose, onSaved, onDeleted }: {
  deal: LedgerDealRow;
  payees: LedgerPayee[];
  brokers: LedgerBroker[];
  onClose: () => void;
  onSaved: (row: LedgerDealRow) => void;
  onDeleted?: (key: string) => void;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const prefilled = new Set(deal.prefilled ?? []);
  const manual = Boolean(deal.is_manual);

  const initialMoney = Object.fromEntries(MONEY_FIELDS.map(({ key }) => {
    const value = deal[key] ?? 0;
    const blank = prefilled.has(key) || (!PREFILLABLE.has(key) && value === 0) || (manual && value === 0);
    return [key, blank ? '' : String(value)];
  })) as Record<MoneyField, string>;

  const [money, setMoney] = useState(initialMoney);
  const [incomeGst, setIncomeGst] = useState(deal.income_gst ?? true);
  const [clawback, setClawback] = useState(deal.is_clawback);
  const [lender, setLender] = useState(prefilled.has('lender_name') ? '' : deal.lender_name ?? '');
  const [newLead, setNewLead] = useState(deal.new_lead);
  const [repeat, setRepeat] = useState(deal.repeat_customer);
  const [dealNotes, setDealNotes] = useState(deal.notes ?? '');
  // Ledger-only deals: the deal itself.
  const [settledOn, setSettledOn] = useState(deal.settled_on);
  const [customer, setCustomer] = useState(deal.customer_name);
  const [entity, setEntity] = useState(deal.entity_name ?? '');
  const [category, setCategory] = useState<LedgerCategory | ''>(deal.category ?? '');
  const [brokerId, setBrokerId] = useState(deal.broker_ids?.[0] ?? '');
  const [brokerName, setBrokerName] = useState(deal.broker_ids?.length ? '' : deal.broker_name ?? '');

  const initialShares = useMemo(() => (deal.shares ?? []).map(draftFromShare), [deal]);
  const [shares, setShares] = useState<ShareDraft[]>(initialShares);
  const [adding, setAdding] = useState('');
  const [saving, setSaving] = useState(false);

  const payeeByKey = useMemo(() => new Map(payees.map((p) => [p.key, p])), [payees]);
  // A payee on the deal may no longer be listed (e.g. a deactivated referrer).
  const nameFor = (key: string) => {
    const p = payeeByKey.get(key);
    if (p) return payeeLabel(p);
    const s = deal.shares?.find((x) => x.payee_key === key);
    return s?.payee_name || 'Unknown payee';
  };

  const fig = (key: MoneyField) => toNum(money[key]) ?? (prefilled.has(key) ? deal[key] ?? 0 : 0);

  // The same sums the server does, so the owner sees each cut before saving.
  const preview = useMemo(() => {
    const rate = incomeGst ? 0.1 : 0;
    const income = fig('brokerage') + fig('doc_fee') + fig('origination_fee') + fig('vir');
    const bases = { brokerage: fig('brokerage'), total_income: income, finance_amount: fig('finance_amount') };
    const each = shares.map((s) => {
      const comms = s.mode === 'dollar' ? toNum(s.amount) ?? 0 : round2(bases[s.base] * (toNum(s.percent) ?? 0) / 100);
      const registered = payeeByKey.get(s.payeeKey)?.gst_registered
        ?? deal.shares?.find((x) => x.payee_key === s.payeeKey)?.share_gst ?? false;
      const gstOn = s.gst === 'auto' ? Boolean(registered) : s.gst === 'yes';
      return { comms, gst: gstOn ? round2(comms * 0.1) : 0, gstOn, registered: Boolean(registered) };
    });
    const comms = each.reduce((a, e) => a + e.comms, 0);
    return { income, incomeInc: round2(income * (1 + rate)), each, comms, net: round2(income - comms) };
  }, [money, incomeGst, shares, payeeByKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateShare = (uid: number, patch: Partial<ShareDraft>) =>
    setShares((prev) => prev.map((s) => (s.uid === uid ? { ...s, ...patch } : s)));

  const addPayee = (key: string) => {
    if (!key || shares.some((s) => s.payeeKey === key)) return;
    setShares((prev) => [...prev, draftForPayee(payeeByKey.get(key), key)]);
    setAdding('');
  };

  const sharesBody = () => shares.map((s) => ({
    payee_key: s.payeeKey,
    share_percent: s.mode === 'percent' ? toNum(s.percent) : null,
    share_base: s.base,
    share_amount: s.mode === 'dollar' ? toNum(s.amount) : null,
    share_gst: s.gst === 'auto' ? null : s.gst === 'yes',
    status: s.status,
    scheduled_on: s.status === 'scheduled' ? s.scheduledOn || null : null,
    paid_on: s.status === 'paid' ? s.paidOn || null : null,
    payment_method: s.method || null,
    payment_reference: s.reference.trim() || null,
    payment_notes: s.notes.trim() || null,
  }));

  const save = async () => {
    for (const s of shares) {
      if (s.status === 'paid' && !s.paidOn) { toast(`Enter the date ${nameFor(s.payeeKey)} was paid`, 'error'); return; }
      if (s.status === 'scheduled' && !s.scheduledOn) { toast(`Enter the date ${nameFor(s.payeeKey)} is scheduled for`, 'error'); return; }
    }
    if (manual && (!customer.trim() || !settledOn)) { toast('A ledger-only deal needs a customer and a settled date', 'error'); return; }
    setSaving(true);
    const body: Record<string, unknown> = {
      ...Object.fromEntries(MONEY_FIELDS.map(({ key }) => [key, toNum(money[key])])),
      income_gst: incomeGst,
      is_clawback: clawback,
      lender_name: lender.trim() || null,
      notes: dealNotes.trim() || null,
    };
    if (newLead !== deal.new_lead) body.new_lead = newLead;
    if (repeat !== deal.repeat_customer) body.repeat_customer = repeat;
    if (manual) {
      Object.assign(body, {
        manual_settled_on: settledOn,
        manual_customer_name: customer.trim(),
        manual_entity_name: entity.trim() || null,
        manual_category: category || null,
        manual_broker_id: brokerId || null,
        manual_broker_name: brokerId ? null : brokerName.trim() || null,
      });
    }
    // Only write shares when they changed — an untouched implied share keeps
    // following the client's referrer.
    const sharesChanged = JSON.stringify(shares.map(({ uid: _u, ...rest }) => rest))
      !== JSON.stringify(initialShares.map(({ uid: _u, ...rest }) => rest));
    try {
      let { data } = await api.patch<LedgerDealRow>(`/ledger/deals/${deal.application_id}`, body);
      if (sharesChanged) {
        ({ data } = await api.put<LedgerDealRow>(`/ledger/deals/${deal.application_id}/shares`, { shares: sharesBody() }));
      }
      onSaved(data);
      toast('Saved', 'success');
      onClose();
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to save'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    const ok = await confirm(manual
      ? { title: 'Delete this ledger-only deal?', message: 'It has no application behind it, so it is removed with its payees and payments.', confirmText: 'Delete', variant: 'danger' }
      : { title: 'Clear everything entered for this deal?', message: 'Figures go back to what the application says, the payee back to the referrer on the client, and payment records are removed.', confirmText: 'Clear', variant: 'danger' });
    if (!ok) return;
    try {
      const { data } = await api.delete(`/ledger/deals/${deal.application_id}`);
      if (manual) onDeleted?.(deal.application_id);
      else onSaved(data as LedgerDealRow);
      onClose();
    } catch (err) {
      toast(getErrorMessage(err, manual ? 'Failed to delete' : 'Failed to clear'), 'error');
    }
  };

  const inputCls = 'led-input !h-9 w-full text-[13px]';
  const labelCls = 'mb-1 block text-[12px] font-medium text-[var(--led-ink-2)]';
  const available = payees.filter((p) => p.is_active && !shares.some((s) => s.payeeKey === p.key));

  return (
    <LedgerModal
      title={manual ? customer || 'Ledger-only deal' : deal.customer_name}
      subtitle={[manual ? 'Ledger-only deal' : null, deal.entity_name, `settled ${formatDate(deal.settled_on)}`].filter(Boolean).join(' · ')}
      onClose={onClose}
      wide
      footer={
        <>
          {(deal.has_entry || manual) && (
            <Button variant="ghost" onClick={reset} className="mr-auto">{manual ? 'Delete deal' : 'Clear entries'}</Button>
          )}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving}>Save</Button>
        </>
      }
    >
      {manual && (
        <section className="mb-5">
          <h4 className="text-[13px] font-semibold text-foreground mb-2">The deal</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className={labelCls}>Settled on</span>
              <input type="date" className={inputCls} value={settledOn} onChange={(e) => setSettledOn(e.target.value)} />
            </label>
            <label className="block">
              <span className={labelCls}>Customer</span>
              <input className={inputCls} value={customer} onChange={(e) => setCustomer(e.target.value)} />
            </label>
            <label className="block">
              <span className={labelCls}>Entity (business)</span>
              <input className={inputCls} value={entity} onChange={(e) => setEntity(e.target.value)} />
            </label>
            <label className="block">
              <span className={labelCls}>Kind of deal</span>
              <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value as LedgerCategory | '')}>
                <option value="">—</option>
                {(Object.keys(CATEGORY_STYLE) as LedgerCategory[]).map((k) => <option key={k} value={k}>{CATEGORY_STYLE[k].label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={labelCls}>Broker</span>
              <select className={inputCls} value={brokerId} onChange={(e) => setBrokerId(e.target.value)}>
                <option value="">{brokerName ? `Other — ${brokerName}` : '—'}</option>
                {brokers.map((b) => <option key={b.id} value={b.id}>{b.full_name}</option>)}
              </select>
            </label>
            {!brokerId && (
              <label className="block">
                <span className={labelCls}>Broker name (not on the team)</span>
                <input className={inputCls} value={brokerName} placeholder="e.g. Arthur" onChange={(e) => setBrokerName(e.target.value)} />
              </label>
            )}
          </div>
        </section>
      )}

      <section className="mb-5">
        <h4 className="text-[13px] font-semibold text-foreground mb-2">Our income</h4>
        <div className="grid gap-3 sm:grid-cols-3">
          {MONEY_FIELDS.map(({ key, label }) => (
            <label key={key} className="block">
              <span className={labelCls}>{label}</span>
              <input
                className={inputCls}
                inputMode="decimal"
                value={money[key]}
                placeholder={prefilled.has(key) ? `${formatLedgerMoney(deal[key] ?? 0)} (${key === 'volume_bonus' ? 'estimated' : 'from application'})` : '0.00'}
                onChange={(e) => setMoney((m) => ({ ...m, [key]: e.target.value }))}
              />
              {key === 'volume_bonus' && <span className="mt-0.5 block text-[11px] text-muted-foreground">{vbHint(deal)}</span>}
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={incomeGst} onChange={(e) => setIncomeGst(e.target.checked)} />
            GST (10%) on our income
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={clawback} onChange={(e) => setClawback(e.target.checked)} />
            Clawback <span className="text-muted-foreground">(enter the figures as negatives)</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={newLead} onChange={(e) => setNewLead(e.target.checked)} />
            New lead this month
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
            Repeat customer
          </label>
        </div>
        <label className="mt-3 block max-w-sm">
          <span className={labelCls}>Lender</span>
          <input
            className={inputCls}
            value={lender}
            placeholder={prefilled.has('lender_name') && deal.lender_name ? `${deal.lender_name} (from application)` : 'Lender'}
            onChange={(e) => setLender(e.target.value)}
          />
        </label>
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          Total income {formatLedgerMoney(preview.income)} ex GST · {formatLedgerMoney(preview.incomeInc)} inc GST
        </p>
      </section>

      <section className="mb-5">
        <h4 className="text-[13px] font-semibold text-foreground mb-1">Who is paid</h4>
        <p className="text-[12px] text-muted-foreground mb-2">
          One deal can pay several people — e.g. 33% and 67% between partners. Payment details are yours only.
        </p>
        {shares.length === 0 && <p className="text-[12.5px] text-muted-foreground mb-2">Nobody is paid commission on this deal.</p>}
        <div className="space-y-3">
          {shares.map((s, i) => {
            const p = preview.each[i];
            return (
              <div key={s.uid} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <span className="text-[13px] font-medium text-foreground">{nameFor(s.payeeKey)}</span>
                  <button type="button" className="led-btn led-btn-ghost led-btn-sm" onClick={() => setShares((prev) => prev.filter((x) => x.uid !== s.uid))}>Remove</button>
                </div>
                <div className="inline-flex rounded-md border border-border p-0.5" role="radiogroup" aria-label="Share as">
                  {(['percent', 'dollar'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={s.mode === m}
                      onClick={() => updateShare(s.uid, { mode: m })}
                      className={`rounded px-3 py-1 text-[12.5px] ${s.mode === m ? 'bg-[var(--led-ink)] text-[var(--led-surface)]' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      {m === 'percent' ? 'Percentage' : 'Dollar amount'}
                    </button>
                  ))}
                </div>
                <div className="mt-2 grid gap-3 sm:grid-cols-3">
                  {s.mode === 'percent' ? (
                    <>
                      <label className="block">
                        <span className={labelCls}>Share %</span>
                        <input className={inputCls} inputMode="decimal" value={s.percent} placeholder="e.g. 40" onChange={(e) => updateShare(s.uid, { percent: e.target.value })} />
                      </label>
                      <label className="block">
                        <span className={labelCls}>Of</span>
                        <select className={inputCls} value={s.base} onChange={(e) => updateShare(s.uid, { base: e.target.value as LedgerShareBase })}>
                          {(Object.keys(SHARE_BASE_LABEL) as LedgerShareBase[]).map((b) => (
                            <option key={b} value={b}>{SHARE_BASE_LABEL[b].replace(/^of /, '')}</option>
                          ))}
                        </select>
                      </label>
                    </>
                  ) : (
                    <label className="block">
                      <span className={labelCls}>Amount (ex GST)</span>
                      <input className={inputCls} inputMode="decimal" value={s.amount} placeholder="0.00" onChange={(e) => updateShare(s.uid, { amount: e.target.value })} />
                    </label>
                  )}
                  <label className="block">
                    <span className={labelCls}>GST on the commission</span>
                    <select className={inputCls} value={s.gst} onChange={(e) => updateShare(s.uid, { gst: e.target.value as ShareDraft['gst'] })}>
                      <option value="auto">Follow the payee ({p?.registered ? 'GST registered' : 'not registered'})</option>
                      <option value="yes">Add GST</option>
                      <option value="no">No GST</option>
                    </select>
                  </label>
                </div>
                <p className="mt-2 text-[12.5px] text-foreground">
                  Commission <span className="font-medium">{formatLedgerMoney(p?.comms ?? 0)}</span> ex GST
                  {p?.gstOn && <> + {formatLedgerMoney(p.gst)} GST = <span className="font-medium">{formatLedgerMoney((p.comms ?? 0) + p.gst)}</span></>}
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <label className="block">
                    <span className={labelCls}>Payment</span>
                    <select className={inputCls} value={s.status} onChange={(e) => {
                      const status = e.target.value as LedgerShareStatus;
                      updateShare(s.uid, { status, paidOn: status === 'paid' && !s.paidOn ? today() : s.paidOn });
                    }}>
                      {(Object.keys(SHARE_STATUS_LABEL) as LedgerShareStatus[]).map((k) => <option key={k} value={k}>{SHARE_STATUS_LABEL[k]}</option>)}
                    </select>
                  </label>
                  {s.status === 'scheduled' && (
                    <label className="block">
                      <span className={labelCls}>Scheduled for</span>
                      <input type="date" className={inputCls} value={s.scheduledOn} onChange={(e) => updateShare(s.uid, { scheduledOn: e.target.value })} />
                    </label>
                  )}
                  {s.status === 'paid' && (
                    <label className="block">
                      <span className={labelCls}>Paid on</span>
                      <input type="date" className={inputCls} value={s.paidOn} onChange={(e) => updateShare(s.uid, { paidOn: e.target.value })} />
                    </label>
                  )}
                  {(s.status === 'paid' || s.status === 'scheduled') && (
                    <>
                      <label className="block">
                        <span className={labelCls}>Payment type</span>
                        <select className={inputCls} value={s.method} onChange={(e) => updateShare(s.uid, { method: e.target.value })}>
                          <option value="">—</option>
                          {[...new Set([...PAYMENT_METHODS, ...(s.method ? [s.method] : [])])].map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className={labelCls}>Reference</span>
                        <input className={inputCls} value={s.reference} placeholder="e.g. part of $17,501.75 transfer" onChange={(e) => updateShare(s.uid, { reference: e.target.value })} />
                      </label>
                    </>
                  )}
                </div>
                <label className="mt-2 block">
                  <span className={labelCls}>Payment notes</span>
                  <input className={inputCls} value={s.notes} placeholder={s.status === 'not_payable' ? "e.g. no comms — it's an overdraft" : 'e.g. paid to Joe on their behalf'} onChange={(e) => updateShare(s.uid, { notes: e.target.value })} />
                </label>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block min-w-[260px]">
            <span className={labelCls}>Add a payee</span>
            <select className={inputCls} value={adding} onChange={(e) => addPayee(e.target.value)}>
              <option value="">Choose…</option>
              {available.map((p) => <option key={p.key} value={p.key}>{payeeLabel(p)}</option>)}
            </select>
          </label>
          <span className="text-[11.5px] text-muted-foreground pb-2">Someone missing? Add them under Referrer comms → Payees.</span>
        </div>
        <p className="mt-3 text-[12.5px] text-foreground">
          Total commission <span className="font-medium">{formatLedgerMoney(preview.comms)}</span> ex GST
          <span className="text-muted-foreground"> · net profit {formatLedgerMoney(preview.net)}</span>
        </p>
      </section>

      <section>
        <label className="block">
          <span className={labelCls}>Notes on this deal</span>
          <textarea className="led-input w-full min-h-[60px] py-2 text-[13px]" value={dealNotes} onChange={(e) => setDealNotes(e.target.value)} />
        </label>
      </section>
    </LedgerModal>
  );
}
