import type {
  LedgerCategory,
  LedgerDealRow,
  LedgerReport,
  LedgerReportMonth,
  LedgerShareBase,
  LedgerShareStatus,
  LedgerTotals,
} from '../types';

export const formatLedgerMoney = (n: number | null | undefined): string =>
  n == null
    ? '—'
    : n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatMonth = (month: string): string => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
};

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export type RangePreset =
  | 'this_half' | 'last_half' | 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter'
  | '3m' | '6m' | '12m' | 'this_fy' | 'last_fy' | 'all' | 'custom';

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'this_half', label: 'This fortnight (1st–15th / 16th–end)' },
  { value: 'last_half', label: 'Last fortnight' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'this_quarter', label: 'This quarter (FY)' },
  { value: 'last_quarter', label: 'Last quarter (FY)' },
  { value: '3m', label: 'Last 3 months' },
  { value: '6m', label: 'Last 6 months' },
  { value: '12m', label: 'Last 12 months' },
  { value: 'this_fy', label: 'This financial year' },
  { value: 'last_fy', label: 'Last financial year' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
];

/** A preset as a from/to pair. "Last N months" includes the current month,
 *  so 3 months in mid-October is 1 August – today. Financial years run
 *  1 July – 30 June. */
export function presetRange(preset: RangePreset, today = new Date()): { from: string; to: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  const monthsBack = (n: number) => ({ from: iso(new Date(y, m - (n - 1), 1)), to: iso(today) });
  const fyStart = m >= 6 ? y : y - 1;
  // FY quarters start in Jul, Oct, Jan and Apr.
  const qStart = m - (((m - 6) % 3) + 3) % 3;
  const d = today.getDate();
  switch (preset) {
    // Work is reviewed by half-month: the 1st–15th, then the 16th to month end.
    case 'this_half': return d <= 15
      ? { from: iso(new Date(y, m, 1)), to: iso(today) }
      : { from: iso(new Date(y, m, 16)), to: iso(today) };
    case 'last_half': return d <= 15
      ? { from: iso(new Date(y, m - 1, 16)), to: iso(new Date(y, m, 0)) }
      : { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m, 15)) };
    case 'this_quarter': return { from: iso(new Date(y, qStart, 1)), to: iso(today) };
    case 'last_quarter': return { from: iso(new Date(y, qStart - 3, 1)), to: iso(new Date(y, qStart, 0)) };
    case 'this_month': return monthsBack(1);
    case 'last_month': return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case '3m': return monthsBack(3);
    case '6m': return monthsBack(6);
    case '12m': return monthsBack(12);
    case 'this_fy': return { from: iso(new Date(fyStart, 6, 1)), to: iso(today) };
    case 'last_fy': return { from: iso(new Date(fyStart - 1, 6, 1)), to: iso(new Date(fyStart, 5, 30)) };
    default: return { from: '', to: '' };
  }
}

