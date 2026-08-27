import type { ArrearsBucket, ArrearsAttemptMethod, ArrearsFileType, ArrearsRecord, ArrearsRepaymentFrequency } from '../types';

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
  /** Theme CSS variable behind the chip — also used for the row age stripe. */
  color: string;
}[] = [
  { value: '0_29', label: '0–29 days', short: '0–29', className: 'led-chip-success', color: 'var(--led-success)' },
  { value: '30_59', label: '30–59 days', short: '30–59', className: 'led-chip-info', color: 'var(--led-info)' },
  { value: '60_89', label: '60–89 days', short: '60–89', className: 'led-chip-accent', color: 'var(--led-accent-ink)' },
  { value: '90_119', label: '90–119 days', short: '90–119', className: 'led-chip-warning', color: 'var(--led-warning)' },
  { value: '120_180', label: '120–180 days', short: '120–180', className: 'led-chip-violet', color: 'var(--led-violet)' },
  { value: 'over_180', label: '180+ days', short: '180+', className: 'led-chip-danger', color: 'var(--led-danger)' },
  { value: 'delinquent', label: 'Delinquent', short: 'Delinquent', className: 'led-chip-danger', color: 'var(--led-danger)' },
];

const BUCKET_BY_VALUE = Object.fromEntries(ARREARS_BUCKETS.map((b) => [b.value, b])) as Record<
  ArrearsBucket,
  (typeof ARREARS_BUCKETS)[number]
>;

export const bucketLabel = (bucket: ArrearsBucket) => BUCKET_BY_VALUE[bucket]?.label ?? bucket;
export const bucketClass = (bucket: ArrearsBucket) => BUCKET_BY_VALUE[bucket]?.className ?? '';
/** Colour for the age stripe down the left of a row — same scale as the chip,
 *  so "how old is this" reads before any text does. */
export const bucketColor = (bucket: ArrearsBucket) =>
  BUCKET_BY_VALUE[bucket]?.color ?? 'var(--led-line)';

/** Whole days since an ISO date (YYYY-MM-DD), floored at 0. Mirrors the
 *  backend's days_in_arrears for the live count in the record modal — the
 *  server value stays authoritative everywhere else. */
