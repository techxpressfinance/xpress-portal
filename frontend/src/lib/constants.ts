import React from 'react';
import type { AnalysisStatus, ApplicationStatus, DocType, EntityType, LenderSubmissionStatus, LoanCategory, LoanType, OcrStatus, QuoteSheetStatus, TaskPriority, TaskStatus, TrustPartyKind, TrustPartyRole, TrustType, UserRole } from '../types';

export const STATUS_BADGE: Record<ApplicationStatus, string> = {
  draft: '',
  application_received: 'led-chip-info',
  application_assessed: 'led-chip-violet',
  submitted: 'led-chip-accent',
  approval: 'led-chip-warning',
  settled: 'led-chip-success',
  rejected: 'led-chip-danger',
  not_proceeding: '',
};

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  draft: 'Draft',
  application_received: 'Application Received',
  application_assessed: 'Application Assessed',
  submitted: 'Submitted',
  approval: 'Approval',
  settled: 'Settled',
  rejected: 'Rejected',
  not_proceeding: 'Not Proceeding',
};

export const ROLE_BADGE: Record<UserRole, string> = {
  client: 'led-chip-info',
  broker: 'led-chip-accent',
  admin: 'led-chip-warning',
  referrer: 'led-chip-violet',
  super_admin: 'led-chip-danger',
};

export const OCR_STATUS_BADGE: Record<OcrStatus, { label: string; className: string }> = {
  pending: { label: 'OCR Pending', className: '' },
  processing: { label: 'Extracting...', className: 'led-chip-warning' },
  completed: { label: 'Text Extracted', className: 'led-chip-success' },
  failed: { label: 'OCR Failed', className: 'led-chip-danger' },
};

export const ANALYSIS_STATUS_BADGE: Record<AnalysisStatus, { label: string; className: string }> = {
  pending: { label: 'Analysis Pending', className: '' },
  processing: { label: 'Analyzing...', className: 'led-chip-warning' },
  completed: { label: 'Analysis Complete', className: 'led-chip-success' },
  failed: { label: 'Analysis Failed', className: 'led-chip-danger' },
};

export const RISK_LEVEL_BADGE: Record<string, { label: string; className: string }> = {
  low: { label: 'Low Risk', className: 'led-chip-success' },
  medium: { label: 'Medium Risk', className: 'led-chip-warning' },
  high: { label: 'High Risk', className: 'led-chip-danger' },
};

export const RECOMMENDATION_BADGE: Record<string, { label: string; className: string }> = {
  approve: { label: 'Approve', className: 'led-chip-success' },
  review: { label: 'Needs Review', className: 'led-chip-warning' },
  reject: { label: 'Reject', className: 'led-chip-danger' },
};

export const FLAG_SEVERITY_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  info: { bg: 'bg-primary/5', border: 'border-primary/20', text: 'text-primary' },
  warning: { bg: 'bg-warning/5', border: 'border-warning/20', text: 'text-warning' },
  critical: { bg: 'bg-destructive/5', border: 'border-destructive/20', text: 'text-destructive' },
};

export const SERVICE_REQUEST_TYPES = [
  'Status Update',
  'Document Update',
  'Callback Request',
  'Change of Details',
  'General Enquiry',
  'Complaint',
  'SOA',
  'Amortization Schedule',
  'Accountant Pack',
  'Payout Figure',
  'Change of Direct Debit Details',
  'Loan Details Sheet (PPSR)',
  'Other',
] as const;

export const DOC_TYPE_LABELS: Record<string, string> = {
  id_proof: 'ID Proof',
  address_proof: 'Address Proof',
  bank_statement: 'Bank Statement',
  payslip: 'Payslip',
  tax_return: 'Tax Return',
  other: 'Other',
};

export const LOAN_TYPE_LABELS: Record<string, string> = {
  personal: 'Personal Loan',
  home: 'Home Loan',
  business: 'Business Loan',
  vehicle: 'Vehicle Loan',
  equipment_finance: 'Equipment Finance',
  business_loan: 'Business Loan',
  commercial_property: 'Commercial Property',
  home_loan: 'Home Loan',
};

