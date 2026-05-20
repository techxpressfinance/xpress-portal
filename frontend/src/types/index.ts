export const USER_ROLES = ['client', 'broker', 'admin', 'referrer', 'super_admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export type AuthMethod = string;

export const LOAN_TYPES = ['personal', 'home', 'business', 'vehicle', 'equipment_finance', 'business_loan', 'commercial_property', 'home_loan'] as const;
export type LoanType = (typeof LOAN_TYPES)[number];

export const APPLICATION_STATUSES = ['draft', 'application_received', 'application_assessed', 'submitted', 'approval', 'settled', 'rejected', 'not_proceeding'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const DOC_TYPES = ['id_proof', 'address_proof', 'bank_statement', 'payslip', 'tax_return', 'other'] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const OCR_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const;
export type OcrStatus = (typeof OCR_STATUSES)[number];

export const ANALYSIS_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

export const LEND_SYNC_STATUSES = ['pending', 'synced', 'failed'] as const;
export type LendSyncStatus = (typeof LEND_SYNC_STATUSES)[number];

export const SERVICE_REQUEST_STATUSES = ['pending', 'in_progress', 'resolved', 'closed'] as const;
export type ServiceRequestStatus = (typeof SERVICE_REQUEST_STATUSES)[number];

export interface User {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  is_active: boolean;
  email_verified: boolean;
  auth_method: AuthMethod;
  employee_id: string | null;
  department: string | null;
  license_number: string | null;
  organization_name: string | null;
  tenant_id: string;
  invited_by_id: string | null;
  created_at: string;
}

export interface TenantBranding {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  primary_color: string | null;
  support_email: string | null;
}

export interface AssignedBroker {
  id: string;
  full_name: string;
}

export interface LoanApplication {
  id: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  user_role?: string;
  loan_type: LoanType;
  amount: number;
  status: ApplicationStatus;
  assigned_broker_id: string | null;
  assigned_broker_name: string | null;
  assigned_brokers: AssignedBroker[];
  notes: string | null;
  created_at: string;
  updated_at: string;
  analysis_status: AnalysisStatus | null;
  analysis_result: string | null;
  analysis_error: string | null;
  analyzed_at: string | null;
  completed_by_id: string | null;
  completed_by_name: string | null;
  completed_at: string | null;
  kanban_column_id: string | null;
  // Client-filled — Personal
  applicant_title: string | null;
  applicant_first_name: string | null;
  applicant_last_name: string | null;
  applicant_middle_name: string | null;
  applicant_dob: string | null;
  applicant_gender: string | null;
  applicant_marital_status: string | null;
  // Client-filled — Address
  applicant_address: string | null;
  applicant_suburb: string | null;
  applicant_state: string | null;
  applicant_postcode: string | null;
  // Client-filled — Business
  business_abn: string | null;
  business_name: string | null;
  business_registration_date: string | null;
  business_industry_id: number | null;
  business_monthly_sales: number | null;
  // Client-filled — Loan
  loan_purpose_id: number | null;
  loan_term_requested: number | null;
  // Overflow JSON
  lend_extra_data: string | null;
  // Extended applicant fields
  applicant_email: string | null;
  applicant_mobile: string | null;
  preferred_contact_method: string | null;
  id_expiry_date: string | null;
  applicant_residency_status: string | null;
  residential_status: string | null;
  time_at_address: string | null;
  applicant_num_dependants: number | null;
  has_partner: boolean | null;
  partner_working: boolean | null;
  employment_category: string | null;
  employer_name: string | null;
  employer_industry: string | null;
  job_title: string | null;
  income_frequency: string | null;
  gross_income: number | null;
  trading_name: string | null;
  business_structure: string | null;
  gst_registered: boolean | null;
  num_directors: number | null;
  time_trading: string | null;
  previously_declined: boolean | null;
  change_of_circumstances: boolean | null;
  signature_name: string | null;
  emergency_contact_name: string | null;
  emergency_contact_relationship: string | null;
  emergency_contact_phone: string | null;
  // Broker-filled — Lend controls
  lend_product_type_id: number | null;
  lend_owner_type: string | null;
  lend_send_type: string | null;
  lend_who_to_contact: string | null;
  // Lend sync tracking
  lend_ref: string | null;
  lend_sync_status: LendSyncStatus | null;
  lend_sync_error: string | null;
  lend_synced_at: string | null;
  // Referrer-filled
  client_engagement_model: ClientEngagementModel | null;
  // Referrer info (populated from referral data)
  referrer: ReferrerInfo | null;
  // Soft delete
  deleted_at: string | null;
  // Nested user object (returned by serializer)
  user?: { id: string; full_name: string; email: string } | null;
}

export interface AnalysisResult {
  financial_summary: {
    income: string;
    employer: string;
    bank_balance: string;
    monthly_obligations: string;
  };
  identity_verification: {
    name_consistent: boolean;
    address_consistent: boolean;
    notes: string;
  };
  risk_assessment: {
    risk_level: 'low' | 'medium' | 'high';
    debt_to_income: string;
    affordability: string;
  };
  red_flags: Array<{
    flag: string;
    severity: 'info' | 'warning' | 'critical';
    details: string;
  }>;
  recommendation: {
    decision: 'approve' | 'review' | 'reject';
    confidence: 'low' | 'medium' | 'high';
    reasoning: string;
    conditions: string[];
  };
  summary: string;
}

export interface Document {
  id: string;
  application_id: string;
  doc_type: DocType;
  original_filename: string;
  is_verified: boolean;
  uploaded_at: string;
  ocr_status: OcrStatus;
  lend_document_type: string | null;
  lend_uploaded: boolean;
}

export const DOCUMENT_REQUEST_STATUSES = ['pending', 'fulfilled'] as const;
export type DocumentRequestStatus = (typeof DOCUMENT_REQUEST_STATUSES)[number];

export interface DocumentRequest {
  id: string;
  application_id: string;
  requested_by_id: string;
  requested_by_name: string | null;
  description: string;
  status: DocumentRequestStatus;
  created_at: string;
  fulfilled_at: string | null;
}

export interface ActivityLog {
  id: string;
  user_id: string;
  user_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  details: string | null;
  created_at: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
}

export const REFERRAL_STATUSES = ['pending', 'signed_up', 'applied'] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export const CLIENT_ENGAGEMENT_MODELS = ['self_managed', 'direct_engagement'] as const;
export type ClientEngagementModel = (typeof CLIENT_ENGAGEMENT_MODELS)[number];

export interface ReferrerInfo {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  organization_name: string | null;
}

export interface ExternalReferrerStats {
  total_referred: number;
  signed_up: number;
  applied: number;
}

export const NOTE_VISIBILITIES = ['broker', 'client', 'referrer', 'personal'] as const;
export type NoteVisibility = (typeof NOTE_VISIBILITIES)[number];

export interface ApplicationNote {
  id: string;
  application_id: string;
  author_id: string;
  author_name: string | null;
  author_role: string | null;
  content: string;
  visibility: NoteVisibility[];
  created_at: string;
}

export interface DirectMessage {
  id: string;
  sender_id: string;
  sender_name: string | null;
  recipient_id: string;
  recipient_name: string | null;
  subject: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

export interface ClientMessage {
  id: string;
  client_id: string;
  author_id: string;
  author_name: string | null;
  author_role: string | null;
  recipient_id: string | null;
  content: string;
  is_read: boolean;
  visibility: string;
  created_at: string;
}

export interface ClientConversation {
  client_id: string;
  client_name: string | null;
  peer_id: string;
  peer_name: string | null;
  last_message: string | null;
  last_message_at: string | null;
  last_message_author_name: string | null;
  message_count: number;
}

export interface ClientAlert {
  id: string;
  client_id: string;
  author_id: string;
  author_name: string | null;
  author_role: string | null;
  content: string;
  created_at: string;
}

export interface Referral {
  id: string;
  referrer_id: string;
  referral_code: string;
  referred_email: string | null;
  referred_user_id: string | null;
  referred_user_name: string | null;
  status: ReferralStatus;
  created_at: string;
  converted_at: string | null;
}

export interface Invitation {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  is_active: boolean;
  auth_method: AuthMethod;
  setup_pending: boolean;
  setup_expired: boolean;
  created_at: string;
  invited_by_name: string | null;
}

export interface ReferralStats {
  total_referred: number;
  signed_up: number;
  applied: number;
}

export interface DashboardStats {
  status_counts: Record<string, number>;
  volume_by_status: Record<string, number>;
  count_by_loan_type: Record<string, number>;
  volume_by_loan_type: Record<string, number>;
  apps_this_week: number;
  apps_last_week: number;
  avg_turnaround_days: number | null;
  monthly_trend: { month: string; count: number }[];
  daily_trend: { date: string; count: number }[];
  action_items: {
    id: string;
    title: string;
    status: string;
    priority: string;
    due_date: string | null;
    application_id: string | null;
  }[];
  top_lenders: { name: string; approvals: number }[];
  top_referrers: { name: string; count: number }[];
}

export interface SearchResultApplication {
  id: string;
  loan_type: LoanType;
  amount: number;
  status: ApplicationStatus;
  user_name: string | null;
  user_email: string | null;
  created_at: string | null;
}

export interface SearchResultUser {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  created_at: string | null;
}

export interface SearchResultDocument {
  id: string;
  application_id: string;
  original_filename: string;
  doc_type: DocType;
  is_verified: boolean;
  uploaded_at: string | null;
  user_name: string | null;
}

export interface GlobalSearchResponse {
  applications: SearchResultApplication[];
  users: SearchResultUser[];
  documents: SearchResultDocument[];
  query: string;
}

export interface BrokerGroupMember {
  id: string;
  full_name: string;
  email: string;
}

export interface BrokerGroup {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  members: BrokerGroupMember[];
}

export const NOTIFICATION_TYPES = ['message', 'alert', 'status_change'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
  link: string;
}

export const LENDER_SUBMISSION_STATUSES = ['pending', 'approved', 'declined', 'conditional', 'withdrawn'] as const;
export type LenderSubmissionStatus = (typeof LENDER_SUBMISSION_STATUSES)[number];

export interface LenderContact {
  id: string;
  name: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
}

export interface Lender {
  id: string;
  name: string;
  notes: string | null;
  is_active: boolean;
  contacts: LenderContact[];
  created_at: string;
  updated_at: string;
}

export interface LenderSubmission {
  id: string;
  application_id: string;
  lender_id: string;
  lender_name: string | null;
  submitted_by_id: string;
  submitted_by_name: string | null;
  status: LenderSubmissionStatus;
  submitted_at: string;
  responded_at: string | null;
  offered_rate: number | null;
  offered_amount: number | null;
  conditions: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface LenderAnalyticsByLender {
  lender_id: string;
  lender_name: string;
  total_submissions: number;
  approved: number;
  declined: number;
  conditional: number;
  pending: number;
  withdrawn: number;
  approval_rate: number;
  avg_turnaround_days: number | null;
}

export interface LenderAnalytics {
  by_lender: LenderAnalyticsByLender[];
  by_loan_type: { loan_type: string; lender_name: string; count: number; approved: number }[];
  monthly_trend: { month: string; submissions: number; approvals: number }[];
  totals: {
    total_submissions: number;
    total_approved: number;
    total_declined: number;
    overall_approval_rate: number;
    avg_turnaround_days: number | null;
  };
}

export interface KanbanColumn {
  id: string;
  board_id: string;
  title: string;
  mapped_status: ApplicationStatus | null;
  position: number;
  color: string | null;
  application_count: number;
}

export interface KanbanBoard {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  created_by_id: string;
  created_by_name: string | null;
  columns: KanbanColumn[];
  created_at: string;
  updated_at: string;
}

export const TASK_STATUSES = ['todo', 'in_progress', 'completed'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface ChecklistItem {
  id: string;
  task_id: string;
  title: string;
  is_completed: boolean;
  sort_order: number;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  application_id: string | null;
  application_label: string | null;
  created_by_id: string;
  created_by_name: string | null;
  checklist_items: ChecklistItem[];
  checklist_progress: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskListItem {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  application_id: string | null;
  application_label: string | null;
  created_by_id: string;
  created_by_name: string | null;
  checklist_total: number;
  checklist_completed: number;
  created_at: string;
  updated_at: string;
}

export const QUOTE_SHEET_STATUSES = ['draft', 'sent'] as const;
export type QuoteSheetStatus = (typeof QUOTE_SHEET_STATUSES)[number];

export interface QuoteOption {
  id: string;
  quote_sheet_id: string;
  sort_order: number;
  is_recommended: boolean;
  lender_name: string;
  lender_product: string | null;
  purchase_price: number | null;
  deposit: number | null;
  loan_amount: number | null;
  loan_term_months: number | null;
  balloon_residual: number | null;
  interest_rate: number | null;
  comparison_rate: number | null;
  client_interest_rate: number | null;
  establishment_fee: number | null;
  monthly_account_fee: number | null;
  application_fee: number | null;
  brokerage: number | null;
  repayment_monthly: number | null;
  repayment_fortnightly: number | null;
  repayment_weekly: number | null;
  total_repayments: number | null;
  total_interest: number | null;
  total_fees: number | null;
  features: string | null;
  notes: string | null;
  created_at: string;
}

export const FACILITY_TYPES = ['chattel', 'hp', 'lease'] as const;
export type FacilityType = (typeof FACILITY_TYPES)[number];

export const PAYMENT_TYPES = ['advance', 'arrears'] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export interface QuoteInputParameters {
  facility_type: FacilityType;         // Chattel Mortgage / Hire Purchase / Lease
  payment_type: PaymentType;           // Advance (beginning) / Arrears (end of period)
  asset_price: number;
  asset_description: string;           // e.g. "Motor Vehicle", "Industrial Equipment", "Land"
  deposit_percent: number;
  deposit_amount: number | null;       // Dollar override — if set, takes priority over %
  establishment_fee: number;
  ppsr_fee: number;
  origination_fee: number;
  brokerage_percent: number;
  brokerage_amount: number | null;     // Dollar override — if set, takes priority over %
  gst_on_brokerage: boolean;
  balloon_on_total_price: boolean;
  interest_rate: number;
  gst_percent: number;
  balloon_percentages: Record<string, number>; // e.g. { "2": 62, "3": 55, "4": 42, "5": 35, "7": 0 }
  balloon_amounts: Record<string, number | null>; // Dollar overrides per term
  monthly_account_fee: number;         // Ongoing monthly fee added to repayment
  non_taxable_charges: number;         // Lease only — non-taxable on-road charges
  luxury_car_tax: number;              // Lease only — luxury car tax
  fees_financed: boolean;              // true = fees added to loan amount, false = charged separately
  selected_terms?: number[];           // e.g. [5, 4, 3] — which terms to show client
  show_interest_rate?: boolean;        // show interest rate to client (default: hidden)
  repayment_range?: number;            // show client a ±$ range instead of exact repayment
}

export interface QuoteSheet {
  id: string;
  application_id: string | null;
  version: number;
  title: string | null;
  status: QuoteSheetStatus;
  created_by_id: string;
  created_by_name: string | null;
  broker_notes: string | null;
  input_parameters: string | null;
  recipient_name: string | null;
  recipient_email: string | null;
  sent_at: string | null;
  options: QuoteOption[];
  created_at: string;
  updated_at: string;
}

// Contacts & Organizations
export interface ContactOrganization {
  id: string;
  name: string;
  abn: string | null;
  industry: string | null;
  address: string | null;
  notes: string | null;
  role: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactApplication {
  id: string;
  loan_type: LoanType;
  amount: number;
  status: ApplicationStatus;
  business_name: string | null;
  business_abn: string | null;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  middle_name: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  drivers_license_number: string | null;
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  notes: string | null;
  application_count: number;
  created_at: string;
  updated_at: string;
}

export interface ContactDetail extends Contact {
  organizations: ContactOrganization[];
  applications: ContactApplication[];
}

export interface KanbanBoardListItem {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  column_count: number;
  created_at: string;
  updated_at: string;
}

export interface ServiceRequest {
  id: string;
  request_type: string;
  custom_request: string | null;
  description: string | null;
  status: ServiceRequestStatus;
  client_id: string;
  client_name: string | null;
  client_email: string | null;
  assigned_broker_id: string | null;
  assigned_broker_name: string | null;
  broker_notes: string | null;
  created_at: string;
  updated_at: string;
}