/** The desk spreadsheet's colour coding, as a tint on the customer cell. */
export const CATEGORY_STYLE: Record<LedgerCategory, { label: string; className: string; print: string }> = {
  asset_finance: { label: 'Asset finance', className: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100', print: '#C6EFCE' },
  consumer: { label: 'Consumer', className: 'bg-pink-100 text-pink-900 dark:bg-pink-900/40 dark:text-pink-100', print: '#F8CBDE' },
  home_loan: { label: 'Home loan', className: 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100', print: '#BDD7EE' },
  commercial: { label: 'Commercial', className: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100', print: '#FFF2CC' },
};

export const SHARE_BASE_LABEL: Record<LedgerShareBase, string> = {
  brokerage: 'of brokerage',
  total_income: 'of total income',
  finance_amount: 'of finance amount',
};

export const PAYMENT_METHODS = ['Bank transfer', 'Card', 'Cash', 'Cheque', 'Other'];

export const SHARE_STATUS_LABEL: Record<LedgerShareStatus, string> = {
  unpaid: 'Unpaid',
  scheduled: 'Scheduled',
  paid: 'Paid',
  not_payable: 'Not payable',
};

/** The payee key an invoice belongs to: the portal referrer, or the off-portal payee. */
export const invoicePayeeKey = (inv: { referrer_id: string; payee_id: string | null }) =>
  inv.payee_id && inv.payee_id === inv.referrer_id ? `p:${inv.payee_id}` : `u:${inv.referrer_id}`;

/** Columns shown on screen and in downloads until the viewer picks their own. */
export const DEFAULT_LEDGER_COLUMNS = [
  'settled_on', 'customer_name', 'entity_name', 'finance_amount', 'brokerage', 'doc_fee', 'origination_fee',
  'vir', 'income_ex_gst', 'lender_name', 'referrer_comms_ex_gst', 'referrer_comms_inc_gst', 'referrer_name',
  'paid_on', 'net_profit', 'volume_bonus', 'vb_received_ex_gst', 'final_profit',
];

/** Month-level columns: blank on a deal and on a half's total, filled on the
 *  month, quarter and year totals. Mirrors PERIOD_ONLY in services/ledger.py. */
export const PERIOD_ONLY_COLUMNS = new Set(['vb_received_ex_gst', 'vb_received_inc_gst', 'final_profit']);

export type TotalLevel = 'half' | 'month' | 'quarter' | 'year';

export type ReportItem =
  | { type: 'month'; key: string; month: LedgerReportMonth }
  | { type: 'half'; key: string; label: string }
  | { type: 'row'; key: string; row: LedgerDealRow }
  | { type: 'total'; key: string; label: string; totals: LedgerTotals | undefined; level: TotalLevel };

/** The report flattened into table rows in the spreadsheet's order: month
 *  heading, each half (heading, deals, total), the month total, then the FY
 *  quarter total after a quarter's last month, a year total when the range
 *  spans more than one financial year, and the grand total last. */
export function reportItems(rows: LedgerDealRow[], report: LedgerReport): ReportItem[] {
  const byId = new Map(rows.map((r) => [r.application_id, r]));
  const quarterEnd = new Map(report.quarters.map((q) => [q.last_month, q]));
  const yearEnd = report.years.length > 1 ? new Map(report.years.map((y) => [y.last_month, y])) : new Map();
  const items: ReportItem[] = [];
  for (const m of report.months) {
    items.push({ type: 'month', key: `m-${m.month}`, month: m });
    for (const h of m.halves) {
      const deals = h.application_ids.map((id) => byId.get(id)).filter((r): r is LedgerDealRow => Boolean(r));
      if (!deals.length) continue;
      items.push({ type: 'half', key: `h-${m.month}-${h.half}`, label: h.label });
      for (const row of deals) items.push({ type: 'row', key: row.application_id, row });
      items.push({ type: 'total', key: `ht-${m.month}-${h.half}`, label: `Total ${h.label}`, totals: h.totals, level: 'half' });
    }
    items.push({ type: 'total', key: `mt-${m.month}`, label: `TOTAL ${formatMonth(m.month)}`, totals: m.totals, level: 'month' });
    const q = quarterEnd.get(m.month);
    if (q) items.push({ type: 'total', key: `qt-${q.fy}-${q.quarter}`, label: `TOTAL ${q.label}`, totals: q.totals, level: 'quarter' });
    const y = yearEnd.get(m.month);
    if (y) items.push({ type: 'total', key: `yt-${y.fy}`, label: `TOTAL ${y.label}`, totals: y.totals, level: 'year' });
  }
  if (report.totals) {
    const n = report.totals.count;
    items.push({ type: 'total', key: 'grand', label: `TOTAL · ${n} deal${n === 1 ? '' : 's'}`, totals: report.totals, level: 'year' });
  }
  return items;
}

const COLUMN_PREF_KEY = 'ledger.columns';

export function loadColumnPref(): string[] | null {
  try {
    const raw = localStorage.getItem(COLUMN_PREF_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : null;
  } catch {
    return null;
  }
}

export function saveColumnPref(keys: string[]): void {
  try {
    localStorage.setItem(COLUMN_PREF_KEY, JSON.stringify(keys));
  } catch {
    // Private window or blocked storage — the choice just won't stick.
  }
}
