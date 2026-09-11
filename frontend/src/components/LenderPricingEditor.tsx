import { useMemo, useState, type ReactNode } from 'react';
import { Button, Card } from './ui';
import api from '../api/client';
import { useToast } from './Toast';
import { getErrorMessage } from '../lib/utils';
import { DIRECT_DEBIT_CYCLES, type FacilityType, type LenderPricingInputs, type QuoteSheet } from '../types';
import {
  DIRECT_DEBIT_CYCLE_LABELS,
  FACILITY_LABELS,
  MAX_TERM_MONTHS,
  MIN_TERM_MONTHS,
  computeLenderPricing,
  fmt2,
  fmtCurrency,
  lenderPricingAlerts,
  lenderPricingOptions,
  lenderPricingStructures,
  parseLenderPricingInputs,
  repaymentFor,
} from '../lib/lenderPricing';

const fieldBase = "w-full h-9 rounded-lg bg-secondary text-[13px] text-foreground transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background border border-transparent";
const labelBase = "block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1";

// ── Money text input (thousands separators) ──────────────────────────
const formatMoney = (v: number | null): string =>
  v == null ? '' : v.toLocaleString('en-US', { maximumFractionDigits: 2 });
// Insert thousands separators, keeping a trailing "." the user is mid-typing.
const commaize = (raw: string): string => {
  const [intPart, ...rest] = raw.split('.');
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return rest.length ? `${withCommas}.${rest.join('')}` : withCommas;
};
const moneyToNum = (s: string): number | null => {
  if (s === '') return null;
  const n = parseFloat(s.replace(/,/g, ''));
  return isFinite(n) ? n : null;
};

function MoneyInput({ value, onChange, placeholder }: {
  value: number | null;
  onChange: (val: number | null) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(() => formatMoney(value));
  // Show what was typed while it still matches the value; otherwise the value
  // changed elsewhere (e.g. deposit $ re-derived from %) and wins.
  const shown = moneyToNum(text) === value ? text : formatMoney(value);
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[13px]">$</span>
      <input
        type="text"
        inputMode="decimal"
        placeholder={placeholder}
        value={shown}
        onChange={e => {
          const cleaned = e.target.value.replace(/[^\d.]/g, '');
          setText(commaize(cleaned));
          const n = moneyToNum(cleaned);
          onChange(n == null ? null : Math.max(0, n));
        }}
        className={`${fieldBase} pl-6 pr-3`}
      />
    </div>
  );
}

// Dollar field where blank means $0.
function DollarField({ label, value, onChange }: { label: string; value: number; onChange: (val: number) => void }) {
  return (
    <div>
      <label className={labelBase}>{label}</label>
      <MoneyInput value={value || null} onChange={v => onChange(v ?? 0)} />
    </div>
  );
}

function PercentField({ label, value, onChange }: { label: string; value: number; onChange: (val: number) => void }) {
  return (
    <div>
      <label className={labelBase}>{label}</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[12px]">%</span>
        <input
          type="number"
          step="0.5"
          min="0"
          value={value || ''}
          onChange={e => onChange(Math.max(0, parseFloat(e.target.value)) || 0)}
          className={`${fieldBase} pl-7 pr-3`}
        />
      </div>
    </div>
  );
}

function CalcField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className={`${labelBase} flex items-center gap-1`}>
        {label}
        <span className="text-[9px] font-bold text-muted-foreground/50 tracking-wide">AUTO</span>
      </label>
      <div className="h-9 flex items-center px-3 rounded-lg bg-muted/30 text-[13px] text-foreground font-semibold border border-dashed border-border/40 tabular-nums">
        {value}
      </div>
    </div>
  );
}

function ToggleButton({ label, active, activeLabel, inactiveLabel, onClick }: {
  label: string;
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
  onClick: () => void;
}) {
  return (
    <div>
      <label className={labelBase}>{label}</label>
      <button
        type="button"
        onClick={onClick}
        className={`h-9 w-full px-3 rounded-lg text-[12px] font-semibold transition-colors border ${active
          ? 'bg-primary/10 text-primary border-primary/20'
          : 'bg-muted text-muted-foreground border-border/40'
        }`}
      >
        {active ? activeLabel : inactiveLabel}
      </button>
    </div>
  );
}

