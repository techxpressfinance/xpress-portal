import { useState, useMemo, type ReactNode } from 'react';
import { Button, GlassCard } from './ui';
import type { QuoteSheet, QuoteInputParameters } from '../types';
import api from '../api/client';
import { useToast } from './Toast';
import { getErrorMessage } from '../lib/utils';

const DEFAULT_BALLOON_PERCENTAGES: Record<string, number> = {
  '2': 0,
  '3': 0,
  '4': 0,
  '5': 0,
  '7': 0,
};

const TERMS = [5, 4, 3, 2, 7]; // Display order matching Excel

const DEFAULT_INPUTS: QuoteInputParameters = {
  facility_type: 'chattel',
  payment_type: 'advance',
  asset_price: 0,
  asset_description: 'Motor Vehicle',
  deposit_percent: 0,
  deposit_amount: null,
  establishment_fee: 0,
  ppsr_fee: 0,
  origination_fee: 0,
  brokerage_percent: 0,
  brokerage_amount: null,
  gst_on_brokerage: false,
  balloon_on_total_price: true,
  interest_rate: 0,
  gst_percent: 10,
  balloon_percentages: { ...DEFAULT_BALLOON_PERCENTAGES },
  balloon_amounts: {},
  monthly_account_fee: 0,
  non_taxable_charges: 0,
  luxury_car_tax: 0,
  fees_financed: true,
  selected_terms: [...TERMS],
  show_interest_rate: false,
};

// ── PMT — Excel-compatible (supports type=0 arrears & type=1 advance) ─
function pmt(rate: number, nper: number, pv: number, fv = 0, type: 0 | 1 = 0): number {
  if (rate === 0) return -(pv + fv) / nper;
  const pvif = Math.pow(1 + rate, nper);
  let payment = -(rate * (pv * pvif + fv)) / (pvif - 1);
  if (type === 1) payment /= (1 + rate);
  return payment;
}

const fmt2 = (n: number) => Math.round(n * 100) / 100;

// ── RATE — Excel-compatible Newton-Raphson solver ────────────────────
// Excel B46: RATE(nper, pmt, pv, fv, type, guess) * 12
function rateNR(nper: number, pmt: number, pv: number, fv = 0, type: 0 | 1 = 0, guess = 0.01): number {
  let r = guess;
  for (let i = 0; i < 300; i++) {
    const f = Math.pow(1 + r, nper);
    const df = nper * Math.pow(1 + r, nper - 1);
    const yr = type === 0
      ? pv * f + pmt * (f - 1) / r + fv
      : pv * f + pmt * (1 + r) * (f - 1) / r + fv;
    const yr_d = type === 0
      ? pv * df + pmt * (r * df - (f - 1)) / (r * r)
      : pv * df + pmt * ((1 + r) * (r * df - (f - 1)) / (r * r) + (f - 1) / r);
    const rNew = r - yr / yr_d;
    if (Math.abs(rNew - r) < 1e-10) return rNew;
    r = rNew;
  }
  return r;
}

// ── ITC Benefit (lease only, from Excel formula page B1-B3) ──────────
function calcItcBenefit(inputs: QuoteInputParameters): number {
  if (inputs.facility_type !== 'lease') return 0;
  const purchasePrice = inputs.asset_price;
  const desc = inputs.asset_description.toLowerCase();
  const nonTax = inputs.non_taxable_charges;
  const lct = inputs.luxury_car_tax;
  const LCT_CAP = 5182.64; // ATO luxury car limit

  if (desc.includes('car')) {
    const raw = (purchasePrice - nonTax - lct) / 11;
    return raw > LCT_CAP ? LCT_CAP : raw;
  } else if (desc.includes('vehicle')) {
    return (purchasePrice - nonTax - lct) / 11;
  }
  // Equipment / other
  return purchasePrice / 11;
}