// Loan types the current category/sub-type flow can still produce (see
// subTypeToLoanType). 'home' and 'business' survive only on old applications.
export const ASSIGNABLE_LOAN_TYPES: readonly LoanType[] = ['personal', 'vehicle', 'home_loan', 'equipment_finance', 'business_loan', 'commercial_property'];

export const loanTypeOptions = (current?: string): { value: string; label: string }[] => {
  const options: { value: string; label: string }[] = ASSIGNABLE_LOAN_TYPES.map(value => ({ value, label: LOAN_TYPE_LABELS[value] }));
  if (current && !ASSIGNABLE_LOAN_TYPES.includes(current as LoanType)) {
    options.push({ value: current, label: `${LOAN_TYPE_LABELS[current] ?? current} (legacy)` });
  }
  return options;
};

/** Covers every action written by `log_activity` in the backend. Unmapped actions fall back to the raw slug. */
export const ACTION_LABELS: Record<string, string> = {
  // Applications
  created: 'Created application',
  cloned: 'Cloned application',
  submitted: 'Submitted application',
  updated: 'Updated application',
  deleted: 'Deleted application',
  restored: 'Restored application',
  status_changed: 'Changed status',
  kanban_moved: 'Moved on board',
  broker_assigned: 'Assigned broker',
  broker_unassigned: 'Removed broker',
  broker_completed: 'Completed on behalf of client',
  broker_group_assigned: 'Assigned broker group',
  client_invite_sent: 'Sent client invite',
  client_sections_set: 'Set client form sections',
  analysis_triggered: 'Analysis triggered',
  application_reconciled: 'Reconciled application',
  lead_submitted: 'Submitted lead',
  submitted_public_form: 'Submitted public form',
  note_added: 'Added note',
  note_deleted: 'Deleted note',
  document_requested: 'Requested document',
  document_request_fulfilled: 'Fulfilled document request',
  director_added: 'Added director',
  director_removed: 'Removed director',
  guarantor_added: 'Added guarantor',
  guarantor_removed: 'Removed guarantor',
  guarantor_signatory_added: 'Added guarantor signatory',
  // Documents
  document_uploaded: 'Uploaded document',
  document_verified: 'Verified document',
  document_deleted: 'Deleted document',
  // Users
  registered: 'Registered',
  broker_created: 'Created broker',
  admin_created: 'Created admin',
  user_updated: 'Updated user',
  user_email_changed: 'Changed login email',
  user_deleted: 'Deleted user',
  role_changed: 'Changed role',
  profile_updated: 'Updated profile',
  profile_details_updated: 'Updated profile details',
  password_changed: 'Changed password',
  password_reset_sent: 'Sent password reset',
  referrer_attached: 'Linked referrer',
  referrer_detached: 'Unlinked referrer',
  client_referred: 'Added client contact',
  // Tasks
  task_created: 'Created task',
  task_updated: 'Updated task',
  task_deleted: 'Deleted task',
  checklist_item_added: 'Added checklist item',
  // Kanban
  board_created: 'Created board',
  board_updated: 'Updated board',
  board_deleted: 'Deleted board',
  columns_reordered: 'Reordered columns',
  column_created: 'Created column',
  column_updated: 'Updated column',
  column_deleted: 'Deleted column',
  // Alerts
  alert_created: 'Created alert',
  alert_deleted: 'Deleted alert',
};

