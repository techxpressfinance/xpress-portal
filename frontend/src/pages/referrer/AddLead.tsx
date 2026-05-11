import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { getErrorMessage } from '../../lib/utils';
import {
  DOC_TYPE_LABELS, AU_STATES, TITLE_OPTIONS, GENDER_OPTIONS, MARITAL_STATUS_OPTIONS,
  CONSUMER_LOAN_TYPES, COMMERCIAL_LOAN_TYPES, VEHICLE_MAKES, PROPERTY_TYPES,
  EQUIPMENT_TYPES, LOAN_TERM_OPTIONS, VEHICLE_CONDITION_OPTIONS
} from '../../lib/constants';
import { GlassCard, PageHeader, Button, Input } from '../../components/ui';
import type { DocType } from '../../types';

// ── Style constants ───────────────────────────────────────────────────────────

const SELECT_CLS = 'w-full rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground h-10 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none';
const TEXTAREA_CLS = 'w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background placeholder:text-muted-foreground border border-transparent resize-none';
const LABEL_CLS = 'block text-[13px] font-medium text-muted-foreground mb-2';

// ── Config data ──────────────────────────────────────────────────────────────

interface Industry {
  id: number;
  label: string;
  children: { id: number; label: string }[];
}

const INDUSTRIES: Industry[] = [
  { id: 52, label: 'Arts & Lifestyle', children: [{ id: 53, label: 'Health & Fitness Centres, Gyms' }, { id: 54, label: 'Movie, Film & Video Services' }, { id: 55, label: 'Parks & Gardens' }, { id: 56, label: 'Photographic Services' }, { id: 57, label: 'Radio & TV Services' }, { id: 58, label: 'Religious Organisations' }, { id: 59, label: 'Services to the Arts' }, { id: 60, label: 'Sports & Physical Recreation' }, { id: 61, label: 'Other' }, { id: 195, label: 'Events' }] },
  { id: 62, label: 'Construction & Trades', children: [{ id: 63, label: 'Air Con, Heating, Solar Services' }, { id: 64, label: 'Bricklaying' }, { id: 65, label: 'Building Construction' }, { id: 66, label: 'Carpentry' }, { id: 67, label: 'Concreting, Paving' }, { id: 68, label: 'Electrical, Lighting' }, { id: 69, label: 'Fire & Security Alarm Services' }, { id: 70, label: 'Gardening' }, { id: 71, label: 'Glazing' }, { id: 72, label: 'Household Equipment Repair' }, { id: 73, label: 'Landscaping' }, { id: 74, label: 'Mechanic, Technician' }, { id: 75, label: 'Motor Vehicle Related Services' }, { id: 76, label: 'Painting & Decorating' }, { id: 77, label: 'Plastering' }, { id: 78, label: 'Plumbing' }, { id: 79, label: 'Property Maintenance, Handyman' }, { id: 80, label: 'Roofing' }, { id: 81, label: 'Steel Fabrication, Welding' }, { id: 82, label: 'Tiling, Carpentry, Floors' }, { id: 83, label: 'Other' }, { id: 205, label: 'Traffic Management' }] },
  { id: 84, label: 'Financial Services & Insurance', children: [{ id: 85, label: 'Accounting, Tax, Bookkeeping Services' }, { id: 86, label: 'Asset Finance' }, { id: 87, label: 'Credit Union Operation' }, { id: 88, label: 'Health Insurance' }, { id: 89, label: 'Life Insurance, Superannuation' }, { id: 90, label: 'Other' }, { id: 197, label: 'Banking' }, { id: 201, label: 'Wealth Management' }] },
  { id: 91, label: 'Hair & Beauty', children: [{ id: 92, label: 'Cosmetics Supplies' }, { id: 93, label: 'Day Spas, Health Retreats' }, { id: 94, label: 'Hair, Beauty Salons' }, { id: 95, label: 'Other' }] },
  { id: 96, label: 'Health', children: [{ id: 97, label: 'Chiropractic, Osteopathic Services' }, { id: 98, label: 'Dental Services' }, { id: 99, label: 'General Practice Medical Services' }, { id: 100, label: 'Health Foods, Nutrition, Supplements' }, { id: 101, label: 'Optometry Services' }, { id: 102, label: 'Pathology & Imaging Services' }, { id: 103, label: 'Physiotherapy Services' }, { id: 104, label: 'Specialist Medical Services' }, { id: 105, label: 'Other' }] },
  { id: 106, label: 'Hospitality', children: [{ id: 107, label: 'Accommodation' }, { id: 108, label: 'Cafes' }, { id: 109, label: 'Catering Services' }, { id: 110, label: 'Clubs' }, { id: 111, label: 'Pubs, Bars, Taverns' }, { id: 112, label: 'Restaurants' }, { id: 113, label: 'Takeaway Food' }, { id: 114, label: 'Other' }] },
  { id: 115, label: 'Manufacturing', children: [{ id: 116, label: 'Beverage Manufacturing' }, { id: 117, label: 'Clothing, Footwear, Textile Manufacturing' }, { id: 118, label: 'Food Manufacturing' }, { id: 119, label: 'Furniture Manufacturing' }, { id: 120, label: 'Glass, Ceramic, Cement Manufacturing' }, { id: 121, label: 'Machinery & Equipment Manufacturing' }, { id: 122, label: 'Metal Product Manufacturing' }, { id: 123, label: 'Paper Product Manufacturing' }, { id: 124, label: 'Printing, Publishing, Media Manufacturing' }, { id: 125, label: 'Wood Product Manufacturing' }, { id: 126, label: 'Other' }] },
  { id: 127, label: 'Primary Industries', children: [{ id: 128, label: 'Agriculture' }, { id: 129, label: 'Commercial Fishing' }, { id: 130, label: 'Forestry & Logging' }, { id: 131, label: 'Mining' }, { id: 192, label: 'Other' }, { id: 193, label: 'Oil & Gas' }] },
  { id: 132, label: 'Professional Services', children: [{ id: 133, label: 'Architectural Services' }, { id: 134, label: 'Child Care Services' }, { id: 135, label: 'Cleaning Services' }, { id: 136, label: 'Education Services' }, { id: 137, label: 'Engineering Services' }, { id: 138, label: 'IT Services' }, { id: 139, label: 'Legal Services' }, { id: 140, label: 'Marketing Services' }, { id: 141, label: 'Pest Control Services' }, { id: 142, label: 'Property Developers' }, { id: 143, label: 'Real Estate Services' }, { id: 144, label: 'Recruitment Services' }, { id: 145, label: 'Rental, Hiring Services' }, { id: 146, label: 'Storage Services' }, { id: 147, label: 'Travel Agent, Tour Services' }, { id: 148, label: 'Veterinary Services' }, { id: 149, label: 'Other' }, { id: 196, label: 'Administrative & Support Services' }, { id: 203, label: 'Labour Hire' }, { id: 204, label: 'Security Services' }] },
  { id: 150, label: 'Retail', children: [{ id: 151, label: 'Antique & Used Goods' }, { id: 152, label: 'Clothing, Footwear' }, { id: 153, label: 'Department Stores' }, { id: 154, label: 'Flower Retailing' }, { id: 155, label: 'Furniture Retailing' }, { id: 156, label: 'Garden Supplies' }, { id: 157, label: 'Hardware & Building Supplies' }, { id: 158, label: 'Homeware Retailing' }, { id: 159, label: 'Liquor Retailing' }, { id: 160, label: 'Marine Retailing' }, { id: 161, label: 'Motor Vehicle Retailing' }, { id: 162, label: 'Newsagency, Book Retailing' }, { id: 163, label: 'Personal Services' }, { id: 164, label: 'Pharmaceutical Goods' }, { id: 165, label: 'Sport & Camping Equipment' }, { id: 166, label: 'Stationery Goods' }, { id: 167, label: 'Supermarket, Grocery & Food Retailing' }, { id: 168, label: 'Tools & Equipment Retailing' }, { id: 169, label: 'Toy & Game Retailing' }, { id: 170, label: 'Watch & Jewellery Retailing' }, { id: 171, label: 'Other' }, { id: 190, label: 'Electronics & Electrical Retailing' }, { id: 191, label: 'Online Retailing' }] },
  { id: 172, label: 'Transport', children: [{ id: 173, label: 'Freight, Courier, Pick-up Services' }, { id: 174, label: 'Taxi, Uber Services' }, { id: 175, label: 'Rail Transport' }, { id: 176, label: 'Road Transport' }, { id: 177, label: 'Water Transport' }, { id: 178, label: 'Other' }] },
  { id: 179, label: 'Wholesale Trade', children: [{ id: 180, label: 'Builders Supplies Wholesaling' }, { id: 181, label: 'Farm Produce Wholesaling' }, { id: 182, label: 'Food & Drink Wholesaling' }, { id: 183, label: 'Household Good Wholesaling' }, { id: 184, label: 'Machinery & Equipment Wholesaling' }, { id: 185, label: 'Mineral, Metal & Chemical Wholesaling' }, { id: 186, label: 'Motor Vehicle Wholesaling' }, { id: 187, label: 'Clothing, Footwear, Textile Wholesaling' }, { id: 188, label: 'Other' }] },
  { id: 189, label: 'Other', children: [] },
  { id: 194, label: 'Utilities', children: [{ id: 202, label: 'Other' }] },
  { id: 198, label: 'Government', children: [{ id: 199, label: 'Defence' }, { id: 200, label: 'Public administration & Safety' }] },
];

const CONSUMER_PURPOSES = [
  { id: 42, label: 'Purchase' }, { id: 41, label: 'Refinance' }, { id: 20, label: 'Car' },
  { id: 21, label: 'Motorcycle' }, { id: 22, label: 'Caravan' }, { id: 23, label: 'Other Vehicle' },
  { id: 24, label: 'Personal Loan' },
];

const COMMERCIAL_PURPOSES = [
  { id: 1, label: 'Day-to-day Capital' }, { id: 3, label: 'Vehicles or Transport' },
  { id: 14, label: 'Machinery or Equipment' }, { id: 13, label: 'New Fit-out' },
  { id: 19, label: 'Staff Recruitment Costs' }, { id: 11, label: 'Expansion' },
  { id: 4, label: 'Renovation' }, { id: 15, label: 'Pay Domestic or International Suppliers' },
  { id: 18, label: 'Waiting for Invoices to be Paid' }, { id: 16, label: 'Property' },
  { id: 17, label: 'Development & Construction' }, { id: 9, label: 'Start a New Business' },
  { id: 10, label: 'Purchase Existing Business' }, { id: 8, label: 'Other' },
];

const LEND_LOAN_TYPES = [
  { value: 'equipment_finance', label: 'Equipment Finance', description: 'Finance equipment, machinery and vehicles', icon: '🏗️' },
  { value: 'business_loan', label: 'Business Loan', description: 'Working capital, growth or refinancing', icon: '💼' },
  { value: 'commercial_property', label: 'Commercial Property', description: 'Purchase or refinance commercial real estate', icon: '🏢' },
  { value: 'home_loan', label: 'Home Loan', description: 'Purchase or refinance residential property', icon: '🏠' },
];

// ── Interfaces ────────────────────────────────────────────────────────────────

interface FormData {
  applicant_title: string;
  applicant_first_name: string;
  applicant_middle_name: string;
  applicant_last_name: string;
  applicant_dob: string;
  applicant_gender: string;
  applicant_marital_status: string;
  applicant_email: string;
  applicant_mobile: string;
  preferred_contact_method: string;
  id_type: string;
  id_number: string;
  id_issuing_state_country: string;
  id_expiry_date: string;
  residency_status: string;
  amount: string;
  notes: string;
  residential_status: string;
  applicant_address: string;
  applicant_suburb: string;
  applicant_state: string;
  applicant_postcode: string;
  time_at_address: string;
  has_partner: string;
  partner_working: string;
  num_dependants: string;
  employment_category: string;
  employer_name: string;
  employer_industry: string;
  job_title: string;
  employment_type_detail: string;
  employment_start_date: string;
  income_frequency: string;
  gross_income: string;
  employer_contact_details: string;
  business_abn: string;
  business_name: string;
  trading_name: string;
  business_structure: string;
  business_industry: string;
  time_trading: string;
  gst_registered: string;
  num_directors: string;
  other_directors: string;
  primary_income_type: string;
  primary_income_amount: string;
  primary_income_frequency: string;
  monthly_living_expenses: string;
  rent_mortgage_payments: string;
  child_support: string;
  other_commitments: string;
  previously_declined: string;
  change_of_circumstances: string;
  emergency_contact_name: string;
  emergency_contact_relationship: string;
  emergency_contact_phone: string;
  signature_name: string;
  // Loan type — Equipment Finance
  eq_asset_type: string;
  eq_new_or_used: string;
  eq_asset_price: string;
  eq_deposit_amount: string;
  eq_vendor_type: string;
  eq_estimated_repayment: string;
  eq_loan_term: string;
  eq_business_use_pct: string;
  // Loan type — Business Loan
  bl_loan_purpose: string;
  bl_loan_amount: string;
  bl_loan_term: string;
  bl_purpose_type: string;
  // Loan type — Commercial Property
  cp_purchase_or_refinance: string;
  cp_security_address: string;
  cp_estimated_value: string;
  cp_existing_debt: string;
  // Loan type — Home Loan
  hl_purchase_or_refinance: string;
  hl_owner_or_investment: string;
  hl_property_value: string;
  hl_existing_lender: string;
  // Comprehensive Consumer Loan Fields
  // Vehicle fields
  vehicle_make: string;
  vehicle_model: string;
  vehicle_year: string;
  vehicle_vin: string;
  vehicle_price: string;
  vehicle_type: string;
  vehicle_condition: string;
  deposit_amount: string;
  loan_term: string;
  // Property fields
  property_address: string;
  property_type: string;
  property_value: string;
  first_home_buyer: string;
  current_lender: string;
  current_balance: string;
  refinance_reason: string;
  // Personal loan fields
  loan_purpose: string;
  // Comprehensive Commercial Loan Fields
  business_purpose: string;
  equipment_type: string;
  equipment_description: string;
  vendor_type: string;
  fit_out_description: string;
  estimated_cost: string;
  recruitment_details: string;
  expansion_description: string;
  renovation_description: string;
  supplier_details: string;
  invoice_amount: string;
  outstanding_invoices: string;
  project_description: string;
  development_experience: string;
  business_plan: string;
  startup_costs: string;
  business_details: string;
  purchase_price: string;
  business_type: string;
  purpose_description: string;
  property_use: string;
}