// ── Stamp duty rate (from Excel formula page B22) ────────────────────
function stampDutyRate(inputs: QuoteInputParameters): number {
  if (inputs.facility_type === 'chattel') return 0;
  if (inputs.facility_type === 'hp') return 0.0075 * 1.1; // 0.75% × GST
  return 0.0075; // lease: 0.75% (no GST multiplier)
}

// ── Derive all calculated values from inputs ─────────────────────────
function computeFromInputs(inputs: QuoteInputParameters) {
  const deposit = inputs.deposit_amount != null ? inputs.deposit_amount : inputs.asset_price * (inputs.deposit_percent / 100);
  const amountBorrowed = inputs.asset_price - deposit;
  const totalFees = inputs.establishment_fee + inputs.ppsr_fee + inputs.origination_fee;
  const netAmount = inputs.fees_financed ? amountBorrowed + totalFees : amountBorrowed;

  // Brokerage: dollar override or calculate from %
  const brokerageBase = inputs.brokerage_amount != null ? inputs.brokerage_amount : amountBorrowed * (inputs.brokerage_percent / 100);
  const brokerageWithGst = brokerageBase * (1 + inputs.gst_percent / 100);
  const brokerage = inputs.gst_on_brokerage ? brokerageWithGst : brokerageBase;

  // ITC benefit (lease only) — deducted from purchase price
  const itcBenefit = calcItcBenefit(inputs);

  // Amount financed: Excel C28 = C24 + C25 + C27
  // C24 = purchasePrice(with fees) - ITC - deposit, C25 = brokerage, C27 = admin fee (0 when fees already in C11)
  const subTotal = netAmount - itcBenefit;
  const amountFinanced = subTotal + brokerage;

  // Balloon base: total price or amount financed
  const balloonBase = inputs.balloon_on_total_price ? inputs.asset_price : amountFinanced;

  return { deposit, amountBorrowed, netAmount, brokerage, brokerageBase, amountFinanced, balloonBase, totalFees, itcBenefit, subTotal };
}

type Scenario = {
  termYears: number;
  hasBalloon: boolean;
  balloon: number;          // net balloon
  balloonGst: number;       // GST on balloon (lease only)
  balloonTotal: number;     // net + GST
  balloonPercent: number;
  netRental: number;        // base PMT payment
  stampDuty: number;        // HP/Lease
  gst: number;              // GST on rental (Lease only)
  monthlyRepayment: number; // net + stamp + GST + account fee
  weeklyRepayment: number;
  fortnightlyRepayment: number;
  totalInterest: number;
  totalAnnual: number;
  totalOverTerm: number;
  clientInterest: number | null; // All Up Interest Rate (advance only)
};

