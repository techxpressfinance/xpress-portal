export type UserRole = 'client' | 'broker' | 'admin';
export type AuthMethod = 'password' | 'code';
export type KYCStatus = 'pending' | 'verified' | 'rejected';
export type LoanType = 'personal' | 'home' | 'business' | 'vehicle';
export type ApplicationStatus = 'draft' | 'submitted' | 'reviewing' | 'approved' | 'rejected';
export type DocType = 'id_proof' | 'address_proof' | 'bank_statement' | 'payslip' | 'tax_return' | 'other';
export type OcrStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type AnalysisStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type LendSyncStatus = 'pending' | 'synced' | 'failed';

export interface User {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  kyc_status: KYCStatus;
  is_active: boolean;
  email_verified: boolean;
  auth_method: AuthMethod;
  employee_id: string | null;
  department: string | null;
  license_number: string | null;
  created_at: string;
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

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export type ReferralStatus = 'pending' | 'signed_up' | 'applied';

export interface ApplicationNote {
  id: string;
  application_id: string;
  author_id: string;
  author_name: string | null;
  content: string;
  is_internal: boolean;
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

export interface ApplicationNoteMessage {
  id: string;
  application_id: string;
  loan_type: string;
  author_id: string;
  author_name: string | null;
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
  created_at: string;
  invited_by_name: string | null;
}

export interface ReferralStats {
  total_referred: number;
  signed_up: number;
  applied: number;
}