interface AdditionalIncome { income_type: string; amount: string; frequency: string; }
interface RealEstateAsset { property_type: string; address: string; estimated_value: string; ownership_type: string; is_financed: string; lender: string; amount_owing: string; monthly_repayment: string; rental_income: string; }
interface OtherAsset { asset_type: string; value: string; }
interface Liability { liability_type: string; lender: string; balance: string; limit: string; monthly_repayment: string; }
interface UploadedDoc { id: string; filename: string; doc_type: string; label?: string; }

const blankIncome = (): AdditionalIncome => ({ income_type: 'Rental Income', amount: '', frequency: 'Monthly' });
const blankRealEstate = (): RealEstateAsset => ({ property_type: 'Home', address: '', estimated_value: '', ownership_type: 'Sole', is_financed: 'no', lender: '', amount_owing: '', monthly_repayment: '', rental_income: '' });
const blankOtherAsset = (): OtherAsset => ({ asset_type: 'Vehicles', value: '' });
const blankLiability = (): Liability => ({ liability_type: 'Home Loans', lender: '', balance: '', limit: '', monthly_repayment: '' });

// New step layout: pre-screen (engagement) → steps 1-6 (consumer) / 1-4 displayed (commercial)
// Internal steps: consumer=1-6, commercial=1,2,5,6
const CONSUMER_STEPS = 6;
const COMMERCIAL_STEPS = 4;
const maxInternalStep = 6;
const CONSUMER_LABELS = ['Client & Loan Details', 'Identification', 'Living & Employment', 'Financial Position', 'Declarations', 'Review'];
const COMMERCIAL_LABELS = ['Client & Loan Details', 'Identification', 'Declarations', 'Review'];

// ── Component ─────────────────────────────────────────────────────────────────

interface AddLeadProps {
  basePath?: string;
  title?: string;
  submitLabel?: string;
  skipEngagement?: boolean;
}