function generateScenarios(inputs: QuoteInputParameters): Scenario[] {
  const { amountFinanced, amountBorrowed, balloonBase, subTotal: financedSubTotal } = computeFromInputs(inputs);
  const rate = inputs.interest_rate / 100;
  const monthlyRate = rate / 12;
  const isAdvance = inputs.payment_type === 'advance';
  const sdRate = stampDutyRate(inputs);
  const isLease = inputs.facility_type === 'lease';

  const scenarios: Scenario[] = [];

  for (const termYears of TERMS) {
    const months = termYears * 12;
    const balloonPct = inputs.balloon_percentages[String(termYears)] ?? 0;
    // Balloon: dollar override or calculate from %
    const balloonOverride = inputs.balloon_amounts?.[String(termYears)];
    const balloonNet = balloonOverride != null ? balloonOverride : fmt2(balloonBase * (balloonPct / 100));
    const balloonGst = isLease ? fmt2(balloonNet * (inputs.gst_percent / 100)) : 0;
    const balloonTotal = fmt2(balloonNet + balloonGst);

    const buildScenario = (useBalloon: boolean): Scenario | null => {
      const balloon = useBalloon ? balloonNet : 0;
      const bGst = useBalloon ? balloonGst : 0;
      const bTotal = useBalloon ? balloonTotal : 0;
      const pct = useBalloon ? balloonPct : 0;

      if (useBalloon && balloonNet <= 0) return null;

      // PMT calculation — matches Excel formula page B36/B37
      let netRental: number;
      if (isAdvance) {
        // Excel B36: PMT(rate/12, months, -amountFinanced, balloon, 1)
        netRental = -pmt(monthlyRate, months, amountFinanced, -balloon, 1);
      } else {
        // Excel B37: PMT(POWER(1+rate/12, 1)-1, months-1, -amountFinanced*(1+rate/12), balloon, 1)
        const periodRate = Math.pow(1 + monthlyRate, 1) - 1; // same as monthlyRate for monthly
        netRental = -pmt(periodRate, months - 1, amountFinanced * (1 + monthlyRate), -balloon, 1);
      }
      netRental = fmt2(netRental);

      // Client Interest (All Up Interest Rate) — Excel B46
      // RATE(nper, netRental, -financedSubTotal, balloon, 1) * 12
      // Advance only; arrears is "Unable to calculate" in source sheet
      const clientInterest = isAdvance && financedSubTotal > 0
        ? rateNR(months, netRental, -financedSubTotal, balloon, 1) * 12
        : null;

      // Stamp duty (HP/Lease — Excel B41)
      const sd = inputs.facility_type === 'chattel' ? 0 : fmt2(Math.round(netRental * sdRate * 100) / 100);

      // GST on rental (Lease only — Excel B43)
      const rentalSubTotal = netRental + sd;
      const rentalGst = isLease ? fmt2(Math.round(rentalSubTotal * (inputs.gst_percent / 100) * 100) / 100) : 0;

      // Total rental = net + stamp + GST + monthly account fee
      const totalRental = fmt2(rentalSubTotal + rentalGst);
      const monthlyRepayment = fmt2(totalRental + inputs.monthly_account_fee);

      const weeklyRepayment = fmt2(monthlyRepayment * 12 / 52);
      const fortnightlyRepayment = fmt2(monthlyRepayment * 12 / 26);
      const totalAnnual = fmt2(monthlyRepayment * 12);
      const totalOverTerm = fmt2(monthlyRepayment * months + balloon);
      const totalInterest = fmt2(totalOverTerm - amountBorrowed);

      return {
        termYears,
        hasBalloon: useBalloon,
        balloon,
        balloonGst: bGst,
        balloonTotal: bTotal,
        balloonPercent: pct,
        netRental,
        stampDuty: sd,
        gst: rentalGst,
        monthlyRepayment,
        weeklyRepayment,
        fortnightlyRepayment,
        totalInterest,
        totalAnnual,
        totalOverTerm,
        clientInterest,
      };
    };

    // No balloon variant
    const noBalloon = buildScenario(false);
    if (noBalloon) scenarios.push(noBalloon);

    // With balloon variant (only if balloon % > 0 or override set)
    const withBalloon = buildScenario(true);
    if (withBalloon) scenarios.push(withBalloon);
  }

  return scenarios;
}

// Convert scenarios to QuoteOption payloads for the API
function scenariosToOptions(inputs: QuoteInputParameters, scenarios: Scenario[]) {
  const { deposit, amountFinanced, brokerage } = computeFromInputs(inputs);

  return scenarios.map((s, i) => ({
    lender_name: `${s.termYears} Year${s.hasBalloon ? ` (${s.balloonPercent}% Balloon)` : ''}`,
    lender_product: inputs.facility_type.toUpperCase(),
    sort_order: i,
    is_recommended: false,
    purchase_price: inputs.asset_price,
    deposit: fmt2(deposit),
    loan_amount: fmt2(amountFinanced),
    loan_term_months: s.termYears * 12,
    balloon_residual: s.balloonTotal,
    interest_rate: inputs.interest_rate,
    comparison_rate: null,
    client_interest_rate: s.clientInterest != null ? fmt2(s.clientInterest * 100) : null,
    establishment_fee: inputs.establishment_fee,
    monthly_account_fee: inputs.monthly_account_fee || null,
    application_fee: inputs.ppsr_fee + inputs.origination_fee,
    brokerage: fmt2(brokerage),
    repayment_monthly: s.monthlyRepayment,
    repayment_fortnightly: s.fortnightlyRepayment,
    repayment_weekly: s.weeklyRepayment,
    total_repayments: s.totalOverTerm,
    total_interest: s.totalInterest,
    total_fees: fmt2(inputs.establishment_fee + inputs.ppsr_fee + inputs.origination_fee + brokerage),
    features: null,
    notes: null,
  }));
}

