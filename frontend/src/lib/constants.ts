import React from 'react';
import type { AnalysisStatus, ApplicationStatus, DocType, KYCStatus, LendSyncStatus, LenderSubmissionStatus, OcrStatus, QuoteSheetStatus, TaskPriority, TaskStatus, UserRole } from '../types';

export const STATUS_BADGE: Record<ApplicationStatus, string> = {
  draft: 'bg-secondary text-muted-foreground',
  application_received: 'bg-primary/10 text-primary',
  application_assessed: 'bg-chart-4/10 text-chart-4',
  submitted: 'bg-chart-2/10 text-chart-2',
  approval: 'bg-chart-5/10 text-chart-5',
  settled: 'bg-success/10 text-success',
  rejected: 'bg-destructive/10 text-destructive',
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
  pending: { color: 'text-warning', bg: 'bg-warning/10', label: 'Pending Verification', gradient: 'from-warning to-warning' },
  verified: { color: 'text-success', bg: 'bg-success/10', label: 'Verified', gradient: 'from-success to-success' },
  rejected: { color: 'text-destructive', bg: 'bg-destructive/10', label: 'Rejected', gradient: 'from-destructive to-destructive' },
};

export const ROLE_BADGE: Record<UserRole, string> = {
  client: 'bg-primary/10 text-primary',
  broker: 'bg-chart-2/10 text-chart-2',
  admin: 'bg-chart-5/10 text-chart-5',
  referrer: 'bg-chart-4/10 text-chart-4',
  super_admin: 'bg-chart-1/10 text-chart-1',
};

export const OCR_STATUS_BADGE: Record<OcrStatus, { label: string; className: string }> = {
  pending: { label: 'OCR Pending', className: 'bg-secondary text-muted-foreground' },
  processing: { label: 'Extracting...', className: 'bg-chart-4/10 text-chart-4' },
  completed: { label: 'Text Extracted', className: 'bg-success/10 text-success' },
  failed: { label: 'OCR Failed', className: 'bg-destructive/10 text-destructive' },
};

export const ANALYSIS_STATUS_BADGE: Record<AnalysisStatus, { label: string; className: string }> = {
  pending: { label: 'Analysis Pending', className: 'bg-secondary text-muted-foreground' },
  processing: { label: 'Analyzing...', className: 'bg-chart-4/10 text-chart-4' },
  completed: { label: 'Analysis Complete', className: 'bg-success/10 text-success' },
  failed: { label: 'Analysis Failed', className: 'bg-destructive/10 text-destructive' },
};

export const RISK_LEVEL_BADGE: Record<string, { label: string; className: string }> = {
  low: { label: 'Low Risk', className: 'bg-success/10 text-success' },
  medium: { label: 'Medium Risk', className: 'bg-warning/10 text-warning' },
  high: { label: 'High Risk', className: 'bg-destructive/10 text-destructive' },
};

export const RECOMMENDATION_BADGE: Record<string, { label: string; className: string }> = {
  approve: { label: 'Approve', className: 'bg-success/10 text-success' },
  review: { label: 'Needs Review', className: 'bg-warning/10 text-warning' },
  reject: { label: 'Reject', className: 'bg-destructive/10 text-destructive' },
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
  pending: { label: 'Pending', className: 'bg-chart-4/10 text-chart-4' },
  approved: { label: 'Approved', className: 'bg-success/10 text-success' },
  declined: { label: 'Declined', className: 'bg-destructive/10 text-destructive' },
  conditional: { label: 'Conditional', className: 'bg-warning/10 text-warning' },
  withdrawn: { label: 'Withdrawn', className: 'bg-secondary text-muted-foreground' },
};

export const QUOTE_SHEET_STATUS_BADGE: Record<QuoteSheetStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-chart-4/10 text-chart-4' },
  sent: { label: 'Sent to Client', className: 'bg-success/10 text-success' },
};

export const LEND_SYNC_BADGE: Record<LendSyncStatus, { label: string; className: string }> = {
  pending: { label: 'Lend Syncing...', className: 'bg-chart-4/10 text-chart-4' },
  synced: { label: 'Lend Synced', className: 'bg-success/10 text-success' },
  failed: { label: 'Lend Sync Failed', className: 'bg-destructive/10 text-destructive' },
};

export const TASK_STATUS_BADGE: Record<TaskStatus, { label: string; className: string }> = {
  todo: { label: 'To Do', className: 'bg-secondary text-muted-foreground' },
  in_progress: { label: 'In Progress', className: 'bg-chart-4/10 text-chart-4' },
  completed: { label: 'Completed', className: 'bg-success/10 text-success' },
};

export const TASK_PRIORITY_BADGE: Record<TaskPriority, { label: string; className: string }> = {
  low: { label: 'Low', className: 'bg-secondary text-muted-foreground' },
  medium: { label: 'Medium', className: 'bg-primary/10 text-primary' },
  high: { label: 'High', className: 'bg-warning/10 text-warning' },
  urgent: { label: 'Urgent', className: 'bg-destructive/10 text-destructive' },
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
