import type { ActivityLog } from '../types';

/**
 * Rendering helpers for activity-log entries.
 *
 * The backend stores `details` as a JSON string in one of three shapes:
 *   1. `{ from, to }`      — a before/after change (status_changed, role_changed, user_email_changed)
 *   2. `{ fields: [...] }` — the names of columns touched by a bulk edit (updated, user_updated)
 *   3. a flat `{ key: value }` map of what was set (task_updated, document_uploaded, ...)
 * `describeActivity` normalises all three into something displayable.
 */

/** Fields that don't humanise cleanly from their column name, or read better with a domain label. */
export const FIELD_LABELS: Record<string, string> = {
  amount: 'Loan amount',
  loan_type: 'Loan type',
  loan_term_requested: 'Loan term',
  loan_purpose_id: 'Loan purpose',
  applicant_dob: 'Date of birth',
  applicant_num_dependants: 'Dependants',
  applicant_residency_status: 'Residency status',
  applicant_mobile: 'Mobile',
  business_abn: 'ABN',
  business_industry_id: 'Industry',
  business_monthly_sales: 'Monthly sales',
  gst_registered: 'GST registered',
  num_directors: 'Number of directors',
  time_trading: 'Time trading',
  time_at_address: 'Time at address',
  gross_income: 'Gross income',
  lend_extra_data: 'Additional details',
  lend_product_type_id: 'Product type',
  lend_ref: 'Lend reference',
  kanban_column_id: 'Board column',
  assigned_broker_id: 'Assigned broker',
  assigned_to_id: 'Assignee',
  application_id: 'Application',
  contact_id: 'Contact',
  business_organization_id: 'Company',
  client_sections: 'Client form sections',
  client_engagement_model: 'Engagement model',
  hidden_from_client: 'Hidden from client',
  is_locked: 'Locked',
  doc_type: 'Document type',
  employee_id: 'Employee ID',
  license_number: 'License number',
  full_name: 'Full name',
  organization_name: 'Organization',
};

/** Values for these read as currency. */
const MONEY_FIELDS = new Set(['amount', 'gross_income', 'business_monthly_sales']);

