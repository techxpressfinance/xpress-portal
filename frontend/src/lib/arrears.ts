import type { ArrearsBucket, ArrearsFileType, ArrearsRepaymentFrequency } from '../types';

/**
 * Ageing bands in report order. `delinquent` is not an age band — it's the
 * manual flag, and a flagged contract reports as delinquent instead of its
 * band. `over_180` catches contracts past the last band the business named so
 * no row falls out of the book.
 *
 * Slugs and boundaries mirror ARREARS_BUCKETS / _BAND_LIMITS in
 * backend/app/services/arrears.py — keep both in sync.
 */
export const ARREARS_BUCKETS: {
  value: ArrearsBucket;
  label: string;
  short: string;
  className: string;
}[] = [
  { value: '0_29', label: '0–29 days', short: '0–29', className: 'led-chip-success' },
  { value: '30_59', label: '30–59 days', short: '30–59', className: 'led-chip-info' },
  { value: '60_89', label: '60–89 days', short: '60–89', className: 'led-chip-accent' },
  { value: '90_119', label: '90–119 days', short: '90–119', className: 'led-chip-warning' },
  { value: '120_180', label: '120–180 days', short: '120–180', className: 'led-chip-violet' },
  { value: 'over_180', label: '180+ days', short: '180+', className: 'led-chip-danger' },
  { value: 'delinquent', label: 'Delinquent', short: 'Delinquent', className: 'led-chip-danger' },
];

const BUCKET_BY_VALUE = Object.fromEntries(ARREARS_BUCKETS.map((b) => [b.value, b])) as Record<
  ArrearsBucket,
  (typeof ARREARS_BUCKETS)[number]
>;

export const bucketLabel = (bucket: ArrearsBucket) => BUCKET_BY_VALUE[bucket]?.label ?? bucket;
export const bucketClass = (bucket: ArrearsBucket) => BUCKET_BY_VALUE[bucket]?.className ?? '';

export const ARREARS_FILE_TYPES: { value: ArrearsFileType; label: string }[] = [
  { value: 'asset_finance', label: 'Asset Finance' },
  { value: 'home_loan', label: 'Home Loan' },
  { value: 'commercial', label: 'Commercial Loan' },
  { value: 'other', label: 'Other' },
];

export const fileTypeLabel = (value: ArrearsFileType) =>
  ARREARS_FILE_TYPES.find((t) => t.value === value)?.label ?? value;

export const ARREARS_FREQUENCIES: { value: ArrearsRepaymentFrequency; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
];

/** Files the arrears dropzone accepts: evidence documents plus dropped emails. */
export const ARREARS_ACCEPT = '.pdf,.jpg,.jpeg,.png,.eml,.msg';

export const formatMoney = (value: number | null | undefined) =>
  value == null ? '—' : `$${Number(value).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const formatRepayment = (
  amount: number | null,
  frequency: ArrearsRepaymentFrequency | null,
) => {
  if (amount == null) return '—';
  const label = ARREARS_FREQUENCIES.find((f) => f.value === frequency)?.label;
  return label ? `${formatMoney(amount)} ${label.toLowerCase()}` : formatMoney(amount);
};

/** "2026-08" → "August 2026". Month strings from the API are ISO dates. */
export const formatMonth = (month: string) =>
  new Date(`${month.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-AU', {
    month: 'long',
    year: 'numeric',
  });

/** The last `count` months, newest first, as YYYY-MM. */
export const recentMonths = (count = 24): string[] => {
  const out: string[] = [];
  const cursor = new Date();
  cursor.setDate(1);
  for (let i = 0; i < count; i++) {
    out.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor.setMonth(cursor.getMonth() - 1);
  }
  return out;
};

/** Timestamps are the audit trail on an arrears record, so always show the time. */
export const formatStamp = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export const EVENT_LABELS: Record<string, string> = {
  created: 'Record created',
  updated: 'Details updated',
  resolved: 'Resolved',
  reopened: 'Reopened',
  proof_received: 'Proof of payment',
  proof_cleared: 'Proof of payment',
  delinquent: 'Delinquent',
  delinquent_cleared: 'Delinquent',
  attachment_added: 'Attachment',
  attachment_removed: 'Attachment',
  note: 'Note',
};
