import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { Button, Card } from './ui';
import type { QuoteSheet, QuoteInputParameters } from '../types';
import api from '../api/client';
import { useToast } from './Toast';
import { getErrorMessage } from '../lib/utils';
import {
  MAX_TERM_MONTHS,
  MIN_TERM_MONTHS,
  STANDARD_TERM_MONTHS,
  migrateQuoteParams,
  sortTerms,
  standardResidualPercent,
  termLabel,
  termLabelShort,
} from '../lib/quoteTerms';

const DEFAULT_BALLOON_PERCENTAGES: Record<string, number> = Object.fromEntries(
  STANDARD_TERM_MONTHS.map(m => [String(m), 0]),
);

// All terms (in months) this sheet quotes: the standard set plus any custom
// terms the broker added (e.g. 18 months).
function termsOf(inputs: QuoteInputParameters): number[] {
  const custom = (inputs.custom_term_months ?? []).filter(m => !STANDARD_TERM_MONTHS.includes(m));
  return sortTerms([...STANDARD_TERM_MONTHS, ...new Set(custom)]);
}

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
  custom_term_months: [],
  selected_terms: [...STANDARD_TERM_MONTHS],
  show_interest_rate: false,
  show_total_interest: true,
  show_weekly: true,
  show_preferred_option: false,
  preferred_term: 60,
  preferred_balloon: false,
  terms_in_months: true,
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

