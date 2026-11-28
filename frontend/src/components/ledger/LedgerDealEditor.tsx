import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, Plus, UserPlus, X } from 'lucide-react';
import api from '../../api/client';
import { useToast } from '../Toast';
import { useConfirm } from '../../hooks/useConfirm';
import { Button } from '../ui';
import { getErrorMessage, formatDate } from '../../lib/utils';
import { CATEGORY_STYLE, extraPaymentStatusText, formatLedgerMoney, PAYMENT_METHODS, SHARE_BASE_LABEL, SHARE_STATUS_LABEL } from '../../lib/ledger';
import type { LedgerBroker, LedgerCategory, LedgerDealRow, LedgerExtraPayment, LedgerPayee, LedgerShare, LedgerShareBase, LedgerShareStatus } from '../../types';
import LedgerModal from './LedgerModal';
import { PayeeSelect } from './LedgerExtraPayments';

type MoneyField = 'finance_amount' | 'brokerage' | 'doc_fee' | 'origination_fee' | 'vir' | 'volume_bonus';

// Saved in this order; the form lays them out by hand.
const MONEY_FIELDS: MoneyField[] = ['finance_amount', 'brokerage', 'doc_fee', 'origination_fee', 'vir', 'volume_bonus'];
// Figures the application can prefill; the rest start blank.
const PREFILLABLE = new Set<MoneyField>(['finance_amount', 'brokerage', 'doc_fee', 'origination_fee', 'vir', 'volume_bonus']);