/** Keys handled explicitly by `describeActivity`, so the generic pass skips them. */
const CONSUMED_KEYS = new Set(['from', 'to', 'fields', 'changes']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Most segments we'll show before collapsing the rest into "+N more". */
const MAX_SEGMENTS = 6;

/**
 * Most field chips to show before collapsing the rest.
 *
 * The backend diffs edits down to genuinely-changed columns, so this is a guard against
 * a wide edit rather than the common case. Entries written before that diff landed hold
 * every submitted field, and this keeps those readable too.
 */
const MAX_FIELDS = 8;

/** Turn a column name into a human label — `employer_name` → "Employer name". */
export function fieldLabel(field: string): string {
  const known = FIELD_LABELS[field];
  if (known) return known;
  const base = field.endsWith('_id') ? field.slice(0, -3) : field;
  const words = base.split('_').filter(Boolean);
  if (words.length === 0) return field;
  return [words[0].charAt(0).toUpperCase() + words[0].slice(1), ...words.slice(1)].join(' ');
}

function isOpaqueId(key: string, value: string): boolean {
  return key.endsWith('_id') || UUID_RE.test(value);
}

/** Render a detail value for display, or null when it carries no meaning to a reader. */
function formatValue(key: string, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.map(String).join(', ') : null;
  if (typeof value === 'object') return null;

  const raw = String(value);
  if (isOpaqueId(key, raw)) return null;
  if (MONEY_FIELDS.has(key)) {
    const n = Number(raw);
    if (!Number.isNaN(n)) return `$${n.toLocaleString('en-AU')}`;
  }
  return raw.length > 60 ? `${raw.slice(0, 57)}…` : raw;
}

export function parseDetails(log: Pick<ActivityLog, 'details'>): Record<string, unknown> {
  if (!log.details) return {};
  try {
    const parsed = JSON.parse(log.details);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export interface FieldChange {
  /** Human-readable field label. */
  field: string;
  /** Previous / new value, or null when the field was empty. Both null when `redacted`. */
  from: string | null;
  to: string | null;
  /** The column is encrypted at rest, so the backend withholds its values. */
  redacted: boolean;
}

export interface ActivityDescription {
  /** One-line summary, e.g. "pending → approved". Empty when there's nothing to add. */
  summary: string;
  /** Before/after detail for each changed field. */
  changes: FieldChange[];
  /** Field names only — entries written before the backend recorded values. */
  fields: string[];
}

function toFieldChange(entry: unknown): FieldChange | null {
  if (!entry || typeof entry !== 'object') return null;
  const row = entry as Record<string, unknown>;
  if (typeof row.field !== 'string') return null;
  return {
    field: fieldLabel(row.field),
    from: typeof row.from === 'string' ? row.from : null,
    to: typeof row.to === 'string' ? row.to : null,
    redacted: row.redacted === true,
  };
}

export function describeActivity(log: Pick<ActivityLog, 'action' | 'details'>): ActivityDescription {
  const details = parseDetails(log);
  const empty: ActivityDescription = { summary: '', changes: [], fields: [] };

  // 1. Before/after change.
  const from = formatValue('from', details.from);
  const to = formatValue('to', details.to);
  if (from && to) return { ...empty, summary: `${from} → ${to}` };
  if (to) return { ...empty, summary: `→ ${to}` };

  // 2. Bulk edit — the columns that changed. This is the shape `updated` and
  //    `user_updated` have always written; it just never got rendered.
  if (Array.isArray(details.changes)) {
    const changes = details.changes.map(toFieldChange).filter((c): c is FieldChange => c !== null);
    if (changes.length > 0) return { ...empty, changes };
  }

  // Entries written before the backend recorded before/after values.
  if (Array.isArray(details.fields)) {
    const names = details.fields.filter((f): f is string => typeof f === 'string');
    if (names.length > 0) {
      const shown = names.slice(0, MAX_FIELDS).map(fieldLabel);
      if (names.length > MAX_FIELDS) shown.push(`+${names.length - MAX_FIELDS} more`);
      return { ...empty, fields: shown };
    }
  }

  // 3. Well-known shapes that read better than a generic key/value dump.
  const filename = typeof details.filename === 'string' ? details.filename : null;
  if (filename) {
    const docType = formatValue('doc_type', details.doc_type);
    return { ...empty, summary: docType ? `${filename} (${docType})` : filename };
  }
  const brokerName = formatValue('broker_name', details.broker_name);
  if (brokerName) return { ...empty, summary: brokerName };

  const loanType = formatValue('loan_type', details.loan_type);
  if (loanType) {
    const amount = formatValue('amount', details.amount);
    const clientName = formatValue('client_name', details.client_name);
    const parts = [`${loanType} loan`, amount, clientName].filter(Boolean);
    return { ...empty, summary: parts.join(' · ') };
  }
  const clientName = formatValue('client_name', details.client_name);
  if (clientName) {
    const clientEmail = formatValue('client_email', details.client_email);
    return { ...empty, summary: clientEmail ? `${clientName} (${clientEmail})` : clientName };
  }

  // 4. Generic flat map — "Status: Done · Priority: High · Assignee changed".
  const segments: string[] = [];
  let hidden = 0;
  for (const [key, value] of Object.entries(details)) {
    if (CONSUMED_KEYS.has(key)) continue;
    if (value === null || value === undefined || value === '') continue;
    if (segments.length >= MAX_SEGMENTS) {
      hidden += 1;
      continue;
    }
    const formatted = formatValue(key, value);
    // Opaque ids still tell the reader *which* field moved, just not to what.
    segments.push(formatted ? `${fieldLabel(key)}: ${formatted}` : `${fieldLabel(key)} changed`);
  }
  if (hidden > 0) segments.push(`+${hidden} more`);
  return { ...empty, summary: segments.join(' · ') };
}

export interface ActivityLink {
  to: string;
  label: string;
}

/**
 * Where to go to see the thing this entry touched.
 *
 * There is no per-user detail route, so `user` entries only link when the action
 * itself identifies which people page the record lives on — sending a broker edit
 * to /admin/users (clients only) would be worse than no link at all.
 */
export function activityEntityLink(log: Pick<ActivityLog, 'action' | 'entity_type' | 'entity_id' | 'details'>): ActivityLink | null {
  const details = parseDetails(log);

  switch (log.entity_type) {
    case 'application':
      return { to: `/admin/applications/${log.entity_id}`, label: 'View application' };
    case 'document': {
      const appId = details.application_id;
      return typeof appId === 'string' && appId
        ? { to: `/admin/applications/${appId}`, label: 'View application' }
        : null;
    }
    case 'task':
      return { to: `/admin/tasks/${log.entity_id}`, label: 'View task' };
    case 'kanban_board':
    case 'kanban_column':
      return { to: '/admin/board', label: 'View board' };
    case 'client':
      return { to: '/admin/users', label: 'View clients' };
    case 'user':
      if (log.action === 'broker_created') return { to: '/admin/brokers', label: 'View brokers' };
      if (log.action === 'admin_created') return { to: '/admin/admins', label: 'View admins' };
      return null;
    default:
      return null;
  }
}
