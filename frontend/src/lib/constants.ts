import React from 'react';
import type { AnalysisStatus, ApplicationStatus, DocType, KYCStatus, LendSyncStatus, OcrStatus, UserRole } from '../types';

export const STATUS_BADGE: Record<ApplicationStatus, string> = {
  draft: 'bg-secondary text-muted-foreground',
  submitted: 'bg-primary/10 text-primary',
  reviewing: 'bg-chart-4/10 text-chart-4',
  approved: 'bg-success/10 text-success',
  rejected: 'bg-destructive/10 text-destructive',
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

export const LEND_SYNC_BADGE: Record<LendSyncStatus, { label: string; className: string }> = {
  pending: { label: 'Lend Syncing...', className: 'bg-chart-4/10 text-chart-4' },
  synced: { label: 'Lend Synced', className: 'bg-success/10 text-success' },
  failed: { label: 'Lend Sync Failed', className: 'bg-destructive/10 text-destructive' },
};

export const AU_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'] as const;

export const TITLE_OPTIONS = ['Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Prof'] as const;

export const GENDER_OPTIONS = ['Male', 'Female', 'Other'] as const;

export const MARITAL_STATUS_OPTIONS = ['Single', 'Married', 'De Facto', 'Divorced', 'Widowed', 'Separated'] as const;

export const CREDIT_HISTORY_OPTIONS = ['Clear', 'Minor Issues', 'Major Issues', 'Bankrupt', 'Unknown'] as const;

export const RESIDENCY_OPTIONS = ['Australian Citizen', 'Permanent Resident', 'Temporary Visa', 'Other'] as const;

export const REQUIRED_DOC_TYPES: DocType[] = ['id_proof', 'address_proof', 'bank_statement', 'payslip', 'tax_return'];

export const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ['submitted'],
  submitted: ['reviewing', 'rejected'],
  reviewing: ['approved', 'rejected'],
  approved: [],
  rejected: [],
};