// ── Money formatting helpers (thousands separators in text inputs) ───
const formatMoney = (v: number | string | null): string => {
  if (v === '' || v == null) return '';
  const n = typeof v === 'number' ? v : parseFloat(v);
  return isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '';
};
// Insert thousands separators into a raw "digits[.digits]" string, keeping a
// trailing decimal point the user may still be mid-typing (e.g. "1234.").
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
  termMonths: number;
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

  for (const months of termsOf(inputs)) {
    const balloonPct = inputs.balloon_percentages[String(months)] ?? 0;
    // Balloon: dollar override or calculate from %
    const balloonOverride = inputs.balloon_amounts?.[String(months)];
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
        termMonths: months,
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
    lender_name: `${termLabel(s.termMonths)}${s.hasBalloon ? ` (${s.balloonPercent}% Balloon)` : ''}`,
    lender_product: inputs.facility_type.toUpperCase(),
    sort_order: i,
    is_recommended: false,
    purchase_price: inputs.asset_price,
    deposit: fmt2(deposit),
    loan_amount: fmt2(amountFinanced),
    loan_term_months: s.termMonths,
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

// Text input that displays dollar amounts with thousands separators while
// reporting a plain number (or null when cleared, if allowNull) to the parent.
function MoneyInput({ value, onChange, placeholder, className, allowNull }: {
  value: number | string | null;
  onChange: (val: number | null) => void;
  placeholder?: string;
  className?: string;
  allowNull?: boolean;
}) {
  const [text, setText] = useState(() => formatMoney(value));
  // Resync from the parent only when the underlying number actually diverges,
  // so a trailing "." or in-progress decimal the user is typing isn't clobbered.
  useEffect(() => {
    const propNum = value === '' || value == null ? null : Number(value);
    if (moneyToNum(text) !== propNum) setText(formatMoney(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      type="text"
      inputMode="decimal"
      placeholder={placeholder}
      value={text}
      onChange={e => {
        const cleaned = e.target.value.replace(/[^\d.]/g, '');
        setText(commaize(cleaned));
        const n = moneyToNum(cleaned);
        onChange(n == null ? (allowNull ? null : 0) : Math.max(0, n));
      }}
      className={className}
    />
  );
}

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
        <MoneyInput
          value={value}
          onChange={v => onChange(v ?? 0)}
          placeholder={placeholder}
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
      // Sheets saved before custom terms keyed everything by years — migrate.
      const saved = migrateQuoteParams(JSON.parse(quoteSheet.input_parameters));
      return { ...DEFAULT_INPUTS, ...saved, gst_percent: 10 } as QuoteInputParameters;
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
  const [customTermInput, setCustomTermInput] = useState('');

  const updateInput = <K extends keyof QuoteInputParameters>(key: K, value: QuoteInputParameters[K]) => {
    setInputs(prev => ({ ...prev, [key]: value }));
  };

  // Editing % makes the percentage the source of truth — drop any $ override
  // so the balloon $ is re-derived live from the balloon base.
  const updateBalloonPct = (term: string, value: number) => {
    setInputs(prev => {
      const amounts = { ...(prev.balloon_amounts ?? {}) };
      delete amounts[term];
      return {
        ...prev,
        balloon_percentages: { ...prev.balloon_percentages, [term]: value },
        balloon_amounts: amounts,
      };
    });
  };

  // Editing $ stores a per-term override and back-computes the % off the base,
  // mirroring the Deposit %/$ pair. Clearing the field reverts to %-driven.
  const updateBalloonAmount = (term: string, value: number | null) => {
    setInputs(prev => {
      const base = computeFromInputs(prev).balloonBase;
      const amounts = { ...(prev.balloon_amounts ?? {}) };
      if (value == null) delete amounts[term]; else amounts[term] = value;
      const pct = value != null && base > 0
        ? fmt2((value / base) * 100)
        : prev.balloon_percentages[term] ?? 0;
      return {
        ...prev,
        balloon_amounts: amounts,
        balloon_percentages: { ...prev.balloon_percentages, [term]: pct },
      };
    });
  };

  // Fill in ATO minimum residual values and clear any $ overrides. Custom terms
  // get the value interpolated between the neighbouring whole years.
  const applyStandardResiduals = () => {
    setInputs(prev => ({
      ...prev,
      balloon_percentages: {
        ...prev.balloon_percentages,
        ...Object.fromEntries(termsOf(prev).map(m => [String(m), standardResidualPercent(m)])),
      },
      balloon_amounts: {},
    }));
  };

  const toggleTerm = (term: number) => {
    setInputs(prev => {
      const current = prev.selected_terms ?? termsOf(prev);
      const next = current.includes(term) ? current.filter(t => t !== term) : [...current, term];
      return { ...prev, selected_terms: next };
    });
  };

  // Custom terms are any month count outside the standard set (e.g. 18, 19) —
  // added terms are shown to the client by default.
  const addCustomTerm = (months: number) => {
    if (!Number.isInteger(months) || months < MIN_TERM_MONTHS || months > MAX_TERM_MONTHS) {
      toast(`Enter a term between ${MIN_TERM_MONTHS} and ${MAX_TERM_MONTHS} months`, 'error');
      return;
    }
    setInputs(prev => {
      if (termsOf(prev).includes(months)) {
        toast(`${termLabel(months)} term is already on this quote`, 'error');
        return prev;
      }
      const selected = prev.selected_terms ?? termsOf(prev);
      return {
        ...prev,
        custom_term_months: sortTerms([...(prev.custom_term_months ?? []), months]),
        balloon_percentages: { ...prev.balloon_percentages, [String(months)]: 0 },
        selected_terms: [...selected, months],
      };
    });
  };

  const removeCustomTerm = (months: number) => {
    setInputs(prev => {
      const percentages = { ...prev.balloon_percentages };
      const amounts = { ...(prev.balloon_amounts ?? {}) };
      delete percentages[String(months)];
      delete amounts[String(months)];
      return {
        ...prev,
        custom_term_months: (prev.custom_term_months ?? []).filter(m => m !== months),
        balloon_percentages: percentages,
        balloon_amounts: amounts,
        selected_terms: (prev.selected_terms ?? termsOf(prev)).filter(t => t !== months),
        preferred_term: prev.preferred_term === months ? undefined : prev.preferred_term,
      };
    });
  };

  // Derived values
  const terms = useMemo(() => termsOf(inputs), [inputs]);
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
    <Card>
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
                <MoneyInput
                  placeholder={fmtCurrency(inputs.asset_price * (inputs.deposit_percent / 100)).replace('$', '')}
                  value={inputs.deposit_amount ?? ''}
                  allowNull
                  onChange={amt =>
                    setInputs(prev => ({ ...prev, deposit_amount: amt, deposit_percent: amt != null && prev.asset_price > 0 ? fmt2((amt / prev.asset_price) * 100) : prev.deposit_percent }))
                  }
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
                    onChange={e => {
                      const pct = Math.max(0, parseFloat(e.target.value)) || 0;
                      setInputs(prev => {
                        const base = computeFromInputs(prev).amountBorrowed;
                        return { ...prev, brokerage_percent: pct, brokerage_amount: base > 0 ? fmt2(base * (pct / 100)) : null };
                      });
                    }}
                    className={`${fieldBase} pl-7 pr-3`}
                  />
                </div>
              </div>
              <div>
                <label className={`${labelBase} flex gap-1`}>
                  Brokerage $
                  <span className="text-[9px] font-semibold text-muted-foreground/50">OVERRIDE</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[13px]">$</span>
                  <MoneyInput
                    placeholder={fmtCurrency(derived.amountBorrowed * (inputs.brokerage_percent / 100)).replace('$', '')}
                    value={inputs.brokerage_amount ?? ''}
                    allowNull
                    onChange={amt =>
                      setInputs(prev => {
                        const base = computeFromInputs(prev).amountBorrowed;
                        return { ...prev, brokerage_amount: amt, brokerage_percent: amt != null && base > 0 ? fmt2((amt / base) * 100) : prev.brokerage_percent };
                      })
                    }
                    className={`${fieldBase} pl-6 pr-3`}
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
              <CalcField label="Brokerage (incl. GST)" value={fmtCurrency(derived.brokerage)} />
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
              <div className="flex items-center justify-between mb-1">
                <label className={labelBase}>Balloon % / $ per Term</label>
                <button
                  type="button"
                  onClick={applyStandardResiduals}
                  className="text-[10px] font-semibold text-primary hover:text-primary/80 transition-colors"
                >
                  Auto-fill standard
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mt-1">
                {terms.map(t => {
                  const pct = inputs.balloon_percentages[String(t)] ?? 0;
                  const computedAmt = fmt2(derived.balloonBase * (pct / 100));
                  return (
                    <div key={t} className="space-y-1">
                      <div className="text-center text-[10px] text-muted-foreground font-semibold mb-1">{termLabelShort(t)}</div>
                      <div className="relative">
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          value={pct}
                          onChange={e => updateBalloonPct(String(t), Math.max(0, parseFloat(e.target.value)) || 0)}
                          className={`${fieldBase} px-2 pr-5 text-center`}
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-[11px]">%</span>
                      </div>
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-[10px]">$</span>
                        <MoneyInput
                          placeholder={computedAmt > 0 ? formatMoney(Math.round(computedAmt)) : ''}
                          value={inputs.balloon_amounts?.[String(t)] ?? ''}
                          allowNull
                          onChange={amt => updateBalloonAmount(String(t), amt)}
                          className={`${fieldBase} pl-5 pr-1 text-center text-[11px]`}
                        />
                      </div>
                    </div>
                  );
                })}
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
                {terms.map(t => {
                  const isSelected = (inputs.selected_terms ?? terms).includes(t);
                  const isCustom = !STANDARD_TERM_MONTHS.includes(t);
                  return (
                    <span
                      key={t}
                      className={`inline-flex items-center h-8 rounded-lg text-[12px] font-semibold transition-colors border ${isSelected
                        ? 'bg-primary/10 text-primary border-primary/20'
                        : 'bg-muted text-muted-foreground border-border/40 opacity-50'
                      }`}
                    >
                      <button type="button" onClick={() => toggleTerm(t)} className="h-full px-4">
                        {termLabel(t)}
                      </button>
                      {isCustom && (
                        <button
                          type="button"
                          onClick={() => removeCustomTerm(t)}
                          title={`Remove the ${termLabel(t).toLowerCase()} term`}
                          className="h-full pr-2.5 -ml-2 text-[14px] leading-none opacity-60 hover:opacity-100"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">Only selected terms appear in the client PDF.</p>

              {/* Custom term — any month count, e.g. 18 or 19 months */}
              <label className={`${labelBase} mt-4 mb-1.5`}>Add custom term</label>
              <div className="flex items-center gap-2">
                <div className="relative w-32">
                  <input
                    type="number"
                    min={MIN_TERM_MONTHS}
                    max={MAX_TERM_MONTHS}
                    step="1"
                    placeholder="e.g. 18"
                    value={customTermInput}
                    onChange={e => setCustomTermInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addCustomTerm(Number(customTermInput));
                        setCustomTermInput('');
                      }
                    }}
                    className={`${fieldBase} pl-3 pr-14`}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[11px] pointer-events-none">months</span>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => { addCustomTerm(Number(customTermInput)); setCustomTermInput(''); }}
                  disabled={customTermInput.trim() === ''}
                >
                  Add term
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">
                Quotes any term in whole months — repayments, balloon and interest are calculated on the exact month count.
              </p>
            </div>
            <div className="space-y-3">
              <div>
                <label className={`${labelBase} mb-1.5`}>Repayment display range (±$)</label>
                <div className="flex items-center gap-3">
                  <div className="relative w-36">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[12px] select-none">±$</span>
                    <MoneyInput
                      placeholder="e.g. 50"
                      value={inputs.repayment_range ?? ''}
                      allowNull
                      onChange={v => updateInput('repayment_range', v ?? undefined)}
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
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => updateInput('show_total_interest', !(inputs.show_total_interest ?? true))}
                  className={`h-8 px-3 rounded-lg text-[12px] font-semibold transition-colors border whitespace-nowrap ${(inputs.show_total_interest ?? true)
                    ? 'bg-primary/10 text-primary border-primary/20'
                    : 'bg-muted text-muted-foreground border-border/40'
                  }`}
                >
                  {(inputs.show_total_interest ?? true) ? 'Total interest: visible' : 'Total interest: hidden'}
                </button>
                <span className="text-[10px] text-muted-foreground">Controls total interest visibility on client quote.</span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => updateInput('show_weekly', !(inputs.show_weekly ?? true))}
                  className={`h-8 px-3 rounded-lg text-[12px] font-semibold transition-colors border whitespace-nowrap ${(inputs.show_weekly ?? true)
                    ? 'bg-primary/10 text-primary border-primary/20'
                    : 'bg-muted text-muted-foreground border-border/40'
                  }`}
                >
                  {(inputs.show_weekly ?? true) ? 'Weekly payment: visible' : 'Weekly payment: hidden'}
                </button>
                <span className="text-[10px] text-muted-foreground">Controls weekly repayment visibility on the quote sheet.</span>
              </div>
            </div>
          </div>

          {/* ── Preferred option ──────────────────────────────── */}
          <div className="mt-6 pt-5 border-t border-border/60">
            <div className="flex items-center gap-3 mb-3">
              <button
                type="button"
                onClick={() => updateInput('show_preferred_option', !inputs.show_preferred_option)}
                className={`h-8 px-3 rounded-lg text-[12px] font-semibold transition-colors border whitespace-nowrap ${inputs.show_preferred_option
                  ? 'bg-primary/10 text-primary border-primary/20'
                  : 'bg-muted text-muted-foreground border-border/40'
                }`}
              >
                {inputs.show_preferred_option ? 'Preferred option: shown' : 'Preferred option: hidden'}
              </button>
              <span className="text-[10px] text-muted-foreground">Adds a highlighted “Recommended for you” callout to the client quote.</span>
            </div>
            {inputs.show_preferred_option && (
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className={`${labelBase} mb-1.5`}>Preferred term</label>
                  <select
                    value={inputs.preferred_term ?? (inputs.selected_terms ?? terms)[0]}
                    onChange={e => updateInput('preferred_term', Number(e.target.value))}
                    className={`${fieldBase} px-3`}
                  >
                    {terms.filter(t => (inputs.selected_terms ?? terms).includes(t)).map(t => (
                      <option key={t} value={t}>{termLabel(t)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={`${labelBase} mb-1.5`}>Balloon</label>
                  <div className="flex gap-2">
                    {([['No Balloon', false], ['With Balloon', true]] as [string, boolean][]).map(([lbl, val]) => (
                      <button
                        key={String(val)}
                        type="button"
                        onClick={() => updateInput('preferred_balloon', val)}
                        className={`h-8 px-4 rounded-lg text-[12px] font-semibold transition-colors border ${(inputs.preferred_balloon ?? false) === val
                          ? 'bg-primary/10 text-primary border-primary/20'
                          : 'bg-muted text-muted-foreground border-border/40'
                        }`}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
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
                      <td className="py-2 px-3 font-semibold tabular-nums">{termLabelShort(s.termMonths)}</td>
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
    </Card>
  );
}
