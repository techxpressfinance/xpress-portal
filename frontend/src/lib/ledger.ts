import { formatDate } from './utils';
import type {
  LedgerCategory,
  LedgerColumn,
  LedgerDealRow,
  LedgerExtraPayment,
  LedgerPaymentCategory,
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
  | 'this_half_year' | 'last_half_year'
  | '3m' | '6m' | '12m' | 'this_fy' | 'last_fy' | 'all' | 'custom';

export const RANGE_PRESETS: { value: RangePreset; label: string; group: string }[] = [
  { value: 'this_half', label: 'This fortnight (1st–15th / 16th–end)', group: 'Fortnightly' },
  { value: 'last_half', label: 'Last fortnight', group: 'Fortnightly' },
  { value: 'this_month', label: 'This month', group: 'Monthly' },
  { value: 'last_month', label: 'Last month', group: 'Monthly' },
  { value: 'this_quarter', label: 'This quarter (FY)', group: 'Quarterly' },
  { value: 'last_quarter', label: 'Last quarter (FY)', group: 'Quarterly' },
  { value: 'this_half_year', label: 'This half-year (Jul–Dec / Jan–Jun)', group: 'Half-yearly' },
  { value: 'last_half_year', label: 'Last half-year', group: 'Half-yearly' },
  { value: 'this_fy', label: 'This financial year', group: 'Yearly' },
  { value: 'last_fy', label: 'Last financial year', group: 'Yearly' },
  { value: '3m', label: 'Last 3 months', group: 'Other' },
  { value: '6m', label: 'Last 6 months', group: 'Other' },
  { value: '12m', label: 'Last 12 months', group: 'Other' },
  { value: 'all', label: 'All time', group: 'Other' },
  { value: 'custom', label: 'Custom range', group: 'Other' },
];

/** The report a preset produces, for download names ("Quarterly report …"). */
export const presetReportName = (p: RangePreset): string => {
  const group = RANGE_PRESETS.find((x) => x.value === p)?.group;
  return group && group !== 'Other' ? `${group} report` : 'Report';
};

/** A preset as a from/to pair. "Last N months" includes the current month,
 *  so 3 months in mid-October is 1 August – today. Financial years run
 *  1 July – 30 June. */
export function presetRange(preset: RangePreset, today = new Date()): { from: string; to: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  const monthsBack = (n: number) => ({ from: iso(new Date(y, m - (n - 1), 1)), to: iso(today) });
  const fyStart = m >= 6 ? y : y - 1;
  // FY quarters start in Jul, Oct, Jan and Apr; FY halves in Jul and Jan.
  const qStart = m - (((m - 6) % 3) + 3) % 3;
  const hStart = m >= 6 ? 6 : 0;
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
    case 'this_half_year': return { from: iso(new Date(y, hStart, 1)), to: iso(today) };
    case 'last_half_year': return { from: iso(new Date(y, hStart - 6, 1)), to: iso(new Date(y, hStart, 0)) };
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
export const CATEGORY_STYLE: Record<LedgerCategory, { label: string; className: string; dot: string; print: string }> = {
  asset_finance: { label: 'Asset finance', className: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100', dot: 'bg-emerald-500', print: '#C6EFCE' },
  consumer: { label: 'Consumer', className: 'bg-pink-100 text-pink-900 dark:bg-pink-900/40 dark:text-pink-100', dot: 'bg-pink-500', print: '#F8CBDE' },
  home_loan: { label: 'Home loan', className: 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100', dot: 'bg-sky-500', print: '#BDD7EE' },
  commercial: { label: 'Commercial', className: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100', dot: 'bg-amber-500', print: '#FFF2CC' },
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

/** Columns shown on screen and in downloads until the viewer picks their own —
 *  the desk's sheet. GST columns follow the GST view, not this list. */
export const DEFAULT_LEDGER_COLUMNS = [
  'settled_on', 'new_lead', 'repeat_customer', 'customer_name', 'entity_name', 'finance_amount', 'brokerage',
  'doc_fee', 'origination_fee', 'vir', 'income_ex_gst', 'lender_name', 'deal_status', 'referrer_comms_ex_gst',
  'referrer_name', 'staff_comms_ex_gst', 'staff_name', 'payment_method', 'payment_notes', 'volume_bonus',
  'net_profit', 'extra_payments_ex_gst', 'vb_received_ex_gst', 'final_profit',
];

/** How GST figures are shown: ex GST only, inc GST only, or all three
 *  (ex GST, the GST, inc GST) beside each other — the accountant's view. */
export type GstView = 'ex' | 'inc' | 'all';

export const GST_VIEW_LABEL: Record<GstView, string> = {
  ex: 'Ex GST only',
  inc: 'Inc GST only',
  all: 'Ex GST + GST + inc GST',
};

/** The columns the picker offers: everything except the GST and inc-GST twins
 *  of a figure, which the GST view adds. */
export const pickableColumns = (all: LedgerColumn[]) => all.filter((c) => !c.gst_part || c.gst_part === 'ex');

/** A figure's label without its "(ex GST)" — the picker names the figure, the
 *  GST view decides which version of it shows. */
export const figureLabel = (c: LedgerColumn) =>
  c.gst_part ? c.label.replace(/\s*\(?ex\.? GST\)?/i, '').replace(/\s+ex GST$/i, '').trim() : c.label;

/** The columns to draw: the picked ones, each GST figure as the view says. */
export function applyGstView(all: LedgerColumn[], selected: string[], view: GstView): LedgerColumn[] {
  const chosen = new Set(selected);
  const groups = new Map<string, LedgerColumn[]>();
  for (const c of all) if (c.gst_group) groups.set(c.gst_group, [...(groups.get(c.gst_group) ?? []), c]);
  const wantedGroups = new Set(all.filter((c) => c.gst_group && chosen.has(c.key)).map((c) => c.gst_group));
  const want = view === 'all' ? ['ex', 'gst', 'inc'] : [view];
  const out: LedgerColumn[] = [];
  const done = new Set<string>();
  for (const c of all) {
    if (!c.gst_group) {
      if (chosen.has(c.key)) out.push(c);
      continue;
    }
    if (!wantedGroups.has(c.gst_group) || done.has(c.gst_group)) continue;
    done.add(c.gst_group);
    const trio = groups.get(c.gst_group) ?? [];
    const picks = trio.filter((t) => want.includes(t.gst_part ?? 'ex'));
    out.push(...(picks.length ? picks : trio.filter((t) => t.gst_part === 'ex')));
  }
  return out;
}

/** Short on-screen headings. The server's labels spell out GST on every
 *  money column, which made the headings wrap to four lines; on screen the GST
 *  view is stated once above the table, so a figure needs only its name (with
 *  ex / GST / inc added when all three show side by side). Downloads keep the
 *  full labels. */
const SHORT_LABEL: Record<string, string> = {
  repeat_customer: 'Repeat', customer_name: 'Customer', entity_name: 'Entity', deal_status: 'Status',
  payment_method: 'Paid by', payment_status_label: 'Payment', payment_reference: 'Reference',
  payment_notes: 'Payment notes', volume_bonus: 'Est. volume bonus', final_profit: 'Final profit',
};
const SHORT_GROUP: Record<string, string> = {
  brokerage: 'Brokerage', doc_fee: 'Doc fee', origination: 'Origination', vir: 'VIR', income: 'Total income',
  referrer_comms: 'Referrer comms', staff_comms: 'Staff comms', extra_payments: 'Extra payments', vb_received: 'VB received',
};
const GST_PART_SUFFIX: Record<string, string> = { ex: ' ex', gst: ' GST', inc: ' inc' };

export function screenLabel(c: LedgerColumn, view: GstView): string {
  if (c.gst_group) {
    const base = SHORT_GROUP[c.gst_group] ?? figureLabel(c);
    return view === 'all' ? `${base}${GST_PART_SUFFIX[c.gst_part ?? 'ex'] ?? ''}` : base;
  }
  return SHORT_LABEL[c.key] ?? c.label;
}

export type ReportLayout = 'detailed' | 'summary';

/** One-click report setups: the accountant's detailed copy and management's
 *  short one. */
export const REPORT_PRESETS: { key: string; label: string; hint: string; layout: ReportLayout; gst: GstView; columns: string[] | 'all' }[] = [
  {
    key: 'accountant', label: 'Accountant — detailed', hint: 'Every deal, every column, ex GST + GST + inc GST',
    layout: 'detailed', gst: 'all', columns: 'all',
  },
  {
    key: 'management', label: 'Management — short', hint: 'Period totals only, ex GST',
    layout: 'summary', gst: 'ex',
    columns: ['finance_amount', 'income_ex_gst', 'referrer_comms_ex_gst', 'staff_comms_ex_gst', 'net_profit',
      'extra_payments_ex_gst', 'vb_received_ex_gst', 'final_profit'],
  },
];

export const PAYMENT_CATEGORY_LABEL: Record<LedgerPaymentCategory, string> = {
  extra_service: 'Extra services (e.g. providing financials)',
  mandate_split: 'Split of a mandate fee',
  staff_bonus: 'Staff commission / bonus',
  other: 'Other',
};

/** Where an extra payment stands, e.g. "Paid 12 Nov 2026". */
export const extraPaymentStatusText = (p: LedgerExtraPayment): string =>
  p.status === 'paid' ? `Paid${p.paid_on ? ` ${formatDate(p.paid_on)}` : ''}`
    : p.status === 'scheduled' ? `Scheduled${p.scheduled_on ? ` ${formatDate(p.scheduled_on)}` : ''}` : 'Unpaid';

/** Month-level columns: blank on a deal and on a half's total, filled on the
 *  month, quarter and year totals. Mirrors PERIOD_ONLY in services/ledger.py. */
export const PERIOD_ONLY_COLUMNS = new Set(['vb_received_ex_gst', 'vb_received_inc_gst', 'final_profit']);

export type TotalLevel = 'half' | 'month' | 'quarter' | 'half_year' | 'year';

export type ReportItem =
  | { type: 'month'; key: string; month: LedgerReportMonth }
  | { type: 'half'; key: string; label: string }
  | { type: 'row'; key: string; row: LedgerDealRow }
  | { type: 'payment'; key: string; payment: LedgerExtraPayment }
  | { type: 'total'; key: string; label: string; totals: LedgerTotals | undefined; level: TotalLevel };

/** The report flattened into table rows in the spreadsheet's order: month
 *  heading, each half (heading, deals, total), the month total, then the FY
 *  quarter, half-year and year totals after their last month — each only when
 *  the range spans more than one of the period below it (report.show) — and
 *  the grand total last. Extra payments are month-level: they follow the
 *  halves, under their own heading, just above the month total that counts
 *  them. ``summary`` drops the deals, payments and headings, leaving one line
 *  per total (management's short report). */
export function reportItems(rows: LedgerDealRow[], report: LedgerReport, summary = false, payments: LedgerExtraPayment[] = []): ReportItem[] {
  const byId = new Map(rows.map((r) => [r.application_id, r]));
  const paymentById = new Map(payments.map((p) => [p.id, p]));
  const show = report.show ?? { quarters: true, half_years: false, years: report.years.length > 1 };
  const quarterEnd = show.quarters ? new Map(report.quarters.map((q) => [q.last_month, q])) : new Map();
  const halfEnd = show.half_years ? new Map((report.half_years ?? []).map((h) => [h.last_month, h])) : new Map();
  const yearEnd = show.years ? new Map(report.years.map((y) => [y.last_month, y])) : new Map();
  const items: ReportItem[] = [];
  for (const m of report.months) {
    if (!summary) items.push({ type: 'month', key: `m-${m.month}`, month: m });
    for (const h of m.halves) {
      const deals = h.application_ids.map((id) => byId.get(id)).filter((r): r is LedgerDealRow => Boolean(r));
      if (!deals.length) continue;
      if (summary) {
        // A month with one half needs no half line — the month total says it.
        if (m.halves.length > 1) items.push({ type: 'total', key: `ht-${m.month}-${h.half}`, label: `${formatMonth(m.month)} · ${h.label}`, totals: h.totals, level: 'half' });
        continue;
      }
      items.push({ type: 'half', key: `h-${m.month}-${h.half}`, label: h.label });
      for (const row of deals) items.push({ type: 'row', key: row.application_id, row });
      items.push({ type: 'total', key: `ht-${m.month}-${h.half}`, label: `Total ${h.label}`, totals: h.totals, level: 'half' });
    }
    const extras = summary ? [] : (m.payment_ids ?? []).map((id) => paymentById.get(id)).filter((p): p is LedgerExtraPayment => Boolean(p));
    if (extras.length) {
      items.push({ type: 'half', key: `ep-${m.month}`, label: 'Extra payments' });
      for (const payment of extras) items.push({ type: 'payment', key: `p-${payment.id}`, payment });
    }
    items.push({ type: 'total', key: `mt-${m.month}`, label: `TOTAL ${formatMonth(m.month)}`, totals: m.totals, level: 'month' });
    const q = quarterEnd.get(m.month);
    if (q) items.push({ type: 'total', key: `qt-${q.fy}-${q.quarter}`, label: `TOTAL ${q.label}`, totals: q.totals, level: 'quarter' });
    const hy = halfEnd.get(m.month);
    if (hy) items.push({ type: 'total', key: `hyt-${hy.fy}-${hy.half}`, label: `TOTAL ${hy.label}`, totals: hy.totals, level: 'half_year' });
    const y = yearEnd.get(m.month);
    if (y) items.push({ type: 'total', key: `yt-${y.fy}`, label: `TOTAL ${y.label}`, totals: y.totals, level: 'year' });
  }
  if (report.totals) {
    const n = report.totals.count;
    items.push({ type: 'total', key: 'grand', label: `TOTAL · ${n} deal${n === 1 ? '' : 's'}`, totals: report.totals, level: 'year' });
  }
  return items;
}

const sameFigures = (a: LedgerTotals | undefined, b: LedgerTotals | undefined) => {
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? null) !== (b[k] ?? null)) return false;
  return true;
};

/** On screen, drop total lines that repeat the one before: a half total when
 *  the month has only that half, and a quarter / half-year / year total that
 *  covers the same deals as the month above it. The grand total always stays
 *  last. The PDF and Excel keep every line, as the desk's sheet does. */
export function collapseRepeatedTotals(items: ReportItem[]): ReportItem[] {
  const out: ReportItem[] = [];
  for (const item of items) {
    const prev = out[out.length - 1];
    if (item.type === 'total' && prev?.type === 'total') {
      // The month line carries the month-only figures a half leaves blank.
      if (prev.level === 'half' && item.level !== 'half' && prev.totals?.count === item.totals?.count) {
        out.pop();
      } else if (prev.level !== 'half' && sameFigures(prev.totals, item.totals)) {
        if (item.key !== 'grand') continue;
        out.pop();
      }
    }
    out.push(item);
  }
  return out;
}

// v2: the sheet-layout defaults (deal status, staff comms, extra payments)
// replaced the first set, so earlier picks start again from them.
const COLUMN_PREF_KEY = 'ledger.columns.v2';
const VIEW_PREF_KEY = 'ledger.view';

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

export interface ViewPref { layout: ReportLayout; gst: GstView; showPipeline: boolean }

export function loadViewPref(): ViewPref {
  const fallback: ViewPref = { layout: 'detailed', gst: 'ex', showPipeline: true };
  try {
    const parsed = JSON.parse(localStorage.getItem(VIEW_PREF_KEY) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return fallback;
    return {
      layout: parsed.layout === 'summary' ? 'summary' : 'detailed',
      gst: ['ex', 'inc', 'all'].includes(parsed.gst) ? parsed.gst : 'ex',
      showPipeline: parsed.showPipeline !== false,
    };
  } catch {
    return fallback;
  }
}

export function saveViewPref(pref: ViewPref): void {
  try {
    localStorage.setItem(VIEW_PREF_KEY, JSON.stringify(pref));
  } catch {
    // As above.
  }
}
