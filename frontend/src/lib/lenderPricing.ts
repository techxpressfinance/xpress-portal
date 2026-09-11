// Lender Pricing — the deal as the lender approved it: one manually entered
// term, the direct-debit cycle the lender set, and an amount borrowed that
// carries the trade-in and the payout owing on it. Stored as a QuoteSheet with
// sheet_type 'lender_pricing'. The maths mirrors the client quote sheet
// (QuoteSheetEditor) so both agree on the same inputs.
import type { DirectDebitCycle, FacilityType, LenderPricingInputs, QuoteOption, QuoteSheet } from '../types';

export const MIN_TERM_MONTHS = 2; // the arrears formula needs at least two periods
export const MAX_TERM_MONTHS = 120;

export const DIRECT_DEBIT_CYCLE_LABELS: Record<DirectDebitCycle, string> = {
  monthly: 'Monthly',
  fortnightly: 'Fortnightly',
  weekly: 'Weekly',
};

export const FACILITY_LABELS: Record<FacilityType, string> = {
  chattel: 'Chattel Mortgage',
  hp: 'Hire Purchase',
  lease: 'Lease',
};

export const LENDER_PRICING_DEFAULTS: LenderPricingInputs = {
  facility_type: 'chattel',
  payment_type: 'advance',
  asset_description: 'Motor Vehicle',
  asset_price: 0,
  deposit_percent: 0,
  deposit_amount: null,
  trade_in_amount: 0,
  payout_amount: 0,
  establishment_fee: 0,
  ppsr_fee: 0,
  origination_fee: 0,
  monthly_account_fee: 0,
  fees_financed: true,
  non_taxable_charges: 0,
  luxury_car_tax: 0,
  interest_rate: 0,
  brokerage_amount: 0,
  gst_on_brokerage: false,
  gst_percent: 10,
  term_months: null,
  balloon_on_total_price: true,
  balloon_percent: 0,
  balloon_amount: null,
  direct_debit_cycle: 'monthly',
  lender_accepts_shortfall: null,
  lender_acceptance_notes: '',
};