export default function AddLead({ basePath = '/referrer/applications', title = 'Add Lead', submitLabel = 'Submit Lead', skipEngagement = false }: AddLeadProps = {}) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const pendingFileInput = useRef<HTMLInputElement>(null);

  // Pre-screen engagement state
  const [showEngagementScreen, setShowEngagementScreen] = useState(!skipEngagement);
  const [engagementModel, setEngagementModel] = useState<'self_managed' | 'direct_engagement' | ''>('');
  const [engagementError, setEngagementError] = useState('');
  const [draftCreating, setDraftCreating] = useState(false);
  const [preFirstName, setPreFirstName] = useState('');
  const [preLastName, setPreLastName] = useState('');
  const [preEmail, setPreEmail] = useState('');
  const [preMobile, setPreMobile] = useState('');

  // Client picker pre-screen (broker mode only)
  const [showClientPicker, setShowClientPicker] = useState(skipEngagement);
  const [clientSearch, setClientSearch] = useState('');
  const [clients, setClients] = useState<{ id: string; full_name: string; email: string; phone?: string; role: string }[]>([]);
  const [clientPickerLoading, setClientPickerLoading] = useState(false);
  const [selectedClient, setSelectedClient] = useState<{ id: string; full_name: string; email: string; phone?: string } | null>(null);
  const [clientPickerMode, setClientPickerMode] = useState<'existing' | 'none'>('existing');

  // Draft tracking
  const [draftAppId, setDraftAppId] = useState<string | null>(null);
  const [createdAppId, setCreatedAppId] = useState<string | null>(null);

  // Send-to-client modal
  const [showSendModal, setShowSendModal] = useState(false);
  const [clientEmail, setClientEmail] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);

  // Form steps
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  // Loan type tab
  const [tab, setTab] = useState<'consumer' | 'commercial'>('consumer');
  const [purposeId, setPurposeId] = useState<number | ''>('');
  const [commercialPurposeId, setCommercialPurposeId] = useState<number | ''>('');
  const [comBusinessName, setComBusinessName] = useState('');
  const [comAbn, setComAbn] = useState('');
  const [parentIndustryId, setParentIndustryId] = useState<number | ''>('');
  const [subIndustryId, setSubIndustryId] = useState<number | ''>('');
  const [comPostcode, setComPostcode] = useState('');
  const [comMonthlySales, setComMonthlySales] = useState('');

  // LEND
  const [lendEnabled, setLendEnabled] = useState(false);
  const [selectedLoanTypes, setSelectedLoanTypes] = useState<string[]>([]);
  const [loanTypeError, setLoanTypeError] = useState('');

  // Selected loan sub-types for comprehensive fields
  const [selectedConsumerLoanType, setSelectedConsumerLoanType] = useState<string>('');
  const [selectedCommercialLoanType, setSelectedCommercialLoanType] = useState<string>('');

  const selectedParent = INDUSTRIES.find(i => i.id === parentIndustryId);
  const subChildren = selectedParent?.children ?? [];
  const resolvedIndustryId = (): number | undefined => {
    if (subIndustryId) return subIndustryId as number;
    if (parentIndustryId) return parentIndustryId as number;
    return undefined;
  };

  const handleTabChange = (newTab: 'consumer' | 'commercial') => {
    setTab(newTab);
    setPurposeId('');
    setCommercialPurposeId('');
    setComBusinessName('');
    setComAbn('');
    setParentIndustryId('');
    setSubIndustryId('');
    setComPostcode('');
    setComMonthlySales('');
    if (newTab === 'commercial' && (step === 3 || step === 4)) {
      setStep(2);
    }
  };

  // Dynamic lists
  const [additionalIncomes, setAdditionalIncomes] = useState<AdditionalIncome[]>([]);
  const [realEstateAssets, setRealEstateAssets] = useState<RealEstateAsset[]>([]);
  const [otherAssets, setOtherAssets] = useState<OtherAsset[]>([]);
  const [liabilities, setLiabilities] = useState<Liability[]>([]);

  // Document state — uploads immediately to the draft
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([]);
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const [stagedDocType, setStagedDocType] = useState<DocType>('other');
  const [stagedLabel, setStagedLabel] = useState('');
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const { register, handleSubmit, watch, trigger, setValue, formState: { errors } } = useForm<FormData>({
    defaultValues: {
      applicant_title: 'Mr',
      applicant_gender: 'Male',
      applicant_marital_status: 'Single',
      applicant_state: 'NSW',
      id_type: 'license',
      id_issuing_state_country: 'NSW',
      residency_status: 'Australian Citizen',
      num_dependants: '0',
      has_partner: 'no',
      partner_working: 'no',
      residential_status: 'Renting',
      employment_category: 'employed',
      employment_type_detail: 'Full Time',
      income_frequency: 'Monthly',
      primary_income_type: 'Salary',
      primary_income_frequency: 'Monthly',
      gst_registered: 'no',
      num_directors: '1',
      previously_declined: 'no',
      change_of_circumstances: 'no',
      preferred_contact_method: 'Mobile',
      eq_asset_type: 'Truck',
      eq_new_or_used: 'New',
      eq_vendor_type: 'Dealer',
      cp_purchase_or_refinance: 'Purchase',
      hl_purchase_or_refinance: 'Purchase',
      hl_owner_or_investment: 'Owner Occupied',
      bl_purpose_type: 'Working Capital',
      // Comprehensive loan defaults
      vehicle_condition: 'New',
      loan_term: '5 years',
      first_home_buyer: 'no',
      vendor_type: 'Dealer',
      vehicle_type: 'Car',
      equipment_type: 'Truck',
    },
  });

  const idType = watch('id_type');
  const residencyStatus = watch('residency_status');
  const employmentCategory = watch('employment_category');
  const hasPartner = watch('has_partner');
  const cpPurchaseOrRefinance = watch('cp_purchase_or_refinance');
  const hlPurchaseOrRefinance = watch('hl_purchase_or_refinance');

  useEffect(() => {
    api.get('/lend/config').then(({ data }) => setLendEnabled(data.enabled)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!skipEngagement) return;
    api.get('/users')
      .then(({ data }) => setClients((data.items ?? data).filter((u: { role: string }) => u.role === 'client')))
      .catch(() => {});
  }, [skipEngagement]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalSteps = lendEnabled ? CONSUMER_STEPS : (tab === 'commercial' ? COMMERCIAL_STEPS : CONSUMER_STEPS);
  const stepLabels = lendEnabled ? CONSUMER_LABELS : (tab === 'commercial' ? COMMERCIAL_LABELS : CONSUMER_LABELS);

  const toUiStep = (internal: number) => {
    if (!lendEnabled && tab === 'commercial' && internal >= 5) return internal - 2;
    return internal;
  };

  const toggleLoanType = (type: string) => {
    setSelectedLoanTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
    setLoanTypeError('');
  };

  // ── Engagement pre-screen ──

  const handleEngagementContinue = async () => {
    if (!engagementModel) { setEngagementError('Please select an option to continue'); return; }
    if (!preFirstName.trim() || !preLastName.trim()) { toast('Please enter the client\'s first and last name', 'error'); return; }
    if (!preEmail.trim()) { toast('Please enter the client\'s email address', 'error'); return; }
    setDraftCreating(true);
    try {
      const { data: appData } = await api.post('/applications', {
        loan_type: 'personal',
        amount: 0,
        client_engagement_model: engagementModel,
        applicant_first_name: preFirstName.trim(),
        applicant_last_name: preLastName.trim(),
        applicant_email: preEmail.trim(),
        applicant_mobile: preMobile.trim() || null,
      });
      setDraftAppId(appData.id);
      setValue('applicant_first_name', preFirstName.trim());
      setValue('applicant_last_name', preLastName.trim());
      setValue('applicant_email', preEmail.trim());
      if (preMobile.trim()) setValue('applicant_mobile', preMobile.trim());
      setShowEngagementScreen(false);
      setStep(1);
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to create lead'), 'error');
    } finally {
      setDraftCreating(false);
    }
  };

  // ── Client picker (broker mode) ──

  const handleClientPickerContinue = async () => {
    setClientPickerLoading(true);
    try {
      const { data } = await api.post('/applications', { loan_type: 'personal', amount: 0 });
      setDraftAppId(data.id);
      if (clientPickerMode === 'existing' && selectedClient) {
        const nameParts = selectedClient.full_name.trim().split(/\s+/);
        const first = nameParts[0] ?? '';
        const last = nameParts.slice(1).join(' ') || first;
        setValue('applicant_first_name', first);
        setValue('applicant_last_name', last);
        setValue('applicant_email', selectedClient.email);
        if (selectedClient.phone) setValue('applicant_mobile', selectedClient.phone);
      }
      setShowClientPicker(false);
      setStep(1);
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to initialise application'), 'error');
    } finally {
      setClientPickerLoading(false);
    }
  };

  // ── Step navigation ──

  const goNext = async () => {
    if (step === 1) {
      if (lendEnabled) {
        const ok = await trigger(['applicant_first_name', 'applicant_last_name', 'applicant_email', 'applicant_mobile']);
        if (!ok) return;
        if (selectedLoanTypes.length === 0) { setLoanTypeError('Please select at least one loan type'); return; }
        setLoanTypeError('');
      } else {
        const ok = await trigger(['applicant_first_name', 'applicant_last_name', 'applicant_email', 'applicant_mobile', 'amount']);
        if (!ok) return;
      }
    }
    const next = lendEnabled ? step + 1 : step + (tab === 'commercial' && step === 2 ? 3 : 1);
    setStep(Math.min(next, maxInternalStep));
  };

  const goBack = () => {
    if (step === 1) return;
    const prev = lendEnabled ? step - 1 : step - (tab === 'commercial' && step === 5 ? 3 : 1);
    setStep(Math.max(prev, 1));
  };

  // ── Document handling (immediate upload) ──

  const stageFile = (file: File) => {
    if (file.size > 10 * 1024 * 1024) { toast('File size exceeds 10MB limit', 'error'); return; }
    setStagedFile(file);
    setStagedDocType('other');
    setStagedLabel('');
    if (pendingFileInput.current) pendingFileInput.current.value = '';
  };

  const handlePickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) stageFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) stageFile(file);
  };

  const handleConfirmStaged = async () => {
    if (!stagedFile || !draftAppId) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', stagedFile);
      const params = new URLSearchParams({ doc_type: stagedDocType });
      if (stagedLabel.trim()) params.set('label', stagedLabel.trim());
      const { data: docData } = await api.post(`/documents/upload/${draftAppId}?${params}`, fd);
      setUploadedDocs(prev => [...prev, { id: docData.id, filename: docData.original_filename || docData.filename || stagedFile.name, doc_type: stagedDocType, label: stagedLabel.trim() || undefined }]);
      setStagedFile(null);
      setStagedLabel('');
      toast('Document uploaded', 'success');
    } catch {
      toast('Failed to upload document', 'error');
    } finally {
      setUploading(false);
    }
  };

  // ── Send-to-client invite ──

  const handleConfirmSendToClient = async () => {
    if (!draftAppId || !clientEmail.trim()) return;
    setSendingInvite(true);
    try {
      await api.post(`/applications/${draftAppId}/client-invite`, {
        email: clientEmail.trim(),
        portal_url: window.location.origin,
      });
      toast('Invite sent to client successfully', 'success');
      setShowSendModal(false);
      navigate(basePath);
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to send invite'), 'error');
    } finally {
      setSendingInvite(false);
    }
  };

  // ── Submit ──

  const onSubmit = async (data: FormData) => {
    if (!draftAppId) return;
    setSubmitting(true);
    try {
      const extraData: Record<string, unknown> = {};

      if (data.id_number) {
        extraData.identification = [{
          type: data.id_type === 'license' ? 'Drivers Licence' : 'Passport',
          number: data.id_number,
          [data.id_type === 'license' ? 'state' : 'country']: data.id_issuing_state_country,
          expiry_date: data.id_expiry_date,
        }];
      }

      extraData.employments = [{
        employer_name: data.employer_name,
        employment_type: data.employment_type_detail,
        start_date: data.employment_start_date,
        industry: data.employer_industry || data.business_industry,
        job_title: data.job_title,
        contact_details: data.employer_contact_details,
      }];

      const primaryIncome = { income_type: data.primary_income_type, amount: parseFloat(data.primary_income_amount) || 0, frequency: data.primary_income_frequency };
      extraData.incomes = [primaryIncome, ...additionalIncomes.map(ai => ({ income_type: ai.income_type, amount: parseFloat(ai.amount) || 0, frequency: ai.frequency }))].filter((i: { amount: number }) => i.amount > 0);
      extraData.additional_incomes = additionalIncomes;

      extraData.assets = { real_estate: realEstateAssets, other: otherAssets };
      extraData.liabilities = liabilities;
      extraData.expenses = {
        monthly_living: parseFloat(data.monthly_living_expenses) || 0,
        rent_mortgage: parseFloat(data.rent_mortgage_payments) || 0,
        child_support: parseFloat(data.child_support) || 0,
        other_commitments: parseFloat(data.other_commitments) || 0,
      };

      extraData.residency_status = data.residency_status;
      extraData.living_status = data.residential_status;
      extraData.dependants = parseInt(data.num_dependants) || 0;
      extraData.credit_history = data.previously_declined === 'yes' ? 'Previously Declined' : 'Clear';
      if (data.other_directors) extraData.other_directors = data.other_directors;
      extraData.applicant_email = data.applicant_email;

      if (lendEnabled) {
        extraData.selected_loan_types = selectedLoanTypes;
        const loanTypeDetails: Record<string, unknown> = {};
        if (selectedLoanTypes.includes('equipment_finance')) {
          loanTypeDetails.equipment_finance = {
            asset_type: data.eq_asset_type, new_or_used: data.eq_new_or_used,
            asset_price: parseFloat(data.eq_asset_price) || 0, deposit_amount: parseFloat(data.eq_deposit_amount) || 0,
            vendor_type: data.eq_vendor_type, estimated_repayment: parseFloat(data.eq_estimated_repayment) || 0,
            loan_term: data.eq_loan_term, business_use_pct: parseFloat(data.eq_business_use_pct) || 0,
          };
        }
        if (selectedLoanTypes.includes('business_loan')) {
          loanTypeDetails.business_loan = {
            loan_purpose: data.bl_loan_purpose, loan_amount: parseFloat(data.bl_loan_amount) || 0,
            loan_term: data.bl_loan_term, purpose_type: data.bl_purpose_type,
          };
        }
        if (selectedLoanTypes.includes('commercial_property')) {
          loanTypeDetails.commercial_property = {
            purchase_or_refinance: data.cp_purchase_or_refinance, security_address: data.cp_security_address,
            estimated_value: parseFloat(data.cp_estimated_value) || 0, existing_debt: parseFloat(data.cp_existing_debt) || 0,
          };
        }
        if (selectedLoanTypes.includes('home_loan')) {
          loanTypeDetails.home_loan = {
            purchase_or_refinance: data.hl_purchase_or_refinance, owner_or_investment: data.hl_owner_or_investment,
            property_value: parseFloat(data.hl_property_value) || 0, existing_lender: data.hl_existing_lender || null,
          };
        }
        extraData.loan_type_details = loanTypeDetails;
      } else if (tab === 'consumer') {
        const loanTypeDetails: Record<string, unknown> = {};
        // Add comprehensive consumer loan type data
        if (selectedConsumerLoanType) {
          const consumerType = CONSUMER_LOAN_TYPES.find(t => t.value === selectedConsumerLoanType);
          loanTypeDetails.consumer_loan_type = {
            type: selectedConsumerLoanType,
            label: consumerType?.label,
          };

          // Vehicle loan fields
          if (['car', 'motorcycle', 'caravan', 'other_vehicle'].includes(selectedConsumerLoanType)) {
            loanTypeDetails.vehicle_details = {
              type: data.vehicle_type,
              make: data.vehicle_make,
              model: data.vehicle_model,
              year: data.vehicle_year,
              vin: data.vehicle_vin,
              condition: data.vehicle_condition,
              price: parseFloat(data.vehicle_price) || 0,
              deposit: parseFloat(data.deposit_amount) || 0,
            };
          }

          // Personal loan fields
          if (selectedConsumerLoanType === 'personal') {
            loanTypeDetails.personal_loan = {
              purpose: data.loan_purpose,
              amount: parseFloat(data.amount) || 0,
              term: data.loan_term,
            };
          }

          // Property loan fields (purchase/refinance)
          if (['purchase', 'refinance'].includes(selectedConsumerLoanType)) {
            loanTypeDetails.property_details = {
              address: data.property_address,
              property_type: data.property_type,
              value: parseFloat(data.property_value) || 0,
              deposit: selectedConsumerLoanType === 'purchase' ? parseFloat(data.deposit_amount) || 0 : undefined,
              first_home_buyer: data.first_home_buyer === 'yes',
              current_lender: selectedConsumerLoanType === 'refinance' ? data.current_lender : undefined,
              current_balance: selectedConsumerLoanType === 'refinance' ? parseFloat(data.current_balance) || 0 : undefined,
              refinance_reason: selectedConsumerLoanType === 'refinance' ? data.refinance_reason : undefined,
              term: data.loan_term,
            };
          }
        }
        extraData.loan_type_details = loanTypeDetails;
      } else {
        const loanTypeDetails: Record<string, unknown> = {};
        // Add comprehensive commercial loan type data
        if (selectedCommercialLoanType) {
          const commercialType = COMMERCIAL_LOAN_TYPES.find(t => t.value === selectedCommercialLoanType);
          loanTypeDetails.commercial_loan_type = {
            type: selectedCommercialLoanType,
            label: commercialType?.label,
          };

          // Vehicle/Equipment fields
          if (['vehicles_or_transport', 'machinery_or_equipment'].includes(selectedCommercialLoanType)) {
            loanTypeDetails.asset_details = {
              equipment_type: data.equipment_type,
              description: data.equipment_description,
              condition: data.vehicle_condition,
              price: parseFloat(data.vehicle_price) || 0,
              deposit: parseFloat(data.deposit_amount) || 0,
              vendor_type: data.vendor_type,
              business_use_pct: parseFloat(data.eq_business_use_pct) || 0,
              term: data.loan_term,
            };
          }

          // Property/Development fields
          if (['property', 'development_construction', 'new_fit_out', 'renovation'].includes(selectedCommercialLoanType)) {
            loanTypeDetails.property_details = {
              address: data.property_address,
              property_type: data.property_type,
              property_use: data.property_use,
              value: parseFloat(data.property_value) || 0,
              loan_amount: parseFloat(data.amount) || 0,
              term: data.loan_term,
              project_description: selectedCommercialLoanType === 'development_construction' ? data.project_description : undefined,
              fit_out_description: selectedCommercialLoanType === 'new_fit_out' ? data.fit_out_description : undefined,
              renovation_description: selectedCommercialLoanType === 'renovation' ? data.renovation_description : undefined,
            };
          }

          // Business acquisition/startup fields
          if (['new_business', 'purchase_business'].includes(selectedCommercialLoanType)) {
            loanTypeDetails.business_details = {
              type: selectedCommercialLoanType,
              business_plan: selectedCommercialLoanType === 'new_business' ? data.business_plan : undefined,
              startup_costs: selectedCommercialLoanType === 'new_business' ? parseFloat(data.startup_costs) || 0 : undefined,
              industry: selectedCommercialLoanType === 'new_business' ? data.business_purpose : undefined,
              business_details: selectedCommercialLoanType === 'purchase_business' ? data.business_details : undefined,
              purchase_price: selectedCommercialLoanType === 'purchase_business' ? parseFloat(data.purchase_price) || 0 : undefined,
              business_type: selectedCommercialLoanType === 'purchase_business' ? data.business_type : undefined,
              loan_amount: parseFloat(data.amount) || 0,
              term: data.loan_term,
            };
          }

          // Working capital/expansion fields
          if (['day_to_day_capital', 'expansion', 'staff_recruitment', 'pay_suppliers', 'waiting_for_invoices', 'other'].includes(selectedCommercialLoanType)) {
            loanTypeDetails.working_capital = {
              type: selectedCommercialLoanType,
              recruitment_details: selectedCommercialLoanType === 'staff_recruitment' ? data.recruitment_details : undefined,
              expansion_description: selectedCommercialLoanType === 'expansion' ? data.expansion_description : undefined,
              supplier_details: selectedCommercialLoanType === 'pay_suppliers' ? data.supplier_details : undefined,
              outstanding_invoices: selectedCommercialLoanType === 'waiting_for_invoices' ? data.outstanding_invoices : undefined,
              purpose_description: selectedCommercialLoanType === 'other' ? data.purpose_description : undefined,
              loan_amount: parseFloat(data.amount) || 0,
              term: data.loan_term,
            };
          }
        }
        extraData.loan_type_details = loanTypeDetails;
      }

      let mainAmount = 0;
      if (lendEnabled) {
        const primary = selectedLoanTypes[0];
        if (primary === 'equipment_finance') mainAmount = parseFloat(data.eq_asset_price) || 0;
        else if (primary === 'business_loan') mainAmount = parseFloat(data.bl_loan_amount) || 0;
        else if (primary === 'commercial_property') mainAmount = parseFloat(data.cp_estimated_value) || 0;
        else if (primary === 'home_loan') mainAmount = parseFloat(data.hl_property_value) || 0;
      } else {
        // Calculate amount based on selected loan type
        if (tab === 'consumer') {
          if (['car', 'motorcycle', 'caravan', 'other_vehicle'].includes(selectedConsumerLoanType)) {
            mainAmount = parseFloat(data.vehicle_price) || 0;
          } else if (['purchase', 'refinance'].includes(selectedConsumerLoanType)) {
            mainAmount = parseFloat(data.property_value) || 0;
          } else {
            mainAmount = parseFloat(data.amount) || 0;
          }
        } else {
          // Commercial loans
          if (['vehicles_or_transport', 'machinery_or_equipment'].includes(selectedCommercialLoanType)) {
            mainAmount = parseFloat(data.vehicle_price) || 0;
          } else if (['property', 'development_construction', 'new_fit_out', 'renovation'].includes(selectedCommercialLoanType)) {
            mainAmount = parseFloat(data.property_value) || 0;
          } else if (['new_business', 'purchase_business'].includes(selectedCommercialLoanType)) {
            mainAmount = parseFloat(data.amount) || parseFloat(data.startup_costs) || parseFloat(data.purchase_price) || 0;
          } else {
            mainAmount = parseFloat(data.amount) || 0;
          }
        }
      }

      const payload: Record<string, unknown> = {
        loan_type: lendEnabled ? (selectedLoanTypes[0] || 'equipment_finance') : (tab === 'consumer' ? 'personal' : 'business_loan'),
        amount: mainAmount,
        notes: data.notes || null,
        status: 'application_received',
        applicant_title: data.applicant_title,
        applicant_first_name: data.applicant_first_name,
        applicant_middle_name: data.applicant_middle_name || null,
        applicant_last_name: data.applicant_last_name,
        applicant_dob: data.applicant_dob || null,
        applicant_gender: data.applicant_gender,
        applicant_marital_status: data.applicant_marital_status,
        applicant_mobile: data.applicant_mobile,
        preferred_contact_method: data.preferred_contact_method,
        applicant_residency_status: data.residency_status,
        id_expiry_date: data.id_expiry_date || null,
        applicant_address: data.applicant_address || null,
        applicant_suburb: data.applicant_suburb || null,
        applicant_state: data.applicant_state,
        applicant_postcode: data.applicant_postcode || null,
        residential_status: data.residential_status,
        time_at_address: data.time_at_address || null,
        applicant_num_dependants: parseInt(data.num_dependants) || 0,
        has_partner: data.has_partner === 'yes',
        partner_working: data.partner_working === 'yes',
        employment_category: data.employment_category,
        previously_declined: data.previously_declined === 'yes',
        change_of_circumstances: data.change_of_circumstances === 'yes',
        signature_name: data.signature_name || null,
        emergency_contact_name: data.emergency_contact_name || null,
        emergency_contact_relationship: data.emergency_contact_relationship || null,
        emergency_contact_phone: data.emergency_contact_phone || null,
        lend_extra_data: JSON.stringify(extraData),
      };

      if (tab === 'consumer') {
        if (purposeId) payload.loan_purpose_id = purposeId;
      } else {
        if (commercialPurposeId) payload.loan_purpose_id = commercialPurposeId;
        if (comBusinessName.trim()) payload.business_name = comBusinessName.trim();
        if (comAbn.trim()) payload.business_abn = comAbn.trim();
        const industryId = resolvedIndustryId();
        if (industryId) payload.business_industry_id = industryId;
        if (comPostcode.trim()) payload.applicant_postcode = comPostcode.trim();
        if (comMonthlySales) payload.business_monthly_sales = parseFloat(comMonthlySales) || null;
      }

      if (data.employment_category === 'employed') {
        payload.employer_name = data.employer_name || null;
        payload.employer_industry = data.employer_industry || null;
        payload.job_title = data.job_title || null;
        payload.income_frequency = data.income_frequency;
        payload.gross_income = parseFloat(data.gross_income) || null;
      } else {
        payload.business_abn = data.business_abn || null;
        payload.business_name = data.business_name || null;
        payload.trading_name = data.trading_name || null;
        payload.business_structure = data.business_structure || null;
        payload.employer_industry = data.business_industry || null;
        payload.time_trading = data.time_trading || null;
        payload.gst_registered = data.gst_registered === 'yes';
        payload.num_directors = parseInt(data.num_directors) || 1;
        payload.income_frequency = data.primary_income_frequency;
        payload.gross_income = parseFloat(data.primary_income_amount) || null;
      }

      await api.patch(`/applications/${draftAppId}`, payload);
      setCreatedAppId(draftAppId);
      toast('Lead submitted successfully', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to submit lead'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Success screen ────────────────────────────────────────────────────────

  if (createdAppId) {
    return (
      <div className="mx-auto max-w-xl">
        <GlassCard>
          <div className="text-center space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
              <svg className="h-7 w-7 text-success" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>
            <div>
              <h2 className="text-[18px] font-semibold text-foreground">Application Submitted</h2>
              <p className="text-[14px] text-muted-foreground mt-1">The application has been created and is ready for review.</p>
            </div>
            <div className="flex gap-3 justify-center pt-2">
              <Button onClick={() => navigate(`${basePath}/${createdAppId}`)}>View Application</Button>
              <Button variant="secondary" onClick={() => navigate(basePath)}>All Applications</Button>
            </div>
          </div>
        </GlassCard>
      </div>
    );
  }

  // ── Client picker pre-screen (broker mode) ───────────────────────────────

  if (showClientPicker) {
    const filteredClients = clients.filter(c => {
      const q = clientSearch.toLowerCase();
      return c.full_name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
    });
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title={title} subtitle="Select a client for this application" />
        <GlassCard className="space-y-4">
          <div className="flex gap-3">
            <button
              onClick={() => { setClientPickerMode('existing'); setSelectedClient(null); }}
              className={`flex-1 rounded-xl border py-2.5 text-[14px] font-medium transition-colors ${clientPickerMode === 'existing' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'}`}
            >
              Select existing client
            </button>
            <button
              onClick={() => { setClientPickerMode('none'); setSelectedClient(null); }}
              className={`flex-1 rounded-xl border py-2.5 text-[14px] font-medium transition-colors ${clientPickerMode === 'none' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'}`}
            >
              No client yet
            </button>
          </div>

          {clientPickerMode === 'existing' && (
            <div className="space-y-3">
              <Input
                placeholder="Search by name or email..."
                value={clientSearch}
                onChange={e => setClientSearch(e.target.value)}
              />
              <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                {filteredClients.length === 0 && (
                  <p className="text-[13px] text-muted-foreground text-center py-4">No clients found</p>
                )}
                {filteredClients.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedClient(c)}
                    className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${selectedClient?.id === c.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}
                  >
                    <p className="text-[14px] font-medium text-foreground">{c.full_name}</p>
                    <p className="text-[12px] text-muted-foreground">{c.email}{c.phone ? ` · ${c.phone}` : ''}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {clientPickerMode === 'none' && (
            <p className="text-[13px] text-muted-foreground">You can fill in the client details in the next step.</p>
          )}
        </GlassCard>

        <div className="mt-6 flex gap-3">
          <Button
            size="lg"
            onClick={handleClientPickerContinue}
            disabled={clientPickerLoading || (clientPickerMode === 'existing' && !selectedClient)}
          >
            {clientPickerLoading ? 'Setting up...' : 'Continue'}
          </Button>
          <Button variant="secondary" size="lg" onClick={() => navigate(basePath)}>Cancel</Button>
        </div>
      </div>
    );
  }

  // ── Engagement pre-screen ─────────────────────────────────────────────────

  if (showEngagementScreen) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title={title} subtitle="First, tell us who the client is and how they'll be managed" />
        <GlassCard className="space-y-4">
          <div>
            <p className="text-[15px] font-semibold text-foreground mb-1">Client Information</p>
            <p className="text-[13px] text-muted-foreground">Enter the basic details of the client you're referring.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLS}>First Name *</label>
              <Input placeholder="John" value={preFirstName} onChange={e => setPreFirstName(e.target.value)} />
            </div>
            <div>
              <label className={LABEL_CLS}>Last Name *</label>
              <Input placeholder="Smith" value={preLastName} onChange={e => setPreLastName(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLS}>Email *</label>
              <Input type="email" placeholder="john@example.com" value={preEmail} onChange={e => setPreEmail(e.target.value)} />
            </div>
            <div>
              <label className={LABEL_CLS}>Mobile <span className="font-normal">(optional)</span></label>
              <Input type="tel" placeholder="04XX XXX XXX" value={preMobile} onChange={e => setPreMobile(e.target.value)} />
            </div>
          </div>
        </GlassCard>
        <GlassCard className="space-y-4">
          <div>
            <p className="text-[15px] font-semibold text-foreground mb-1">Who will engage with the client?</p>
            <p className="text-[13px] text-muted-foreground">This determines how we handle the client relationship for this application.</p>
          </div>

          <label className={`flex items-start gap-3 rounded-xl border p-4 cursor-pointer transition-colors ${engagementModel === 'self_managed' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}>
            <input type="radio" name="engagement" value="self_managed" checked={engagementModel === 'self_managed'} onChange={() => { setEngagementModel('self_managed'); setEngagementError(''); }} className="mt-0.5 accent-primary shrink-0" />
            <div>
              <p className="text-[14px] font-semibold text-foreground">I will engage with the client</p>
              <p className="text-[13px] text-muted-foreground mt-0.5">You'll fill in the application on the client's behalf, or send them a link to complete it themselves.</p>
            </div>
          </label>

          <label className={`flex items-start gap-3 rounded-xl border p-4 cursor-pointer transition-colors ${engagementModel === 'direct_engagement' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}>
            <input type="radio" name="engagement" value="direct_engagement" checked={engagementModel === 'direct_engagement'} onChange={() => { setEngagementModel('direct_engagement'); setEngagementError(''); }} className="mt-0.5 accent-primary shrink-0" />
            <div>
              <p className="text-[14px] font-semibold text-foreground">Xpress Finance will engage with the client</p>
              <p className="text-[13px] text-muted-foreground mt-0.5">Our team will contact and work with the client directly. You can still send them a form link.</p>
            </div>
          </label>

          {engagementError && <p className="text-[12px] text-destructive">{engagementError}</p>}
        </GlassCard>

        <div className="mt-6 flex gap-3">
          <Button size="lg" onClick={handleEngagementContinue} disabled={draftCreating}>
            {draftCreating ? 'Creating lead...' : 'Continue'}
          </Button>
          <Button variant="secondary" size="lg" onClick={() => navigate(basePath)}>Cancel</Button>
        </div>
      </div>
    );
  }

  // ── Multi-step form ───────────────────────────────────────────────────────

  const progress = (toUiStep(step) / totalSteps) * 100;
  const currentPurposeLabel = tab === 'consumer'
    ? CONSUMER_PURPOSES.find(p => p.id === purposeId)?.label
    : COMMERCIAL_PURPOSES.find(p => p.id === commercialPurposeId)?.label;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={title} subtitle={stepLabels[toUiStep(step) - 1]} />

      {/* Progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] font-medium text-muted-foreground">Step {toUiStep(step)} of {totalSteps}</span>
          <span className="text-[12px] font-medium text-muted-foreground">{Math.round(progress)}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
          <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

        {/* ── Step 1: Client & Loan Details ── */}
        {step === 1 && (
          <>
            {/* Info banner */}
            <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 flex items-start gap-3">
              <svg className="h-4 w-4 text-primary mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" /></svg>
              <p className="text-[13px] text-foreground">You only need to fill in the important fields. The application can be submitted even if non-critical information is missing.</p>
            </div>

            {/* Loan type tab */}
            <div className="flex gap-1 p-1 rounded-xl bg-secondary w-fit">
              {(['consumer', 'commercial'] as const).map(t => (
                <button key={t} type="button" onClick={() => handleTabChange(t)}
                  className={`px-5 py-2 rounded-lg text-[13px] font-medium transition-all ${tab === t ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                  {t === 'consumer' ? 'Consumer Loan' : 'Commercial Loan'}
                </button>
              ))}
            </div>

            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-foreground">Client Details</h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className={LABEL_CLS}>First Name *</label>
                  <Input placeholder="John" error={errors.applicant_first_name?.message} {...register('applicant_first_name', { required: 'Required' })} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Middle Name <span className="font-normal">(optional)</span></label>
                  <Input placeholder="William" {...register('applicant_middle_name')} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Last Name *</label>
                  <Input placeholder="Smith" error={errors.applicant_last_name?.message} {...register('applicant_last_name', { required: 'Required' })} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={LABEL_CLS}>Email *</label>
                  <Input type="email" placeholder="john@example.com" error={errors.applicant_email?.message} {...register('applicant_email', { required: 'Required' })} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Mobile *</label>
                  <Input type="tel" placeholder="04XX XXX XXX" error={errors.applicant_mobile?.message} {...register('applicant_mobile', { required: 'Required' })} />
                </div>
              </div>
            </GlassCard>

            {!lendEnabled ? (
              <>
                {/* Consumer Loan Types with Comprehensive Fields */}
                {tab === 'consumer' && (
                  <GlassCard className="space-y-4">
                    <h3 className="text-[14px] font-semibold text-foreground">Select Loan Type</h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {CONSUMER_LOAN_TYPES.map(type => {
                        const active = selectedConsumerLoanType === type.value;
                        return (
                          <label key={type.value} className={`relative flex cursor-pointer items-start gap-3 rounded-2xl p-4 transition-all duration-200 ${active ? 'bg-primary/5 ring-2 ring-primary/30 shadow-[0_0_0_1px_var(--primary)]' : 'bg-secondary hover:bg-secondary/80'}`} onClick={() => setSelectedConsumerLoanType(type.value)}>
                            <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border" style={active ? { background: 'var(--primary)', borderColor: 'var(--primary)' } : {}}>
                              {active && <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>}
                            </div>
                            <span className="text-2xl">{type.icon}</span>
                            <div>
                              <p className={`text-[14px] font-semibold ${active ? 'text-primary' : 'text-foreground'}`}>{type.label}</p>
                              <p className="text-[13px] text-muted-foreground mt-0.5">{type.description}</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>

                    {/* Vehicle Loan Fields */}
                    {['car', 'motorcycle', 'caravan', 'other_vehicle'].includes(selectedConsumerLoanType) && (
                      <div className="space-y-4 pt-4 border-t border-border">
                        <h4 className="text-[13px] font-semibold text-foreground">Vehicle Details</h4>
                        {selectedConsumerLoanType === 'other_vehicle' && (
                          <div>
                            <label className={LABEL_CLS}>Vehicle Type</label>
                            <select {...register('vehicle_type')} className={SELECT_CLS}>
                              {['Boat', 'Jet Ski', 'Trailer', 'Camper', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                        )}
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className={LABEL_CLS}>Make</label>
                            <select {...register('vehicle_make')} className={SELECT_CLS}>
                              <option value="">Select make...</option>
                              {VEHICLE_MAKES.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className={LABEL_CLS}>Model</label>
                            <Input placeholder="e.g. Corolla" {...register('vehicle_model')} />
                          </div>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-3">
                          <div>
                            <label className={LABEL_CLS}>Year</label>
                            <Input type="number" min="1900" max={new Date().getFullYear() + 1} placeholder="2024" {...register('vehicle_year')} />
                          </div>
                          <div>
                            <label className={LABEL_CLS}>Condition</label>
                            <select {...register('vehicle_condition')} className={SELECT_CLS}>
                              {VEHICLE_CONDITION_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className={LABEL_CLS}>VIN <span className="font-normal">(optional)</span></label>
                            <Input placeholder="1HGCM82633A123456" {...register('vehicle_vin')} />
                          </div>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className={LABEL_CLS}>Vehicle Price ($)</label>
                            <Input type="number" step="0.01" min="0" placeholder="35,000" {...register('vehicle_price')} />
                          </div>
                          <div>
                            <label className={LABEL_CLS}>Deposit ($) <span className="font-normal">(optional)</span></label>
                            <Input type="number" step="0.01" min="0" placeholder="5,000" {...register('deposit_amount')} />
                          </div>
                        </div>
                        <div>
                          <label className={LABEL_CLS}>Preferred Loan Term</label>
                          <select {...register('loan_term')} className={SELECT_CLS}>
                            {LOAN_TERM_OPTIONS.slice(0, 7).map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                      </div>
                    )}

                    {/* Personal Loan Fields */}
                    {selectedConsumerLoanType === 'personal' && (
                      <div className="space-y-4 pt-4 border-t border-border">
                        <h4 className="text-[13px] font-semibold text-foreground">Personal Loan Details</h4>
                        <div>
                          <label className={LABEL_CLS}>Loan Purpose</label>
                          <textarea {...register('loan_purpose')} rows={2} className={TEXTAREA_CLS} placeholder="Describe what the loan is for..." />
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className={LABEL_CLS}>Loan Amount ($)</label>
                            <Input type="number" step="0.01" min="0" placeholder="25,000" {...register('amount')} />
                          </div>
                          <div>
                            <label className={LABEL_CLS}>Preferred Term</label>
                            <select {...register('loan_term')} className={SELECT_CLS}>
                              {LOAN_TERM_OPTIONS.slice(0, 7).map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Purchase/Refinance Fields */}
                    {['purchase', 'refinance'].includes(selectedConsumerLoanType) && (
                      <div className="space-y-4 pt-4 border-t border-border">
                        <h4 className="text-[13px] font-semibold text-foreground">Property Details</h4>
                        <div>
                          <label className={LABEL_CLS}>Property Address</label>
                          <Input placeholder="123 Main St, Sydney NSW 2000" {...register('property_address')} />
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className={LABEL_CLS}>Property Type</label>
                            <select {...register('property_type')} className={SELECT_CLS}>
                              {PROPERTY_TYPES.slice(0, 6).map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className={LABEL_CLS}>Property Value ($)</label>
                            <Input type="number" step="0.01" min="0" placeholder="800,000" {...register('property_value')} />
                          </div>
                        </div>
                        {selectedConsumerLoanType === 'purchase' && (
                          <>
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div>
                                <label className={LABEL_CLS}>Deposit ($)</label>
                                <Input type="number" step="0.01" min="0" placeholder="80,000" {...register('deposit_amount')} />
                              </div>
                              <div>
                                <label className={LABEL_CLS}>First Home Buyer?</label>
                                <select {...register('first_home_buyer')} className={SELECT_CLS}>
                                  <option value="yes">Yes</option>
                                  <option value="no">No</option>
                                </select>
                              </div>
                            </div>
                          </>
                        )}
                        {selectedConsumerLoanType === 'refinance' && (
                          <>
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div>
                                <label className={LABEL_CLS}>Current Lender</label>
                                <Input placeholder="e.g. ANZ" {...register('current_lender')} />
                              </div>
                              <div>
                                <label className={LABEL_CLS}>Current Balance ($)</label>
                                <Input type="number" step="0.01" min="0" placeholder="500,000" {...register('current_balance')} />
                              </div>
                            </div>
                            <div>
                              <label className={LABEL_CLS}>Refinance Reason</label>
                              <textarea {...register('refinance_reason')} rows={2} className={TEXTAREA_CLS} placeholder="Why do you want to refinance?" />
                            </div>
                          </>
                        )}
                        <div>
                          <label className={LABEL_CLS}>Preferred Loan Term</label>
                          <select {...register('loan_term')} className={SELECT_CLS}>
                            {LOAN_TERM_OPTIONS.slice(4).map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                      </div>
                    )}

                    <div>
                      <label className={LABEL_CLS}>Notes to broker <span className="font-normal">(optional)</span></label>
                      <textarea {...register('notes')} rows={3} className={TEXTAREA_CLS} placeholder="Any context about this lead for the broker..." />
                    </div>
                  </GlassCard>
                )}

                {/* Commercial Loan Types with Comprehensive Fields */}
                {tab === 'commercial' && (
                  <GlassCard className="space-y-4">
                    <h3 className="text-[14px] font-semibold text-foreground">Business & Loan Details</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className={LABEL_CLS}>Business / Entity Name</label>
                        <Input placeholder="Acme Pty Ltd" value={comBusinessName} onChange={e => setComBusinessName(e.target.value)} />
                      </div>
                      <div>
                        <label className={LABEL_CLS}>ACN / ABN</label>
                        <Input placeholder="12 345 678 901" value={comAbn} onChange={e => setComAbn(e.target.value)} />
                      </div>
                    </div>

                    <div>
                      <label className={LABEL_CLS}>Loan Purpose</label>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {COMMERCIAL_LOAN_TYPES.map(type => {
                          const active = selectedCommercialLoanType === type.value;
                          return (
                            <label key={type.value} className={`relative flex cursor-pointer items-start gap-3 rounded-xl p-3 transition-all duration-200 ${active ? 'bg-primary/5 ring-1 ring-primary/30' : 'bg-secondary hover:bg-secondary/80'}`} onClick={() => setSelectedCommercialLoanType(type.value)}>
                              <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border" style={active ? { background: 'var(--primary)', borderColor: 'var(--primary)' } : {}}>
                                {active && <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>}
                              </div>
                              <div>
                                <p className={`text-[13px] font-semibold ${active ? 'text-primary' : 'text-foreground'}`}>{type.icon} {type.label}</p>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {/* Commercial Vehicle/Equipment Fields */}
                    {['vehicles_or_transport', 'machinery_or_equipment'].includes(selectedCommercialLoanType) && (
                      <div className="space-y-4 pt-4 border-t border-border">
                        <h4 className="text-[13px] font-semibold text-foreground">Asset Details</h4>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className={LABEL_CLS}>Asset Type</label>
                            <select {...register('equipment_type')} className={SELECT_CLS}>
                              {EQUIPMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className={LABEL_CLS}>Condition</label>
                            <select {...register('vehicle_condition')} className={SELECT_CLS}>
                              {VEHICLE_CONDITION_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className={LABEL_CLS}>Description</label>
                          <Input placeholder="e.g. 2023 Isuzu NPR 65-190 Tray Truck" {...register('equipment_description')} />
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className={LABEL_CLS}>Asset Price ($)</label>
                            <Input type="number" step="0.01" min="0" placeholder="80,000" {...register('vehicle_price')} />
                          </div>
                          <div>
                            <label className={LABEL_CLS}>Deposit / Trade-in ($)</label>
                            <Input type="number" step="0.01" min="0" placeholder="10,000" {...register('deposit_amount')} />
                          </div>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className={LABEL_CLS}>Vendor Type</label>
                            <select {...register('vendor_type')} className={SELECT_CLS}>
                              <option value="Dealer">Dealer</option>
                              <option value="Private">Private</option>
                              <option value="Auction">Auction</option>
                            </select>
                          </div>
                          <div>
                            <label className={LABEL_CLS}>Business Use %</label>
                            <Input type="number" min="0" max="100" placeholder="80" {...register('eq_business_use_pct')} />
                          </div>
                        </div>
                        <div>
                          <label className={LABEL_CLS}>Preferred Loan Term</label>
                          <select {...register('loan_term')} className={SELECT_CLS}>
                            {LOAN_TERM_OPTIONS.slice(0, 7).map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                      </div>
                    )}

                    {/* Property/Development Fields */}
                    {['property', 'development_construction', 'new_fit_out', 'renovation'].includes(selectedCommercialLoanType) && (
                      <div className="space-y-4 pt-4 border-t border-border">
                        <h4 className="text-[13px] font-semibold text-foreground">Property Details</h4>
                        <div>
                          <label className={LABEL_CLS}>Property Address</label>
                          <Input placeholder="123 Main St, Sydney NSW 2000" {...register('property_address')} />
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className={LABEL_CLS}>Property Type</label>
                            <select {...register('property_type')} className={SELECT_CLS}>
                              {PROPERTY_TYPES.slice(6).map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className={LABEL_CLS}>Property Use</label>
                            <select {...register('property_use')} className={SELECT_CLS}>
                              <option value="Owner Occupied">Owner Occupied</option>
                              <option value="Investment">Investment</option>
                              <option value="Mixed Use">Mixed Use</option>
                            </select>
                          </div>
                        </div>
                        {selectedCommercialLoanType === 'development_construction' && (
                          <div>
                            <label className={LABEL_CLS}>Project Description</label>
                            <textarea {...register('project_description')} rows={3} className={TEXTAREA_CLS} placeholder="Describe the development project..." />
                          </div>
                        )}
                        {selectedCommercialLoanType === 'new_fit_out' && (
                          <div>
                            <label className={LABEL_CLS}>Fit-out Description</label>
                            <textarea {...register('fit_out_description')} rows={2} className={TEXTAREA_CLS} placeholder="Describe the fit-out requirements..." />
                          </div>
                        )}
                        {selectedCommercialLoanType === 'renovation' && (
                          <div>
                            <label className={LABEL_CLS}>Renovation Details</label>
                            <textarea {...register('renovation_description')} rows={2} className={TEXTAREA_CLS} placeholder="Describe the renovation works..." />
                          </div>
                        )}
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className={LABEL_CLS}>{selectedCommercialLoanType === 'development_construction' ? 'Project Value' : selectedCommercialLoanType === 'renovation' ? 'Estimated Cost' : 'Property Value'} ($)</label>
                            <Input type="number" step="0.01" min="0" placeholder="1,000,000" {...register('property_value')} />
                          </div>
                          <div>
                            <label className={LABEL_CLS}>Loan Amount Required ($)</label>
                            <Input type="number" step="0.01" min="0" placeholder="800,000" {...register('amount')} />
                          </div>
                        </div>
                        <div>
                          <label className={LABEL_CLS}>Preferred Loan Term</label>
                          <select {...register('loan_term')} className={SELECT_CLS}>
                            {LOAN_TERM_OPTIONS.slice(4).map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                      </div>
                    )}

                    {/* Business Acquisition/Startup Fields */}
                    {['new_business', 'purchase_business'].includes(selectedCommercialLoanType) && (
                      <div className="space-y-4 pt-4 border-t border-border">
                        <h4 className="text-[13px] font-semibold text-foreground">Business Details</h4>
                        {selectedCommercialLoanType === 'new_business' ? (
                          <>
                            <div>
                              <label className={LABEL_CLS}>Business Plan Summary</label>
                              <textarea {...register('business_plan')} rows={3} className={TEXTAREA_CLS} placeholder="Briefly describe your business plan..." />
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div>
                                <label className={LABEL_CLS}>Startup Costs ($)</label>
                                <Input type="number" step="0.01" min="0" placeholder="150,000" {...register('startup_costs')} />
                              </div>
                              <div>
                                <label className={LABEL_CLS}>Industry</label>
                                <Input placeholder="e.g. Retail, Hospitality" {...register('business_purpose')} />
                              </div>
                            </div>
                          </>
                        ) : (
                          <>
                            <div>
                              <label className={LABEL_CLS}>Business Details</label>
                              <textarea {...register('business_details')} rows={2} className={TEXTAREA_CLS} placeholder="Business name, type, and brief description..." />
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div>
                                <label className={LABEL_CLS}>Purchase Price ($)</label>
                                <Input type="number" step="0.01" min="0" placeholder="500,000" {...register('purchase_price')} />
                              </div>
                              <div>
                                <label className={LABEL_CLS}>Business Type</label>
                                <Input placeholder="e.g. Cafe, Franchise" {...register('business_type')} />
                              </div>
                            </div>
                          </>
                        )}
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className={LABEL_CLS}>Loan Amount ($)</label>
                            <Input type="number" step="0.01" min="0" placeholder="400,000" {...register('amount')} />
                          </div>
                          <div>
                            <label className={LABEL_CLS}>Preferred Term</label>
                            <select {...register('loan_term')} className={SELECT_CLS}>
                              {LOAN_TERM_OPTIONS.slice(2, 8).map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Working Capital/Expansion Fields */}
                    {['day_to_day_capital', 'expansion', 'staff_recruitment', 'pay_suppliers', 'waiting_for_invoices', 'other'].includes(selectedCommercialLoanType) && (
                      <div className="space-y-4 pt-4 border-t border-border">
                        <h4 className="text-[13px] font-semibold text-foreground">Loan Details</h4>
                        {selectedCommercialLoanType === 'staff_recruitment' && (
                          <div>
                            <label className={LABEL_CLS}>Recruitment Details</label>
                            <textarea {...register('recruitment_details')} rows={2} className={TEXTAREA_CLS} placeholder="Number of staff, roles, training costs..." />
                          </div>
                        )}
                        {selectedCommercialLoanType === 'expansion' && (
                          <div>
                            <label className={LABEL_CLS}>Expansion Description</label>
                            <textarea {...register('expansion_description')} rows={2} className={TEXTAREA_CLS} placeholder="Describe your expansion plans..." />
                          </div>
                        )}
                        {selectedCommercialLoanType === 'pay_suppliers' && (
                          <div>
                            <label className={LABEL_CLS}>Supplier Details</label>
                            <textarea {...register('supplier_details')} rows={2} className={TEXTAREA_CLS} placeholder="Supplier names, invoice details..." />
                          </div>
                        )}
                        {selectedCommercialLoanType === 'waiting_for_invoices' && (
                          <div>
                            <label className={LABEL_CLS}>Outstanding Invoices</label>
                            <textarea {...register('outstanding_invoices')} rows={2} className={TEXTAREA_CLS} placeholder="Debtor details, amounts, due dates..." />
                          </div>
                        )}
                        {selectedCommercialLoanType === 'other' && (
                          <div>
                            <label className={LABEL_CLS}>Purpose Description</label>
                            <textarea {...register('purpose_description')} rows={2} className={TEXTAREA_CLS} placeholder="Describe the purpose of the loan..." />
                          </div>
                        )}
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className={LABEL_CLS}>Loan Amount ($)</label>
                            <Input type="number" step="0.01" min="0" placeholder="100,000" {...register('amount')} />
                          </div>
                          <div>
                            <label className={LABEL_CLS}>Preferred Term</label>
                            <select {...register('loan_term')} className={SELECT_CLS}>
                              {LOAN_TERM_OPTIONS.slice(0, 7).map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Fallback for unselected or simple loan types */}
                    {!selectedCommercialLoanType && (
                      <div>
                        <label className={LABEL_CLS}>Loan Amount *</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 z-10 text-[14px] font-semibold text-muted-foreground pointer-events-none">$</span>
                          <Input type="number" step="0.01" min="1" placeholder="100,000" style={{ paddingLeft: '2rem' }} {...register('amount')} />
                        </div>
                      </div>
                    )}

                    <div>
                      <label className={LABEL_CLS}>Notes to broker <span className="font-normal">(optional)</span></label>
                      <textarea {...register('notes')} rows={3} className={TEXTAREA_CLS} placeholder="Any context about this lead for the broker..." />
                    </div>
                  </GlassCard>
                )}
              </>
            ) : (
              <>
                <GlassCard>
                  <label className={LABEL_CLS}>Select Loan Type(s)</label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {LEND_LOAN_TYPES.map(type => {
                      const active = selectedLoanTypes.includes(type.value);
                      return (
                        <label key={type.value} className={`relative flex cursor-pointer items-start gap-3 rounded-2xl p-4 transition-all duration-200 ${active ? 'bg-primary/5 ring-2 ring-primary/30 shadow-[0_0_0_1px_var(--primary)]' : 'bg-secondary hover:bg-secondary/80'}`} onClick={() => toggleLoanType(type.value)}>
                          <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border" style={active ? { background: 'var(--primary)', borderColor: 'var(--primary)' } : {}}>
                            {active && <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>}
                          </div>
                          <span className="text-2xl">{type.icon}</span>
                          <div>
                            <p className={`text-[14px] font-semibold ${active ? 'text-primary' : 'text-foreground'}`}>{type.label}</p>
                            <p className="text-[13px] text-muted-foreground mt-0.5">{type.description}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  {loanTypeError && <p className="mt-2 text-[12px] text-destructive">{loanTypeError}</p>}
                </GlassCard>

                {selectedLoanTypes.includes('equipment_finance') && (
                  <GlassCard className="space-y-4">
                    <h3 className="text-[14px] font-semibold text-foreground">🏗️ Equipment Finance Details</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className={LABEL_CLS}>Asset Type</label>
                        <select {...register('eq_asset_type')} className={SELECT_CLS}>
                          {['Truck', 'Car', 'Machinery', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={LABEL_CLS}>New or Used</label>
                        <select {...register('eq_new_or_used')} className={SELECT_CLS}>
                          <option value="New">New</option>
                          <option value="Used">Used</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className={LABEL_CLS}>Asset Price ($)</label>
                        <Input type="number" step="0.01" min="0" placeholder="150,000" {...register('eq_asset_price')} />
                      </div>
                      <div>
                        <label className={LABEL_CLS}>Deposit Amount ($) <span className="font-normal">(optional)</span></label>
                        <Input type="number" step="0.01" min="0" placeholder="20,000" {...register('eq_deposit_amount')} />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className={LABEL_CLS}>Vendor Type</label>
                        <select {...register('eq_vendor_type')} className={SELECT_CLS}>
                          <option value="Dealer">Dealer</option>
                          <option value="Private">Private</option>
                        </select>
                      </div>
                      <div>
                        <label className={LABEL_CLS}>Loan Term (Years)</label>
                        <Input type="number" min="1" max="10" placeholder="5" {...register('eq_loan_term')} />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className={LABEL_CLS}>Estimated Repayment Budget ($/month)</label>
                        <Input type="number" step="0.01" min="0" placeholder="3,000" {...register('eq_estimated_repayment')} />
                      </div>
                      <div>
                        <label className={LABEL_CLS}>Business Use % <span className="font-normal">(optional)</span></label>
                        <Input type="number" min="0" max="100" placeholder="80" {...register('eq_business_use_pct')} />
                      </div>
                    </div>
                  </GlassCard>
                )}

                {selectedLoanTypes.includes('business_loan') && (
                  <GlassCard className="space-y-4">
                    <h3 className="text-[14px] font-semibold text-foreground">💼 Business Loan Details</h3>
                    <div>
                      <label className={LABEL_CLS}>Loan Purpose</label>
                      <textarea {...register('bl_loan_purpose')} rows={2} className={TEXTAREA_CLS} placeholder="Describe the purpose of the loan..." />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className={LABEL_CLS}>Requested Loan Amount ($)</label>
                        <Input type="number" step="0.01" min="0" placeholder="50,000" {...register('bl_loan_amount')} />
                      </div>
                      <div>
                        <label className={LABEL_CLS}>Preferred Loan Term</label>
                        <Input placeholder="e.g. 3 years" {...register('bl_loan_term')} />
                      </div>
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Purpose Type</label>
                      <select {...register('bl_purpose_type')} className={SELECT_CLS}>
                        {['Working Capital', 'Growth', 'Refinance', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </GlassCard>
                )}

                {selectedLoanTypes.includes('commercial_property') && (
                  <GlassCard className="space-y-4">
                    <h3 className="text-[14px] font-semibold text-foreground">🏢 Commercial Property Details</h3>
                    <div>
                      <label className={LABEL_CLS}>Purchase or Refinance?</label>
                      <div className="flex gap-3">
                        {['Purchase', 'Refinance'].map(v => (
                          <label key={v} className={`flex-1 cursor-pointer rounded-xl p-3 text-center text-[13px] font-medium transition-all ${cpPurchaseOrRefinance === v ? 'bg-primary/10 text-primary ring-1 ring-primary/30' : 'bg-secondary text-muted-foreground hover:bg-secondary/80'}`}>
                            <input type="radio" value={v} {...register('cp_purchase_or_refinance')} className="sr-only" />
                            {v}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Security Address</label>
                      <Input placeholder="123 Main St, Sydney NSW 2000" {...register('cp_security_address')} />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className={LABEL_CLS}>Estimated Value / Purchase Price ($)</label>
                        <Input type="number" step="0.01" min="0" placeholder="1,000,000" {...register('cp_estimated_value')} />
                      </div>
                      {cpPurchaseOrRefinance === 'Refinance' && (
                        <div>
                          <label className={LABEL_CLS}>Existing Debt ($)</label>
                          <Input type="number" step="0.01" min="0" placeholder="500,000" {...register('cp_existing_debt')} />
                        </div>
                      )}
                    </div>
                  </GlassCard>
                )}

                {selectedLoanTypes.includes('home_loan') && (
                  <GlassCard className="space-y-4">
                    <h3 className="text-[14px] font-semibold text-foreground">🏠 Home Loan Details</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className={LABEL_CLS}>Purchase or Refinance?</label>
                        <div className="flex gap-3">
                          {['Purchase', 'Refinance'].map(v => (
                            <label key={v} className={`flex-1 cursor-pointer rounded-xl p-3 text-center text-[13px] font-medium transition-all ${hlPurchaseOrRefinance === v ? 'bg-primary/10 text-primary ring-1 ring-primary/30' : 'bg-secondary text-muted-foreground hover:bg-secondary/80'}`}>
                              <input type="radio" value={v} {...register('hl_purchase_or_refinance')} className="sr-only" />
                              {v}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className={LABEL_CLS}>Owner Occupied or Investment?</label>
                        <select {...register('hl_owner_or_investment')} className={SELECT_CLS}>
                          <option value="Owner Occupied">Owner Occupied</option>
                          <option value="Investment">Investment</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className={LABEL_CLS}>Property Value / Purchase Price ($)</label>
                        <Input type="number" step="0.01" min="0" placeholder="800,000" {...register('hl_property_value')} />
                      </div>
                      {hlPurchaseOrRefinance === 'Refinance' && (
                        <div>
                          <label className={LABEL_CLS}>Existing Lender</label>
                          <Input placeholder="e.g. ANZ" {...register('hl_existing_lender')} />
                        </div>
                      )}
                    </div>
                  </GlassCard>
                )}

                <div>
                  <label className={LABEL_CLS}>Notes to broker <span className="font-normal">(optional)</span></label>
                  <textarea {...register('notes')} rows={3} className={TEXTAREA_CLS} placeholder="Any context about this lead for the broker..." />
                </div>
              </>
            )}

            {/* Document upload */}
            <GlassCard className="space-y-4">
              <div>
                <h3 className="text-[14px] font-semibold text-foreground">Supporting Documents</h3>
                <p className="text-[12px] text-muted-foreground mt-0.5">Optional — files upload immediately.</p>
              </div>

              {uploadedDocs.length > 0 && (
                <ul className="space-y-2">
                  {uploadedDocs.map((d, i) => (
                    <li key={i} className="flex items-center gap-3 rounded-xl border border-border bg-secondary/40 px-3 py-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-foreground truncate">{d.label || DOC_TYPE_LABELS[d.doc_type as DocType] || d.doc_type}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{d.filename}</p>
                      </div>
                      <svg className="h-4 w-4 text-success shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                    </li>
                  ))}
                </ul>
              )}

              {stagedFile ? (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-primary shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                    <span className="text-[13px] font-medium text-foreground truncate">{stagedFile.name}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{(stagedFile.size / 1024).toFixed(0)} KB</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className={LABEL_CLS}>Document Type</label>
                      <select value={stagedDocType} onChange={e => setStagedDocType(e.target.value as DocType)} className={SELECT_CLS}>
                        {Object.entries(DOC_TYPE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Label <span className="font-normal">(optional)</span></label>
                      <Input placeholder={DOC_TYPE_LABELS[stagedDocType] || 'e.g. June payslip'} value={stagedLabel} onChange={e => setStagedLabel(e.target.value)} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" onClick={handleConfirmStaged} disabled={uploading}>
                      {uploading ? 'Uploading...' : 'Upload now'}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setStagedFile(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div
                  className={`relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${isDragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-secondary/40'}`}
                  onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                  onDragEnter={e => { e.preventDefault(); setIsDragOver(true); }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={handleDrop}
                >
                  <input ref={pendingFileInput} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handlePickFile} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${isDragOver ? 'bg-primary/15' : 'bg-secondary'}`}>
                    <svg className={`h-5 w-5 transition-colors ${isDragOver ? 'text-primary' : 'text-muted-foreground'}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" /></svg>
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-foreground">{isDragOver ? 'Drop to upload' : 'Drop a file or click to browse'}</p>
                    <p className="text-[12px] text-muted-foreground mt-0.5">PDF, JPG, PNG — up to 10 MB</p>
                  </div>
                </div>
              )}
            </GlassCard>
          </>
        )}

        {/* ── Step 2: Identification & Residency ── */}
        {step === 2 && (
          <>
            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-foreground">Personal Details</h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className={LABEL_CLS}>Title</label>
                  <select {...register('applicant_title')} className={SELECT_CLS}>
                    {TITLE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Gender</label>
                  <select {...register('applicant_gender')} className={SELECT_CLS}>
                    {GENDER_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Marital Status</label>
                  <select {...register('applicant_marital_status')} className={SELECT_CLS}>
                    {MARITAL_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={LABEL_CLS}>Date of Birth</label>
                  <Input type="date" {...register('applicant_dob')} />
                </div>
                <div>
                  <label className={LABEL_CLS}>No. of Dependants</label>
                  <Input type="number" min="0" max="20" {...register('num_dependants')} />
                </div>
              </div>
              <div>
                <label className={LABEL_CLS}>Preferred Contact Method</label>
                <select {...register('preferred_contact_method')} className={SELECT_CLS}>
                  {['Email', 'Mobile', 'Either'].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </GlassCard>

            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-foreground">Identification</h3>
              <div>
                <label className={LABEL_CLS}>ID Type</label>
                <div className="flex gap-3">
                  {(['license', 'passport'] as const).map(t => (
                    <label key={t} className={`flex-1 cursor-pointer rounded-xl p-3 text-center text-[13px] font-medium transition-all ${idType === t ? 'bg-primary/10 text-primary ring-1 ring-primary/30' : 'bg-secondary text-muted-foreground hover:bg-secondary/80'}`}>
                      <input type="radio" value={t} {...register('id_type')} className="sr-only" />
                      {t === 'license' ? 'Driver Licence' : 'Passport'}
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className={LABEL_CLS}>ID Number</label>
                  <Input placeholder={idType === 'license' ? '12345678' : 'PA1234567'} {...register('id_number')} />
                </div>
                <div>
                  <label className={LABEL_CLS}>{idType === 'license' ? 'Issuing State' : 'Issuing Country'}</label>
                  {idType === 'license' ? (
                    <select {...register('id_issuing_state_country')} className={SELECT_CLS}>
                      {AU_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : (
                    <Input placeholder="Australia" {...register('id_issuing_state_country')} />
                  )}
                </div>
                <div>
                  <label className={LABEL_CLS}>Expiry Date</label>
                  <Input type="date" {...register('id_expiry_date')} />
                </div>
              </div>
            </GlassCard>

            <GlassCard className="space-y-3">
              <h3 className="text-[14px] font-semibold text-foreground">Residency Status</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {['Australian Citizen', 'Permanent Resident', 'Temporary Visa', 'Other'].map(r => (
                  <label key={r} className={`flex cursor-pointer items-center gap-3 rounded-xl p-3 transition-all ${residencyStatus === r ? 'bg-primary/5 ring-1 ring-primary/30' : 'bg-secondary hover:bg-secondary/80'}`}>
                    <input type="radio" value={r} {...register('residency_status')} className="h-4 w-4 accent-[var(--primary)]" />
                    <span className="text-[13px] font-medium text-foreground">{r}</span>
                  </label>
                ))}
              </div>
            </GlassCard>

            {tab === 'commercial' && (
              <GlassCard className="space-y-4">
                <h3 className="text-[14px] font-semibold text-foreground">Business Details</h3>
                <div>
                  <label className={LABEL_CLS}>Industry</label>
                  <select value={parentIndustryId} onChange={e => { setParentIndustryId(e.target.value ? Number(e.target.value) : ''); setSubIndustryId(''); }} className={SELECT_CLS}>
                    <option value="">Select industry...</option>
                    {INDUSTRIES.map(ind => <option key={ind.id} value={ind.id}>{ind.label}</option>)}
                  </select>
                </div>
                {parentIndustryId !== '' && subChildren.length > 0 && (
                  <div>
                    <label className={LABEL_CLS}>Sub-industry</label>
                    <select value={subIndustryId} onChange={e => setSubIndustryId(e.target.value ? Number(e.target.value) : '')} className={SELECT_CLS}>
                      <option value="">Select sub-industry...</option>
                      {subChildren.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </div>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={LABEL_CLS}>Postcode</label>
                    <Input placeholder="2000" maxLength={4} value={comPostcode} onChange={e => setComPostcode(e.target.value)} />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Monthly Sales ($)</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 z-10 text-[14px] font-semibold text-muted-foreground pointer-events-none">$</span>
                      <Input type="number" step="1" min="0" placeholder="30,000" style={{ paddingLeft: '2rem' }} value={comMonthlySales} onChange={e => setComMonthlySales(e.target.value)} />
                    </div>
                  </div>
                </div>
              </GlassCard>
            )}
          </>
        )}

        {/* ── Step 3: Living & Employment (consumer / LEND only) ── */}
        {step === 3 && (tab === 'consumer' || lendEnabled) && (
          <>
            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-foreground">Living Situation</h3>
              <div>
                <label className={LABEL_CLS}>Residential Status</label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {['Renting', 'Owner (Mortgage)', 'Owner (No Mortgage)', 'Living with Family'].map(r => (
                    <label key={r} className={`flex cursor-pointer items-center gap-3 rounded-xl p-3 transition-all ${watch('residential_status') === r ? 'bg-primary/5 ring-1 ring-primary/30' : 'bg-secondary hover:bg-secondary/80'}`}>
                      <input type="radio" value={r} {...register('residential_status')} className="h-4 w-4 accent-[var(--primary)]" />
                      <span className="text-[13px] font-medium text-foreground">{r}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className={LABEL_CLS}>Current Address</label>
                <Input placeholder="123 Main Street" {...register('applicant_address')} />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className={LABEL_CLS}>Suburb</label>
                  <Input placeholder="Sydney" {...register('applicant_suburb')} />
                </div>
                <div>
                  <label className={LABEL_CLS}>State</label>
                  <select {...register('applicant_state')} className={SELECT_CLS}>
                    {AU_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Postcode</label>
                  <Input placeholder="2000" maxLength={4} {...register('applicant_postcode')} />
                </div>
              </div>
              <div>
                <label className={LABEL_CLS}>Time at Current Address</label>
                <Input placeholder="e.g. 3 years" {...register('time_at_address')} />
              </div>
            </GlassCard>

            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-foreground">Household</h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className={LABEL_CLS}>Partner / Spouse?</label>
                  <select {...register('has_partner')} className={SELECT_CLS}>
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Number of Dependants</label>
                  <Input type="number" min="0" max="20" {...register('num_dependants')} />
                </div>
                {hasPartner === 'yes' && (
                  <div>
                    <label className={LABEL_CLS}>Partner Working?</label>
                    <select {...register('partner_working')} className={SELECT_CLS}>
                      <option value="no">No</option>
                      <option value="yes">Yes</option>
                    </select>
                  </div>
                )}
              </div>
            </GlassCard>

            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-foreground">Employment</h3>
              <div>
                <label className={LABEL_CLS}>Employment Type</label>
                <div className="flex gap-3">
                  {[{ value: 'employed', label: 'Employed' }, { value: 'self_employed', label: 'Self-Employed / Business Owner' }].map(opt => (
                    <label key={opt.value} className={`flex-1 cursor-pointer rounded-xl p-3 text-center text-[13px] font-medium transition-all ${employmentCategory === opt.value ? 'bg-primary/10 text-primary ring-1 ring-primary/30' : 'bg-secondary text-muted-foreground hover:bg-secondary/80'}`}>
                      <input type="radio" value={opt.value} {...register('employment_category')} className="sr-only" />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>

              {employmentCategory === 'employed' && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className={LABEL_CLS}>Employer Name</label>
                      <Input placeholder="Company Pty Ltd" {...register('employer_name')} />
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Industry</label>
                      <Input placeholder="e.g. Construction" {...register('employer_industry')} />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className={LABEL_CLS}>Job Title</label>
                      <Input placeholder="e.g. Project Manager" {...register('job_title')} />
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Employment Type</label>
                      <select {...register('employment_type_detail')} className={SELECT_CLS}>
                        {['Full Time', 'Part Time', 'Casual', 'Contract'].map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className={LABEL_CLS}>Employment Start Date</label>
                      <Input type="date" {...register('employment_start_date')} />
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Employer Contact <span className="font-normal">(optional)</span></label>
                      <Input placeholder="Name + phone" {...register('employer_contact_details')} />
                    </div>
                  </div>
                </>
              )}

              {employmentCategory === 'self_employed' && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div><label className={LABEL_CLS}>ABN</label><Input placeholder="12 345 678 901" {...register('business_abn')} /></div>
                    <div><label className={LABEL_CLS}>Business Name</label><Input placeholder="Your Business Pty Ltd" {...register('business_name')} /></div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div><label className={LABEL_CLS}>Trading Name <span className="font-normal">(if different)</span></label><Input placeholder="Trading As..." {...register('trading_name')} /></div>
                    <div>
                      <label className={LABEL_CLS}>Business Structure</label>
                      <select {...register('business_structure')} className={SELECT_CLS}>
                        {['Sole Trader', 'Partnership', 'Company', 'Trust'].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div><label className={LABEL_CLS}>Industry</label><Input placeholder="e.g. Retail" {...register('business_industry')} /></div>
                    <div><label className={LABEL_CLS}>Time Trading</label><Input placeholder="e.g. 5 years" {...register('time_trading')} /></div>
                    <div>
                      <label className={LABEL_CLS}>GST Registered?</label>
                      <select {...register('gst_registered')} className={SELECT_CLS}>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div><label className={LABEL_CLS}>No. of Directors / Partners</label><Input type="number" min="1" {...register('num_directors')} /></div>
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Other Directors / Partners <span className="font-normal">(optional)</span></label>
                    <textarea {...register('other_directors')} rows={2} className={TEXTAREA_CLS} placeholder="Name, role, ownership %" />
                  </div>
                </>
              )}
            </GlassCard>

            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-foreground">Income</h3>
              <div className="rounded-xl bg-secondary/40 p-4 space-y-3">
                <p className="text-[13px] font-semibold text-foreground">Primary Income</p>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label className={LABEL_CLS}>Type</label>
                    <select {...register('primary_income_type')} className={SELECT_CLS}>
                      {['Salary', 'Wages', 'Business Income', 'Rental Income', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Gross Amount ($)</label>
                    <Input type="number" step="0.01" min="0" placeholder="5,000" {...register('primary_income_amount')} />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Frequency</label>
                    <select {...register('primary_income_frequency')} className={SELECT_CLS}>
                      {['Weekly', 'Fortnightly', 'Monthly', 'Annually'].map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {additionalIncomes.map((inc, idx) => (
                <div key={idx} className="rounded-xl bg-secondary/40 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-medium text-muted-foreground">Additional Income {idx + 1}</span>
                    <button type="button" onClick={() => setAdditionalIncomes(prev => prev.filter((_, i) => i !== idx))} className="text-[12px] text-destructive hover:underline">Remove</button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className={LABEL_CLS}>Type</label>
                      <select value={inc.income_type} onChange={e => setAdditionalIncomes(prev => prev.map((it, i) => i === idx ? { ...it, income_type: e.target.value } : it))} className={SELECT_CLS}>
                        {['Rental Income', 'Overtime / Allowances', 'Centrelink', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Amount ($)</label>
                      <Input type="number" step="0.01" min="0" value={inc.amount} onChange={e => setAdditionalIncomes(prev => prev.map((it, i) => i === idx ? { ...it, amount: e.target.value } : it))} placeholder="1,000" />
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Frequency</label>
                      <select value={inc.frequency} onChange={e => setAdditionalIncomes(prev => prev.map((it, i) => i === idx ? { ...it, frequency: e.target.value } : it))} className={SELECT_CLS}>
                        {['Weekly', 'Fortnightly', 'Monthly', 'Annually'].map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => setAdditionalIncomes(prev => [...prev, blankIncome()])} className="text-[13px] text-primary font-medium hover:underline">+ Add Additional Income</button>
            </GlassCard>
          </>
        )}

        {/* ── Step 4: Financial Position (consumer / LEND only) ── */}
        {step === 4 && (tab === 'consumer' || lendEnabled) && (
          <>
            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-foreground">Real Estate Assets</h3>
              {realEstateAssets.map((asset, idx) => (
                <div key={idx} className="rounded-xl bg-secondary/40 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-semibold text-foreground">Property {idx + 1}</span>
                    <button type="button" onClick={() => setRealEstateAssets(prev => prev.filter((_, i) => i !== idx))} className="text-[12px] text-destructive hover:underline">Remove</button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className={LABEL_CLS}>Property Type</label>
                      <select value={asset.property_type} onChange={e => setRealEstateAssets(prev => prev.map((it, i) => i === idx ? { ...it, property_type: e.target.value } : it))} className={SELECT_CLS}>
                        <option value="Home">Home</option>
                        <option value="Investment">Investment Property</option>
                      </select>
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Ownership Type</label>
                      <select value={asset.ownership_type} onChange={e => setRealEstateAssets(prev => prev.map((it, i) => i === idx ? { ...it, ownership_type: e.target.value } : it))} className={SELECT_CLS}>
                        {['Sole', 'Joint', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Address</label>
                    <Input value={asset.address} onChange={e => setRealEstateAssets(prev => prev.map((it, i) => i === idx ? { ...it, address: e.target.value } : it))} placeholder="123 Main St, Sydney NSW 2000" />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className={LABEL_CLS}>Estimated Value ($)</label>
                      <Input type="number" step="0.01" min="0" value={asset.estimated_value} onChange={e => setRealEstateAssets(prev => prev.map((it, i) => i === idx ? { ...it, estimated_value: e.target.value } : it))} placeholder="800,000" />
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Is Financed?</label>
                      <select value={asset.is_financed} onChange={e => setRealEstateAssets(prev => prev.map((it, i) => i === idx ? { ...it, is_financed: e.target.value } : it))} className={SELECT_CLS}>
                        <option value="no">No</option>
                        <option value="yes">Yes</option>
                      </select>
                    </div>
                  </div>
                  {asset.is_financed === 'yes' && (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <label className={LABEL_CLS}>Lender</label>
                        <Input value={asset.lender} onChange={e => setRealEstateAssets(prev => prev.map((it, i) => i === idx ? { ...it, lender: e.target.value } : it))} placeholder="ANZ" />
                      </div>
                      <div>
                        <label className={LABEL_CLS}>Amount Owing ($)</label>
                        <Input type="number" step="0.01" min="0" value={asset.amount_owing} onChange={e => setRealEstateAssets(prev => prev.map((it, i) => i === idx ? { ...it, amount_owing: e.target.value } : it))} placeholder="400,000" />
                      </div>
                      <div>
                        <label className={LABEL_CLS}>Monthly Repayment ($)</label>
                        <Input type="number" step="0.01" min="0" value={asset.monthly_repayment} onChange={e => setRealEstateAssets(prev => prev.map((it, i) => i === idx ? { ...it, monthly_repayment: e.target.value } : it))} placeholder="2,500" />
                      </div>
                    </div>
                  )}
                  {asset.property_type === 'Investment' && (
                    <div>
                      <label className={LABEL_CLS}>Rental Income ($/month)</label>
                      <Input type="number" step="0.01" min="0" value={asset.rental_income} onChange={e => setRealEstateAssets(prev => prev.map((it, i) => i === idx ? { ...it, rental_income: e.target.value } : it))} placeholder="2,000" />
                    </div>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setRealEstateAssets(prev => [...prev, blankRealEstate()])} className="text-[13px] text-primary font-medium hover:underline">+ Add Property</button>
            </GlassCard>

            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-foreground">Other Assets</h3>
              {otherAssets.map((asset, idx) => (
                <div key={idx} className="flex items-end gap-3">
                  <div className="flex-1">
                    <label className={LABEL_CLS}>Asset Type</label>
                    <select value={asset.asset_type} onChange={e => setOtherAssets(prev => prev.map((it, i) => i === idx ? { ...it, asset_type: e.target.value } : it))} className={SELECT_CLS}>
                      {['Vehicles', 'Savings', 'Shares', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className={LABEL_CLS}>Value ($)</label>
                    <Input type="number" step="0.01" min="0" value={asset.value} onChange={e => setOtherAssets(prev => prev.map((it, i) => i === idx ? { ...it, value: e.target.value } : it))} placeholder="30,000" />
                  </div>
                  <button type="button" onClick={() => setOtherAssets(prev => prev.filter((_, i) => i !== idx))} className="mb-0.5 text-[12px] text-destructive hover:underline whitespace-nowrap">Remove</button>
                </div>
              ))}
              <button type="button" onClick={() => setOtherAssets(prev => [...prev, blankOtherAsset()])} className="text-[13px] text-primary font-medium hover:underline">+ Add Asset</button>
            </GlassCard>

            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-foreground">Liabilities</h3>
              {liabilities.map((liability, idx) => (
                <div key={idx} className="rounded-xl bg-secondary/40 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-semibold text-foreground">Liability {idx + 1}</span>
                    <button type="button" onClick={() => setLiabilities(prev => prev.filter((_, i) => i !== idx))} className="text-[12px] text-destructive hover:underline">Remove</button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className={LABEL_CLS}>Type</label>
                      <select value={liability.liability_type} onChange={e => setLiabilities(prev => prev.map((it, i) => i === idx ? { ...it, liability_type: e.target.value } : it))} className={SELECT_CLS}>
                        {['Home Loans', 'Personal Loans', 'Business Loans', 'Credit Cards', 'ATO / Tax Debt', 'Buy Now Pay Later', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Lender</label>
                      <Input value={liability.lender} onChange={e => setLiabilities(prev => prev.map((it, i) => i === idx ? { ...it, lender: e.target.value } : it))} placeholder="e.g. ANZ" />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className={LABEL_CLS}>Balance ($)</label>
                      <Input type="number" step="0.01" min="0" value={liability.balance} onChange={e => setLiabilities(prev => prev.map((it, i) => i === idx ? { ...it, balance: e.target.value } : it))} placeholder="50,000" />
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Limit ($) <span className="font-normal">(if applicable)</span></label>
                      <Input type="number" step="0.01" min="0" value={liability.limit} onChange={e => setLiabilities(prev => prev.map((it, i) => i === idx ? { ...it, limit: e.target.value } : it))} placeholder="10,000" />
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Monthly Repayment ($)</label>
                      <Input type="number" step="0.01" min="0" value={liability.monthly_repayment} onChange={e => setLiabilities(prev => prev.map((it, i) => i === idx ? { ...it, monthly_repayment: e.target.value } : it))} placeholder="500" />
                    </div>
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => setLiabilities(prev => [...prev, blankLiability()])} className="text-[13px] text-primary font-medium hover:underline">+ Add Liability</button>
            </GlassCard>

            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-foreground">Monthly Expenses</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label className={LABEL_CLS}>Estimated Living Expenses ($)</label><Input type="number" step="0.01" min="0" placeholder="3,000" {...register('monthly_living_expenses')} /></div>
                <div><label className={LABEL_CLS}>Rent / Mortgage Payments ($)</label><Input type="number" step="0.01" min="0" placeholder="2,000" {...register('rent_mortgage_payments')} /></div>
                <div><label className={LABEL_CLS}>Child Support ($) <span className="font-normal">(if applicable)</span></label><Input type="number" step="0.01" min="0" placeholder="0" {...register('child_support')} /></div>
                <div><label className={LABEL_CLS}>Other Regular Commitments ($)</label><Input type="number" step="0.01" min="0" placeholder="500" {...register('other_commitments')} /></div>
              </div>
            </GlassCard>
          </>
        )}

        {/* ── Step 5: Declarations ── */}
        {step === 5 && (
          <>
            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-foreground">Credit History</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={LABEL_CLS}>Previously declined for finance?</label>
                  <select {...register('previously_declined')} className={SELECT_CLS}>
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Any expected change of circumstances?</label>
                  <select {...register('change_of_circumstances')} className={SELECT_CLS}>
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </div>
              </div>
            </GlassCard>

            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-foreground">Emergency Contact</h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <div><label className={LABEL_CLS}>Name</label><Input placeholder="Jane Smith" {...register('emergency_contact_name')} /></div>
                <div><label className={LABEL_CLS}>Relationship</label><Input placeholder="Spouse, Parent, etc." {...register('emergency_contact_relationship')} /></div>
                <div><label className={LABEL_CLS}>Phone Number</label><Input type="tel" placeholder="04XX XXX XXX" {...register('emergency_contact_phone')} /></div>
              </div>
            </GlassCard>

            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-foreground">Signature</h3>
              <div>
                <label className={LABEL_CLS}>Digital Signature — Type client's full name</label>
                <Input placeholder="Client's full legal name" {...register('signature_name')} />
              </div>
              <p className="text-[12px] text-muted-foreground">Date: {new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
            </GlassCard>
          </>
        )}

        {/* ── Step 6: Review ── */}
        {step === 6 && (
          <GlassCard className="space-y-4">
            <h3 className="text-[15px] font-semibold text-foreground">Review Lead</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-secondary/50 p-3">
                <p className="text-[12px] font-medium text-muted-foreground">Client</p>
                <p className="text-[14px] font-semibold text-foreground">{[watch('applicant_title'), watch('applicant_first_name'), watch('applicant_last_name')].filter(Boolean).join(' ') || '—'}</p>
              </div>
              <div className="rounded-xl bg-secondary/50 p-3">
                <p className="text-[12px] font-medium text-muted-foreground">Contact</p>
                <p className="text-[14px] font-semibold text-foreground">{watch('applicant_mobile') || watch('applicant_email') || '—'}</p>
              </div>
              
              {/* Business info for commercial loans */}
              {!lendEnabled && tab === 'commercial' && comBusinessName && (
                <div className="rounded-xl bg-secondary/50 p-3">
                  <p className="text-[12px] font-medium text-muted-foreground">Business</p>
                  <p className="text-[14px] font-semibold text-foreground">{comBusinessName}</p>
                  {comAbn && <p className="text-[12px] text-muted-foreground">ABN: {comAbn}</p>}
                </div>
              )}
              
              <div className="rounded-xl bg-secondary/50 p-3">
                <p className="text-[12px] font-medium text-muted-foreground">Loan Type</p>
                <p className="text-[14px] font-semibold text-foreground capitalize">
                  {lendEnabled
                    ? (selectedLoanTypes.map(t => t.replace(/_/g, ' ')).join(', ') || '—')
                    : `${tab === 'consumer' ? 'Consumer' : 'Commercial'} · ${currentPurposeLabel || 'No purpose selected'}`}
                </p>
              </div>
              
              {/* Selected loan sub-type */}
              {!lendEnabled && tab === 'consumer' && selectedConsumerLoanType && (
                <div className="rounded-xl bg-secondary/50 p-3">
                  <p className="text-[12px] font-medium text-muted-foreground">Loan Category</p>
                  <p className="text-[14px] font-semibold text-foreground">
                    {CONSUMER_LOAN_TYPES.find(t => t.value === selectedConsumerLoanType)?.label}
                  </p>
                </div>
              )}
              {!lendEnabled && tab === 'commercial' && selectedCommercialLoanType && (
                <div className="rounded-xl bg-secondary/50 p-3">
                  <p className="text-[12px] font-medium text-muted-foreground">Loan Purpose</p>
                  <p className="text-[14px] font-semibold text-foreground">
                    {COMMERCIAL_LOAN_TYPES.find(t => t.value === selectedCommercialLoanType)?.label}
                  </p>
                </div>
              )}
              
              {!lendEnabled && (
                <div className="rounded-xl bg-secondary/50 p-3">
                  <p className="text-[12px] font-medium text-muted-foreground">Amount</p>
                  <p className="text-[14px] font-semibold text-foreground">${Number(watch('amount') || 0).toLocaleString()}</p>
                </div>
              )}
              {!skipEngagement && (
                <div className="rounded-xl bg-secondary/50 p-3">
                  <p className="text-[12px] font-medium text-muted-foreground">Engagement</p>
                  <p className="text-[14px] font-semibold text-foreground">{engagementModel === 'self_managed' ? 'Referrer manages' : 'Direct client contact'}</p>
                </div>
              )}
              {uploadedDocs.length > 0 && (
                <div className="rounded-xl bg-secondary/50 p-3">
                  <p className="text-[12px] font-medium text-muted-foreground">Documents</p>
                  <p className="text-[14px] font-semibold text-foreground">{uploadedDocs.length} uploaded</p>
                </div>
              )}
              {realEstateAssets.length > 0 && (
                <div className="rounded-xl bg-secondary/50 p-3 sm:col-span-2">
                  <p className="text-[12px] font-medium text-muted-foreground">Properties</p>
                  <p className="text-[14px] font-semibold text-foreground">{realEstateAssets.length} propert{realEstateAssets.length === 1 ? 'y' : 'ies'} listed</p>
                </div>
              )}
              {liabilities.length > 0 && (
                <div className="rounded-xl bg-secondary/50 p-3 sm:col-span-2">
                  <p className="text-[12px] font-medium text-muted-foreground">Liabilities</p>
                  <p className="text-[14px] font-semibold text-foreground">{liabilities.length} liabilit{liabilities.length === 1 ? 'y' : 'ies'} listed</p>
                </div>
              )}
            </div>
          </GlassCard>
        )}

        {/* ── Navigation ── */}
        <div className="flex flex-wrap gap-3">
          {step > 1 && (
            <Button type="button" variant="secondary" size="lg" onClick={goBack}>Back</Button>
          )}
          {step < maxInternalStep ? (
            <Button type="button" size="lg" onClick={goNext}>Continue</Button>
          ) : (
            <Button type="submit" size="lg" disabled={submitting}>
              {submitting ? 'Submitting...' : submitLabel}
            </Button>
          )}
          {step === 1 && (
            <Button type="button" variant="secondary" size="lg" onClick={() => { setClientEmail(watch('applicant_email') || ''); setShowSendModal(true); }}>
              Send to Client Instead
            </Button>
          )}
          {step > 1 && step < maxInternalStep && (
            <Button type="button" variant="secondary" size="lg" onClick={() => setStep(maxInternalStep)}>Skip to Review</Button>
          )}
          <Button type="button" variant="secondary" size="lg" onClick={() => navigate(basePath)}>Cancel</Button>
        </div>
      </form>

      {/* ── Send-to-client disclaimer modal ── */}
      {showSendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-background rounded-2xl p-6 max-w-md w-full shadow-xl space-y-4">
            <h3 className="text-[16px] font-semibold text-foreground">Send Form to Client</h3>

            <div className="rounded-xl bg-warning/10 border border-warning/30 p-4">
              <p className="text-[13px] font-semibold text-foreground mb-1">Important Notice</p>
              <p className="text-[13px] text-muted-foreground">
                The form will be branded as <strong>Xpress Finance</strong>. The client will receive an email from Xpress Finance asking them to complete their application details.
              </p>
            </div>

            <div>
              <label className={LABEL_CLS}>Client's Email Address *</label>
              <Input
                type="email"
                placeholder="client@example.com"
                value={clientEmail}
                onChange={e => setClientEmail(e.target.value)}
              />
            </div>

            <div className="flex gap-3 pt-1">
              <Button
                type="button"
                size="lg"
                onClick={handleConfirmSendToClient}
                disabled={!clientEmail.trim() || sendingInvite}
              >
                {sendingInvite ? 'Sending...' : 'Send to Client'}
              </Button>
              <Button type="button" variant="secondary" size="lg" onClick={() => setShowSendModal(false)}>
                Cancel — I'll fill it myself
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
