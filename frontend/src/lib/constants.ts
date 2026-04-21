import React from 'react';
import type { AnalysisStatus, ApplicationStatus, DocType, KYCStatus, LendSyncStatus, LenderSubmissionStatus, OcrStatus, QuoteSheetStatus, TaskPriority, TaskStatus, UserRole } from '../types';

export const STATUS_BADGE: Record<ApplicationStatus, string> = {
  draft: '',
  application_received: 'led-chip-info',
  application_assessed: 'led-chip-violet',
  submitted: 'led-chip-accent',
  approval: 'led-chip-warning',
  settled: 'led-chip-success',
  rejected: 'led-chip-danger',
};

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  draft: 'Draft',
  application_received: 'Application Received',
  application_assessed: 'Application Assessed',
  submitted: 'Submitted',
  approval: 'Approval',
  settled: 'Settled',
  rejected: 'Rejected',
};

export const KYC_CONFIG: Record<KYCStatus, { color: string; bg: string; label: string; gradient: string }> = {
  pending: { color: 'text-[var(--led-warning)]', bg: 'led-chip-warning', label: 'Pending Verification', gradient: 'from-warning to-warning' },
  verified: { color: 'text-[var(--led-success)]', bg: 'led-chip-success', label: 'Verified', gradient: 'from-success to-success' },
  rejected: { color: 'text-[var(--led-danger)]', bg: 'led-chip-danger', label: 'Rejected', gradient: 'from-destructive to-destructive' },
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

export const DOC_TYPE_LABELS: Record<string, string> = {
  id_proof: 'ID Proof',
  address_proof: 'Address Proof',
  bank_statement: 'Bank Statement',
  payslip: 'Payslip',
  tax_return: 'Tax Return',
  other: 'Other',
};

export const LOAN_TYPE_ICONS: Record<string, string> = {
  personal: '\u{1F4B3}',
  home: '\u{1F3E0}',
  business: '\u{1F4BC}',
  vehicle: '\u{1F697}',
  equipment_finance: '\u{1F3D7}',
  business_loan: '\u{1F4BC}',
  commercial_property: '\u{1F3E2}',
  home_loan: '\u{1F3E0}',
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

export const ACTION_LABELS: Record<string, string> = {
  created: 'Created application',
  status_changed: 'Changed status',
  broker_assigned: 'Assigned broker',
  broker_unassigned: 'Removed broker',
  document_verified: 'Verified document',
  broker_completed: 'Completed on behalf of client',
};

export const ACTION_ICON_CONFIG: Record<string, { bg: string; icon: React.ReactNode }> = {
  created: {
    bg: 'bg-[#0071e3] text-white',
    icon: React.createElement('svg', { className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', strokeWidth: 2, stroke: 'currentColor' },
      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M12 4.5v15m7.5-7.5h-15' })),
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

export const LEND_SYNC_BADGE: Record<LendSyncStatus, { label: string; className: string }> = {
  pending: { label: 'Lend Syncing...', className: 'led-chip-warning' },
  synced: { label: 'Lend Synced', className: 'led-chip-success' },
  failed: { label: 'Lend Sync Failed', className: 'led-chip-danger' },
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

export const CREDIT_HISTORY_OPTIONS = ['Clear', 'Minor Issues', 'Major Issues', 'Bankrupt', 'Unknown'] as const;

export const RESIDENCY_OPTIONS = ['Australian Citizen', 'Permanent Resident', 'Temporary Visa', 'Other'] as const;

export const RECOMMENDED_DOC_TYPES: DocType[] = ['id_proof', 'address_proof', 'bank_statement', 'payslip', 'tax_return'];

// NOTE: backend source of truth at backend/app/constants.py — keep in sync
export const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ['application_received', 'rejected'],
  application_received: ['application_assessed', 'submitted', 'rejected', 'draft'],
  application_assessed: ['submitted', 'approval', 'rejected', 'application_received', 'draft'],
  submitted: ['approval', 'rejected', 'application_assessed', 'application_received', 'draft'],
  approval: ['settled', 'rejected', 'submitted'],
  settled: [],
  rejected: ['draft', 'application_received', 'application_assessed', 'submitted'],
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

export const COLUMN_COLOR_BG: Record<string, string> = {
  'muted-foreground': 'bg-muted-foreground',
  'primary': 'bg-primary',
  'chart-4': 'bg-chart-4',
  'success': 'bg-success',
  'destructive': 'bg-destructive',
  'chart-2': 'bg-chart-2',
  'chart-5': 'bg-chart-5',
};

export const COLUMN_COLOR_BORDER_L: Record<string, string> = {
  'muted-foreground': 'border-l-muted-foreground',
  'primary': 'border-l-primary',
  'chart-4': 'border-l-chart-4',
  'success': 'border-l-success',
  'destructive': 'border-l-destructive',
  'chart-2': 'border-l-chart-2',
  'chart-5': 'border-l-chart-5',
};