/** How the volume bonus estimate was reached, for the hint under the field. */
function vbHint(deal: LedgerDealRow): string {
  if (deal.vb_rate == null) return 'No VBI rate for this lender — type a figure in, or set the rate on the lender.';
  return `Estimate: finance ex GST × ${deal.vb_rate}% VBI × ${deal.vb_share ?? 0}% our share (${formatLedgerMoney(deal.vb_month_volume ?? 0)} settled that month).`;
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
  // A clawback recorded by the team on the file — always a clawback here.
  const recorded = Boolean(deal.clawback_id);

  const initialMoney = Object.fromEntries(MONEY_FIELDS.map((key) => {
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
  const [settledOn, setSettledOn] = useState(deal.settled_on ?? '');
  const [customer, setCustomer] = useState(deal.customer_name);
  const [entity, setEntity] = useState(deal.entity_name ?? '');
  const [category, setCategory] = useState<LedgerCategory | ''>(deal.category ?? '');
  const [brokerId, setBrokerId] = useState(deal.broker_ids?.[0] ?? '');
  const [brokerName, setBrokerName] = useState(deal.broker_ids?.length ? '' : deal.broker_name ?? '');

  const initialShares = useMemo(() => (deal.shares ?? []).map(draftFromShare), [deal]);
  const [shares, setShares] = useState<ShareDraft[]>(initialShares);
  const [adding, setAdding] = useState('');
  const [saving, setSaving] = useState(false);
  // One-off payments linked to this deal, from whatever month they were made in.
  const [linkedPayments, setLinkedPayments] = useState<LedgerExtraPayment[]>([]);
  useEffect(() => {
    api.get<{ payments: LedgerExtraPayment[] }>('/ledger/payments', { params: { deal_key: deal.application_id } })
      .then(({ data }) => setLinkedPayments(data.payments))
      .catch(() => setLinkedPayments([]));
  }, [deal.application_id]);

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
      const staff = (payeeByKey.get(s.payeeKey)?.kind ?? deal.shares?.find((x) => x.payee_key === s.payeeKey)?.payee_kind) === 'staff';
      return { comms, gst: gstOn ? round2(comms * 0.1) : 0, gstOn, registered: Boolean(registered), staff };
    });
    const comms = each.reduce((a, e) => a + e.comms, 0);
    const staffComms = each.filter((e) => e.staff).reduce((a, e) => a + e.comms, 0);
    return { income, incomeInc: round2(income * (1 + rate)), each, comms, staffComms, net: round2(income - comms) };
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
      ...Object.fromEntries(MONEY_FIELDS.map((key) => [key, toNum(money[key])])),
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
    const comparable = (list: ShareDraft[]) => JSON.stringify(list.map((s) => ({ ...s, uid: 0 })));
    const sharesChanged = comparable(shares) !== comparable(initialShares);
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
  const labelCls = 'mb-1 flex items-center gap-1.5 text-[12px] font-medium text-[var(--led-ink-2)]';
  const onDeal = new Set(shares.map((s) => s.payeeKey));
  const referrerComms = round2(preview.comms - preview.staffComms);

  const moneyField = (key: MoneyField, label: string, hint?: ReactNode) => {
    const fromApp = prefilled.has(key) && money[key].trim() === '';
    return (
      <label key={key} className="block">
        <span className={labelCls}>
          {label}
          {fromApp && <SourceTag>{key === 'volume_bonus' ? 'estimate' : 'from application'}</SourceTag>}
        </span>
        <span className="relative block">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">$</span>
          <input
            className={`${inputCls} !pl-6 tabular-nums`}
            inputMode="decimal"
            value={money[key]}
            placeholder={prefilled.has(key) ? plainMoney(deal[key] ?? 0) : '0.00'}
            onChange={(e) => setMoney((m) => ({ ...m, [key]: e.target.value }))}
          />
        </span>
        {hint}
      </label>
    );
  };

  return (
    <LedgerModal
      title={manual ? customer || 'Ledger-only deal' : deal.customer_name}
      subtitle={[
        manual ? 'Ledger-only deal' : null,
        deal.entity_name,
        deal.is_pipeline ? `in the pipeline — ${deal.deal_status ?? 'not settled yet'}`
          : deal.settled_on ? `${recorded ? 'clawed back' : 'settled'} ${formatDate(deal.settled_on)}` : null,
      ].filter(Boolean).join(' · ')}
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
      {/* The deal's bottom line, live as figures change — stays in view while scrolling. */}
      <div className="sticky -top-4 z-10 -mx-6 -mt-4 mb-6 border-b border-border bg-[var(--led-surface-2)] px-6 py-3">
        <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-x-3">
          <Stat label="Income" value={preview.income} sub={`${formatLedgerMoney(preview.incomeInc)} inc GST`} />
          <Operator>−</Operator>
          <Stat
            label="Commissions"
            value={preview.comms}
            sub={preview.staffComms !== 0
              ? `referrers ${formatLedgerMoney(referrerComms)} · staff ${formatLedgerMoney(preview.staffComms)}`
              : shares.length === 0 ? 'nobody paid' : `${shares.length} payee${shares.length === 1 ? '' : 's'}`}
          />
          <Operator>=</Operator>
          <Stat
            label="Net profit"
            value={preview.net}
            sub={clawback ? 'clawback' : 'before volume bonus'}
            tone={preview.net < 0 ? 'danger' : preview.net > 0 ? 'success' : undefined}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">All figures ex GST.</p>
      </div>

      {manual && (
        <Section title="The deal" caption="No application behind this deal, so describe it here.">
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
        </Section>
      )}

      <Section title="Our income" caption={manual ? undefined : 'Leave a field blank to use what the application says.'}>
        <div className="grid gap-3 sm:grid-cols-2">
          {moneyField('finance_amount', 'Finance amount')}
          <label className="block">
            <span className={labelCls}>
              Lender
              {prefilled.has('lender_name') && !lender.trim() && deal.lender_name && <SourceTag>from application</SourceTag>}
            </span>
            <input
              className={inputCls}
              value={lender}
              placeholder={prefilled.has('lender_name') && deal.lender_name ? deal.lender_name : 'Lender'}
              onChange={(e) => setLender(e.target.value)}
            />
          </label>
        </div>

        <div className="mt-4 rounded-lg border border-border bg-[var(--led-surface-2)] p-3.5">
          <p className="led-label mb-2.5">Fees we earn · ex GST</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {moneyField('brokerage', 'Brokerage')}
            {moneyField('doc_fee', 'Doc fee')}
            {moneyField('origination_fee', 'Origination fee')}
            {moneyField('vir', 'VIR (inspection)')}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border pt-3">
            <label className="flex items-center gap-2 text-[13px] text-foreground">
              <input type="checkbox" checked={incomeGst} onChange={(e) => setIncomeGst(e.target.checked)} />
              We charge GST (10%) on these
            </label>
            <p className="text-[13px] text-foreground tabular-nums">
              Total income <span className="font-semibold">{formatLedgerMoney(preview.income)}</span>
              <span className="text-muted-foreground"> ex GST · {formatLedgerMoney(preview.incomeInc)} inc GST</span>
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {moneyField('volume_bonus', 'Possible volume bonus · ex GST', (
            <span className="mt-1 block text-[11.5px] leading-snug text-muted-foreground">
              {vbHint(deal)}
              <br />
              Not in net profit — final profit uses the bonus actually received for the month.
            </span>
          ))}
          <div>
            <span className={labelCls}>Tags</span>
            <div className="flex flex-wrap gap-2">
              <ToggleChip on={newLead} onChange={setNewLead}>New lead this month</ToggleChip>
              <ToggleChip on={repeat} onChange={setRepeat}>Repeat customer</ToggleChip>
              {!recorded && <ToggleChip on={clawback} onChange={setClawback} tone="danger">Clawback</ToggleChip>}
            </div>
            {recorded ? (
              <p className="mt-1.5 text-[11.5px] text-[var(--led-danger)]">
                Clawback recorded on the file{deal.clawback_reason ? ` — ${deal.clawback_reason}` : ''}. The brokerage starts as minus the amount
                clawed back; enter any other figures as negatives.
              </p>
            ) : clawback && <p className="mt-1.5 text-[11.5px] text-[var(--led-danger)]">Clawback — enter the figures above as negatives.</p>}
          </div>
        </div>
      </Section>

      <Section
        title="Who is paid"
        caption="Referrers and staff who share in this deal. Each one is paid, and tracked, separately."
      >
        {shares.length === 0 && (
          <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-[12.5px] text-muted-foreground">
            Nobody is paid commission on this deal.
          </div>
        )}
        <div className="space-y-3">
          {shares.map((s, i) => {
            const p = preview.each[i];
            const name = nameFor(s.payeeKey);
            return (
              <div key={s.uid} className="overflow-hidden rounded-lg border border-border bg-[var(--led-surface)] shadow-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-[var(--led-surface-2)] px-4 py-2.5">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <span className="truncate text-[13.5px] font-semibold text-foreground">{name}</span>
                    <span className="led-chip !h-5 !text-[11px] !font-medium">{p?.staff ? 'Staff' : 'Referrer'}</span>
                    {/* Only when the payee is still listed — otherwise registration is unknown. */}
                    {payeeByKey.has(s.payeeKey) && (p?.registered
                      ? <span className="led-chip led-chip-accent !h-5 !text-[11px] !font-medium" title="Registered for GST — GST is added to their commission unless you turn it off below">GST registered</span>
                      : <span className="led-chip !h-5 !text-[11px] !font-medium !text-muted-foreground" title="Not registered for GST — no GST on their commission unless you add it below">Not GST registered</span>)}
                    <span className={`led-chip !h-5 !text-[11px] ${STATUS_CHIP[s.status]}`}>
                      <span className="led-chip-dot" />
                      {statusText(s)}
                    </span>
                  </div>
                  <div className="text-right tabular-nums">
                    <div className="text-[15px] font-semibold text-foreground">{formatLedgerMoney(p?.comms ?? 0)}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {p?.gstOn ? `+ ${formatLedgerMoney(p.gst)} GST = ${formatLedgerMoney((p.comms ?? 0) + p.gst)}` : 'ex GST · no GST added'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="led-btn led-btn-ghost led-btn-sm led-btn-icon"
                    aria-label={`Remove ${name}`}
                    title="Remove from this deal"
                    onClick={() => setShares((prev) => prev.filter((x) => x.uid !== s.uid))}
                  >
                    <X size={15} />
                  </button>
                </div>

                <div className="grid gap-4 p-4 md:grid-cols-2 md:gap-0 md:divide-x md:divide-[var(--led-line)]">
                  <div className="md:pr-4">
                    <div className="mb-2.5 flex items-center justify-between gap-2">
                      <p className="led-label">Their cut</p>
                      <div className="led-segment" role="radiogroup" aria-label="Cut as">
                        {(['percent', 'dollar'] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            role="radio"
                            aria-checked={s.mode === m}
                            className={s.mode === m ? 'led-active' : ''}
                            onClick={() => updateShare(s.uid, { mode: m })}
                          >
                            {m === 'percent' ? '% of' : '$ amount'}
                          </button>
                        ))}
                      </div>
                    </div>
                    {s.mode === 'percent' ? (
                      <div className="grid grid-cols-[110px_1fr] gap-3">
                        <label className="block">
                          <span className={labelCls}>Share</span>
                          <span className="relative block">
                            <input className={`${inputCls} !pr-7 tabular-nums`} inputMode="decimal" value={s.percent} placeholder="40" onChange={(e) => updateShare(s.uid, { percent: e.target.value })} />
                            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">%</span>
                          </span>
                        </label>
                        <label className="block">
                          <span className={labelCls}>Of our</span>
                          <select className={inputCls} value={s.base} onChange={(e) => updateShare(s.uid, { base: e.target.value as LedgerShareBase })}>
                            {(Object.keys(SHARE_BASE_LABEL) as LedgerShareBase[]).map((b) => (
                              <option key={b} value={b}>{SHARE_BASE_LABEL[b].replace(/^of /, '')}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ) : (
                      <label className="block">
                        <span className={labelCls}>Amount · ex GST</span>
                        <span className="relative block">
                          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">$</span>
                          <input className={`${inputCls} !pl-6 tabular-nums`} inputMode="decimal" value={s.amount} placeholder="0.00" onChange={(e) => updateShare(s.uid, { amount: e.target.value })} />
                        </span>
                      </label>
                    )}
                    <label className="mt-3 block">
                      <span className={labelCls}>GST on their commission</span>
                      <select className={inputCls} value={s.gst} onChange={(e) => updateShare(s.uid, { gst: e.target.value as ShareDraft['gst'] })}>
                        <option value="auto">Follow the payee ({p?.registered ? 'GST registered' : 'not registered'})</option>
                        <option value="yes">Add GST</option>
                        <option value="no">No GST</option>
                      </select>
                    </label>
                  </div>

                  <div className="md:pl-4">
                    <p className="led-label mb-2.5 flex h-[34px] items-center">Payment</p>
                    <div className="led-segment flex-wrap" role="radiogroup" aria-label={`Payment to ${name}`}>
                      {(Object.keys(SHARE_STATUS_LABEL) as LedgerShareStatus[]).map((k) => (
                        <button
                          key={k}
                          type="button"
                          role="radio"
                          aria-checked={s.status === k}
                          className={s.status === k ? 'led-active' : ''}
                          onClick={() => updateShare(s.uid, { status: k, paidOn: k === 'paid' && !s.paidOn ? today() : s.paidOn })}
                        >
                          {SHARE_STATUS_LABEL[k]}
                        </button>
                      ))}
                    </div>
                    {(s.status === 'paid' || s.status === 'scheduled') && (
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        {s.status === 'paid' ? (
                          <label className="block">
                            <span className={labelCls}>Paid on</span>
                            <input type="date" className={inputCls} value={s.paidOn} onChange={(e) => updateShare(s.uid, { paidOn: e.target.value })} />
                          </label>
                        ) : (
                          <label className="block">
                            <span className={labelCls}>Scheduled for</span>
                            <input type="date" className={inputCls} value={s.scheduledOn} onChange={(e) => updateShare(s.uid, { scheduledOn: e.target.value })} />
                          </label>
                        )}
                        <label className="block">
                          <span className={labelCls}>Payment type</span>
                          <select className={inputCls} value={s.method} onChange={(e) => updateShare(s.uid, { method: e.target.value })}>
                            <option value="">—</option>
                            {[...new Set([...PAYMENT_METHODS, ...(s.method ? [s.method] : [])])].map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </label>
                        <label className="col-span-2 block">
                          <span className={labelCls}>Reference</span>
                          <input className={inputCls} value={s.reference} placeholder="e.g. part of $17,501.75 transfer" onChange={(e) => updateShare(s.uid, { reference: e.target.value })} />
                        </label>
                      </div>
                    )}
                    <label className="mt-3 block">
                      <span className={labelCls}>Notes · why / how they were paid</span>
                      <input className={inputCls} value={s.notes} placeholder={s.status === 'not_payable' ? "e.g. no comms — it's an overdraft" : 'e.g. paid to Joe on their behalf'} onChange={(e) => updateShare(s.uid, { notes: e.target.value })} />
                    </label>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed border-border px-3 py-2.5">
          <UserPlus size={16} className="shrink-0 text-muted-foreground" aria-hidden />
          <PayeeSelect
            payees={payees}
            value={adding}
            onChange={addPayee}
            className={`${inputCls} !w-auto min-w-[260px] flex-1 sm:flex-none`}
            placeholder={shares.length ? 'Add another referrer or staff member…' : 'Add a referrer or staff member…'}
            exclude={onDeal}
          />
          <span className="text-[11.5px] text-muted-foreground">Not listed? Add them under Referrer &amp; staff comms → Payees.</span>
        </div>
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          Paid someone more than their agreed cut? Record the extra under Referrer &amp; staff comms → Extra payments.
        </p>
      </Section>

      {linkedPayments.length > 0 && (
        <Section
          title="Extra payments linked to this deal"
          caption="Each counts in the month it was paid, not in this deal's net profit. Change them from the deals table or Referrer & staff comms."
        >
          <div className="divide-y divide-[var(--led-line)] overflow-hidden rounded-lg border border-border">
            {linkedPayments.map((x) => (
              <div key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[12.5px]">
                <span className="w-[92px] shrink-0 tabular-nums text-muted-foreground">{formatDate(x.payment_date)}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-foreground">{x.payee_name || 'Unnamed'}</span>
                  <span className="text-muted-foreground"> · {x.category_label}{x.description ? ` — ${x.description}` : ''}</span>
                </span>
                <span className={`led-chip !h-5 !text-[11px] ${x.status === 'paid' ? 'led-chip-success' : x.status === 'scheduled' ? 'led-chip-info' : 'led-chip-warning'}`}>
                  {extraPaymentStatusText(x)}
                </span>
                <span className="w-[110px] text-right font-semibold tabular-nums text-foreground">{formatLedgerMoney(x.amount_inc_gst)}</span>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-right text-[11.5px] text-muted-foreground">Amounts inc GST</p>
        </Section>
      )}

      <section>
        <label className="block">
          <span className={labelCls}>Notes on this deal</span>
          <textarea className="led-input w-full min-h-[60px] py-2 text-[13px]" value={dealNotes} onChange={(e) => setDealNotes(e.target.value)} />
        </label>
      </section>
    </LedgerModal>
  );
}

const STATUS_CHIP: Record<LedgerShareStatus, string> = {
  unpaid: 'led-chip-warning',
  scheduled: 'led-chip-info',
  paid: 'led-chip-success',
  not_payable: '',
};

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

function statusText(s: ShareDraft): string {
  if (s.status === 'paid') return s.paidOn ? `Paid ${shortDate(s.paidOn)}` : 'Paid — date needed';
  if (s.status === 'scheduled') return s.scheduledOn ? `Scheduled ${shortDate(s.scheduledOn)}` : 'Scheduled — date needed';
  return SHARE_STATUS_LABEL[s.status];
}

const plainMoney = (n: number) => n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Section({ title, caption, children }: { title: string; caption?: string; children: ReactNode }) {
  return (
    <section className="mb-7">
      <div className="mb-3">
        <h4 className="text-[14.5px] font-semibold text-foreground">{title}</h4>
        {caption && <p className="mt-0.5 text-[12px] text-muted-foreground">{caption}</p>}
      </div>
      {children}
    </section>
  );
}

function SourceTag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded bg-[var(--led-neutral-tint)] px-1.5 py-px text-[10.5px] font-medium text-muted-foreground">{children}</span>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number; sub: string; tone?: 'success' | 'danger' }) {
  const color = tone === 'success' ? 'text-[var(--led-success)]' : tone === 'danger' ? 'text-[var(--led-danger)]' : 'text-foreground';
  return (
    <div className="min-w-0">
      <p className="led-label">{label}</p>
      <p className={`mt-0.5 text-[18px] font-semibold tabular-nums leading-tight ${color}`}>{formatLedgerMoney(value)}</p>
      <p className="truncate text-[11.5px] text-muted-foreground" title={sub}>{sub}</p>
    </div>
  );
}

function Operator({ children }: { children: ReactNode }) {
  return <span className="text-[18px] font-light text-muted-foreground" aria-hidden>{children}</span>;
}

function ToggleChip({ on, onChange, tone, children }: {
  on: boolean;
  onChange: (on: boolean) => void;
  tone?: 'danger';
  children: ReactNode;
}) {
  const onCls = tone === 'danger'
    ? 'border-transparent bg-[var(--led-danger-tint)] text-[var(--led-danger)]'
    : 'border-transparent bg-[var(--led-accent-tint)] text-[var(--led-accent)]';
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors ${on ? onCls : 'border-border text-muted-foreground hover:text-foreground'}`}
    >
      {on ? <Check size={13} /> : <Plus size={13} />}
      {children}
    </button>
  );
}
