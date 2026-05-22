import React from 'react';
import type { AnalysisStatus, ApplicationStatus, DocType, LendSyncStatus, LenderSubmissionStatus, OcrStatus, QuoteSheetStatus, TaskPriority, TaskStatus, UserRole } from '../types';

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
  submitted: 'Submitted application',
  updated: 'Updated application',
  status_changed: 'Changed status',
  broker_assigned: 'Assigned broker',
  broker_unassigned: 'Removed broker',
  broker_completed: 'Completed on behalf of client',
  broker_group_assigned: 'Assigned broker group',
  document_verified: 'Verified document',
  analysis_triggered: 'Analysis triggered',
  lead_submitted: 'Submitted lead',
  client_referred: 'Added client contact',
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

export const RECOMMENDED_DOC_TYPES: DocType[] = ['id_proof', 'address_proof', 'bank_statement', 'payslip', 'tax_return'];

// NOTE: backend source of truth at backend/app/constants.py — keep in sync
export const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ['application_received', 'rejected', 'not_proceeding'],
  application_received: ['application_assessed', 'submitted', 'settled', 'rejected', 'not_proceeding', 'draft'],
  application_assessed: ['submitted', 'approval', 'settled', 'rejected', 'not_proceeding', 'application_received', 'draft'],
  submitted: ['approval', 'settled', 'rejected', 'not_proceeding', 'application_assessed', 'application_received', 'draft'],
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

// Comprehensive Loan Type Configurations
export const CONSUMER_LOAN_TYPES = [
  { value: 'car', label: 'Car Loan', icon: '🚗', description: 'Finance a new or used car', fields: ['vehicle_make', 'vehicle_model', 'vehicle_year', 'vehicle_vin', 'vehicle_price', 'deposit_amount', 'loan_term', 'vehicle_condition'] },
  { value: 'motorcycle', label: 'Motorcycle Loan', icon: '🏍️', description: 'Finance a new or used motorcycle', fields: ['vehicle_make', 'vehicle_model', 'vehicle_year', 'vehicle_vin', 'vehicle_price', 'deposit_amount', 'loan_term', 'vehicle_condition'] },
  { value: 'caravan', label: 'Caravan / RV Loan', icon: '🚐', description: 'Finance a caravan or recreational vehicle', fields: ['vehicle_make', 'vehicle_model', 'vehicle_year', 'vehicle_price', 'deposit_amount', 'loan_term', 'vehicle_condition'] },
  { value: 'other_vehicle', label: 'Other Vehicle', icon: '🚙', description: 'Boat, jet ski, or other vehicle', fields: ['vehicle_type', 'vehicle_make', 'vehicle_model', 'vehicle_year', 'vehicle_price', 'deposit_amount', 'loan_term', 'vehicle_condition'] },
  { value: 'personal', label: 'Personal Loan', icon: '💳', description: 'Unsecured personal loan for any purpose', fields: ['loan_purpose', 'loan_amount', 'loan_term'] },
  { value: 'purchase', label: 'Purchase', icon: '🏠', description: 'Property purchase', fields: ['property_address', 'property_type', 'property_value', 'deposit_amount', 'loan_term', 'first_home_buyer'] },
  { value: 'refinance', label: 'Refinance', icon: '🔄', description: 'Refinance existing loan', fields: ['current_lender', 'current_balance', 'property_address', 'property_value', 'loan_term', 'refinance_reason'] },
] as const;

export const COMMERCIAL_LOAN_TYPES = [
  { value: 'day_to_day_capital', label: 'Working capital/ overdraft', icon: '💵', description: 'Working capital for daily operations', fields: ['loan_amount', 'loan_term', 'business_purpose'] },
  { value: 'vehicles_or_transport', label: 'Vehicle/car/ transport/ Equipment / Machinery', icon: '🚛', description: 'Commercial vehicle, equipment & machinery finance', fields: ['vehicle_type', 'vehicle_make', 'vehicle_model', 'vehicle_year', 'vehicle_price', 'deposit_amount', 'loan_term', 'business_use_pct'] },
  { value: 'new_fit_out', label: 'Fitouts / Biz Expansion/grow staff', icon: '🏗️', description: 'Shop or office fit-out, business expansion or staff growth', fields: ['fit_out_description', 'property_address', 'estimated_cost', 'loan_term'] },
  { value: 'waiting_for_invoices', label: 'Invoice financing/ pay to international suppliers', icon: '⏳', description: 'Invoice factoring or supplier payment financing', fields: ['outstanding_invoices', 'total_amount', 'loan_term'] },
  { value: 'property', label: 'Development finance & Construction', icon: '🏢', description: 'Construction and development finance', fields: ['property_address', 'property_type', 'property_value', 'deposit_amount', 'loan_term', 'property_use'] },
  { value: 'new_business', label: 'Start a new business/ Purchase an existing business', icon: '🚀', description: 'Startup funding or business acquisition', fields: ['business_plan', 'startup_costs', 'loan_amount', 'loan_term', 'industry'] },
  { value: 'other', label: 'Other', icon: '📋', description: 'Other business purpose', fields: ['purpose_description', 'loan_amount', 'loan_term'] },
] as const;

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


