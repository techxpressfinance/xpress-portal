// Direct Debit First Payment Request — the letter, in the lender's name, that
// tells the lender what to take on the first debit after settlement.
//
// The figures come from the application's lender pricing: the repayment on the
// direct-debit cycle the lender set, and the lender's fees when they were not
// financed. Only the broker's choices are stored (on the application, as JSON):
// which pricing and structure, the settlement date, the fees the pricing does
// not carry, any structured repayments and who signs.
import type { DirectDebitCycle, LoanApplication, QuoteSheet } from '../types';
import { fmt2, parseLenderPricingInputs, repaymentFor } from './lenderPricing';

/** A structured payment: `amount` is added on top of the normal repayment, on
 *  that one payment only (payment 4 + 3,000 = the 4th debit is repayment + 3,000). */
export interface StructuredRow {
  payment: number | null;
  amount: number | null;
}

export interface DirectDebitSettings {
  /** The lender pricing it is drawn from; null = the latest. */
  pricing_sheet_id: string | null;
  /** Which structure was written; null = with the balloon when one is priced. */
  with_balloon: boolean | null;
  /** YYYY-MM-DD; null = the date the application settled. */
  settlement_date: string | null;
  vsr_fee: number | null;
  private_sale_fee: number | null;
  asic_fee: number | null;
  stamp_duty: number | null;
  structured: StructuredRow[];
  signatory_name: string | null;
}

export const DIRECT_DEBIT_DEFAULTS: DirectDebitSettings = {
  pricing_sheet_id: null,
  with_balloon: null,
  settlement_date: null,
  vsr_fee: null,
  private_sale_fee: null,
  asic_fee: null,
  stamp_duty: null,
  structured: [],
  signatory_name: null,
};

export function parseDirectDebitSettings(application: Pick<LoanApplication, 'direct_debit_request'>): DirectDebitSettings {
  if (!application.direct_debit_request) return { ...DIRECT_DEBIT_DEFAULTS };
  try {
    const saved = JSON.parse(application.direct_debit_request) as Partial<DirectDebitSettings>;
    // Rows saved as runs ({count, amount}) from before extras were one payment
    // each have no `payment` and mean something else now, so they are dropped.
    const structured = Array.isArray(saved.structured) ? saved.structured.filter((r) => r && 'payment' in r) : [];
    return { ...DIRECT_DEBIT_DEFAULTS, ...saved, structured };
  } catch {
    return { ...DIRECT_DEBIT_DEFAULTS };
  }
}

/** "one month" / "one fortnight" / "one week" — the gap to the first debit in arrears. */
export const CYCLE_PERIOD: Record<DirectDebitCycle, string> = {
  monthly: 'one month',
  fortnightly: 'one fortnight',
  weekly: 'one week',
};

const CYCLE_UNIT: Record<DirectDebitCycle, string> = {
  monthly: 'month',
  fortnightly: 'fortnight',
  weekly: 'week',
};

/** One cycle on from a YYYY-MM-DD date. A month on from the 31st lands on the
 *  last day of a shorter month rather than spilling into the next. */
export function addCycle(isoDate: string, cycle: DirectDebitCycle): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (cycle === 'monthly') {
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(d, lastDay))).toISOString().slice(0, 10);
  }
  const date = new Date(Date.UTC(y, m - 1, d + (cycle === 'weekly' ? 7 : 14)));
  return date.toISOString().slice(0, 10);
}

export function longDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export interface DebitRow {
  label: string;
  /** Smaller text after the label, as the lender's form has it. */
  note?: string;
  amount: number | null;
}

export interface DirectDebitStatement {
  sheet: QuoteSheet;
  lenderId: string | null;
  lenderName: string;
  cycle: DirectDebitCycle;
  advance: boolean;
  hasBalloonOption: boolean;
  withBalloon: boolean;
  /** The first debit: the repayment on the debit cycle, plus any extra on payment 1. */
  repayment: number | null;
  /** The even repayment from the chosen pricing structure. */
  normalRepayment: number | null;
  feesFinanced: boolean;
  /** All fees financed in the loan — nothing but the repayment is debited. */
  allFeesFinanced: boolean;
  lenderFees: number;
  rows: DebitRow[];
  total: number;
  settlementDate: string | null;
  firstDebitDate: string | null;
  /** The sentence under the table: when the first debit comes out. */
  timing: string;
  /** Payments that carry an extra, in order: what is debited and the extra in it. */
  structured: { payment: number; extra: number; amount: number }[];
  cycleUnit: string;
}