function RadioGroup<T extends string>({ name, value, options, onChange }: {
  name: string;
  value: T | null;
  options: readonly { value: T; label: string }[];
  onChange: (val: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {options.map(o => (
        <label key={o.value} className="inline-flex items-center gap-1.5 text-[12.5px] text-foreground cursor-pointer">
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="accent-primary"
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-0.5 h-4 bg-primary/60 rounded-full shrink-0" />
      <h3 className="text-[11px] font-bold text-foreground uppercase tracking-widest">{children}</h3>
      <div className="flex-1 h-px bg-border/50" />
    </div>
  );
}

const CYCLE_OPTIONS = DIRECT_DEBIT_CYCLES.map(c => ({ value: c, label: DIRECT_DEBIT_CYCLE_LABELS[c] }));
const YES_NO_OPTIONS = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] as const;

interface LenderPricingEditorProps {
  /** Omit for standalone lender pricing (the general Quote Sheets page). */
  applicationId?: string;
  sheet?: QuoteSheet;
  onSave: (sheet: QuoteSheet) => void;
  onCancel: () => void;
}

export default function LenderPricingEditor({ applicationId, sheet, onSave, onCancel }: LenderPricingEditorProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState(sheet?.title || '');
  const [brokerNotes, setBrokerNotes] = useState(sheet?.broker_notes || '');
  const [inputs, setInputs] = useState<LenderPricingInputs>(() => parseLenderPricingInputs(sheet));
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof LenderPricingInputs>(key: K, value: LenderPricingInputs[K]) => {
    setInputs(prev => ({ ...prev, [key]: value }));
  };

  // %/$ pairs: editing one re-derives the other, as on the quote sheet.
  const setDepositPercent = (pct: number) => setInputs(prev => ({
    ...prev,
    deposit_percent: pct,
    deposit_amount: prev.asset_price > 0 ? fmt2(prev.asset_price * (pct / 100)) : null,
  }));
  const setDepositAmount = (amt: number | null) => setInputs(prev => ({
    ...prev,
    deposit_amount: amt,
    deposit_percent: amt != null && prev.asset_price > 0 ? fmt2((amt / prev.asset_price) * 100) : prev.deposit_percent,
  }));
  const setBalloonPercent = (pct: number) => setInputs(prev => ({ ...prev, balloon_percent: pct, balloon_amount: null }));
  const setBalloonAmount = (amt: number | null) => setInputs(prev => {
    const base = computeLenderPricing(prev).balloonBase;
    return { ...prev, balloon_amount: amt, balloon_percent: amt != null && base > 0 ? fmt2((amt / base) * 100) : prev.balloon_percent };
  });

  const derived = useMemo(() => computeLenderPricing(inputs), [inputs]);
  const structures = useMemo(() => lenderPricingStructures(inputs), [inputs]);
  const alerts = useMemo(() => lenderPricingAlerts(inputs), [inputs]);
  const cycleLabel = DIRECT_DEBIT_CYCLE_LABELS[inputs.direct_debit_cycle];
  const isChattel = inputs.facility_type === 'chattel';
  const isLease = inputs.facility_type === 'lease';

  const handleSave = async () => {
    if (inputs.asset_price <= 0) {
      toast('Please enter a valid asset price', 'error');
      return;
    }
    const term = inputs.term_months;
    if (term == null || term < MIN_TERM_MONTHS || term > MAX_TERM_MONTHS) {
      toast(`Enter a term between ${MIN_TERM_MONTHS} and ${MAX_TERM_MONTHS} months`, 'error');
      return;
    }

    setSaving(true);
    const baseUrl = applicationId ? `/applications/${applicationId}/quote-sheets` : '/quote-sheets';
    const inputParamsJson = JSON.stringify(inputs);
    const options = lenderPricingOptions(inputs, structures);
    try {
      if (sheet) {
        await api.patch(`${baseUrl}/${sheet.id}`, {
          title: title.trim() || null,
          broker_notes: brokerNotes.trim() || null,
          input_parameters: inputParamsJson,
        });
        for (const existing of sheet.options) {
          await api.delete(`${baseUrl}/${sheet.id}/options/${existing.id}`);
        }
        for (const opt of options) {
          await api.post(`${baseUrl}/${sheet.id}/options`, opt);
        }
        const { data } = await api.get(`${baseUrl}/${sheet.id}`);
        onSave(data);
        toast('Lender pricing updated', 'success');
      } else {
        const { data } = await api.post(baseUrl, {
          title: title.trim() || null,
          sheet_type: 'lender_pricing',
          broker_notes: brokerNotes.trim() || null,
          input_parameters: inputParamsJson,
          options,
        });
        onSave(data);
        toast('Lender pricing created', 'success');
      }
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to save lender pricing'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const selectBase = `${fieldBase} px-3 appearance-none`;
  const th = 'py-2 px-3 text-muted-foreground font-semibold uppercase tracking-wide text-[10px]';

  return (
    <Card>
      <div className="space-y-6">

        {/* Sheet meta */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={labelBase}>Title</label>
            <input
              type="text"
              placeholder="e.g. Approved structure — Macquarie"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className={`${fieldBase} px-3`}
            />
          </div>
          <div>
            <label className={labelBase}>Broker Notes</label>
            <textarea
              className="w-full rounded-lg bg-secondary px-3 py-2 text-[13px] text-foreground transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background placeholder:text-muted-foreground border border-transparent min-h-[36px] resize-none"
              placeholder="Internal notes..."
              value={brokerNotes}
              onChange={e => setBrokerNotes(e.target.value)}
              rows={1}
            />
          </div>
        </div>

        {/* ── Loan Setup ─────────────────────────────────────── */}
        <section className="border border-border rounded-xl p-4">
          <SectionHeader>Loan Setup</SectionHeader>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className={labelBase}>Facility Type</label>
              <select
                value={inputs.facility_type}
                onChange={e => set('facility_type', e.target.value as FacilityType)}
                className={selectBase}
              >
                {(Object.keys(FACILITY_LABELS) as FacilityType[]).map(f => (
                  <option key={f} value={f}>{FACILITY_LABELS[f]}</option>
                ))}
              </select>
            </div>
            <ToggleButton
              label="Payment Type"
              active={inputs.payment_type === 'advance'}
              activeLabel="Advance (Start)"
              inactiveLabel="Arrears (End)"
              onClick={() => set('payment_type', inputs.payment_type === 'advance' ? 'arrears' : 'advance')}
            />
            <div className="md:col-span-2">
              <label className={labelBase}>Asset / Loan Description</label>
              <input
                type="text"
                placeholder="e.g. Motor Vehicle, Industrial Equipment, Boat"
                value={inputs.asset_description}
                onChange={e => set('asset_description', e.target.value)}
                className={`${fieldBase} px-3`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3 pt-3 border-t border-border/40">
            <DollarField label="Asset Price" value={inputs.asset_price} onChange={v => set('asset_price', v)} />
            <PercentField label="Deposit %" value={inputs.deposit_percent} onChange={setDepositPercent} />
            <div>
              <label className={`${labelBase} flex gap-1`}>
                Deposit $
                <span className="text-[9px] font-semibold text-muted-foreground/50">OVERRIDE</span>
              </label>
              <MoneyInput
                value={inputs.deposit_amount}
                onChange={setDepositAmount}
                placeholder={formatMoney(fmt2(inputs.asset_price * (inputs.deposit_percent / 100)))}
              />
            </div>
            <DollarField label="Trade-in" value={inputs.trade_in_amount} onChange={v => set('trade_in_amount', v)} />
            <DollarField label="Payout Figure" value={inputs.payout_amount} onChange={v => set('payout_amount', v)} />
            <CalcField label="Amount Borrowed" value={fmtCurrency(derived.amountBorrowed)} />
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Amount borrowed = asset price − deposit − trade-in + payout figure.
          </p>

          {alerts.length > 0 && (
            <div className="mt-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 space-y-1.5">
              {alerts.map(msg => (
                <div key={msg} className="flex gap-2 text-[12.5px] text-foreground">
                  <span aria-hidden className="text-danger">▲</span>
                  <span>{msg}</span>
                </div>
              ))}
              <div className="pt-2 mt-1 border-t border-danger/20">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <span className="text-[12.5px] font-semibold text-foreground">
                    Is the lender OK to accept the shortfall and negative equity?
                  </span>
                  <RadioGroup
                    name="lender_accepts_shortfall"
                    value={inputs.lender_accepts_shortfall}
                    options={YES_NO_OPTIONS}
                    onChange={v => set('lender_accepts_shortfall', v)}
                  />
                </div>
                {inputs.lender_accepts_shortfall === 'yes' && (
                  <div className="mt-2">
                    <label className={labelBase}>Notes</label>
                    <textarea
                      className="w-full rounded-lg bg-background px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 border border-border min-h-[60px]"
                      placeholder="e.g. Confirmed with the lender's BDM — negative equity accepted given strong servicing…"
                      value={inputs.lender_acceptance_notes}
                      onChange={e => set('lender_acceptance_notes', e.target.value)}
                      rows={2}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ── Fees & Charges ─────────────────────────────────── */}
        <section className="border border-border rounded-xl p-4">
          <SectionHeader>Fees &amp; Charges</SectionHeader>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <DollarField label="Establishment Fee" value={inputs.establishment_fee} onChange={v => set('establishment_fee', v)} />
            <DollarField label="PPSR" value={inputs.ppsr_fee} onChange={v => set('ppsr_fee', v)} />
            <DollarField label="Origination Fee" value={inputs.origination_fee} onChange={v => set('origination_fee', v)} />
            <DollarField label="Monthly Account Fee" value={inputs.monthly_account_fee} onChange={v => set('monthly_account_fee', v)} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 pt-3 border-t border-border/40">
            <div>
              <label className={labelBase}>Fees Treatment</label>
              <select
                value={inputs.fees_financed ? 'financed' : 'non-financed'}
                onChange={e => set('fees_financed', e.target.value === 'financed')}
                className={selectBase}
              >
                <option value="financed">Financed (added to loan)</option>
                <option value="non-financed">Non-Financed (separate)</option>
              </select>
            </div>
            <CalcField label="Total Fees" value={`${fmtCurrency(derived.totalFees)}${!inputs.fees_financed ? ' (sep.)' : ''}`} />
            {derived.itcBenefit > 0 ? (
              <CalcField label="ITC Benefit" value={`-${fmtCurrency(derived.itcBenefit)}`} />
            ) : <div />}
            <CalcField label="Amount to be Financed" value={fmtCurrency(derived.amountFinanced)} />
          </div>
          {isLease && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 pt-3 border-t border-border/40">
              <DollarField label="Non-Taxable On-Road Charges" value={inputs.non_taxable_charges} onChange={v => set('non_taxable_charges', v)} />
              <DollarField label="Luxury Car Tax" value={inputs.luxury_car_tax} onChange={v => set('luxury_car_tax', v)} />
            </div>
          )}
        </section>

        {/* ── Rate & Brokerage + Term & Repayments ───────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <section className="border border-border rounded-xl p-4">
            <SectionHeader>Rate &amp; Brokerage</SectionHeader>
            <div className="grid grid-cols-2 gap-3">
              <PercentField label="Lender Interest Rate" value={inputs.interest_rate} onChange={v => set('interest_rate', v)} />
              <DollarField label="Brokerage $" value={inputs.brokerage_amount} onChange={v => set('brokerage_amount', v)} />
              <ToggleButton
                label="GST on Brokerage"
                active={inputs.gst_on_brokerage}
                activeLabel="With GST"
                inactiveLabel="Without GST"
                onClick={() => set('gst_on_brokerage', !inputs.gst_on_brokerage)}
              />
              <CalcField label="Brokerage (incl. GST)" value={fmtCurrency(derived.brokerage)} />
            </div>
          </section>

          <section className="border border-border rounded-xl p-4">
            <SectionHeader>Term &amp; Repayments</SectionHeader>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelBase}>Term (months)</label>
                <input
                  type="number"
                  min={MIN_TERM_MONTHS}
                  max={MAX_TERM_MONTHS}
                  step="1"
                  placeholder="e.g. 60"
                  value={inputs.term_months ?? ''}
                  onChange={e => {
                    const n = parseInt(e.target.value, 10);
                    set('term_months', Number.isFinite(n) ? n : null);
                  }}
                  className={`${fieldBase} px-3`}
                />
              </div>
              <ToggleButton
                label="Balloon calculated on"
                active={inputs.balloon_on_total_price}
                activeLabel="Total Price"
                inactiveLabel="Amount Financed"
                onClick={() => set('balloon_on_total_price', !inputs.balloon_on_total_price)}
              />
              <PercentField label="Balloon %" value={inputs.balloon_percent} onChange={setBalloonPercent} />
              <div>
                <label className={`${labelBase} flex gap-1`}>
                  Balloon $
                  <span className="text-[9px] font-semibold text-muted-foreground/50">OVERRIDE</span>
                </label>
                <MoneyInput
                  value={inputs.balloon_amount}
                  onChange={setBalloonAmount}
                  placeholder={formatMoney(fmt2(derived.balloonBase * (inputs.balloon_percent / 100)))}
                />
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-border/40">
              <label className={`${labelBase} mb-2`}>Direct debit cycle (as approved by the lender)</label>
              <RadioGroup
                name="direct_debit_cycle"
                value={inputs.direct_debit_cycle}
                options={CYCLE_OPTIONS}
                onChange={v => set('direct_debit_cycle', v)}
              />
            </div>
          </section>
        </div>

        {/* ── Live Preview ───────────────────────────────────── */}
        {structures.length > 0 && (
          <section className="border border-border rounded-xl p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-0.5 h-4 bg-primary/60 rounded-full shrink-0" />
              <h3 className="text-[11px] font-bold text-foreground uppercase tracking-widest">Live Preview</h3>
              <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full uppercase tracking-wide">
                {FACILITY_LABELS[inputs.facility_type]} · {inputs.term_months} months · {cycleLabel}
              </span>
              <div className="flex-1 h-px bg-border/50" />
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-[12px] border-collapse">
                <thead>
                  <tr className="bg-muted/40 border-b border-border">
                    <th className={`${th} text-left`}>Structure</th>
                    <th className={`${th} text-left`}>Balloon</th>
                    <th className={`${th} text-right`}>Net Rental</th>
                    {!isChattel && <th className={`${th} text-right`}>Stamp Duty</th>}
                    {isLease && <th className={`${th} text-right`}>GST</th>}
                    <th className={`${th} text-right`}>{cycleLabel} Repayment</th>
                    <th className={`${th} text-right`}>Total Interest</th>
                    <th className={`${th} text-right`}>All Up Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {structures.map(s => (
                    <tr key={String(s.hasBalloon)} className="border-b border-border/40 last:border-0">
                      <td className="py-2 px-3 font-semibold">{s.hasBalloon ? 'With Balloon' : 'No Balloon'}</td>
                      <td className="py-2 px-3 text-muted-foreground tabular-nums">
                        {s.hasBalloon ? `${s.balloonPercent}% · ${fmtCurrency(s.balloonTotal)}` : '—'}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{fmtCurrency(s.netRental)}</td>
                      {!isChattel && <td className="py-2 px-3 text-right tabular-nums">{fmtCurrency(s.stampDuty)}</td>}
                      {isLease && <td className="py-2 px-3 text-right tabular-nums">{fmtCurrency(s.gst)}</td>}
                      <td className="py-2 px-3 text-right font-bold tabular-nums">
                        {fmtCurrency(repaymentFor(inputs.direct_debit_cycle, s) ?? 0)}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{fmtCurrency(s.totalInterest)}</td>
                      <td className="py-2 px-3 text-right font-bold tabular-nums text-primary">
                        {s.allUpRate != null ? `${(s.allUpRate * 100).toFixed(2)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1 flex-wrap">
          <Button onClick={handleSave} loading={saving}>
            {sheet ? 'Update Lender Pricing' : 'Create Lender Pricing'}
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </div>
    </Card>
  );
}