// ── Shared field components ──────────────────────────────────────────

const fieldBase = "w-full h-9 rounded-lg bg-secondary text-[13px] text-foreground transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background border border-transparent";
const labelBase = "block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1";

function DollarInput({ label, value, onChange, placeholder }: {
  label: string;
  value: number | string;
  onChange: (val: number) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className={labelBase}>{label}</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[13px]">$</span>
        <input
          type="number"
          step="any"
          min="0"
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(Math.max(0, parseFloat(e.target.value)) || 0)}
          className={`${fieldBase} pl-6 pr-3`}
        />
      </div>
    </div>
  );
}

function CalcField({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <label className={`${labelBase} flex items-center gap-1`}>
        {label}
        <span className="text-[9px] font-bold text-muted-foreground/50 tracking-wide">AUTO</span>
      </label>
      <div className={`h-9 flex items-center px-3 rounded-lg bg-muted/30 text-[13px] text-foreground font-semibold border border-dashed border-border/40 tabular-nums ${className ?? ''}`}>
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

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-0.5 h-4 bg-primary/60 rounded-full shrink-0" />
      <h3 className="text-[11px] font-bold text-foreground uppercase tracking-widest">{children}</h3>
      <div className="flex-1 h-px bg-border/50" />
    </div>
  );
}


interface QuoteSheetEditorProps {
  applicationId?: string;
  quoteSheet?: QuoteSheet;
  onSave: (sheet: QuoteSheet) => void;
  onCancel: () => void;
}

function parseInputParams(quoteSheet?: QuoteSheet): QuoteInputParameters {
  if (quoteSheet?.input_parameters) {
    try {
      return { ...DEFAULT_INPUTS, ...JSON.parse(quoteSheet.input_parameters), gst_percent: 10 };
    } catch { /* fall through */ }
  }
  return { ...DEFAULT_INPUTS, balloon_percentages: { ...DEFAULT_BALLOON_PERCENTAGES } };
}