/** The latest lender pricing, or the one the settings name if it still exists. */
export function pickPricingSheet(sheets: QuoteSheet[], settings: DirectDebitSettings): QuoteSheet | null {
  const pricing = sheets.filter((s) => s.sheet_type === 'lender_pricing');
  if (pricing.length === 0) return null;
  const named = settings.pricing_sheet_id && pricing.find((s) => s.id === settings.pricing_sheet_id);
  if (named) return named;
  return [...pricing].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

export function buildDirectDebitStatement(
  sheet: QuoteSheet,
  settings: DirectDebitSettings,
  application: Pick<LoanApplication, 'settled_at'>,
): DirectDebitStatement {
  const inputs = parseLenderPricingInputs(sheet);
  const cycle = inputs.direct_debit_cycle;
  const options = [...sheet.options].sort((a, b) => a.sort_order - b.sort_order);
  const balloonOption = options.find((o) => (o.balloon_residual ?? 0) > 0);
  const plainOption = options.find((o) => !((o.balloon_residual ?? 0) > 0)) ?? options[0];
  const withBalloon = balloonOption != null && (settings.with_balloon ?? true);
  const option = withBalloon ? balloonOption : plainOption;
  const priced = option ? repaymentFor(cycle, option) : null;

  // A structured payment is an extra on top of the normal repayment, on that one
  // payment only — every other payment stays the even repayment. Two rows for the
  // same payment number add together.
  const extras = new Map<number, number>();
  for (const r of settings.structured) {
    if (r.payment == null || r.payment < 1 || r.amount == null || r.amount === 0) continue;
    const n = Math.floor(r.payment);
    extras.set(n, fmt2((extras.get(n) ?? 0) + r.amount));
  }
  const structured = [...extras.entries()]
    .sort(([a], [b]) => a - b)
    .map(([payment, extra]) => ({ payment, extra, amount: fmt2((priced ?? 0) + extra) }));
  // The first debit is payment 1, so an extra on it lands on the first line.
  const repayment = priced == null && !extras.has(1) ? priced : fmt2((priced ?? 0) + (extras.get(1) ?? 0));

  // The lender's fees ride in the loan when financed; otherwise the lender
  // takes them with the first debit.
  const lenderFees = fmt2(inputs.establishment_fee + inputs.ppsr_fee + inputs.origination_fee);
  const feesFinanced = inputs.fees_financed || lenderFees <= 0;

  const rows: DebitRow[] = [
    { label: '1st payment/rental', note: '(inclusive Govt charges)', amount: repayment },
    feesFinanced
      ? { label: 'Bank Fee - Financed', amount: null }
      : { label: 'Bank Fee', note: '(not financed)', amount: lenderFees },
    // VSR, private sale, ASIC and stamp duty follow the same rule as the lender's
    // fees: financed in the loan means nothing extra comes out, otherwise they
    // are taken once, with the first debit. A financed one that was entered is
    // still named ("- Financed") but carries no amount, so it stays out of the total.
    ...([
      { label: 'VSR fee', amount: settings.vsr_fee },
      { label: 'Private sale Fee', amount: settings.private_sale_fee },
      { label: 'ASIC fee', note: '(312)', amount: settings.asic_fee },
      { label: 'Stamp Duty', note: '(applicable some States)', amount: settings.stamp_duty },
    ] as DebitRow[]).map((r): DebitRow =>
      inputs.fees_financed && (r.amount ?? 0) > 0
        ? { label: `${r.label} - Financed`, amount: null }
        : r),
  ];
  const total = fmt2(rows.reduce((sum, r) => sum + (r.amount ?? 0), 0));

  const settlementDate = settings.settlement_date || application.settled_at?.slice(0, 10) || null;
  const advance = inputs.payment_type === 'advance';
  // In advance the first debit is taken on settlement day; in arrears it falls
  // one month after settlement, whatever the debit cycle.
  const firstDebitDate = settlementDate ? (advance ? settlementDate : addCycle(settlementDate, 'monthly')) : null;
  const timing = advance
    ? settlementDate
      ? `The first direct debit will be on the day of settlement of the loan, ${longDate(settlementDate)}.`
      : 'The first direct debit will be on the day of settlement of the loan.'
    : settlementDate && firstDebitDate
      ? `The first direct debit will be one month after the settlement of the loan, on ${longDate(firstDebitDate)}.`
      : 'The first direct debit will be one month after the settlement of the loan.';

  return {
    sheet,
    lenderId: sheet.lender_id,
    lenderName: inputs.lender_name.trim() || sheet.lender_name || '',
    cycle,
    advance,
    hasBalloonOption: balloonOption != null,
    withBalloon,
    repayment,
    normalRepayment: priced,
    feesFinanced,
    allFeesFinanced: inputs.fees_financed,
    lenderFees,
    rows,
    total,
    settlementDate,
    firstDebitDate,
    timing,
    structured,
    cycleUnit: CYCLE_UNIT[cycle],
  };
}
