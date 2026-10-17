import type { LedgerCategory, LedgerShareBase } from '../types';

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

export type RangePreset = 'this_month' | 'last_month' | '3m' | '6m' | '12m' | 'this_fy' | 'last_fy' | 'all' | 'custom';

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
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
  switch (preset) {
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

/** Columns shown on screen and in downloads until the viewer picks their own. */
export const DEFAULT_LEDGER_COLUMNS = [
  'settled_on', 'customer_name', 'entity_name', 'finance_amount', 'brokerage', 'doc_fee', 'origination_fee',
  'vir', 'income_ex_gst', 'lender_name', 'referrer_comms_ex_gst', 'referrer_comms_inc_gst', 'referrer_name',
  'paid_on', 'net_profit',
];

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