export const daysInArrears = (since: string): number => {
  const start = new Date(`${since}T00:00:00`);
  if (Number.isNaN(start.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(Math.round((today.getTime() - start.getTime()) / 86_400_000), 0);
};

/** Age band for a day count — same boundaries as the backend's age_bucket. */
export const bucketForDays = (days: number): ArrearsBucket => {
  if (days <= 29) return '0_29';
  if (days <= 59) return '30_59';
  if (days <= 89) return '60_89';
  if (days <= 119) return '90_119';
  if (days <= 180) return '120_180';
  return 'over_180';
};

export const ARREARS_FILE_TYPES: { value: ArrearsFileType; label: string }[] = [
  { value: 'asset_finance', label: 'Asset Finance' },
  { value: 'home_loan', label: 'Home Loan' },
  { value: 'commercial', label: 'Commercial Loan' },
  { value: 'other', label: 'Other' },
];

export const fileTypeLabel = (value: ArrearsFileType) =>
  ARREARS_FILE_TYPES.find((t) => t.value === value)?.label ?? value;

/** A file is a viewable image if its name carries an image extension — a pasted
 *  screenshot arrives as "screenshot-….png", but a dropped snip may be a plain
 *  "call log.jpg" stored with kind "file", so go by name rather than kind. */
export const isImageAttachment = (filename: string) => /\.(png|jpe?g|gif|webp)$/i.test(filename);

/** An attachment is an email if it was parsed as one, or simply looks like one:
 *  rows dropped before the parser shipped — and any whose bytes the parser
 *  couldn't read — are stored with kind "file", and going by name too is what
 *  gets them the same Read/Download treatment on an older contract. */
export const isEmailAttachment = (a: { kind: string; original_filename: string }) =>
  a.kind === 'email' || /\.(eml|msg)$/i.test(a.original_filename);

/** ISO 3779 VIN length — the backend rejects anything else on an arrears record. */
export const VIN_LENGTH = 17;

export const ARREARS_FREQUENCIES: { value: ArrearsRepaymentFrequency; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
];

/** Collections touch types — mirrors ATTEMPT_METHODS in backend schemas. */
export const ATTEMPT_METHODS: { value: ArrearsAttemptMethod; label: string; done: string }[] = [
  { value: 'phone', label: 'Phone call', done: 'Phone call attempted' },
  { value: 'email', label: 'Email', done: 'Email attempted' },
  { value: 'text', label: 'Text message', done: 'Text message attempted' },
];

export const attemptMethodLabel = (value: string) =>
  ATTEMPT_METHODS.find((m) => m.value === value)?.label ?? value;

/** Value for a <input type="datetime-local"> from an ISO stamp — the API
 *  round-trips naive wall-clock strings, so keep the local value verbatim. */
export const toDatetimeLocal = (iso: string): string => iso.slice(0, 16);

/** Files the arrears dropzone accepts: evidence documents plus dropped emails. */
export const ARREARS_ACCEPT = '.pdf,.jpg,.jpeg,.png,.eml,.msg';

export const formatMoney = (value: number | null | undefined) =>
  value == null ? '—' : `$${Number(value).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** All lender names on a record — "A, B" for co-financed contracts. Falls
 *  back to the primary copy for rows written before the lenders list existed. */
export const lenderNames = (record: ArrearsRecord): string => {
  const names = (record.lenders ?? []).map((l) => l.lender_name).filter(Boolean);
  return names.length ? names.join(', ') : (record.lender_name ?? '');
};

export const formatRepayment = (
  amount: number | null,
  frequency: ArrearsRepaymentFrequency | null,
) => {
  if (amount == null) return '—';
  const label = ARREARS_FREQUENCIES.find((f) => f.value === frequency)?.label;
  return label ? `${formatMoney(amount)} ${label.toLowerCase()}` : formatMoney(amount);
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

/** Spreadsheet export of arrears records — amounts and dates stay raw so
 *  Excel/Sheets can compute on them. */
export function arrearsToCsv(records: ArrearsRecord[]): string {
  const esc = (value: unknown) => {
    const s = value == null ? '' : String(value);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows: unknown[][] = [[
    'Entity', 'Client', 'Lenders', 'Loan type', 'Contract no.', 'VIN',
    'Repayment', 'Frequency', 'Arrears amount', 'Days in arrears', 'Bucket',
    'In arrears since', 'Resolved', 'Proof of payment', 'Notes',
  ]];
  for (const r of records) {
    rows.push([
      r.organization_name, r.contact_name, lenderNames(r), fileTypeLabel(r.file_type),
      r.contract_number, r.vin,
      r.repayment_amount, r.repayment_frequency, r.arrears_amount,
      r.days_in_arrears, bucketLabel(r.bucket), r.in_arrears_since,
      r.resolved ? 'Yes' : 'No', r.proof_of_payment_received ? 'Yes' : 'No', r.notes,
    ]);
  }
  return rows.map((row) => row.map(esc).join(',')).join('\r\n');
}

/** Save records as a CSV file — the "pull the data" counterpart to the PDF report. */
export function downloadArrearsCsv(records: ArrearsRecord[], baseName: string): void {
  const blob = new Blob([arrearsToCsv(records)], { type: 'text/csv;charset=utf-8' });
  saveBlob(blob, `${baseName}-${new Date().toISOString().slice(0, 10)}.csv`);
}

/** Hand a blob to the browser as a download. The link has to be in the document
 *  and the URL revoked only after the click, or the download never starts in
 *  some browsers — same shape as hooks/useFileDownload. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

export const EVENT_LABELS: Record<string, string> = {
  created: 'Record created',
  updated: 'Details updated',
  resolved: 'Resolved',
  reopened: 'Reopened',
  attempt_logged: 'Contact attempt',
  attempt_updated: 'Contact attempt',
  attempt_removed: 'Contact attempt',
  proof_received: 'Proof of payment',
  proof_cleared: 'Proof of payment',
  delinquent: 'Delinquent',
  delinquent_cleared: 'Delinquent',
  attachment_added: 'Attachment',
  attachment_removed: 'Attachment',
  note: 'Note',
};
