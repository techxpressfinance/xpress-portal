import { useMemo, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../Toast';
import { useConfirm } from '../../hooks/useConfirm';
import { Button } from '../ui';
import { getErrorMessage, formatDate } from '../../lib/utils';
import { formatLedgerMoney, PAYMENT_METHODS, SHARE_BASE_LABEL } from '../../lib/ledger';
import type { LedgerDealRow, LedgerReferrerOption, LedgerShareBase } from '../../types';
import LedgerModal from './LedgerModal';

type MoneyField = 'finance_amount' | 'brokerage' | 'doc_fee' | 'origination_fee' | 'vir' | 'volume_bonus';

const MONEY_FIELDS: { key: MoneyField; label: string; hint?: string }[] = [
  { key: 'finance_amount', label: 'Finance amount' },
  { key: 'brokerage', label: 'Brokerage (ex GST)' },
  { key: 'doc_fee', label: 'Doc fee (ex GST)' },
  { key: 'origination_fee', label: 'Origination fee (ex GST)' },
  { key: 'vir', label: 'VIR (ex GST)' },
  { key: 'volume_bonus', label: 'Volume bonus', hint: 'Shown for reference; not in net profit' },
];
// Figures the application can prefill; the rest start blank.
const PREFILLABLE = new Set<MoneyField>(['finance_amount', 'brokerage', 'origination_fee']);

const toNum = (s: string): number | null => {
  const t = s.replace(/[$,\s]/g, '');
  if (t === '' || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The owner's editor for one settled deal: our income, who shares in it and
 *  how much, and when they were paid. Blank figures fall back to what the
 *  application says (shown as the placeholder). */
export default function LedgerDealEditor({ deal, referrers, onClose, onSaved }: {
  deal: LedgerDealRow;
  referrers: LedgerReferrerOption[];
  onClose: () => void;
  onSaved: (row: LedgerDealRow) => void;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const prefilled = new Set(deal.prefilled ?? []);

  const initialMoney = Object.fromEntries(MONEY_FIELDS.map(({ key }) => {
    const value = deal[key] ?? 0;
    const blank = prefilled.has(key) || (!PREFILLABLE.has(key) && value === 0);
    return [key, blank ? '' : String(value)];
  })) as Record<MoneyField, string>;

  const [money, setMoney] = useState(initialMoney);
  const [incomeGst, setIncomeGst] = useState(deal.income_gst ?? true);
  const [clawback, setClawback] = useState(deal.is_clawback);
  const [lender, setLender] = useState(prefilled.has('lender_name') ? '' : deal.lender_name ?? '');
  const [newLead, setNewLead] = useState(deal.new_lead);
  const [repeat, setRepeat] = useState(deal.repeat_customer);
  // '' = as on the client, 'none' = nobody, else a referrer id.
  const [referrerChoice, setReferrerChoice] = useState<string>('');
  const [shareMode, setShareMode] = useState<'percent' | 'dollar'>(deal.share_amount != null ? 'dollar' : 'percent');
  const [sharePercent, setSharePercent] = useState(deal.share_percent != null ? String(deal.share_percent) : '');
  const [shareBase, setShareBase] = useState<LedgerShareBase>(deal.share_base ?? 'brokerage');
  const [shareAmount, setShareAmount] = useState(deal.share_amount != null ? String(deal.share_amount) : '');
  // 'auto' follows the referrer's GST registration.
  const [shareGst, setShareGst] = useState<'auto' | 'yes' | 'no'>('auto');
  const [paidOn, setPaidOn] = useState(deal.paid_on ?? '');
  const [paymentMethod, setPaymentMethod] = useState(deal.payment_method ?? '');
  const [paymentNotes, setPaymentNotes] = useState(deal.payment_notes ?? '');
  const [saving, setSaving] = useState(false);

  const fig = (key: MoneyField) => toNum(money[key]) ?? (prefilled.has(key) ? deal[key] ?? 0 : 0);

  const referrerId = referrerChoice === '' ? deal.referrer_id : referrerChoice === 'none' ? null : referrerChoice;
  const referrer = referrers.find((r) => r.id === referrerId);

  // The same sums the server does, so the owner sees the share before saving.
  const preview = useMemo(() => {
    const rate = incomeGst ? 0.1 : 0;
    const income = fig('brokerage') + fig('doc_fee') + fig('origination_fee') + fig('vir');
    const base = { brokerage: fig('brokerage'), total_income: income, finance_amount: fig('finance_amount') }[shareBase];
    let comms = 0;
    if (referrerId) {
      if (shareMode === 'dollar') comms = toNum(shareAmount) ?? 0;
      else comms = round2(base * (toNum(sharePercent) ?? 0) / 100);
    }
    const gstOn = shareGst === 'auto' ? (referrerChoice === '' ? deal.share_gst ?? false : Boolean(referrer?.gst_registered)) : shareGst === 'yes';
    const commsGst = gstOn ? round2(comms * 0.1) : 0;
    return { income, incomeInc: round2(income * (1 + rate)), comms, commsGst, gstOn, net: round2(income - comms) };
  }, [money, incomeGst, shareBase, shareMode, shareAmount, sharePercent, shareGst, referrerId, referrerChoice]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setSaving(true);
    const body: Record<string, unknown> = {
      ...Object.fromEntries(MONEY_FIELDS.map(({ key }) => [key, toNum(money[key])])),
      income_gst: incomeGst,
      is_clawback: clawback,
      lender_name: lender.trim() || null,
      share_base: shareBase,
      share_percent: shareMode === 'percent' ? toNum(sharePercent) : null,
      share_amount: shareMode === 'dollar' ? toNum(shareAmount) : null,
      paid_on: paidOn || null,
      payment_method: paymentMethod || null,
      payment_notes: paymentNotes.trim() || null,
    };
    if (newLead !== deal.new_lead) body.new_lead = newLead;
    if (repeat !== deal.repeat_customer) body.repeat_customer = repeat;
    if (referrerChoice === 'none') Object.assign(body, { referrer_set: true, referrer_id: null });
    else if (referrerChoice) Object.assign(body, { referrer_set: true, referrer_id: referrerChoice });
    if (shareGst !== 'auto') body.share_gst = shareGst === 'yes';
    try {
      const { data } = await api.patch<LedgerDealRow>(`/ledger/deals/${deal.application_id}`, body);
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
    const ok = await confirm({
      title: 'Clear everything entered for this deal?',
      message: 'Figures go back to what the application says, the referrer back to the one on the client, and the payment record is removed.',
      confirmText: 'Clear',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const { data } = await api.delete<LedgerDealRow>(`/ledger/deals/${deal.application_id}`);
      onSaved(data);
      onClose();
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to clear'), 'error');
    }
  };

  const inputCls = 'led-input !h-9 w-full text-[13px]';
  const labelCls = 'mb-1 block text-[12px] font-medium text-[var(--led-ink-2)]';

  return (
    <LedgerModal
      title={deal.customer_name}
      subtitle={[deal.entity_name, `settled ${formatDate(deal.settled_on)}`].filter(Boolean).join(' · ')}
      onClose={onClose}
      wide
      footer={
        <>
          {deal.has_entry && <Button variant="ghost" onClick={reset} className="mr-auto">Clear entries</Button>}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving}>Save</Button>
        </>
      }
    >
      <section className="mb-5">
        <h4 className="text-[13px] font-semibold text-foreground mb-2">Our income</h4>
        <div className="grid gap-3 sm:grid-cols-3">
          {MONEY_FIELDS.map(({ key, label, hint }) => (
            <label key={key} className="block">
              <span className={labelCls}>{label}</span>
              <input
                className={inputCls}
                inputMode="decimal"
                value={money[key]}
                placeholder={prefilled.has(key) ? `${formatLedgerMoney(deal[key] ?? 0)} (from application)` : '0.00'}
                onChange={(e) => setMoney((m) => ({ ...m, [key]: e.target.value }))}
              />
              {hint && <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>}
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
        <h4 className="text-[13px] font-semibold text-foreground mb-2">Referrer commission</h4>
        <label className="block max-w-md">
          <span className={labelCls}>Referrer</span>
          <select className={inputCls} value={referrerChoice} onChange={(e) => setReferrerChoice(e.target.value)}>
            <option value="">{deal.referrer_name ? `Keep — ${deal.referrer_name}` : 'Keep — no referrer'}</option>
            <option value="none">No referrer on this deal</option>
            {referrers.filter((r) => r.id !== deal.referrer_id).map((r) => (
              <option key={r.id} value={r.id}>{r.full_name}{r.organization_name ? ` · ${r.organization_name}` : ''}</option>
            ))}
          </select>
        </label>
        {referrerId && (
          <>
            <div className="mt-3 inline-flex rounded-md border border-border p-0.5" role="radiogroup" aria-label="Share as">
              {(['percent', 'dollar'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={shareMode === m}
                  onClick={() => setShareMode(m)}
                  className={`rounded px-3 py-1 text-[12.5px] ${shareMode === m ? 'bg-[var(--led-ink)] text-[var(--led-surface)]' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {m === 'percent' ? 'Percentage' : 'Dollar amount'}
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {shareMode === 'percent' ? (
                <>
                  <label className="block">
                    <span className={labelCls}>Share %</span>
                    <input className={inputCls} inputMode="decimal" value={sharePercent} placeholder="e.g. 40" onChange={(e) => setSharePercent(e.target.value)} />
                  </label>
                  <label className="block">
                    <span className={labelCls}>Of</span>
                    <select className={inputCls} value={shareBase} onChange={(e) => setShareBase(e.target.value as LedgerShareBase)}>
                      {(Object.keys(SHARE_BASE_LABEL) as LedgerShareBase[]).map((b) => (
                        <option key={b} value={b}>{SHARE_BASE_LABEL[b].replace(/^of /, '')}</option>
                      ))}
                    </select>
                  </label>
                </>
              ) : (
                <label className="block">
                  <span className={labelCls}>Amount (ex GST)</span>
                  <input className={inputCls} inputMode="decimal" value={shareAmount} placeholder="0.00" onChange={(e) => setShareAmount(e.target.value)} />
                </label>
              )}
              <label className="block">
                <span className={labelCls}>GST on the commission</span>
                <select className={inputCls} value={shareGst} onChange={(e) => setShareGst(e.target.value as typeof shareGst)}>
                  <option value="auto">Follow the referrer ({(referrerChoice === '' ? deal.share_gst : referrer?.gst_registered) ? 'GST registered' : 'not registered'})</option>
                  <option value="yes">Add GST</option>
                  <option value="no">No GST</option>
                </select>
              </label>
            </div>
            <p className="mt-2 text-[12.5px] text-foreground">
              Commission <span className="font-medium">{formatLedgerMoney(preview.comms)}</span> ex GST
              {preview.gstOn && <> + {formatLedgerMoney(preview.commsGst)} GST = <span className="font-medium">{formatLedgerMoney(preview.comms + preview.commsGst)}</span></>}
              <span className="text-muted-foreground"> · net profit {formatLedgerMoney(preview.net)}</span>
            </p>
          </>
        )}
      </section>

      <section>
        <h4 className="text-[13px] font-semibold text-foreground mb-1">Paid to the referrer</h4>
        <p className="text-[12px] text-muted-foreground mb-2">Only you see this, even if the ledger is shared.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className={labelCls}>Paid on</span>
            <input type="date" className={inputCls} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </label>
          <label className="block">
            <span className={labelCls}>Payment type</span>
            <select className={inputCls} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option value="">—</option>
              {[...new Set([...PAYMENT_METHODS, ...(deal.payment_method ? [deal.payment_method] : [])])].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="mt-3 block">
          <span className={labelCls}>Notes</span>
          <textarea
            className="led-input w-full min-h-[72px] py-2 text-[13px]"
            value={paymentNotes}
            placeholder="e.g. paid 704.55 to Akash Sharma"
            onChange={(e) => setPaymentNotes(e.target.value)}
          />
        </label>
      </section>
    </LedgerModal>
  );
}