export default function QuoteSheetEditor({ applicationId, quoteSheet, onSave, onCancel }: QuoteSheetEditorProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState(quoteSheet?.title || '');
  const [brokerNotes, setBrokerNotes] = useState(quoteSheet?.broker_notes || '');
  const [inputs, setInputs] = useState<QuoteInputParameters>(() => parseInputParams(quoteSheet));
  const [saving, setSaving] = useState(false);

  const updateInput = <K extends keyof QuoteInputParameters>(key: K, value: QuoteInputParameters[K]) => {
    setInputs(prev => ({ ...prev, [key]: value }));
  };

  const updateBalloonPct = (term: string, value: number) => {
    setInputs(prev => ({
      ...prev,
      balloon_percentages: { ...prev.balloon_percentages, [term]: value },
    }));
  };

  const toggleTerm = (term: number) => {
    setInputs(prev => {
      const current = prev.selected_terms ?? TERMS;
      const next = current.includes(term) ? current.filter(t => t !== term) : [...current, term];
      return { ...prev, selected_terms: next };
    });
  };

  // Derived values
  const derived = useMemo(() => computeFromInputs(inputs), [inputs]);
  const scenarios = useMemo(() => {
    if (inputs.asset_price <= 0) return [];
    return generateScenarios(inputs);
  }, [inputs]);

  const isStandalone = !applicationId;
  const baseUrl = isStandalone ? '/quote-sheets' : `/applications/${applicationId}/quote-sheets`;

  const handleSave = async () => {
    if (inputs.asset_price <= 0) {
      toast('Please enter a valid asset price', 'error');
      return;
    }

    setSaving(true);
    const inputParamsJson = JSON.stringify(inputs);
    const options = scenariosToOptions(inputs, scenarios);

    try {
      if (quoteSheet) {
        // Update existing: patch sheet, then replace all options
        await api.patch(`${baseUrl}/${quoteSheet.id}`, {
          title: title.trim() || null,
          broker_notes: brokerNotes.trim() || null,
          input_parameters: inputParamsJson,
        });

        // Delete all existing options
        for (const existing of quoteSheet.options) {
          await api.delete(`${baseUrl}/${quoteSheet.id}/options/${existing.id}`);
        }

        // Add new generated options
        for (const opt of options) {
          await api.post(`${baseUrl}/${quoteSheet.id}/options`, opt);
        }

        const { data } = await api.get(`${baseUrl}/${quoteSheet.id}`);
        onSave(data);
        toast('Quote sheet updated', 'success');
      } else {
        const payload = {
          title: title.trim() || null,
          broker_notes: brokerNotes.trim() || null,
          input_parameters: inputParamsJson,
          options,
        };
        const { data } = await api.post(baseUrl, payload);
        onSave(data);
        toast('Quote sheet created', 'success');
      }
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to save quote sheet'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const fmtCurrency = (n: number) =>
    `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const selectBase = `${fieldBase} px-3 appearance-none`;

  return (
    <GlassCard>
      <div className="space-y-6">

        {/* Sheet meta */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={labelBase}>Title</label>
            <input
              type="text"
              placeholder="e.g. Vehicle Finance Options"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className={`${fieldBase} px-3`}
            />
          </div>
          <div>
            <label className={`${labelBase} flex gap-1.5 items-center`}>
              Broker Notes
              <span className="text-[9px] font-semibold text-muted-foreground/50 tracking-wide">INTERNAL — NOT SHOWN TO CLIENT</span>
            </label>
            <textarea
              className="w-full rounded-lg bg-secondary px-3 py-2 text-[13px] text-foreground transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background placeholder:text-muted-foreground border border-transparent min-h-[36px] resize-none"
              placeholder="Internal notes..."
              value={brokerNotes}
              onChange={e => setBrokerNotes(e.target.value)}
              rows={1}
            />
          </div>
        </div>

        {/* ── SECTION 1: Loan Setup ─────────────────────────────── */}
        <section className="border border-border rounded-xl p-4">
          <SectionHeader>Loan Setup</SectionHeader>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className={labelBase}>Facility Type</label>
              <select
                value={inputs.facility_type}
                onChange={e => updateInput('facility_type', e.target.value as 'chattel' | 'hp' | 'lease')}
                className={selectBase}
              >
                <option value="chattel">Chattel Mortgage</option>
                <option value="hp">Hire Purchase</option>
                <option value="lease">Lease</option>
              </select>
            </div>
            <ToggleButton
              label="Payment Type"
              active={inputs.payment_type === 'advance'}
              activeLabel="Advance (Start)"
              inactiveLabel="Arrears (End)"
              onClick={() => updateInput('payment_type', inputs.payment_type === 'advance' ? 'arrears' : 'advance')}
            />
            <div className="md:col-span-2">
              <label className={labelBase}>Asset / Loan Description</label>
              <input
                type="text"
                placeholder="e.g. Motor Vehicle, Industrial Equipment, Boat"
                value={inputs.asset_description}
                onChange={e => updateInput('asset_description', e.target.value)}
                className={`${fieldBase} px-3`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 pt-3 border-t border-border/40">
            <DollarInput
              label="Asset Price"
              value={inputs.asset_price || ''}
              onChange={v => updateInput('asset_price', v)}
            />
            <div>
              <label className={labelBase}>Deposit %</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[12px]">%</span>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={inputs.deposit_percent || ''}
                  onChange={e => {
                    const pct = Math.max(0, parseFloat(e.target.value)) || 0;
                    setInputs(prev => ({ ...prev, deposit_percent: pct, deposit_amount: prev.asset_price > 0 ? fmt2(prev.asset_price * (pct / 100)) : null }));
                  }}
                  className={`${fieldBase} pl-7 pr-3`}
                />
              </div>
            </div>
              <div>
                <label className={`${labelBase} flex gap-1`}>
                Deposit $
                <span className="text-[9px] font-semibold text-muted-foreground/50">OVERRIDE</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[13px]">$</span>
                <input
                  type="number"
                  step="any"
                  min="0"
                  placeholder={fmtCurrency(inputs.asset_price * (inputs.deposit_percent / 100)).replace('$', '')}
                  value={inputs.deposit_amount ?? ''}
                  onChange={e => {
                    const amt = e.target.value ? Math.max(0, parseFloat(e.target.value)) : null;
                    setInputs(prev => ({ ...prev, deposit_amount: amt, deposit_percent: amt != null && prev.asset_price > 0 ? fmt2((amt / prev.asset_price) * 100) : prev.deposit_percent }));
                  }}
                  className={`${fieldBase} pl-6 pr-3`}
                />
              </div>
            </div>
            <CalcField label="Amount Borrowed" value={fmtCurrency(derived.amountBorrowed)} />
          </div>
        </section>

        {/* ── SECTION 2: Fees & Charges ────────────────────────── */}
        <section className="border border-border rounded-xl p-4">
          <SectionHeader>Fees &amp; Charges</SectionHeader>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <DollarInput
              label="Establishment Fee"
              value={inputs.establishment_fee || ''}
              onChange={v => updateInput('establishment_fee', v)}
            />
            <DollarInput
              label="PPSR"
              value={inputs.ppsr_fee || ''}
              onChange={v => updateInput('ppsr_fee', v)}
            />
            <DollarInput
              label="Origination Fee"
              value={inputs.origination_fee || ''}
              onChange={v => updateInput('origination_fee', v)}
            />
            <DollarInput
              label="Monthly Account Fee"
              value={inputs.monthly_account_fee || ''}
              onChange={v => updateInput('monthly_account_fee', v)}
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 pt-3 border-t border-border/40">
            <div>
              <label className={labelBase}>Fees Treatment</label>
              <select
                value={inputs.fees_financed ? 'financed' : 'non-financed'}
                onChange={e => updateInput('fees_financed', e.target.value === 'financed')}
                className={selectBase}
              >
                <option value="financed">Financed (added to loan)</option>
                <option value="non-financed">Non-Financed (separate)</option>
              </select>
            </div>
            <CalcField
              label="Total Fees"
              value={`${fmtCurrency(derived.totalFees)}${!inputs.fees_financed ? ' (sep.)' : ''}`}
            />
            {derived.itcBenefit > 0 ? (
              <CalcField
                label="ITC Benefit"
                value={`-${fmtCurrency(derived.itcBenefit)}`}
                className="!text-green-700 !bg-green-500/10 !border-green-200"
              />
            ) : <div />}
            <CalcField label="Amount to be Financed" value={fmtCurrency(derived.amountFinanced)} />
          </div>

          {inputs.facility_type === 'lease' && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 pt-3 border-t border-border/40">
              <DollarInput
                label="Non-Taxable On-Road Charges"
                value={inputs.non_taxable_charges || ''}
                onChange={v => updateInput('non_taxable_charges', v)}
              />
              <DollarInput
                label="Luxury Car Tax"
                value={inputs.luxury_car_tax || ''}
                onChange={v => updateInput('luxury_car_tax', v)}
              />
            </div>
          )}
        </section>

        {/* ── SECTION 3: Rate & Brokerage + Balloon ──────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <section className="border border-border rounded-xl p-4">
            <SectionHeader>Rate &amp; Brokerage</SectionHeader>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelBase}>Lender Interest Rate</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[12px]">%</span>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={inputs.interest_rate || ''}
                    onChange={e => updateInput('interest_rate', Math.max(0, parseFloat(e.target.value)) || 0)}
                    className={`${fieldBase} pl-7 pr-3`}
                  />
                </div>
              </div>
              <div>
                <label className={labelBase}>Brokerage %</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[12px]">%</span>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={inputs.brokerage_percent || ''}
                    onChange={e => updateInput('brokerage_percent', Math.max(0, parseFloat(e.target.value)) || 0)}
                    className={`${fieldBase} pl-7 pr-3`}
                  />
                </div>
              </div>
              <ToggleButton
                label="GST on Brokerage"
                active={inputs.gst_on_brokerage}
                activeLabel="With GST"
                inactiveLabel="Without GST"
                onClick={() => updateInput('gst_on_brokerage', !inputs.gst_on_brokerage)}
              />
              <CalcField label="Brokerage Amount" value={fmtCurrency(derived.brokerage)} />
              <CalcField label="GST Rate" value="10%" />
            </div>
          </section>

          <section className="border border-border rounded-xl p-4">
            <SectionHeader>Balloon Settings</SectionHeader>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <ToggleButton
                label="Balloon calculated on"
                active={inputs.balloon_on_total_price}
                activeLabel="Total Price"
                inactiveLabel="Amount Financed"
                onClick={() => updateInput('balloon_on_total_price', !inputs.balloon_on_total_price)}
              />
              <CalcField label="Balloon Base" value={fmtCurrency(derived.balloonBase)} />
            </div>
            <div>
              <label className={labelBase}>Balloon % per Term</label>
              <div className="grid grid-cols-5 gap-2 mt-1">
                {TERMS.map(t => (
                  <div key={t}>
                    <div className="text-center text-[10px] text-muted-foreground font-semibold mb-1">{t}yr</div>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        value={inputs.balloon_percentages[String(t)] ?? 0}
                        onChange={e => updateBalloonPct(String(t), Math.max(0, parseFloat(e.target.value)) || 0)}
                        className={`${fieldBase} px-2 pr-5 text-center`}
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-[11px]">%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* ── Terms to Show Client ─────────────────────────────── */}
        <section className="border border-border rounded-xl p-4">
          <SectionHeader>Client Output Settings</SectionHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className={`${labelBase} mb-2`}>Terms to include in client PDF</label>
              <div className="flex flex-wrap gap-2">
                {TERMS.map(t => {
                  const isSelected = (inputs.selected_terms ?? TERMS).includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleTerm(t)}
                      className={`h-8 px-4 rounded-lg text-[12px] font-semibold transition-colors border ${isSelected
                        ? 'bg-primary/10 text-primary border-primary/20'
                        : 'bg-muted text-muted-foreground border-border/40 opacity-50'
                      }`}
                    >
                      {t} Year
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">Only selected terms appear in the client PDF.</p>
            </div>
            <div className="space-y-3">
              <div>
                <label className={`${labelBase} mb-1.5`}>Repayment display range (±$)</label>
                <div className="flex items-center gap-3">
                  <div className="relative w-36">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[12px] select-none">±$</span>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      placeholder="e.g. 50"
                      value={inputs.repayment_range ?? ''}
                      onChange={e => updateInput('repayment_range', Math.max(0, parseFloat(e.target.value)) || undefined)}
                      className={`${fieldBase} pl-8 pr-3`}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground">Shows a range to client instead of exact. Leave blank for exact.</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => updateInput('show_interest_rate', !inputs.show_interest_rate)}
                  className={`h-8 px-3 rounded-lg text-[12px] font-semibold transition-colors border whitespace-nowrap ${inputs.show_interest_rate
                    ? 'bg-primary/10 text-primary border-primary/20'
                    : 'bg-muted text-muted-foreground border-border/40'
                  }`}
                >
                  {inputs.show_interest_rate ? 'Interest rate: visible' : 'Interest rate: hidden'}
                </button>
                <span className="text-[10px] text-muted-foreground">Controls interest rate visibility on client quote.</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Live Preview ─────────────────────────────────────── */}
        {scenarios.length > 0 && (
          <section className="border border-border rounded-xl p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-0.5 h-4 bg-primary/60 rounded-full shrink-0" />
              <h3 className="text-[11px] font-bold text-foreground uppercase tracking-widest">Live Preview</h3>
              <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full uppercase tracking-wide">
                {inputs.facility_type === 'chattel' ? 'Chattel Mortgage' : inputs.facility_type === 'hp' ? 'Hire Purchase' : 'Lease'}
              </span>
              <div className="flex-1 h-px bg-border/50" />
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-[12px] border-collapse">
                <thead>
                  <tr className="bg-muted/40 border-b border-border">
                    <th className="text-left py-2 px-3 text-muted-foreground font-semibold uppercase tracking-wide text-[10px]">Term</th>
                    <th className="text-left py-2 px-3 text-muted-foreground font-semibold uppercase tracking-wide text-[10px]">Balloon</th>
                    <th className="text-right py-2 px-3 text-muted-foreground font-semibold uppercase tracking-wide text-[10px]">Net Rental</th>
                    {inputs.facility_type !== 'chattel' && <th className="text-right py-2 px-3 text-muted-foreground font-semibold uppercase tracking-wide text-[10px]">Stamp Duty</th>}
                    {inputs.facility_type === 'lease' && <th className="text-right py-2 px-3 text-muted-foreground font-semibold uppercase tracking-wide text-[10px]">GST</th>}
                    <th className="text-right py-2 px-3 text-muted-foreground font-semibold uppercase tracking-wide text-[10px]">Monthly</th>
                    <th className="text-right py-2 px-3 text-muted-foreground font-semibold uppercase tracking-wide text-[10px]">Fortnightly</th>
                    <th className="text-right py-2 px-3 text-muted-foreground font-semibold uppercase tracking-wide text-[10px]">Weekly</th>
                    <th className="text-right py-2 px-3 text-muted-foreground font-semibold uppercase tracking-wide text-[10px]">Total Interest</th>
                    <th className="text-right py-2 px-3 text-muted-foreground font-semibold uppercase tracking-wide text-[10px]">All Up Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarios.map((s, i) => (
                    <tr key={i} className={`border-b border-border/40 last:border-0 ${i % 2 === 0 ? '' : 'bg-muted/20'}`}>
                      <td className="py-2 px-3 font-semibold tabular-nums">{s.termYears}yr</td>
                      <td className="py-2 px-3 text-muted-foreground tabular-nums">
                        {s.hasBalloon ? `${s.balloonPercent}% · ${fmtCurrency(s.balloon)}` : '—'}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{fmtCurrency(s.netRental)}</td>
                      {inputs.facility_type !== 'chattel' && <td className="py-2 px-3 text-right tabular-nums">{fmtCurrency(s.stampDuty)}</td>}
                      {inputs.facility_type === 'lease' && <td className="py-2 px-3 text-right tabular-nums">{fmtCurrency(s.gst)}</td>}
                      <td className="py-2 px-3 text-right font-bold tabular-nums">{fmtCurrency(s.monthlyRepayment)}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{fmtCurrency(s.fortnightlyRepayment)}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{fmtCurrency(s.weeklyRepayment)}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{fmtCurrency(s.totalInterest)}</td>
                      <td className="py-2 px-3 text-right font-bold tabular-nums text-primary">
                        {s.clientInterest != null ? `${(s.clientInterest * 100).toFixed(2)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1">
          <Button onClick={handleSave} loading={saving}>
            {quoteSheet ? 'Update Quote Sheet' : 'Create Quote Sheet'}
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </div>
    </GlassCard>
  );
}