export const ACTION_ICON_CONFIG: Record<string, { bg: string; icon: React.ReactNode }> = {
  created: {
    bg: 'bg-[#0071e3] text-white',
    icon: React.createElement('svg', { className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', strokeWidth: 2, stroke: 'currentColor' },
      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M12 4.5v15m7.5-7.5h-15' })),
  },
  cloned: {
    bg: 'bg-[#0071e3] text-white',
    icon: React.createElement('svg', { className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', strokeWidth: 2, stroke: 'currentColor' },
      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75' })),
  },
  status_changed: {
    bg: 'bg-[#af52de] text-white',
    icon: React.createElement('svg', { className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', strokeWidth: 2, stroke: 'currentColor' },
      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5' })),
  },
  broker_assigned: {
    bg: 'bg-[#5856d6] text-white',
    icon: React.createElement('svg', { className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', strokeWidth: 2, stroke: 'currentColor' },
      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0' })),
  },
  document_verified: {
    bg: 'bg-[#34c759] text-white',
    icon: React.createElement('svg', { className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', strokeWidth: 2, stroke: 'currentColor' },
      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'm4.5 12.75 6 6 9-13.5' })),
  },
  lead_submitted: {
    bg: 'bg-[#ff9500] text-white',
    icon: React.createElement('svg', { className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', strokeWidth: 2, stroke: 'currentColor' },
      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5' })),
  },
  client_referred: {
    bg: 'bg-[#5856d6] text-white',
    icon: React.createElement('svg', { className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', strokeWidth: 2, stroke: 'currentColor' },
      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z' })),
  },
  submitted: {
    bg: 'bg-[#30b0c7] text-white',
    icon: React.createElement('svg', { className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', strokeWidth: 2, stroke: 'currentColor' },
      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5' })),
  },
};

export const SUBMISSION_STATUS_BADGE: Record<LenderSubmissionStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'led-chip-warning' },
  approved: { label: 'Approved', className: 'led-chip-success' },
  declined: { label: 'Declined', className: 'led-chip-danger' },
  conditional: { label: 'Conditional', className: 'led-chip-accent' },
  withdrawn: { label: 'Withdrawn', className: '' },
};

export const QUOTE_SHEET_STATUS_BADGE: Record<QuoteSheetStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'led-chip-warning' },
  sent: { label: 'Sent to Client', className: 'led-chip-success' },
};


export const TASK_STATUS_BADGE: Record<TaskStatus, { label: string; className: string }> = {
  todo: { label: 'To Do', className: '' },
  in_progress: { label: 'In Progress', className: 'led-chip-warning' },
  completed: { label: 'Completed', className: 'led-chip-success' },
};

export const TASK_PRIORITY_BADGE: Record<TaskPriority, { label: string; className: string }> = {
  low: { label: 'Low', className: '' },
  medium: { label: 'Medium', className: 'led-chip-info' },
  high: { label: 'High', className: 'led-chip-warning' },
  urgent: { label: 'Urgent', className: 'led-chip-danger' },
};

export const AU_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'] as const;

export const TITLE_OPTIONS = ['Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Prof'] as const;

export const GENDER_OPTIONS = ['Male', 'Female', 'Other'] as const;

export const MARITAL_STATUS_OPTIONS = ['Single', 'Married', 'De Facto', 'Divorced', 'Widowed', 'Separated'] as const;

export const RECOMMENDED_DOC_TYPES: DocType[] = ['id_proof', 'address_proof', 'bank_statement', 'payslip', 'tax_return'];

// NOTE: backend source of truth at backend/app/constants.py — keep in sync
export const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ['application_received', 'rejected', 'not_proceeding'],
  // Settled is reachable only via Approval — an application must be approved
  // by a lender before it can be marked settled.
  application_received: ['application_assessed', 'submitted', 'rejected', 'not_proceeding', 'draft'],
  application_assessed: ['submitted', 'approval', 'rejected', 'not_proceeding', 'application_received', 'draft'],
  submitted: ['approval', 'rejected', 'not_proceeding', 'application_assessed', 'application_received', 'draft'],
  approval: ['settled', 'rejected', 'not_proceeding', 'submitted'],
  settled: [],
  rejected: ['draft', 'application_received', 'application_assessed', 'submitted'],
  not_proceeding: ['draft', 'application_received'],
};

export const COLUMN_COLOR_OPTIONS = [
  { value: 'muted-foreground', label: 'Gray' },
  { value: 'primary', label: 'Blue' },
  { value: 'chart-4', label: 'Orange' },
  { value: 'success', label: 'Green' },
  { value: 'destructive', label: 'Red' },
  { value: 'chart-2', label: 'Teal' },
  { value: 'chart-5', label: 'Purple' },
] as const;

// Comprehensive Loan Type Configurations — grouped into the three top-level
// categories shown on application forms (Asset Finance / Home Loan / Commercial).
export const ASSET_FINANCE_LOAN_TYPES = [
  { value: 'car', label: 'Car Loan', short: 'Car', description: 'Finance a new or used car', fields: ['vehicle_make', 'vehicle_model', 'vehicle_year', 'vehicle_vin', 'vehicle_price', 'deposit_amount', 'loan_term', 'vehicle_condition'] },
  { value: 'motorcycle', label: 'Motorcycle Loan', short: 'Motorcycle', description: 'Finance a new or used motorcycle', fields: ['vehicle_make', 'vehicle_model', 'vehicle_year', 'vehicle_vin', 'vehicle_price', 'deposit_amount', 'loan_term', 'vehicle_condition'] },
  { value: 'caravan', label: 'Caravan / RV Loan', short: 'Caravan / RV', description: 'Finance a caravan or recreational vehicle', fields: ['vehicle_make', 'vehicle_model', 'vehicle_year', 'vehicle_price', 'deposit_amount', 'loan_term', 'vehicle_condition'] },
  { value: 'other_vehicle', label: 'Other Vehicle', short: 'Other Vehicle', description: 'Boat, jet ski, or other vehicle', fields: ['vehicle_type', 'vehicle_make', 'vehicle_model', 'vehicle_year', 'vehicle_price', 'deposit_amount', 'loan_term', 'vehicle_condition'] },
  { value: 'personal', label: 'Personal Loan', short: 'Personal', description: 'Unsecured personal loan for any purpose', fields: ['loan_purpose', 'loan_amount', 'loan_term'] },
  { value: 'day_to_day_capital', label: 'Working capital/ overdraft', short: 'Working Capital', description: 'Working capital for daily operations', fields: ['loan_amount', 'loan_term', 'business_purpose'] },
  { value: 'vehicles_or_transport', label: 'Vehicle/car/ transport/ Equipment / Machinery', short: 'Vehicle / Equipment', description: 'Commercial vehicle, equipment & machinery finance', fields: ['vehicle_type', 'vehicle_make', 'vehicle_model', 'vehicle_year', 'vehicle_price', 'deposit_amount', 'loan_term', 'business_use_pct'] },
] as const;

export const HOME_LOAN_TYPES = [
  { value: 'purchase', label: 'Purchase', short: 'Purchase', description: 'Property purchase', fields: ['property_address', 'property_type', 'property_value', 'deposit_amount', 'loan_term', 'first_home_buyer'] },
  { value: 'refinance', label: 'Refinance', short: 'Refinance', description: 'Refinance existing loan', fields: ['current_lender', 'current_balance', 'property_address', 'property_value', 'loan_term', 'refinance_reason'] },
] as const;

export const COMMERCIAL_LOAN_TYPES = [
  { value: 'new_fit_out', label: 'Fitouts / Biz Expansion/grow staff', short: 'Fit-out / Expansion', description: 'Shop or office fit-out, business expansion or staff growth', fields: ['fit_out_description', 'property_address', 'estimated_cost', 'loan_term'] },
  { value: 'waiting_for_invoices', label: 'Invoice financing/ pay to international suppliers', short: 'Invoice Finance', description: 'Invoice factoring or supplier payment financing', fields: ['outstanding_invoices', 'total_amount', 'loan_term'] },
  { value: 'property', label: 'Development finance & Construction', short: 'Development', description: 'Construction and development finance', fields: ['property_address', 'property_type', 'property_value', 'deposit_amount', 'loan_term', 'property_use'] },
  { value: 'new_business', label: 'Start a new business/ Purchase an existing business', short: 'New Business', description: 'Startup funding or business acquisition', fields: ['business_plan', 'startup_costs', 'loan_amount', 'loan_term', 'industry'] },
  { value: 'other', label: 'Other', short: 'Other', description: 'Other business purpose', fields: ['purpose_description', 'loan_amount', 'loan_term'] },
] as const;

// Declared in ../types (User.specialties needs it and types must not import
// from here) and re-exported so existing `from '../../lib/constants'` imports
// keep working.
export type { LoanCategory };

export const LOAN_CATEGORIES: { value: LoanCategory; label: string; types: readonly { value: string; label: string; short: string; description: string; fields: readonly string[] }[] }[] = [
  { value: 'asset_finance', label: 'Asset Finance', types: ASSET_FINANCE_LOAN_TYPES },
  { value: 'home_loan', label: 'Home Loan', types: HOME_LOAN_TYPES },
  { value: 'commercial', label: 'Commercial Loans', types: COMMERCIAL_LOAN_TYPES },
];

// Legal structures an entity can take. Order drives the entity picker.
// Backend copy at backend/app/constants.py (ENTITY_TYPES) — keep in sync.
export const ENTITY_TYPES: { value: EntityType; label: string; description: string }[] = [
  { value: 'trust', label: 'Trust', description: 'Discretionary, unit or SMSF trust' },
  { value: 'trustee', label: 'Trustee', description: 'Acts as trustee for a trust' },
  { value: 'company', label: 'Company', description: 'Pty Ltd or public company' },
  { value: 'partnership', label: 'Partnership', description: 'Two or more partners' },
  { value: 'sole_trader', label: 'Sole Trader', description: 'Individual trading under an ABN' },
];

// Trust structure. Backend copies at backend/app/constants.py (TRUST_TYPES,
// TRUST_PARTY_ROLES, TRUST_PARTY_KINDS) — keep in sync.
export const TRUST_TYPES: { value: TrustType; label: string }[] = [
  { value: 'discretionary', label: 'Discretionary (family)' },
  { value: 'unit', label: 'Unit' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'smsf', label: 'SMSF' },
  { value: 'testamentary', label: 'Testamentary' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'other', label: 'Other' },
];

export const TRUST_PARTY_ROLES: {
  value: TrustPartyRole;
  label: string;
  plural: string;
  description: string;
  className: string;
}[] = [
  {
    value: 'settlor',
    label: 'Settlor',
    plural: 'Settlors',
    description: 'Settled the trust with the initial sum — named on the deed.',
    className: 'bg-chart-1/10 text-chart-1',
  },
  {
    value: 'appointor',
    label: 'Appointor',
    plural: 'Appointors',
    description: 'Can hire and fire the trustee — effective control of the trust.',
    className: 'bg-chart-5/10 text-chart-5',
  },
  {
    value: 'trustee',
    label: 'Trustee',
    plural: 'Trustees',
    description: 'Holds the trust property and borrows on its behalf. An individual, company or partnership.',
    className: 'bg-chart-2/10 text-chart-2',
  },
  {
    value: 'beneficiary',
    label: 'Beneficiary',
    plural: 'Beneficiaries',
    description: 'Entitled to benefit from the trust. May be a person, an entity or a class.',
    className: 'bg-chart-4/10 text-chart-4',
  },
  {
    value: 'beneficial_owner',
    label: 'Beneficial owner',
    plural: 'Beneficial owners',
    description: 'Ultimately owns or controls 25%+ of the trust (AML/CTF).',
    className: 'bg-chart-3/10 text-chart-3',
  },
];

export const TRUST_PARTY_ROLE_CONFIG = Object.fromEntries(
  TRUST_PARTY_ROLES.map(r => [r.value, r]),
) as Record<TrustPartyRole, (typeof TRUST_PARTY_ROLES)[number]>;

export const TRUST_PARTY_KINDS: { value: TrustPartyKind; label: string }[] = [
  { value: 'individual', label: 'Individual' },
  { value: 'company', label: 'Company' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'trust', label: 'Trust' },
  { value: 'other', label: 'Other / class' },
];

/** Kinds that are an entity with an ABN — these link to an Organization
 *  rather than a Contact. */
export const isEntityPartyKind = (kind: TrustPartyKind): boolean =>
  kind === 'company' || kind === 'partnership' || kind === 'trust';

export const ENTITY_TYPE_CONFIG: Record<EntityType, { label: string; className: string }> = {
  trust: { label: 'Trust', className: 'bg-chart-4/10 text-chart-4' },
  trustee: { label: 'Trustee', className: 'bg-chart-5/10 text-chart-5' },
  company: { label: 'Company', className: 'bg-chart-2/10 text-chart-2' },
  partnership: { label: 'Partnership', className: 'bg-chart-1/10 text-chart-1' },
  sole_trader: { label: 'Sole Trader', className: 'bg-chart-3/10 text-chart-3' },
};

// Sub-types whose details serialize under consumer_loan_type (individual borrower).
// Everything else — including legacy values no longer offered as cards — is a
// business-purpose loan serialized under commercial_loan_type and requiring ABN.
const CONSUMER_SUB_TYPES = new Set(['car', 'motorcycle', 'caravan', 'other_vehicle', 'personal', 'purchase', 'refinance']);

export const isConsumerSubType = (subType: string): boolean => CONSUMER_SUB_TYPES.has(subType);
export const isBusinessSubType = (subType: string): boolean => !!subType && !CONSUMER_SUB_TYPES.has(subType);

export const categoryForSubType = (subType: string): LoanCategory => {
  if (subType === 'purchase' || subType === 'refinance') return 'home_loan';
  if (CONSUMER_SUB_TYPES.has(subType) || ['day_to_day_capital', 'vehicles_or_transport'].includes(subType)) return 'asset_finance';
  return 'commercial';
};

// Maps a form sub-type to the stored LoanType enum value. Includes legacy
// sub-types (machinery_or_equipment, renovation, …) still present in old data.
export const subTypeToLoanType = (subType: string): string => {
  if (['car', 'motorcycle', 'caravan', 'other_vehicle'].includes(subType)) return 'vehicle';
  if (['purchase', 'refinance'].includes(subType)) return 'home_loan';
  if (subType === 'personal') return 'personal';
  if (['vehicles_or_transport', 'machinery_or_equipment', 'new_fit_out', 'renovation', 'pay_suppliers'].includes(subType)) return 'equipment_finance';
  if (['property', 'development_construction'].includes(subType)) return 'commercial_property';
  return 'business_loan';
};

export const findLoanSubType = (value: string) =>
  [...ASSET_FINANCE_LOAN_TYPES, ...HOME_LOAN_TYPES, ...COMMERCIAL_LOAN_TYPES].find(t => t.value === value);

export const VEHICLE_MAKES = [
  'Toyota', 'Honda', 'Mazda', 'Ford', 'Holden', 'Hyundai', 'Kia', 'Mitsubishi', 'Nissan', 'Subaru',
  'Volkswagen', 'BMW', 'Mercedes-Benz', 'Audi', 'Lexus', 'Volvo', 'Jeep', 'Land Rover', 'Porsche',
  'Tesla', 'Suzuki', 'Yamaha', 'Harley-Davidson', 'Kawasaki', 'Ducati', 'Triumph', 'Indian',
  'Jayco', 'Winnebago', 'Airstream', 'Caravans Australia', 'Other'
] as const;

export const PROPERTY_TYPES = [
  'House', 'Apartment / Unit', 'Townhouse', 'Villa', 'Land', 'Commercial Office', 'Retail Shop',
  'Warehouse / Industrial', 'Mixed Use', 'Development Site', 'Rural Property', 'Other'
] as const;

export const EQUIPMENT_TYPES = [
  'Truck', 'Car / Ute', 'Van', 'Forklift', 'Excavator', 'Bulldozer', 'Crane', 'Tractor',
  'Manufacturing Equipment', 'Printing Equipment', 'Medical Equipment', 'IT Equipment',
  'Catering Equipment', 'Gym Equipment', 'Agricultural Equipment', 'Other'
] as const;

export const LOAN_TERM_OPTIONS = ['1 year', '2 years', '3 years', '4 years', '5 years', '7 years', '10 years', '15 years', '20 years', '30 years'] as const;

export const VEHICLE_CONDITION_OPTIONS = ['New', 'Used - Excellent', 'Used - Good', 'Used - Fair', 'Demo'] as const;

// Client-form sections a broker can choose to show/hide for the client.
// Keys must mirror SECTION_KEYS in backend/app/routers/applications.py.
export const APPLICATION_SECTIONS = [
  { key: 'loan_details', label: 'Loan Details' },
  { key: 'personal', label: 'Personal Details' },
  { key: 'identification', label: 'Identification' },
  { key: 'contact', label: 'Contact Details' },
  { key: 'business', label: 'Business Details' },
  { key: 'living', label: 'Living Situation' },
  { key: 'employment', label: 'Employment' },
  { key: 'income', label: 'Income' },
  { key: 'assets', label: 'Assets' },
  { key: 'liabilities', label: 'Liabilities' },
  { key: 'expenses', label: 'Monthly Expenses' },
  { key: 'declarations', label: 'Declarations' },
  { key: 'emergency', label: 'Emergency Contact' },
  { key: 'documents', label: 'Supporting Documents' },
] as const;

export type ApplicationSectionKey = (typeof APPLICATION_SECTIONS)[number]['key'];