export const fmt2 = (n: number) => Math.round(n * 100) / 100;
export const fmtCurrency = (n: number) =>
  `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Excel-compatible PMT (type 0 = arrears, type 1 = advance).
function pmt(rate: number, nper: number, pv: number, fv = 0, type: 0 | 1 = 0): number {
  if (rate === 0) return -(pv + fv) / nper;
  const pvif = Math.pow(1 + rate, nper);
  let payment = -(rate * (pv * pvif + fv)) / (pvif - 1);
  if (type === 1) payment /= (1 + rate);
  return payment;
}

// Excel-compatible RATE via Newton-Raphson.
function rateNR(nper: number, payment: number, pv: number, fv = 0, type: 0 | 1 = 0, guess = 0.01): number {
  let r = guess;
  for (let i = 0; i < 300; i++) {
    const f = Math.pow(1 + r, nper);
    const df = nper * Math.pow(1 + r, nper - 1);
    const yr = type === 0
      ? pv * f + payment * (f - 1) / r + fv
      : pv * f + payment * (1 + r) * (f - 1) / r + fv;
    const yrD = type === 0
      ? pv * df + payment * (r * df - (f - 1)) / (r * r)
      : pv * df + payment * ((1 + r) * (r * df - (f - 1)) / (r * r) + (f - 1) / r);
    const rNew = r - yr / yrD;
    if (Math.abs(rNew - r) < 1e-10) return rNew;
    r = rNew;
  }
  return r;
}

// ITC benefit — lease only (quote sheet formula page B1-B3).
function itcBenefit(inputs: LenderPricingInputs): number {
  if (inputs.facility_type !== 'lease') return 0;
  const desc = inputs.asset_description.toLowerCase();
  const LCT_CAP = 5182.64; // ATO luxury car limit
  const net = inputs.asset_price - inputs.non_taxable_charges - inputs.luxury_car_tax;
  if (desc.includes('car')) return Math.min(net / 11, LCT_CAP);
  if (desc.includes('vehicle')) return net / 11;
  return inputs.asset_price / 11;
}

// Stamp duty on rentals (quote sheet formula page B22).
function stampDutyRate(inputs: LenderPricingInputs): number {
  if (inputs.facility_type === 'chattel') return 0;
  if (inputs.facility_type === 'hp') return 0.0075 * 1.1;
  return 0.0075;
}

export function computeLenderPricing(inputs: LenderPricingInputs) {
  const deposit = inputs.deposit_amount ?? inputs.asset_price * (inputs.deposit_percent / 100);
  // Amount borrowed = asset price − deposit − trade-in + payout figure. Any
  // payout still owing on the trade-in is rolled into the new loan.
  const amountBorrowed = inputs.asset_price - deposit - inputs.trade_in_amount + inputs.payout_amount;
  const totalFees = inputs.establishment_fee + inputs.ppsr_fee + inputs.origination_fee;
  const netAmount = inputs.fees_financed ? amountBorrowed + totalFees : amountBorrowed;
  const brokerage = inputs.gst_on_brokerage
    ? inputs.brokerage_amount * (1 + inputs.gst_percent / 100)
    : inputs.brokerage_amount;
  const itc = itcBenefit(inputs);
  const subTotal = netAmount - itc;
  const amountFinanced = subTotal + brokerage;
  const balloonBase = inputs.balloon_on_total_price ? inputs.asset_price : amountFinanced;
  // Negative equity: payout owing on the trade-in beyond what it is worth.
  const negativeEquity = Math.max(0, inputs.payout_amount - inputs.trade_in_amount);
  return { deposit, amountBorrowed, totalFees, brokerage, itcBenefit: itc, subTotal, amountFinanced, balloonBase, negativeEquity };
}

/** Lending-policy red alerts. Never block a save — the desk may still have good
 *  reason to write the deal, and records whether the lender accepted it. */
export function lenderPricingAlerts(inputs: LenderPricingInputs): string[] {
  const price = inputs.asset_price;
  if (price <= 0) return [];
  const { amountBorrowed, negativeEquity } = computeLenderPricing(inputs);
  const pct = (n: number) => `${fmt2((n / price) * 100)}%`;
  const alerts: string[] = [];
  if (negativeEquity > price * 0.1) {
    alerts.push(`Negative equity of ${fmtCurrency(negativeEquity)} is ${pct(negativeEquity)} of the asset price — more than 10%.`);
  }
  if (amountBorrowed > price * 1.1) {
    alerts.push(`Amount borrowed of ${fmtCurrency(amountBorrowed)} is ${pct(amountBorrowed)} of the asset price — more than 110%.`);
  }
  return alerts;
}

type Repayments = Pick<QuoteOption, 'repayment_monthly' | 'repayment_fortnightly' | 'repayment_weekly'>;

/** The repayment on the lender's direct-debit cycle. */
export function repaymentFor(cycle: DirectDebitCycle, r: Repayments): number | null {
  if (cycle === 'weekly') return r.repayment_weekly;
  if (cycle === 'fortnightly') return r.repayment_fortnightly;
  return r.repayment_monthly;
}

export interface LenderPricingStructure extends Repayments {
  hasBalloon: boolean;
  balloon: number;          // net balloon
  balloonTotal: number;     // net + GST (lease only)
  balloonPercent: number;
  netRental: number;
  stampDuty: number;
  gst: number;
  repayment_monthly: number;
  repayment_fortnightly: number;
  repayment_weekly: number;
  totalOverTerm: number;
  totalInterest: number;
  allUpRate: number | null; // annual, as a fraction (advance only)
}

/** The approved term priced with no balloon and, when one is set, with it. */
export function lenderPricingStructures(inputs: LenderPricingInputs): LenderPricingStructure[] {
  const months = inputs.term_months;
  if (months == null || months < MIN_TERM_MONTHS || months > MAX_TERM_MONTHS || inputs.asset_price <= 0) return [];

  const { amountFinanced, amountBorrowed, balloonBase, subTotal } = computeLenderPricing(inputs);
  const monthlyRate = inputs.interest_rate / 100 / 12;
  const isAdvance = inputs.payment_type === 'advance';
  const isLease = inputs.facility_type === 'lease';
  const sdRate = stampDutyRate(inputs);
  const balloonNet = inputs.balloon_amount ?? fmt2(balloonBase * (inputs.balloon_percent / 100));
  const balloonGst = isLease ? fmt2(balloonNet * (inputs.gst_percent / 100)) : 0;

  const build = (useBalloon: boolean): LenderPricingStructure => {
    const balloon = useBalloon ? balloonNet : 0;
    // PMT — quote sheet formula page B36 (advance) / B37 (arrears)
    const netRental = fmt2(isAdvance
      ? -pmt(monthlyRate, months, amountFinanced, -balloon, 1)
      : -pmt(monthlyRate, months - 1, amountFinanced * (1 + monthlyRate), -balloon, 1));
    // All-up rate — quote sheet formula page B46 (advance only)
    const allUpRate = isAdvance && subTotal > 0 ? rateNR(months, netRental, -subTotal, balloon, 1) * 12 : null;
    const stampDuty = inputs.facility_type === 'chattel' ? 0 : fmt2(netRental * sdRate);
    const rentalSubTotal = netRental + stampDuty;
    const gst = isLease ? fmt2(rentalSubTotal * (inputs.gst_percent / 100)) : 0;
    const totalRental = fmt2(rentalSubTotal + gst);
    const monthly = fmt2(totalRental + inputs.monthly_account_fee);
    const totalOverTerm = fmt2(monthly * months + balloon);
    return {
      hasBalloon: useBalloon,
      balloon,
      balloonTotal: useBalloon ? fmt2(balloonNet + balloonGst) : 0,
      balloonPercent: useBalloon ? inputs.balloon_percent : 0,
      netRental,
      stampDuty,
      gst,
      repayment_monthly: monthly,
      repayment_fortnightly: fmt2(monthly * 12 / 26),
      repayment_weekly: fmt2(monthly * 12 / 52),
      totalOverTerm,
      totalInterest: fmt2(totalOverTerm - amountBorrowed),
      allUpRate,
    };
  };

  return balloonNet > 0 ? [build(false), build(true)] : [build(false)];
}

/** QuoteOption payloads for the API — one per structure. */
export function lenderPricingOptions(inputs: LenderPricingInputs, structures: LenderPricingStructure[]) {
  const d = computeLenderPricing(inputs);
  const months = inputs.term_months ?? 0;
  return structures.map((s, i) => ({
    lender_name: `${months} months${s.hasBalloon ? ` (${s.balloonPercent}% Balloon)` : ''}`,
    lender_product: inputs.facility_type.toUpperCase(),
    sort_order: i,
    is_recommended: false,
    purchase_price: inputs.asset_price,
    deposit: fmt2(d.deposit),
    loan_amount: fmt2(d.amountFinanced),
    loan_term_months: months,
    balloon_residual: s.balloonTotal,
    interest_rate: inputs.interest_rate,
    comparison_rate: null,
    client_interest_rate: s.allUpRate != null ? fmt2(s.allUpRate * 100) : null,
    establishment_fee: inputs.establishment_fee,
    monthly_account_fee: inputs.monthly_account_fee || null,
    application_fee: inputs.ppsr_fee + inputs.origination_fee,
    brokerage: fmt2(d.brokerage),
    repayment_monthly: s.repayment_monthly,
    repayment_fortnightly: s.repayment_fortnightly,
    repayment_weekly: s.repayment_weekly,
    total_repayments: s.totalOverTerm,
    total_interest: s.totalInterest,
    total_fees: fmt2(d.totalFees + d.brokerage),
    features: null,
    notes: null,
  }));
}

export function parseLenderPricingInputs(sheet?: QuoteSheet | null): LenderPricingInputs {
  let parsed: Partial<LenderPricingInputs> & { brokerage_percent?: number } = {};
  if (sheet?.input_parameters) {
    try { parsed = JSON.parse(sheet.input_parameters); } catch { /* keep defaults */ }
  }
  const { brokerage_percent: legacyBrokeragePercent, ...saved } = parsed;
  const inputs: LenderPricingInputs = {
    ...LENDER_PRICING_DEFAULTS,
    ...saved,
    // Lender pricing made before this editor existed carries no term — take it
    // from the saved options.
    term_months: saved.term_months ?? sheet?.options[0]?.loan_term_months ?? null,
    brokerage_amount: saved.brokerage_amount ?? 0,
    gst_percent: 10,
  };
  // Brokerage is entered in dollars only. Sheets saved while it could be a %
  // carry no dollar figure — convert the % once, off the amount borrowed.
  if (saved.brokerage_amount == null && legacyBrokeragePercent) {
    inputs.brokerage_amount = fmt2(computeLenderPricing(inputs).amountBorrowed * (legacyBrokeragePercent / 100));
  }
  return inputs;
}
