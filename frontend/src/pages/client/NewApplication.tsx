import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/Toast';
import { getErrorMessage } from '../../lib/utils';
import { GlassCard, Button, Input, AbrResultCard, DatePicker, LoanTypeIcon } from '../../components/ui';
import { useAbrLookup } from '../../hooks/useAbrLookup';
import {
  AU_STATES, TITLE_OPTIONS, GENDER_OPTIONS, MARITAL_STATUS_OPTIONS, DOC_TYPE_LABELS,
  CONSUMER_LOAN_TYPES, COMMERCIAL_LOAN_TYPES, VEHICLE_MAKES, PROPERTY_TYPES,
  EQUIPMENT_TYPES, LOAN_TERM_OPTIONS, VEHICLE_CONDITION_OPTIONS
} from '../../lib/constants';
import type { DocType } from '../../types';

const SELECT_CLS = 'led-input';
const TEXTAREA_CLS = 'w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background placeholder:text-muted-foreground border border-transparent resize-none';
const LABEL_CLS = 'block text-[13px] font-medium text-muted-foreground mb-2';

interface AbnCompanyMatch {
  id: string;
  name: string;
  industry: string | null;
}

function useAbnCompanyLookup(abn: string): AbnCompanyMatch | null {
  const [match, setMatch] = useState<AbnCompanyMatch | null>(null);
  useEffect(() => {
    const digits = (abn || '').replace(/\D/g, '');
    if (digits.length < 4) { setMatch(null); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      api.get('/organizations/lookup', { params: { abn: digits } })
        .then(({ data }) => { if (!cancelled) setMatch(data.organization || null); })
        .catch(() => { if (!cancelled) setMatch(null); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [abn]);
  return match;
}

function AbnHint({ match, onUseName }: { match: AbnCompanyMatch | null; onUseName?: (name: string) => void }) {
  if (!match) return null;
  return (
    <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg bg-success/10 px-3 py-2 text-[12px] text-success">
      <span>
        Found existing company: <strong>{match.name}</strong>{match.industry ? ` · ${match.industry}` : ''}
      </span>
      {onUseName && (
        <button
          type="button"
          className="text-[12px] font-medium underline hover:opacity-80"
          onClick={() => onUseName(match.name)}
        >
          Use this name
        </button>
      )}
    </div>
  );
}


interface FormData {
  // Non-lend simple path
  loan_type: string;
  amount: string;
  notes: string;
  // Personal
  applicant_title: string;
  applicant_first_name: string;
  applicant_middle_name: string;
  applicant_last_name: string;
  applicant_dob: string;
  applicant_gender: string;
  applicant_marital_status: string;
  num_dependants: string;
  // Contact
  applicant_email: string;
  applicant_mobile: string;
  preferred_contact_method: string;
  // Identification
  id_type: string;
  id_number: string;
  id_issuing_state_country: string;
  id_expiry_date: string;
  // Residency
  residency_status: string;
  residency_other: string;
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
  // Living situation
  residential_status: string;
  applicant_address: string;
  applicant_suburb: string;
  applicant_state: string;
  applicant_postcode: string;
  time_at_address: string;
  has_partner: string;
  partner_working: string;
  // Employment — employed
  employment_category: string;
  employer_name: string;
  employer_industry: string;
  job_title: string;
  employment_type_detail: string;
  employment_start_date: string;
  income_frequency: string;
  gross_income: string;
  employer_contact_details: string;
  // Employment — self-employed
  business_abn: string;
  business_name: string;
  trading_name: string;
  business_structure: string;
  business_industry: string;
  time_trading: string;
  gst_registered: string;
  num_directors: string;
  other_directors: string;
  // Income
  primary_income_type: string;
  primary_income_amount: string;
  primary_income_frequency: string;
  // Expenses
  monthly_living_expenses: string;
  rent_mortgage_payments: string;
  child_support: string;
  other_commitments: string;
  // Declarations
  previously_declined: string;
  change_of_circumstances: string;
  emergency_contact_name: string;
  emergency_contact_relationship: string;
  emergency_contact_phone: string;
  signature_name: string;
}

interface AdditionalIncome {
  income_type: string;
  amount: string;
  frequency: string;
}

interface RealEstateAsset {
  property_type: string;
  address: string;
  estimated_value: string;
  ownership_type: string;
  is_financed: string;
  lender: string;
  amount_owing: string;
  monthly_repayment: string;
  rental_income: string;
}

interface OtherAsset {
  asset_type: string;
  value: string;
}

interface Liability {
  liability_type: string;
  lender: string;
  balance: string;
  limit: string;
  monthly_repayment: string;
}

interface UploadedDoc { id: string; filename: string; doc_type: string; label?: string; }

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
  { id: 1, label: 'Working capital/ overdraft' }, { id: 3, label: 'Vehicle/car/ transport/ Equipment / Machinery' },
  { id: 14, label: 'Machinery or Equipment' }, { id: 13, label: 'Fitouts / Biz Expansion/grow staff' },
  { id: 19, label: 'Staff Recruitment Costs' }, { id: 11, label: 'Expansion' },
  { id: 4, label: 'Renovation' }, { id: 15, label: 'Pay Domestic or International Suppliers' },
  { id: 18, label: 'Invoice financing/ pay to international suppliers' }, { id: 16, label: 'Development finance & Construction' },
  { id: 17, label: 'Development & Construction' }, { id: 9, label: 'Start a new business/ Purchase an existing business' },
  { id: 10, label: 'Purchase Existing Business' }, { id: 8, label: 'Other' },
];

const LEND_LOAN_TYPES = [
  { value: 'equipment_finance', label: 'Equipment Finance', description: 'Finance equipment, machinery and vehicles' },
  { value: 'business_loan', label: 'Business Loan', description: 'Working capital, growth or refinancing' },
  { value: 'commercial_property', label: 'Commercial Property', description: 'Purchase or refinance commercial real estate' },
  { value: 'home_loan', label: 'Home Loan', description: 'Purchase or refinance residential property' },
];

const CONSUMER_TYPE_TO_PURPOSE_ID: Record<string, number> = {
  car: 20, motorcycle: 21, caravan: 22, other_vehicle: 23, personal: 24, purchase: 42, refinance: 41,
};

const COMMERCIAL_TYPE_TO_PURPOSE_ID: Record<string, number> = {
  day_to_day_capital: 1, vehicles_or_transport: 3, machinery_or_equipment: 14, new_fit_out: 13,
  staff_recruitment: 19, expansion: 11, renovation: 4, pay_suppliers: 15,
  waiting_for_invoices: 18, property: 16, development_construction: 17,
  new_business: 9, purchase_business: 10, other: 8,
};


const blankRealEstate = (): RealEstateAsset => ({
  property_type: 'Home', address: '', estimated_value: '', ownership_type: 'Sole',
  is_financed: 'no', lender: '', amount_owing: '', monthly_repayment: '', rental_income: '',
});

const blankOtherAsset = (): OtherAsset => ({ asset_type: 'Vehicles', value: '' });

const blankLiability = (): Liability => ({
  liability_type: 'Home Loans', lender: '', balance: '', limit: '', monthly_repayment: '',
});

const blankIncome = (): AdditionalIncome => ({ income_type: 'Rental Income', amount: '', frequency: 'Monthly' });

export default function NewApplication() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const completeId = searchParams.get('completeId') || '';

  const [lendEnabled, setLendEnabled] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [checked, setChecked] = useState(false);
  const [isOwnDraftEdit, setIsOwnDraftEdit] = useState(false);
  const [completeLoading, setCompleteLoading] = useState(!!completeId);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [autosaveReady, setAutosaveReady] = useState(!completeId);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const performAutosaveRef = useRef<() => void>(() => {});
  const draftStorageKey = user?.id ? `application-draft-${user.id}` : null;

  // Fields prefilled from the client's saved profile, for the "review" hint.
  const [prefilledFields, setPrefilledFields] = useState<Set<string>>(new Set());
  const [showPrefillHint, setShowPrefillHint] = useState(false);

  const [selectedLoanTypes, setSelectedLoanTypes] = useState<string[]>([]);
  const [loanTypeError, setLoanTypeError] = useState('');

  // Broker-selected sections the client may complete. null = all visible.
  const [enabledSections, setEnabledSections] = useState<Set<string> | null>(null);
  const isSectionVisible = (key: string) => !enabledSections || enabledSections.has(key);

  const [additionalIncomes, setAdditionalIncomes] = useState<AdditionalIncome[]>([]);
  const [realEstateAssets, setRealEstateAssets] = useState<RealEstateAsset[]>([]);
  const [otherAssets, setOtherAssets] = useState<OtherAsset[]>([]);
  const [liabilities, setLiabilities] = useState<Liability[]>([]);

  const [tab, setTab] = useState<'consumer' | 'commercial'>('consumer');
  const [comBusinessName, setComBusinessName] = useState('');
  const [comAbn, setComAbn] = useState('');
  const [parentIndustryId, setParentIndustryId] = useState<number | ''>('');
  const [subIndustryId, setSubIndustryId] = useState<number | ''>('');
  const [comPostcode, setComPostcode] = useState('');
  const [comMonthlySales, setComMonthlySales] = useState('');

  // Selected loan sub-types for comprehensive fields
  const [selectedConsumerLoanType, setSelectedConsumerLoanType] = useState<string>('');
  const [selectedCommercialLoanType, setSelectedCommercialLoanType] = useState<string>('');

  const purposeId: number | '' = CONSUMER_TYPE_TO_PURPOSE_ID[selectedConsumerLoanType] ?? '';
  const commercialPurposeId: number | '' = COMMERCIAL_TYPE_TO_PURPOSE_ID[selectedCommercialLoanType] ?? '';

  const pendingFileInput = useRef<HTMLInputElement>(null);
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([]);
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const [stagedDocType, setStagedDocType] = useState<DocType>('other');
  const [stagedLabel, setStagedLabel] = useState('');
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const selectedParent = INDUSTRIES.find(i => i.id === parentIndustryId);
  const subChildren = selectedParent?.children ?? [];
  const resolvedIndustryId = (): number | undefined => {
    if (subIndustryId) return subIndustryId as number;
    if (parentIndustryId) return parentIndustryId as number;
    return undefined;
  };

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
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
      residential_status: 'Owner (Mortgage)',
      employment_category: 'employed',
      employment_type_detail: 'Full Time',
      income_frequency: 'Monthly',
      primary_income_type: 'Salary',
      primary_income_frequency: 'Monthly',
      gst_registered: 'no',
      num_directors: '1',
      previously_declined: 'no',
      change_of_circumstances: 'no',
      eq_new_or_used: 'New',
      eq_vendor_type: 'Dealer',
      cp_purchase_or_refinance: 'Purchase',
      hl_purchase_or_refinance: 'Purchase',
      hl_owner_or_investment: 'Owner Occupied',
      bl_purpose_type: 'Working Capital',
      preferred_contact_method: 'Mobile',
      // Comprehensive loan defaults
      vehicle_condition: 'New',
      loan_term: '5 years',
      first_home_buyer: 'no',
      vendor_type: 'Dealer',
      vehicle_type: 'Car',
      equipment_type: 'Truck',
    },
  });

  const watchedBusinessAbn = watch('business_abn') || '';
  const commercialAbnMatch = useAbnCompanyLookup(comAbn);
  const selfEmployedAbnMatch = useAbnCompanyLookup(watchedBusinessAbn);
  // ABR fallback — only fired when there's no local Company match
  const commercialAbr = useAbrLookup(commercialAbnMatch ? '' : comAbn);
  const selfEmployedAbr = useAbrLookup(selfEmployedAbnMatch ? '' : watchedBusinessAbn);

  const idType = watch('id_type');
  const residencyStatus = watch('residency_status');
  const employmentCategory = watch('employment_category');
  const hasPartner = watch('has_partner');

  useEffect(() => {
    api.get('/lend/config').then(({ data }) => setLendEnabled(data.enabled)).catch(() => {});
  }, []);

  useEffect(() => {
    if (user?.full_name) {
      const parts = user.full_name.split(' ');
      if (!getValues('applicant_first_name')) setValue('applicant_first_name', parts[0] || '');
      if (parts.length > 2) {
        if (!getValues('applicant_middle_name')) setValue('applicant_middle_name', parts.slice(1, -1).join(' '));
        if (!getValues('applicant_last_name')) setValue('applicant_last_name', parts[parts.length - 1]);
      } else if (parts.length === 2) {
        if (!getValues('applicant_last_name')) setValue('applicant_last_name', parts[1]);
      }
    }
    if (user?.email && !getValues('applicant_email')) setValue('applicant_email', user.email);
  }, [user, setValue, getValues]);

  // Prefill from an existing draft application when completing a direct referral or editing own draft.
  useEffect(() => {
    if (!completeId) return;
    let cancelled = false;
    api.get(`/applications/${completeId}`)
      .then(({ data }) => {
        if (cancelled || !data) return;

        // Detect if the client is editing their own draft
        if (user?.id && data.user_id === user.id) {
          setIsOwnDraftEdit(true);
        }

        // Broker-selected sections (null/absent = all visible).
        if (data.client_sections) {
          try {
            const parsed = JSON.parse(data.client_sections);
            if (Array.isArray(parsed)) setEnabledSections(new Set(parsed.filter((s: unknown): s is string => typeof s === 'string')));
          } catch { /* ignore malformed — leave all visible */ }
        }

        const lendData = (() => {
          if (!data.lend_extra_data) return {} as Record<string, unknown>;
          try { return JSON.parse(data.lend_extra_data) as Record<string, unknown>; }
          catch { return {} as Record<string, unknown>; }
        })();
        const loanTypeDetails = (lendData.loan_type_details ?? {}) as Record<string, Record<string, unknown> | undefined>;

        const lt = data.loan_type as string | undefined;
        const COMMERCIAL_LTS = new Set(['equipment_finance', 'business_loan', 'commercial_property', 'business']);
        const isCommercial = lt ? COMMERCIAL_LTS.has(lt) : false;
        setTab(isCommercial ? 'commercial' : 'consumer');

        if (isCommercial) {
          const cType = (loanTypeDetails.commercial_loan_type as { type?: string } | undefined)?.type;
          if (cType) setSelectedCommercialLoanType(cType);
        } else {
          const cType = (loanTypeDetails.consumer_loan_type as { type?: string } | undefined)?.type;
          if (cType) setSelectedConsumerLoanType(cType);
          else if (lt === 'personal') setSelectedConsumerLoanType('personal');
        }

        if (lt) setSelectedLoanTypes([lt]);

        // Core loan fields
        if (data.amount != null) setValue('amount', String(data.amount));
        if (data.notes) setValue('notes', data.notes);

        // Personal details
        if (data.applicant_title) setValue('applicant_title', data.applicant_title);
        if (data.applicant_first_name) setValue('applicant_first_name', data.applicant_first_name);
        if (data.applicant_middle_name) setValue('applicant_middle_name', data.applicant_middle_name);
        if (data.applicant_last_name) setValue('applicant_last_name', data.applicant_last_name);
        if (data.applicant_dob) setValue('applicant_dob', data.applicant_dob);
        if (data.applicant_gender) setValue('applicant_gender', data.applicant_gender);
        if (data.applicant_marital_status) setValue('applicant_marital_status', data.applicant_marital_status);
        if (data.applicant_num_dependants != null) setValue('num_dependants', String(data.applicant_num_dependants));

        // Contact
        if (data.applicant_email) setValue('applicant_email', data.applicant_email);
        if (data.applicant_mobile) setValue('applicant_mobile', data.applicant_mobile);
        if (data.preferred_contact_method) setValue('preferred_contact_method', data.preferred_contact_method);

        // Residency / ID
        if (data.applicant_residency_status) setValue('residency_status', data.applicant_residency_status);
        if (data.id_expiry_date) setValue('id_expiry_date', data.id_expiry_date);

        // Address
        if (data.applicant_address) setValue('applicant_address', data.applicant_address);
        if (data.applicant_suburb) setValue('applicant_suburb', data.applicant_suburb);
        if (data.applicant_state) setValue('applicant_state', data.applicant_state);
        if (data.applicant_postcode) {
          setValue('applicant_postcode', data.applicant_postcode);
          if (isCommercial) setComPostcode(data.applicant_postcode);
        }
        if (data.residential_status) setValue('residential_status', data.residential_status);
        if (data.time_at_address) setValue('time_at_address', data.time_at_address);
        if (data.has_partner != null) setValue('has_partner', data.has_partner ? 'yes' : 'no');
        if (data.partner_working != null) setValue('partner_working', data.partner_working ? 'yes' : 'no');

        // Employment
        if (data.employment_category) setValue('employment_category', data.employment_category);
        if (data.employer_name) setValue('employer_name', data.employer_name);
        if (data.employer_industry) setValue('employer_industry', data.employer_industry);
        if (data.job_title) setValue('job_title', data.job_title);
        if (data.income_frequency) setValue('income_frequency', data.income_frequency);
        if (data.gross_income != null) setValue('gross_income', String(data.gross_income));

        // Self-employed / business
        if (data.business_name) {
          setComBusinessName(data.business_name);
          setValue('business_name', data.business_name);
        }
        if (data.business_abn) {
          setComAbn(data.business_abn);
          setValue('business_abn', data.business_abn);
        }
        if (data.trading_name) setValue('trading_name', data.trading_name);
        if (data.business_structure) setValue('business_structure', data.business_structure);
        if (data.time_trading) setValue('time_trading', data.time_trading);
        if (data.gst_registered != null) setValue('gst_registered', data.gst_registered ? 'yes' : 'no');
        if (data.num_directors != null) setValue('num_directors', String(data.num_directors));
        if (data.business_monthly_sales != null) setComMonthlySales(String(data.business_monthly_sales));

        // Emergency contact
        if (data.emergency_contact_name) setValue('emergency_contact_name', data.emergency_contact_name);
        if (data.emergency_contact_relationship) setValue('emergency_contact_relationship', data.emergency_contact_relationship);
        if (data.emergency_contact_phone) setValue('emergency_contact_phone', data.emergency_contact_phone);

        // Declarations
        if (data.previously_declined != null) setValue('previously_declined', data.previously_declined ? 'yes' : 'no');
        if (data.change_of_circumstances != null) setValue('change_of_circumstances', data.change_of_circumstances ? 'yes' : 'no');
        if (data.signature_name) setValue('signature_name', data.signature_name);

        // Loan type-specific fields from lend_extra_data
        const vehicleDetails = loanTypeDetails.vehicle_details as Record<string, unknown> | undefined;
        if (vehicleDetails) {
          if (vehicleDetails.make) setValue('vehicle_make', vehicleDetails.make as string);
          if (vehicleDetails.model) setValue('vehicle_model', vehicleDetails.model as string);
          if (vehicleDetails.year) setValue('vehicle_year', vehicleDetails.year as string);
          if (vehicleDetails.vin) setValue('vehicle_vin', vehicleDetails.vin as string);
          if (vehicleDetails.condition) setValue('vehicle_condition', vehicleDetails.condition as string);
          if (vehicleDetails.price) setValue('vehicle_price', String(vehicleDetails.price));
          if (vehicleDetails.deposit) setValue('deposit_amount', String(vehicleDetails.deposit));
        }

        const propertyDetails = loanTypeDetails.property_details as Record<string, unknown> | undefined;
        if (propertyDetails) {
          if (propertyDetails.address) setValue('property_address', propertyDetails.address as string);
          if (propertyDetails.property_type) setValue('property_type', propertyDetails.property_type as string);
          if (propertyDetails.value) setValue('property_value', String(propertyDetails.value));
          if (propertyDetails.first_home_buyer != null) setValue('first_home_buyer', propertyDetails.first_home_buyer ? 'yes' : 'no');
          if (propertyDetails.current_lender) setValue('current_lender', propertyDetails.current_lender as string);
          if (propertyDetails.refinance_reason) setValue('refinance_reason', propertyDetails.refinance_reason as string);
          if (propertyDetails.property_use) setValue('property_use', propertyDetails.property_use as string);
        }

        const personalLoan = loanTypeDetails.personal_loan as Record<string, unknown> | undefined;
        if (personalLoan) {
          if (personalLoan.purpose) setValue('loan_purpose', personalLoan.purpose as string);
          if (personalLoan.term) setValue('loan_term', personalLoan.term as string);
        }

        const assetDetails = loanTypeDetails.asset_details as Record<string, unknown> | undefined;
        if (assetDetails) {
          if (assetDetails.equipment_type) setValue('equipment_type', assetDetails.equipment_type as string);
          if (assetDetails.description) setValue('equipment_description', assetDetails.description as string);
          if (assetDetails.condition) setValue('vehicle_condition', assetDetails.condition as string);
          if (assetDetails.price) setValue('vehicle_price', String(assetDetails.price));
          if (assetDetails.deposit) setValue('deposit_amount', String(assetDetails.deposit));
          if (assetDetails.vendor_type) setValue('vendor_type', assetDetails.vendor_type as string);
          if (assetDetails.business_use_pct) setValue('eq_business_use_pct', String(assetDetails.business_use_pct));
        }

        const workingCapital = loanTypeDetails.working_capital as Record<string, unknown> | undefined;
        if (workingCapital) {
          if (workingCapital.recruitment_details) setValue('recruitment_details', workingCapital.recruitment_details as string);
          if (workingCapital.expansion_description) setValue('expansion_description', workingCapital.expansion_description as string);
          if (workingCapital.supplier_details) setValue('supplier_details', workingCapital.supplier_details as string);
          if (workingCapital.outstanding_invoices) setValue('outstanding_invoices', workingCapital.outstanding_invoices as string);
          if (workingCapital.purpose_description) setValue('purpose_description', workingCapital.purpose_description as string);
        }

        const businessDetails = loanTypeDetails.business_details as Record<string, unknown> | undefined;
        if (businessDetails) {
          if (businessDetails.business_plan) setValue('business_plan', businessDetails.business_plan as string);
          if (businessDetails.startup_costs) setValue('startup_costs', String(businessDetails.startup_costs));
          if (businessDetails.business_details) setValue('business_details', businessDetails.business_details as string);
          if (businessDetails.purchase_price) setValue('purchase_price', String(businessDetails.purchase_price));
          if (businessDetails.business_type) setValue('business_type', businessDetails.business_type as string);
        }
      })
      .catch(() => toast('Could not load your application. You can still fill the form below.', 'error'))
      .finally(() => {
        if (cancelled) return;
        setCompleteLoading(false);
        setAutosaveReady(true);
      });
    return () => { cancelled = true; };
  }, [completeId, user?.id, setValue, toast]);

  // Restore an in-progress draft from localStorage (only for fresh /applications/new — not the completeId flow).
  useEffect(() => {
    if (completeId) return;
    if (!draftStorageKey) return;
    let raw: string | null = null;
    try { raw = localStorage.getItem(draftStorageKey); } catch { return; }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        formData?: Partial<FormData>;
        tab?: 'consumer' | 'commercial';
        comBusinessName?: string;
        comAbn?: string;
        parentIndustryId?: number | '';
        subIndustryId?: number | '';
        comPostcode?: string;
        comMonthlySales?: string;
        selectedLoanTypes?: string[];
        selectedConsumerLoanType?: string;
        selectedCommercialLoanType?: string;
        additionalIncomes?: AdditionalIncome[];
        realEstateAssets?: RealEstateAsset[];
        otherAssets?: OtherAsset[];
        liabilities?: Liability[];
        acknowledged?: boolean;
        savedAt?: string;
      };
      if (parsed.formData) {
        Object.entries(parsed.formData).forEach(([k, v]) => {
          if (v !== undefined && v !== null) setValue(k as keyof FormData, v as never);
        });
      }
      if (parsed.tab) setTab(parsed.tab);
      if (parsed.comBusinessName) setComBusinessName(parsed.comBusinessName);
      if (parsed.comAbn) setComAbn(parsed.comAbn);
      if (parsed.parentIndustryId !== undefined) setParentIndustryId(parsed.parentIndustryId);
      if (parsed.subIndustryId !== undefined) setSubIndustryId(parsed.subIndustryId);
      if (parsed.comPostcode) setComPostcode(parsed.comPostcode);
      if (parsed.comMonthlySales) setComMonthlySales(parsed.comMonthlySales);
      if (parsed.selectedLoanTypes) setSelectedLoanTypes(parsed.selectedLoanTypes);
      if (parsed.selectedConsumerLoanType) setSelectedConsumerLoanType(parsed.selectedConsumerLoanType);
      if (parsed.selectedCommercialLoanType) setSelectedCommercialLoanType(parsed.selectedCommercialLoanType);
      if (parsed.additionalIncomes) setAdditionalIncomes(parsed.additionalIncomes);
      if (parsed.realEstateAssets) setRealEstateAssets(parsed.realEstateAssets);
      if (parsed.otherAssets) setOtherAssets(parsed.otherAssets);
      if (parsed.liabilities) setLiabilities(parsed.liabilities);
      if (parsed.acknowledged) {
        setAcknowledged(true);
        setChecked(true);
      }
      if (parsed.savedAt) setLastSavedAt(new Date(parsed.savedAt));
    } catch { /* ignore malformed draft */ }
  // Run once on mount per user.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftStorageKey, completeId]);

  // Prefill constant personal details from the client's saved profile on a fresh
  // new application. Skipped when completing/editing an existing app, and when an
  // in-progress local draft already exists (that draft takes precedence).
  useEffect(() => {
    if (completeId) return;
    if (!user?.id) return;
    if (draftStorageKey) {
      try {
        if (localStorage.getItem(draftStorageKey)) return;
      } catch { /* ignore */ }
    }
    let cancelled = false;
    const NAME_FIELDS = new Set(['applicant_first_name', 'applicant_middle_name', 'applicant_last_name']);
    const PROFILE_FIELDS: (keyof FormData)[] = [
      'applicant_title', 'applicant_first_name', 'applicant_middle_name', 'applicant_last_name',
      'applicant_dob', 'applicant_gender', 'applicant_mobile', 'preferred_contact_method',
      'id_type', 'id_number', 'id_issuing_state_country', 'id_expiry_date', 'residency_status',
      'emergency_contact_name', 'emergency_contact_relationship', 'emergency_contact_phone',
    ];
    api.get('/users/me/profile')
      .then(({ data }) => {
        if (cancelled || !data) return;
        const filled = new Set<string>();
        PROFILE_FIELDS.forEach((f) => {
          const v = (data as Record<string, unknown>)[f];
          if (v == null || v === '') return;
          // Defer name fields to the account-derived values populated above.
          if (NAME_FIELDS.has(f) && getValues(f)) return;
          setValue(f, v as never);
          filled.add(f);
        });
        if (filled.size > 0) {
          setPrefilledFields(filled);
          setShowPrefillHint(true);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [completeId, user?.id, draftStorageKey, getValues, setValue]);

  // Keep the autosave routine current with the latest state via a ref so the
  // scheduling effect doesn't have to re-subscribe on every keystroke.
  performAutosaveRef.current = () => {
    if (!acknowledged) return;
    const data = getValues();
    if (completeId) {
      const payload = buildPayload(data);
      setSaveStatus('saving');
      api.patch(`/applications/${completeId}`, payload)
        .then(() => { setSaveStatus('saved'); setLastSavedAt(new Date()); })
        .catch(() => setSaveStatus('error'));
    } else {
      if (!draftStorageKey) return;
      try {
        localStorage.setItem(draftStorageKey, JSON.stringify({
          formData: data,
          tab,
          comBusinessName,
          comAbn,
          parentIndustryId,
          subIndustryId,
          comPostcode,
          comMonthlySales,
          selectedLoanTypes,
          selectedConsumerLoanType,
          selectedCommercialLoanType,
          additionalIncomes,
          realEstateAssets,
          otherAssets,
          liabilities,
          acknowledged,
          savedAt: new Date().toISOString(),
        }));
        setSaveStatus('saved');
        setLastSavedAt(new Date());
      } catch {
        setSaveStatus('error');
      }
    }
  };

  const scheduleAutosave = () => {
    if (!autosaveReady) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => performAutosaveRef.current(), 1500);
  };

  // Trigger autosave on any react-hook-form field change.
  useEffect(() => {
    const sub = watch(() => scheduleAutosave());
    return () => sub.unsubscribe();
  // scheduleAutosave intentionally not in deps — performAutosaveRef carries fresh state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watch, autosaveReady]);

  // Trigger autosave on local-state changes (tab, sub-loan type, lists, etc.).
  useEffect(() => {
    scheduleAutosave();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    autosaveReady,
    tab, comBusinessName, comAbn,
    parentIndustryId, subIndustryId, comPostcode, comMonthlySales,
    selectedLoanTypes, selectedConsumerLoanType, selectedCommercialLoanType,
    additionalIncomes, realEstateAssets, otherAssets, liabilities,
    acknowledged,
  ]);


  const toggleLoanType = (type: string) => {
    setSelectedLoanTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
    setLoanTypeError('');
  };

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
    if (!stagedFile) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', stagedFile);
      const { data: docData } = await api.post('/documents/upload?doc_type=' + stagedDocType + (stagedLabel.trim() ? '&label=' + encodeURIComponent(stagedLabel.trim()) : ''), fd);
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


  const buildPayload = (data: FormData): Record<string, unknown> => {
    const extraData: Record<string, unknown> = {};

    if (lendEnabled) {
      extraData.selected_loan_types = selectedLoanTypes;

      const loanTypeDetails: Record<string, unknown> = {};
      if (selectedLoanTypes.includes('equipment_finance')) {
        loanTypeDetails.equipment_finance = {
          asset_type: data.eq_asset_type,
          new_or_used: data.eq_new_or_used,
          asset_price: parseFloat(data.eq_asset_price) || 0,
          deposit_amount: parseFloat(data.eq_deposit_amount) || 0,
          vendor_type: data.eq_vendor_type,
          estimated_repayment: parseFloat(data.eq_estimated_repayment) || 0,
          loan_term: data.eq_loan_term,
          business_use_pct: parseFloat(data.eq_business_use_pct) || 0,
        };
      }
      if (selectedLoanTypes.includes('business_loan')) {
        loanTypeDetails.business_loan = {
          loan_purpose: data.bl_loan_purpose,
          loan_amount: parseFloat(data.bl_loan_amount) || 0,
          loan_term: data.bl_loan_term,
          purpose_type: data.bl_purpose_type,
        };
      }
      if (selectedLoanTypes.includes('commercial_property')) {
        loanTypeDetails.commercial_property = {
          purchase_or_refinance: data.cp_purchase_or_refinance,
          security_address: data.cp_security_address,
          estimated_value: parseFloat(data.cp_estimated_value) || 0,
          existing_debt: parseFloat(data.cp_existing_debt) || 0,
        };
      }
      if (selectedLoanTypes.includes('home_loan')) {
        loanTypeDetails.home_loan = {
          purchase_or_refinance: data.hl_purchase_or_refinance,
          owner_or_investment: data.hl_owner_or_investment,
          property_value: parseFloat(data.hl_property_value) || 0,
          existing_lender: data.hl_existing_lender || null,
        };
      }
      extraData.loan_type_details = loanTypeDetails;

      const identification: Record<string, string>[] = [];
      if (data.id_number) {
        identification.push({
          type: data.id_type === 'license' ? 'Drivers Licence' : 'Passport',
          number: data.id_number,
          [data.id_type === 'license' ? 'state' : 'country']: data.id_issuing_state_country,
          expiry_date: data.id_expiry_date,
        });
      }
      extraData.identification = identification;

      extraData.employments = [{
        employer_name: data.employer_name,
        employment_type: data.employment_type_detail,
        start_date: data.employment_start_date,
        industry: data.employer_industry || data.business_industry,
        job_title: data.job_title,
        contact_details: data.employer_contact_details,
      }];

      const primaryIncome = { income_type: data.primary_income_type, amount: parseFloat(data.primary_income_amount) || 0, frequency: data.primary_income_frequency };
      const extraIncomes = additionalIncomes.map(ai => ({ income_type: ai.income_type, amount: parseFloat(ai.amount) || 0, frequency: ai.frequency }));
      extraData.incomes = [primaryIncome, ...extraIncomes].filter(i => i.amount > 0);
      extraData.additional_incomes = additionalIncomes;

      extraData.dependants = parseInt(data.num_dependants) || 0;
      extraData.credit_history = data.previously_declined === 'yes' ? 'Previously Declined' : 'Clear';
      extraData.residency_status = data.residency_status;
      extraData.living_status = data.residential_status;

      extraData.assets = { real_estate: realEstateAssets, other: otherAssets };
      extraData.liabilities = liabilities;
      extraData.expenses = {
        monthly_living: parseFloat(data.monthly_living_expenses) || 0,
        rent_mortgage: parseFloat(data.rent_mortgage_payments) || 0,
        child_support: parseFloat(data.child_support) || 0,
        other_commitments: parseFloat(data.other_commitments) || 0,
      };

      if (data.other_directors) extraData.other_directors = data.other_directors;
    } else {
      // Add comprehensive loan type data for non-LEND mode
      const loanTypeDetails: Record<string, unknown> = {};

      if (tab === 'consumer' && selectedConsumerLoanType) {
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

      if (tab === 'commercial' && selectedCommercialLoanType) {
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
      mainAmount = parseFloat(data.amount) || 0;
    }

    const payload: Record<string, unknown> = {
      loan_type: lendEnabled ? (selectedLoanTypes[0] || 'equipment_finance') : (tab === 'consumer' ? 'personal' : 'business_loan'),
      amount: mainAmount,
      notes: data.notes || null,
    };

      if (!lendEnabled) {
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
      }

      payload.applicant_title = data.applicant_title;
      payload.applicant_first_name = data.applicant_first_name;
      payload.applicant_middle_name = data.applicant_middle_name || null;
      payload.applicant_last_name = data.applicant_last_name;
      payload.applicant_dob = data.applicant_dob || null;
      payload.applicant_gender = data.applicant_gender;
      payload.applicant_marital_status = data.applicant_marital_status;
      payload.applicant_mobile = data.applicant_mobile;
      payload.preferred_contact_method = data.preferred_contact_method;
      payload.applicant_residency_status = data.residency_status;
      payload.id_expiry_date = data.id_expiry_date || null;
      payload.applicant_address = data.applicant_address;
      payload.applicant_suburb = data.applicant_suburb;
      payload.applicant_state = data.applicant_state;
      payload.applicant_postcode = data.applicant_postcode;
      payload.residential_status = data.residential_status;
      payload.time_at_address = data.time_at_address;
      payload.applicant_num_dependants = parseInt(data.num_dependants) || 0;
      payload.has_partner = data.has_partner === 'yes';
      payload.partner_working = data.partner_working === 'yes';
      payload.employment_category = data.employment_category;
      if (data.employment_category === 'employed') {
        payload.employer_name = data.employer_name;
        payload.employer_industry = data.employer_industry;
        payload.job_title = data.job_title;
        payload.income_frequency = data.income_frequency;
        payload.gross_income = parseFloat(data.gross_income) || null;
      } else {
        payload.business_abn = data.business_abn;
        payload.business_name = data.business_name;
        payload.trading_name = data.trading_name;
        payload.business_structure = data.business_structure;
        payload.employer_industry = data.business_industry;
        payload.time_trading = data.time_trading;
        payload.gst_registered = data.gst_registered === 'yes';
        payload.num_directors = parseInt(data.num_directors) || 1;
        payload.income_frequency = data.primary_income_frequency;
        payload.gross_income = parseFloat(data.primary_income_amount) || null;
      }
      payload.previously_declined = data.previously_declined === 'yes';
      payload.change_of_circumstances = data.change_of_circumstances === 'yes';
      payload.signature_name = data.signature_name;
      payload.emergency_contact_name = data.emergency_contact_name;
      payload.emergency_contact_relationship = data.emergency_contact_relationship;
      payload.emergency_contact_phone = data.emergency_contact_phone;
      payload.lend_extra_data = JSON.stringify(extraData);

    return payload;
  };

  const clearLocalDraft = () => {
    if (!draftStorageKey) return;
    try { localStorage.removeItem(draftStorageKey); } catch { /* ignore */ }
  };

  const onSubmit = async (data: FormData) => {
    const payload = buildPayload(data);
    // ABN is required for commercial loan applications (keys company reconciliation).
    const COMMERCIAL_LOAN_TYPE_SET = ['business', 'business_loan', 'commercial_property', 'equipment_finance'];
    if (COMMERCIAL_LOAN_TYPE_SET.includes(payload.loan_type as string) && !payload.business_abn) {
      toast('ABN is required for commercial loan applications', 'error');
      return;
    }
    try {
      if (completeId) {
        const res = await api.patch(`/applications/${completeId}`, payload);
        toast('Application saved! Please upload your supporting documents.', 'success');
        clearLocalDraft();
        navigate(`/applications/${res.data.id}?tab=documents`);
      } else {
        const res = await api.post('/applications', payload);
        toast('Application saved! Please upload your supporting documents.', 'success');
        clearLocalDraft();
        navigate(`/applications/${res.data.id}?tab=documents`);
      }
    } catch (err: unknown) {
      toast(getErrorMessage(err, completeId ? 'Failed to update application' : 'Failed to create application'), 'error');
    }
  };

  // ── Acknowledgment ──
  if (!acknowledged) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] flex-col pb-8">
        <div className="mb-8 mt-2">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="led-chip led-chip-accent">Disclosure</span>
          </div>
          <h1 className="text-[26px] sm:text-[34px] font-semibold tracking-[-0.05em] text-[var(--led-ink)]">Important Information</h1>
          <p className="mt-2 text-[14px] leading-6 text-[var(--led-muted)]">Please read the following information carefully before proceeding</p>
        </div>
        <GlassCard>
          <div className="max-h-80 overflow-y-auto rounded-xl bg-[var(--led-surface-2)] p-5 text-[14px] text-[var(--led-ink)] leading-relaxed space-y-4">
            <h3 className="text-[15px] font-semibold">Loan Application Disclosure</h3>
            <p>By submitting a loan application through this portal, you acknowledge and agree to the following terms and conditions. Please read this information carefully before proceeding.</p>
            <p><strong>Information Accuracy:</strong> All information provided in your loan application must be accurate and complete. Providing false or misleading information may result in the denial of your application and could have legal consequences.</p>
            <p><strong>Credit Check Authorization:</strong> By submitting your application, you authorize us to perform credit checks and verify the information you have provided. This may include contacting third-party agencies and financial institutions.</p>
            <p><strong>Data Privacy:</strong> Your personal and financial information will be handled in accordance with our privacy policy. We are committed to protecting your data and will only use it for the purposes of processing your loan application.</p>
            <p><strong>No Guarantee of Approval:</strong> Submitting an application does not guarantee loan approval. All applications are subject to review and assessment based on our lending criteria.</p>
            <p><strong>Document Requirements:</strong> You may be required to submit additional supporting documents during the review process. Failure to provide requested documents in a timely manner may delay or result in the denial of your application.</p>
          </div>
          <div className="mt-5">
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} className="h-4 w-4 rounded border-[var(--led-line)] accent-[var(--led-accent)]" />
              <span className="text-[13px] text-[var(--led-ink)]">I have read and understood the above information</span>
            </label>
          </div>
        </GlassCard>
        <div className="mt-6 flex gap-3">
          <Button size="lg" disabled={!checked} onClick={() => setAcknowledged(true)}>Continue</Button>
          <Button variant="secondary" size="lg" onClick={() => navigate('/dashboard')}>Cancel</Button>
        </div>
      </div>
    );
  }

  const currentPurposeLabel = tab === 'consumer'
    ? CONSUMER_PURPOSES.find(p => p.id === purposeId)?.label
    : COMMERCIAL_PURPOSES.find(p => p.id === commercialPurposeId)?.label;

  const prefillTag = (field: string) =>
    prefilledFields.has(field) ? (
      <span className="ml-2 inline-flex items-center rounded-full bg-[var(--led-accent)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--led-accent)] align-middle">from profile</span>
    ) : null;

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col pb-8">
      <div className="mb-8 mt-2">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="led-chip led-chip-accent">
            {completeId ? (isOwnDraftEdit ? 'Edit Application' : 'Complete Application') : 'New Application'}
          </span>
        </div>
        <h1 className="text-[26px] sm:text-[34px] font-semibold tracking-[-0.05em] text-[var(--led-ink)]">
          {completeId
            ? (isOwnDraftEdit ? 'Edit Your Application' : 'Complete Your Loan Application')
            : 'New Loan Application'}
        </h1>
        <p className="mt-2 text-[14px] leading-6 text-[var(--led-muted)]">
          {completeId
            ? (isOwnDraftEdit
              ? 'Update your draft application below. Your changes are saved automatically.'
              : 'A referrer has started this application for you. Please fill in the remaining details below.')
            : 'Complete all sections below to submit your application'}
        </p>
        {completeLoading && (
          <p className="mt-2 text-[13px] text-[var(--led-muted)]">Loading your application…</p>
        )}
        <div className="mt-3 flex items-center gap-2 text-[12px] text-[var(--led-muted)] min-h-[18px]" aria-live="polite">
          {saveStatus === 'saving' && (
            <>
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--led-accent)]" />
              <span>Saving…</span>
            </>
          )}
          {saveStatus === 'saved' && lastSavedAt && (
            <>
              <svg className="h-3.5 w-3.5 text-[var(--led-success,#22c55e)]" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
              <span>{completeId ? 'Saved' : 'Draft saved locally'} · {lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </>
          )}
          {saveStatus === 'error' && (
            <span className="text-[var(--led-danger,#ef4444)]">Couldn't save — your changes are still on this page.</span>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">

        {showPrefillHint && (
          <div className="flex items-start gap-3 rounded-xl border border-[var(--led-accent)]/30 bg-[var(--led-accent)]/5 px-4 py-3">
            <svg className="mt-0.5 h-4 w-4 shrink-0 text-[var(--led-accent)]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
            <div className="flex-1">
              <p className="text-[13px] font-medium text-[var(--led-ink)]">We filled in some details from your saved profile.</p>
              <p className="mt-0.5 text-[12px] leading-5 text-[var(--led-muted)]">Please review the highlighted fields before submitting — you can edit any of them here.</p>
            </div>
            <button type="button" onClick={() => setShowPrefillHint(false)} className="shrink-0 rounded-lg px-2 py-1 text-[12px] font-medium text-[var(--led-muted)] hover:text-[var(--led-ink)]">Dismiss</button>
          </div>
        )}

        {/* ── Loan Type & Details ── */}
            {lendEnabled && (
              <>
                {isSectionVisible('loan_details') && (<>
                <GlassCard>
                  <label className={LABEL_CLS}>Select Loan Type(s)</label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {LEND_LOAN_TYPES.map(type => {
                      const active = selectedLoanTypes.includes(type.value);
                      return (
                        <label key={type.value} className={`relative flex cursor-pointer items-start gap-3 rounded-2xl p-4 transition-all duration-200 ${active ? 'bg-[var(--led-accent)]/5 ring-2 ring-[var(--led-accent)]/30 shadow-[0_0_0_1px_var(--led-accent)]' : 'bg-[var(--led-surface-2)] hover:bg-[var(--led-surface-2)]/80'}`} onClick={() => toggleLoanType(type.value)}>
                          <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-[var(--led-line)]" style={active ? { background: 'var(--led-accent)', borderColor: 'var(--led-accent)' } : {}}>
                            {active && <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>}
                          </div>
                          <LoanTypeIcon type={type.value} className="mt-0.5 h-6 w-6 shrink-0 text-[var(--led-muted)]" />
                          <div>
                            <p className={`text-[14px] font-semibold ${active ? 'text-[var(--led-accent)]' : 'text-[var(--led-ink)]'}`}>{type.label}</p>
                            <p className="text-[13px] text-[var(--led-muted)] mt-0.5">{type.description}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  {loanTypeError && <p className="mt-2 text-[12px] text-destructive">{loanTypeError}</p>}
                </GlassCard>

                {selectedLoanTypes.includes('equipment_finance') && (
                  <GlassCard className="space-y-4">
                    <h3 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--led-ink)]"><LoanTypeIcon type="equipment_finance" className="h-5 w-5 text-[var(--led-muted)]" /> Equipment Finance Details</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className={LABEL_CLS}>Asset Type <span className="font-normal">(Optional)</span></label>
                        <select {...register('eq_asset_type')} className={SELECT_CLS}>
                          {['Truck', 'Car', 'Machinery', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={LABEL_CLS}>New or Used <span className="font-normal">(Optional)</span></label>
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
                        <label className={LABEL_CLS}>Vendor Type <span className="font-normal">(Optional)</span></label>
                        <select {...register('eq_vendor_type')} className={SELECT_CLS}>
                          <option value="Dealer">Dealer</option>
                          <option value="Private">Private</option>
                        </select>
                      </div>
                      <div>
                        <label className={LABEL_CLS}>Loan Term (Years) <span className="font-normal">(Optional)</span></label>
                        <Input type="number" min="1" max="10" placeholder="5" {...register('eq_loan_term')} />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className={LABEL_CLS}>Estimated Repayment Budget ($/month) <span className="font-normal">(Optional)</span></label>
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
                    <h3 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--led-ink)]"><LoanTypeIcon type="business_loan" className="h-5 w-5 text-[var(--led-muted)]" /> Business Loan Details</h3>
                    <div>
                      <label className={LABEL_CLS}>Loan Purpose <span className="font-normal">(Optional)</span></label>
                      <textarea {...register('bl_loan_purpose')} rows={2} className={TEXTAREA_CLS} placeholder="Describe the purpose of the loan..." />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className={LABEL_CLS}>Requested Loan Amount ($)</label>
                        <Input type="number" step="0.01" min="0" placeholder="50,000" {...register('bl_loan_amount')} />
                      </div>
                      <div>
                        <label className={LABEL_CLS}>Preferred Loan Term <span className="font-normal">(Optional)</span></label>
                        <Input placeholder="e.g. 3 years" {...register('bl_loan_term')} />
                      </div>
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Purpose Type <span className="font-normal">(Optional)</span></label>
                      <select {...register('bl_purpose_type')} className={SELECT_CLS}>
                        {['Working Capital', 'Growth', 'Refinance', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </GlassCard>
                )}

                {selectedLoanTypes.includes('commercial_property') && (
                  <GlassCard className="space-y-4">
                    <h3 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--led-ink)]"><LoanTypeIcon type="commercial_property" className="h-5 w-5 text-[var(--led-muted)]" /> Commercial Property Details</h3>
                    <div>
                      <label className={LABEL_CLS}>Purchase or Refinance? <span className="font-normal">(Optional)</span></label>
                      <div className="flex gap-3">
                        {['Purchase', 'Refinance'].map(v => (
                          <label key={v} className={`flex-1 cursor-pointer rounded-xl p-3 text-center text-[13px] font-medium transition-all ${watch('cp_purchase_or_refinance') === v ? 'bg-[var(--led-accent)]/10 text-[var(--led-accent)] ring-1 ring-[var(--led-accent)]/30' : 'bg-[var(--led-surface-2)] text-[var(--led-muted)] hover:bg-[var(--led-surface-2)]/80'}`}>
                            <input type="radio" value={v} {...register('cp_purchase_or_refinance')} className="sr-only" />
                            {v}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Security Address <span className="font-normal">(Optional)</span></label>
                      <Input placeholder="123 Main St, Sydney NSW 2000" {...register('cp_security_address')} />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className={LABEL_CLS}>Estimated Value / Purchase Price ($)</label>
                        <Input type="number" step="0.01" min="0" placeholder="1,000,000" {...register('cp_estimated_value')} />
                      </div>
                      {watch('cp_purchase_or_refinance') === 'Refinance' && (
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
                    <h3 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--led-ink)]"><LoanTypeIcon type="home_loan" className="h-5 w-5 text-[var(--led-muted)]" /> Home Loan Details</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className={LABEL_CLS}>Purchase or Refinance? <span className="font-normal">(Optional)</span></label>
                        <div className="flex gap-3">
                          {['Purchase', 'Refinance'].map(v => (
                            <label key={v} className={`flex-1 cursor-pointer rounded-xl p-3 text-center text-[13px] font-medium transition-all ${watch('hl_purchase_or_refinance') === v ? 'bg-[var(--led-accent)]/10 text-[var(--led-accent)] ring-1 ring-[var(--led-accent)]/30' : 'bg-[var(--led-surface-2)] text-[var(--led-muted)] hover:bg-[var(--led-surface-2)]/80'}`}>
                              <input type="radio" value={v} {...register('hl_purchase_or_refinance')} className="sr-only" />
                              {v}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className={LABEL_CLS}>Owner Occupied or Investment? <span className="font-normal">(Optional)</span></label>
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
                      {watch('hl_purchase_or_refinance') === 'Refinance' && (
                        <div>
                          <label className={LABEL_CLS}>Existing Lender <span className="font-normal">(Optional)</span></label>
                          <Input placeholder="e.g. ANZ" {...register('hl_existing_lender')} />
                        </div>
                      )}
                    </div>
                  </GlassCard>
                )}

                </>)}

                {/* Document upload */}
                {isSectionVisible('documents') && (
                <GlassCard className="space-y-4">
                  <div>
                    <h3 className="text-[14px] font-semibold text-[var(--led-ink)]">Supporting Documents</h3>
                    <p className="text-[12px] text-[var(--led-muted)] mt-0.5">Optional — files upload immediately.</p>
                  </div>

                  {uploadedDocs.length > 0 && (
                    <ul className="space-y-2">
                      {uploadedDocs.map((d, i) => (
                        <li key={i} className="flex items-center gap-3 rounded-xl border border-[var(--led-line)] bg-[var(--led-surface-2)]/40 px-3 py-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--led-accent)]/10">
                            <svg className="h-4 w-4 text-[var(--led-accent)]" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-medium text-[var(--led-ink)] truncate">{d.label || DOC_TYPE_LABELS[d.doc_type as DocType] || d.doc_type}</p>
                            <p className="text-[11px] text-[var(--led-muted)] truncate">{d.filename}</p>
                          </div>
                          <svg className="h-4 w-4 text-success shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                        </li>
                      ))}
                    </ul>
                  )}

                  {stagedFile ? (
                    <div className="rounded-xl border border-primary/30 bg-[var(--led-accent)]/5 p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <svg className="h-4 w-4 text-[var(--led-accent)] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                        <span className="text-[13px] font-medium text-[var(--led-ink)] truncate">{stagedFile.name}</span>
                        <span className="ml-auto shrink-0 text-[11px] text-[var(--led-muted)]">{(stagedFile.size / 1024).toFixed(0)} KB</span>
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
                      className={`relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${isDragOver ? 'border-primary bg-[var(--led-accent)]/5' : 'border-[var(--led-line)] hover:border-primary/50 hover:bg-[var(--led-surface-2)]/40'}`}
                      onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                      onDragEnter={e => { e.preventDefault(); setIsDragOver(true); }}
                      onDragLeave={() => setIsDragOver(false)}
                      onDrop={handleDrop}
                    >
                      <input ref={pendingFileInput} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handlePickFile} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                      <div className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${isDragOver ? 'bg-[var(--led-accent)]/15' : 'bg-[var(--led-surface-2)]'}`}>
                        <svg className={`h-5 w-5 transition-colors ${isDragOver ? 'text-[var(--led-accent)]' : 'text-[var(--led-muted)]'}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" /></svg>
                      </div>
                      <div>
                        <p className="text-[13px] font-medium text-[var(--led-ink)]">{isDragOver ? 'Drop to upload' : 'Drop a file or click to browse'}</p>
                        <p className="text-[12px] text-[var(--led-muted)] mt-0.5">PDF, JPG, PNG — up to 10 MB</p>
                      </div>
                    </div>
                  )}
                </GlassCard>
                )}
              </>
            )}

            {!lendEnabled && isSectionVisible('loan_details') && (
              <>
                {/* Consumer / Commercial Tab Switcher */}
                <div className="flex rounded-xl bg-secondary p-1 gap-1">
                  {(['consumer', 'commercial'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTab(t)}
                      className={`flex-1 rounded-lg py-2 text-[13px] font-medium transition-all ${tab === t ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      {t === 'consumer' ? 'Consumer' : 'Commercial'}
                    </button>
                  ))}
                </div>

                {/* Consumer Loan Types with Comprehensive Fields */}
                {tab === 'consumer' && (
                  <GlassCard className="space-y-4">
                    <h3 className="text-[14px] font-semibold text-[var(--led-ink)]">Select Loan Type</h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {CONSUMER_LOAN_TYPES.map(type => {
                        const active = selectedConsumerLoanType === type.value;
                        return (
                          <label key={type.value} className={`relative flex cursor-pointer items-start gap-3 rounded-2xl p-4 transition-all duration-200 ${active ? 'bg-[var(--led-accent)]/5 ring-2 ring-[var(--led-accent)]/30 shadow-[0_0_0_1px_var(--led-accent)]' : 'bg-[var(--led-surface-2)] hover:bg-[var(--led-surface-2)]/80'}`} onClick={() => setSelectedConsumerLoanType(type.value)}>
                            <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-[var(--led-line)]" style={active ? { background: 'var(--led-accent)', borderColor: 'var(--led-accent)' } : {}}>
                              {active && <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>}
                            </div>
                            <LoanTypeIcon type={type.value} className="mt-0.5 h-6 w-6 shrink-0 text-[var(--led-muted)]" />
                            <div>
                              <p className={`text-[14px] font-semibold ${active ? 'text-[var(--led-accent)]' : 'text-[var(--led-ink)]'}`}>{type.label}</p>
                              <p className="text-[13px] text-[var(--led-muted)] mt-0.5">{type.description}</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>

                    {/* Vehicle Loan Fields */}
                    {['car', 'motorcycle', 'caravan', 'other_vehicle'].includes(selectedConsumerLoanType) && (
                      <div className="space-y-4 pt-4 border-t border-[var(--led-line)]">
                        <h4 className="text-[13px] font-semibold text-[var(--led-ink)]">Vehicle Details</h4>
                        {selectedConsumerLoanType === 'other_vehicle' && (
                          <div>
                            <label className={LABEL_CLS}>Vehicle Type <span className="font-normal">(Optional)</span></label>
                            <select {...register('vehicle_type')} className={SELECT_CLS}>
                              {['Boat', 'Jet Ski', 'Trailer', 'Camper', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                        )}
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className={LABEL_CLS}>Make <span className="font-normal">(Optional)</span></label>
                            <select {...register('vehicle_make')} className={SELECT_CLS}>
                              <option value="">Select make...</option>
                              {VEHICLE_MAKES.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className={LABEL_CLS}>Model <span className="font-normal">(Optional)</span></label>
                            <Input placeholder="e.g. Corolla" {...register('vehicle_model')} />
                          </div>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-3">
                          <div>
                            <label className={LABEL_CLS}>Year <span className="font-normal">(Optional)</span></label>
                            <Input type="number" min="1900" max={new Date().getFullYear() + 1} placeholder="2024" {...register('vehicle_year')} />
                          </div>
                          <div>
                            <label className={LABEL_CLS}>Condition <span className="font-normal">(Optional)</span></label>
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
                          <label className={LABEL_CLS}>Preferred Loan Term <span className="font-normal">(Optional)</span></label>
                          <select {...register('loan_term')} className={SELECT_CLS}>
                            {LOAN_TERM_OPTIONS.slice(0, 7).map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                      </div>
                    )}

                    {/* Personal Loan Fields */}
                    {selectedConsumerLoanType === 'personal' && (
                      <div className="space-y-4 pt-4 border-t border-[var(--led-line)]">
                        <h4 className="text-[13px] font-semibold text-[var(--led-ink)]">Personal Loan Details</h4>
                        <div>
                          <label className={LABEL_CLS}>Loan Purpose</label>
                          <textarea {...register('loan_purpose')} rows={2} className={TEXTAREA_CLS} placeholder="Describe what the loan is for..." />
                        </div>
                        <div>
                          <label className={LABEL_CLS}>Preferred Term <span className="font-normal">(Optional)</span></label>
                          <select {...register('loan_term')} className={SELECT_CLS}>
                            {LOAN_TERM_OPTIONS.slice(0, 7).map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                      </div>
                    )}

                    {/* Purchase/Refinance Fields */}
                    {['purchase', 'refinance'].includes(selectedConsumerLoanType) && (
                      <div className="space-y-4 pt-4 border-t border-[var(--led-line)]">
                        <h4 className="text-[13px] font-semibold text-[var(--led-ink)]">Property Details</h4>
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
                                <label className={LABEL_CLS}>Deposit ($) <span className="font-normal">(Optional)</span></label>
                                <Input type="number" step="0.01" min="0" placeholder="80,000" {...register('deposit_amount')} />
                              </div>
                              <div>
                                <label className={LABEL_CLS}>First Home Buyer? <span className="font-normal">(Optional)</span></label>
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
                      <label className={LABEL_CLS}>Notes <span className="font-normal">(optional)</span></label>
                      <textarea {...register('notes')} rows={3} className={TEXTAREA_CLS} placeholder="Any additional information about your loan requirement..." />
                    </div>
                  </GlassCard>
                )}

                {tab === 'commercial' && (
                  <GlassCard className="space-y-4">
                    <h3 className="text-[14px] font-semibold text-[var(--led-ink)]">Business & Loan Details</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className={LABEL_CLS}>Business / Entity Name</label>
                        <Input placeholder="Acme Pty Ltd" value={comBusinessName} onChange={e => setComBusinessName(e.target.value)} />
                      </div>
                      <div>
                        <label className={LABEL_CLS}>ABN *</label>
                        <Input placeholder="12 345 678 901" value={comAbn} onChange={e => setComAbn(e.target.value)} />
                        <AbnHint match={commercialAbnMatch} onUseName={(n) => setComBusinessName(n)} />
                        {!commercialAbnMatch && commercialAbr.enabled && (
                          <AbrResultCard
                            record={commercialAbr.record}
                            loading={commercialAbr.loading}
                            onApply={(r) => setComBusinessName(r.name)}
                          />
                        )}
                      </div>
                    </div>

                    <div>
                      <label className={LABEL_CLS}>Loan Purpose</label>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {COMMERCIAL_LOAN_TYPES.map(type => {
                          const active = selectedCommercialLoanType === type.value;
                          return (
                            <label key={type.value} className={`relative flex cursor-pointer items-start gap-3 rounded-xl p-3 transition-all duration-200 ${active ? 'bg-[var(--led-accent)]/5 ring-1 ring-[var(--led-accent)]/30' : 'bg-[var(--led-surface-2)] hover:bg-[var(--led-surface-2)]/80'}`} onClick={() => setSelectedCommercialLoanType(type.value)}>
                              <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-[var(--led-line)]" style={active ? { background: 'var(--led-accent)', borderColor: 'var(--led-accent)' } : {}}>
                                {active && <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>}
                              </div>
                              <div className="flex items-center gap-2">
                                <LoanTypeIcon type={type.value} className={`h-4 w-4 shrink-0 ${active ? 'text-[var(--led-accent)]' : 'text-[var(--led-muted)]'}`} />
                                <p className={`text-[13px] font-semibold ${active ? 'text-[var(--led-accent)]' : 'text-[var(--led-ink)]'}`}>{type.label}</p>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {/* Commercial Vehicle/Equipment Fields */}
                    {['vehicles_or_transport', 'machinery_or_equipment'].includes(selectedCommercialLoanType) && (
                      <div className="space-y-4 pt-4 border-t border-[var(--led-line)]">
                        <h4 className="text-[13px] font-semibold text-[var(--led-ink)]">Asset Details</h4>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className={LABEL_CLS}>Asset Type <span className="font-normal">(Optional)</span></label>
                            <select {...register('equipment_type')} className={SELECT_CLS}>
                              {EQUIPMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className={LABEL_CLS}>Condition <span className="font-normal">(Optional)</span></label>
                            <select {...register('vehicle_condition')} className={SELECT_CLS}>
                              {VEHICLE_CONDITION_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className={LABEL_CLS}>Description <span className="font-normal">(Optional)</span></label>
                          <Input placeholder="e.g. 2023 Isuzu NPR 65-190 Tray Truck" {...register('equipment_description')} />
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className={LABEL_CLS}>Asset Price ($)</label>
                            <Input type="number" step="0.01" min="0" placeholder="80,000" {...register('vehicle_price')} />
                          </div>
                          <div>
                            <label className={LABEL_CLS}>Deposit / Trade-in ($) <span className="font-normal">(Optional)</span></label>
                            <Input type="number" step="0.01" min="0" placeholder="10,000" {...register('deposit_amount')} />
                          </div>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className={LABEL_CLS}>Vendor Type <span className="font-normal">(Optional)</span></label>
                            <select {...register('vendor_type')} className={SELECT_CLS}>
                              <option value="Dealer">Dealer</option>
                              <option value="Private">Private</option>
                              <option value="Auction">Auction</option>
                            </select>
                          </div>
                          <div>
                            <label className={LABEL_CLS}>Business Use % <span className="font-normal">(Optional)</span></label>
                            <Input type="number" min="0" max="100" placeholder="80" {...register('eq_business_use_pct')} />
                          </div>
                        </div>
                        <div>
                          <label className={LABEL_CLS}>Preferred Loan Term <span className="font-normal">(Optional)</span></label>
                          <select {...register('loan_term')} className={SELECT_CLS}>
                            {LOAN_TERM_OPTIONS.slice(0, 7).map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                      </div>
                    )}

                    {/* Property/Development Fields */}
                    {['property', 'development_construction', 'new_fit_out', 'renovation'].includes(selectedCommercialLoanType) && (
                      <div className="space-y-4 pt-4 border-t border-[var(--led-line)]">
                        <h4 className="text-[13px] font-semibold text-[var(--led-ink)]">Property Details</h4>
                        <div>
                          <label className={LABEL_CLS}>Property Address <span className="font-normal">(Optional)</span></label>
                          <Input placeholder="123 Main St, Sydney NSW 2000" {...register('property_address')} />
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className={LABEL_CLS}>Property Type <span className="font-normal">(Optional)</span></label>
                            <select {...register('property_type')} className={SELECT_CLS}>
                              {PROPERTY_TYPES.slice(6).map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className={LABEL_CLS}>Property Use <span className="font-normal">(Optional)</span></label>
                            <select {...register('property_use')} className={SELECT_CLS}>
                              <option value="Owner Occupied">Owner Occupied</option>
                              <option value="Investment">Investment</option>
                              <option value="Mixed Use">Mixed Use</option>
                            </select>
                          </div>
                        </div>
                        {selectedCommercialLoanType === 'development_construction' && (
                          <div>
                            <label className={LABEL_CLS}>Project Description <span className="font-normal">(Optional)</span></label>
                            <textarea {...register('project_description')} rows={3} className={TEXTAREA_CLS} placeholder="Describe the development project..." />
                          </div>
                        )}
                        {selectedCommercialLoanType === 'new_fit_out' && (
                          <div>
                            <label className={LABEL_CLS}>Fit-out Description <span className="font-normal">(Optional)</span></label>
                            <textarea {...register('fit_out_description')} rows={2} className={TEXTAREA_CLS} placeholder="Describe the fit-out requirements..." />
                          </div>
                        )}
                        {selectedCommercialLoanType === 'renovation' && (
                          <div>
                            <label className={LABEL_CLS}>Renovation Details <span className="font-normal">(Optional)</span></label>
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
                          <label className={LABEL_CLS}>Preferred Loan Term <span className="font-normal">(Optional)</span></label>
                          <select {...register('loan_term')} className={SELECT_CLS}>
                            {LOAN_TERM_OPTIONS.slice(4).map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                      </div>
                    )}

                    {/* Business Acquisition/Startup Fields */}
                    {['new_business', 'purchase_business'].includes(selectedCommercialLoanType) && (
                      <div className="space-y-4 pt-4 border-t border-[var(--led-line)]">
                        <h4 className="text-[13px] font-semibold text-[var(--led-ink)]">Business Details</h4>
                        {selectedCommercialLoanType === 'new_business' ? (
                          <>
                            <div>
                              <label className={LABEL_CLS}>Business Plan Summary <span className="font-normal">(Optional)</span></label>
                              <textarea {...register('business_plan')} rows={3} className={TEXTAREA_CLS} placeholder="Briefly describe your business plan..." />
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div>
                                <label className={LABEL_CLS}>Startup Costs ($)</label>
                                <Input type="number" step="0.01" min="0" placeholder="150,000" {...register('startup_costs')} />
                              </div>
                              <div>
                                <label className={LABEL_CLS}>Industry <span className="font-normal">(Optional)</span></label>
                                <Input placeholder="e.g. Retail, Hospitality" {...register('business_purpose')} />
                              </div>
                            </div>
                          </>
                        ) : (
                          <>
                            <div>
                              <label className={LABEL_CLS}>Business Details <span className="font-normal">(Optional)</span></label>
                              <textarea {...register('business_details')} rows={2} className={TEXTAREA_CLS} placeholder="Business name, type, and brief description..." />
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div>
                                <label className={LABEL_CLS}>Purchase Price ($)</label>
                                <Input type="number" step="0.01" min="0" placeholder="500,000" {...register('purchase_price')} />
                              </div>
                              <div>
                                <label className={LABEL_CLS}>Business Type <span className="font-normal">(Optional)</span></label>
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
                            <label className={LABEL_CLS}>Preferred Term <span className="font-normal">(Optional)</span></label>
                            <select {...register('loan_term')} className={SELECT_CLS}>
                              {LOAN_TERM_OPTIONS.slice(2, 8).map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Working Capital/Expansion Fields */}
                    {['day_to_day_capital', 'expansion', 'staff_recruitment', 'pay_suppliers', 'waiting_for_invoices', 'other'].includes(selectedCommercialLoanType) && (
                      <div className="space-y-4 pt-4 border-t border-[var(--led-line)]">
                        <h4 className="text-[13px] font-semibold text-[var(--led-ink)]">Loan Details</h4>
                        {selectedCommercialLoanType === 'staff_recruitment' && (
                          <div>
                            <label className={LABEL_CLS}>Recruitment Details <span className="font-normal">(Optional)</span></label>
                            <textarea {...register('recruitment_details')} rows={2} className={TEXTAREA_CLS} placeholder="Number of staff, roles, training costs..." />
                          </div>
                        )}
                        {selectedCommercialLoanType === 'expansion' && (
                          <div>
                            <label className={LABEL_CLS}>Expansion Description <span className="font-normal">(Optional)</span></label>
                            <textarea {...register('expansion_description')} rows={2} className={TEXTAREA_CLS} placeholder="Describe your expansion plans..." />
                          </div>
                        )}
                        {selectedCommercialLoanType === 'pay_suppliers' && (
                          <div>
                            <label className={LABEL_CLS}>Supplier Details <span className="font-normal">(Optional)</span></label>
                            <textarea {...register('supplier_details')} rows={2} className={TEXTAREA_CLS} placeholder="Supplier names, invoice details..." />
                          </div>
                        )}
                        {selectedCommercialLoanType === 'waiting_for_invoices' && (
                          <div>
                            <label className={LABEL_CLS}>Outstanding Invoices <span className="font-normal">(Optional)</span></label>
                            <textarea {...register('outstanding_invoices')} rows={2} className={TEXTAREA_CLS} placeholder="Debtor details, amounts, due dates..." />
                          </div>
                        )}
                        {selectedCommercialLoanType === 'other' && (
                          <div>
                            <label className={LABEL_CLS}>Purpose Description <span className="font-normal">(Optional)</span></label>
                            <textarea {...register('purpose_description')} rows={2} className={TEXTAREA_CLS} placeholder="Describe the purpose of the loan..." />
                          </div>
                        )}
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className={LABEL_CLS}>Loan Amount ($)</label>
                            <Input type="number" step="0.01" min="0" placeholder="100,000" {...register('amount')} />
                          </div>
                          <div>
                            <label className={LABEL_CLS}>Preferred Term <span className="font-normal">(Optional)</span></label>
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
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 z-10 text-[14px] font-semibold text-[var(--led-muted)] pointer-events-none">$</span>
                          <Input type="number" step="0.01" min="1" placeholder="100,000" style={{ paddingLeft: '2rem' }} {...register('amount')} />
                        </div>
                      </div>
                    )}

                    <div>
                      <label className={LABEL_CLS}>Notes <span className="font-normal">(optional)</span></label>
                      <textarea {...register('notes')} rows={3} className={TEXTAREA_CLS} placeholder="Any additional information about your loan requirement..." />
                    </div>
            </GlassCard>
            )}

            {/* ── Loan Amount ── */}
            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-[var(--led-ink)]">Loan Amount</h3>
              <div>
                <label className={LABEL_CLS}>Loan Amount ($) *</label>
                <div className="flex h-10 overflow-hidden rounded-xl border border-[var(--led-line)] bg-[var(--led-surface-2)] transition-all focus-within:border-primary focus-within:shadow-[0_0_0_3px_var(--led-accent-tint)]">
                  <span className="flex shrink-0 items-center border-r border-[var(--led-line)] bg-secondary/60 px-3.5 text-[13px] font-medium text-muted-foreground">AUD $</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0"
                    className="flex-1 bg-transparent px-3.5 text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
                    {...register('amount', { required: isSectionVisible('loan_details') && 'Required' })}
                  />
                </div>
                {errors.amount && <p className="mt-1 text-[12px] text-destructive">{errors.amount.message}</p>}
              </div>
            </GlassCard>
            </>
          )}

        {/* ── Identification ── */}
          {isSectionVisible('personal') && (
          <GlassCard className="space-y-4">
            <h3 className="text-[14px] font-semibold text-[var(--led-ink)]">Personal Details</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className={LABEL_CLS}>Title{prefillTag('applicant_title')}</label>
                <select {...register('applicant_title')} className={SELECT_CLS}>
                  {TITLE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>Gender <span className="font-normal">(optional)</span>{prefillTag('applicant_gender')}</label>
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
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className={LABEL_CLS}>First Name *{prefillTag('applicant_first_name')}</label>
                  <Input placeholder="First name" error={errors.applicant_first_name?.message} {...register('applicant_first_name', { required: isSectionVisible('personal') && 'Required' })} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Middle Name <span className="font-normal">(optional)</span>{prefillTag('applicant_middle_name')}</label>
                  <Input placeholder="Middle name" {...register('applicant_middle_name')} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Last Name *{prefillTag('applicant_last_name')}</label>
                  <Input placeholder="Last name" error={errors.applicant_last_name?.message} {...register('applicant_last_name', { required: isSectionVisible('personal') && 'Required' })} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={LABEL_CLS}>Date of Birth *{prefillTag('applicant_dob')}</label>
                  <DatePicker
                    error={errors.applicant_dob?.message}
                    value={watch('applicant_dob') || ''}
                    onChange={(v) => setValue('applicant_dob', v, { shouldValidate: true })}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Number of Dependants</label>
                  <Input type="number" min="0" max="20" {...register('num_dependants')} />
                </div>
              </div>
            </GlassCard>)}

            {isSectionVisible('identification') && (<>
            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-[var(--led-ink)]">Identification</h3>
              <div>
                <label className={LABEL_CLS}>ID Type{prefillTag('id_type')}</label>
                <div className="flex gap-3">
                  {(['license', 'passport'] as const).map(t => (
                    <label key={t} className={`flex-1 cursor-pointer rounded-xl p-3 text-center text-[13px] font-medium transition-all ${idType === t ? 'bg-[var(--led-accent)]/10 text-[var(--led-accent)] ring-1 ring-[var(--led-accent)]/30' : 'bg-[var(--led-surface-2)] text-[var(--led-muted)] hover:bg-[var(--led-surface-2)]/80'}`}>
                      <input type="radio" value={t} {...register('id_type')} className="sr-only" />
                      {t === 'license' ? 'Driver Licence' : 'Passport'}
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className={LABEL_CLS}>ID Number *{prefillTag('id_number')}</label>
                  <Input placeholder={idType === 'license' ? '12345678' : 'PA1234567'} {...register('id_number')} />
                </div>
                <div>
                  <label className={LABEL_CLS}>{idType === 'license' ? 'Issuing State' : 'Issuing Country'}{prefillTag('id_issuing_state_country')}</label>
                  {idType === 'license' ? (
                    <select {...register('id_issuing_state_country')} className={SELECT_CLS}>
                      {AU_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : (
                    <Input placeholder="Australia" {...register('id_issuing_state_country')} />
                  )}
                </div>
                <div>
                  <label className={LABEL_CLS}>Expiry Date *{prefillTag('id_expiry_date')}</label>
                  <DatePicker
                    value={watch('id_expiry_date') || ''}
                    onChange={(v) => setValue('id_expiry_date', v, { shouldValidate: true })}
                  />
                </div>
              </div>
            </GlassCard>

            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-[var(--led-ink)]">Residency Status{prefillTag('residency_status')}</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {['Australian Citizen', 'Permanent Resident', 'Temporary Visa', 'Other'].map(r => (
                  <label key={r} className={`flex cursor-pointer items-center gap-3 rounded-xl p-3 transition-all ${residencyStatus === r ? 'bg-[var(--led-accent)]/5 ring-1 ring-[var(--led-accent)]/30' : 'bg-[var(--led-surface-2)] hover:bg-[var(--led-surface-2)]/80'}`}>
                    <input type="radio" value={r} {...register('residency_status')} className="h-4 w-4 accent-[var(--led-accent)]" />
                    <span className="text-[13px] font-medium text-[var(--led-ink)]">{r}</span>
                  </label>
                ))}
              </div>
              {residencyStatus === 'Other' && (
                <Input placeholder="Please specify..." {...register('residency_other')} />
              )}
            </GlassCard>
            </>)}

            {!lendEnabled && tab === 'commercial' && isSectionVisible('business') && (
              <GlassCard className="space-y-4">
                <h3 className="text-[14px] font-semibold text-[var(--led-ink)]">Business Details</h3>
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
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 z-10 text-[14px] font-semibold text-[var(--led-muted)] pointer-events-none">$</span>
                      <Input type="number" step="1" min="0" placeholder="30,000" style={{ paddingLeft: '2rem' }} value={comMonthlySales} onChange={e => setComMonthlySales(e.target.value)} />
                    </div>
                  </div>
                </div>
            </GlassCard>
            )}

            {isSectionVisible('contact') && (
            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-[var(--led-ink)]">Contact Details</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={LABEL_CLS}>Email Address *</label>
                  <Input type="email" placeholder="you@example.com" {...register('applicant_email')} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Mobile Number *{prefillTag('applicant_mobile')}</label>
                  <Input type="tel" placeholder="04XX XXX XXX" error={errors.applicant_mobile?.message} {...register('applicant_mobile', { required: isSectionVisible('contact') && 'Required' })} />
                </div>
              </div>
              <div>
                <label className={LABEL_CLS}>Preferred Contact Method{prefillTag('preferred_contact_method')}</label>
                <select {...register('preferred_contact_method')} className={SELECT_CLS}>
                  {['Email', 'Mobile', 'Either'].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </GlassCard>)}

        {/* ── Living & Employment ── */}
        {(tab === 'consumer' || lendEnabled) && (
          <>
            {isSectionVisible('living') && (<>
            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-[var(--led-ink)]">Living Situation</h3>
              <div>
                <label className={LABEL_CLS}>Residential Status</label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {['Renting', 'Owner (Mortgage)', 'Owner (No Mortgage)', 'Living with Family'].map(r => (
                    <label key={r} className={`flex cursor-pointer items-center gap-3 rounded-xl p-3 transition-all ${watch('residential_status') === r ? 'bg-[var(--led-accent)]/5 ring-1 ring-[var(--led-accent)]/30' : 'bg-[var(--led-surface-2)] hover:bg-[var(--led-surface-2)]/80'}`}>
                      <input type="radio" value={r} {...register('residential_status')} className="h-4 w-4 accent-[var(--led-accent)]" />
                      <span className="text-[13px] font-medium text-[var(--led-ink)]">{r}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className={LABEL_CLS}>Current Address *</label>
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
                  <Input placeholder="2000" maxLength={4} {...register('applicant_postcode', { pattern: { value: /^\d{4}$/, message: 'Invalid postcode' } })} error={errors.applicant_postcode?.message} />
                </div>
              </div>
              <div>
                <label className={LABEL_CLS}>Time at Current Address</label>
                <Input placeholder="e.g. 3 years" {...register('time_at_address')} />
              </div>
            </GlassCard>

            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-[var(--led-ink)]">Household</h3>
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
            </>)}

            {isSectionVisible('employment') && (
            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-[var(--led-ink)]">Employment</h3>
              <div>
                <label className={LABEL_CLS}>Employment Type</label>
                <div className="flex gap-3">
                  {[{ value: 'employed', label: 'Employed' }, { value: 'self_employed', label: 'Self-Employed / Business Owner' }].map(opt => (
                    <label key={opt.value} className={`flex-1 cursor-pointer rounded-xl p-3 text-center text-[13px] font-medium transition-all ${employmentCategory === opt.value ? 'bg-[var(--led-accent)]/10 text-[var(--led-accent)] ring-1 ring-[var(--led-accent)]/30' : 'bg-[var(--led-surface-2)] text-[var(--led-muted)] hover:bg-[var(--led-surface-2)]/80'}`}>
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
                      <label className={LABEL_CLS}>Employer Name *</label>
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
                      <DatePicker
                        value={watch('employment_start_date') || ''}
                        onChange={(v) => setValue('employment_start_date', v, { shouldValidate: true })}
                      />
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Income Frequency</label>
                      <select {...register('income_frequency')} className={SELECT_CLS}>
                        {['Weekly', 'Fortnightly', 'Monthly', 'Annually'].map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className={LABEL_CLS}>Gross Income Amount ($)</label>
                      <Input type="number" step="0.01" min="0" placeholder="5,000" {...register('gross_income')} />
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
                    <div>
                      <label className={LABEL_CLS}>ABN *</label>
                      <Input placeholder="12 345 678 901" {...register('business_abn')} />
                      <AbnHint match={selfEmployedAbnMatch} onUseName={(n) => setValue('business_name', n)} />
                      {!selfEmployedAbnMatch && selfEmployedAbr.enabled && (
                        <AbrResultCard
                          record={selfEmployedAbr.record}
                          loading={selfEmployedAbr.loading}
                          onApply={(r) => setValue('business_name', r.name)}
                        />
                      )}
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Business Name *</label>
                      <Input placeholder="Your Business Pty Ltd" {...register('business_name')} />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className={LABEL_CLS}>Trading Name <span className="font-normal">(if different)</span></label>
                      <Input placeholder="Trading As..." {...register('trading_name')} />
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Business Structure</label>
                      <select {...register('business_structure')} className={SELECT_CLS}>
                        {['Sole Trader', 'Partnership', 'Company', 'Trust'].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className={LABEL_CLS}>Industry</label>
                      <Input placeholder="e.g. Retail" {...register('business_industry')} />
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Time Trading</label>
                      <Input placeholder="e.g. 5 years" {...register('time_trading')} />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <label className={LABEL_CLS}>GST Registered?</label>
                      <select {...register('gst_registered')} className={SELECT_CLS}>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </div>
                    <div>
                      <label className={LABEL_CLS}>No. of Directors / Partners</label>
                      <Input type="number" min="1" {...register('num_directors')} />
                    </div>
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Other Directors / Partners <span className="font-normal">(optional)</span></label>
                    <textarea {...register('other_directors')} rows={2} className={TEXTAREA_CLS} placeholder="Name, role, ownership %" />
                  </div>
                </>
              )}
            </GlassCard>)}

            {isSectionVisible('income') && (
            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-[var(--led-ink)]">Income</h3>
              <div className="rounded-xl bg-[var(--led-surface-2)]/40 p-4 space-y-3">
                <p className="text-[13px] font-semibold text-[var(--led-ink)]">Primary Income</p>
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

              {additionalIncomes.length > 0 && (
                <div className="space-y-3">
                  <p className="text-[13px] font-semibold text-[var(--led-ink)]">Additional Income</p>
                  {additionalIncomes.map((inc, idx) => (
                    <div key={idx} className="rounded-xl bg-[var(--led-surface-2)]/40 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] font-medium text-[var(--led-muted)]">Income Source {idx + 1}</span>
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
                </div>
              )}
              <button type="button" onClick={() => setAdditionalIncomes(prev => [...prev, blankIncome()])} className="text-[13px] text-[var(--led-accent)] font-medium hover:underline">+ Add Additional Income</button>
            </GlassCard>)}
          </>
        )}

        {/* ── Financial Position ── */}
        {(tab === 'consumer' || lendEnabled) && (
          <>
            {isSectionVisible('assets') && (<>
            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-[var(--led-ink)]">Real Estate Assets</h3>
              {realEstateAssets.map((asset, idx) => (
                <div key={idx} className="rounded-xl bg-[var(--led-surface-2)]/40 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-semibold text-[var(--led-ink)]">Property {idx + 1}</span>
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
              <button type="button" onClick={() => setRealEstateAssets(prev => [...prev, blankRealEstate()])} className="text-[13px] text-[var(--led-accent)] font-medium hover:underline">+ Add Property</button>
            </GlassCard>

            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-[var(--led-ink)]">Other Assets</h3>
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
              <button type="button" onClick={() => setOtherAssets(prev => [...prev, blankOtherAsset()])} className="text-[13px] text-[var(--led-accent)] font-medium hover:underline">+ Add Asset</button>
            </GlassCard>
            </>)}

            {isSectionVisible('liabilities') && (
            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-[var(--led-ink)]">Liabilities</h3>
              {liabilities.map((liability, idx) => (
                <div key={idx} className="rounded-xl bg-[var(--led-surface-2)]/40 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-semibold text-[var(--led-ink)]">Liability {idx + 1}</span>
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
              <button type="button" onClick={() => setLiabilities(prev => [...prev, blankLiability()])} className="text-[13px] text-[var(--led-accent)] font-medium hover:underline">+ Add Liability</button>
            </GlassCard>)}

            {isSectionVisible('expenses') && (
            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-[var(--led-ink)]">Monthly Expenses</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={LABEL_CLS}>Estimated Living Expenses ($) *</label>
                  <Input type="number" step="0.01" min="0" placeholder="3,000" {...register('monthly_living_expenses')} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Rent / Mortgage Payments ($)</label>
                  <Input type="number" step="0.01" min="0" placeholder="2,000" {...register('rent_mortgage_payments')} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Child Support ($) <span className="font-normal">(if applicable)</span></label>
                  <Input type="number" step="0.01" min="0" placeholder="0" {...register('child_support')} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Other Regular Commitments ($)</label>
                  <Input type="number" step="0.01" min="0" placeholder="500" {...register('other_commitments')} />
                </div>
              </div>
            </GlassCard>)}
          </>
        )}

        {/* ── Declarations ── */}
            {isSectionVisible('declarations') && (
            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-[var(--led-ink)]">Credit History</h3>
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
            </GlassCard>)}

            {isSectionVisible('emergency') && (
            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-[var(--led-ink)]">Emergency Contact</h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className={LABEL_CLS}>Name{prefillTag('emergency_contact_name')}</label>
                  <Input placeholder="Jane Smith" {...register('emergency_contact_name')} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Relationship{prefillTag('emergency_contact_relationship')}</label>
                  <Input placeholder="Spouse, Parent, etc." {...register('emergency_contact_relationship')} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Phone Number{prefillTag('emergency_contact_phone')}</label>
                  <Input type="tel" placeholder="04XX XXX XXX" {...register('emergency_contact_phone')} />
                </div>
              </div>
            </GlassCard>)}

            {isSectionVisible('declarations') && (
            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-[var(--led-ink)]">Signature</h3>
              <div>
                <label className={LABEL_CLS}>Digital Signature — Type your full name</label>
                <Input placeholder="Your full legal name" {...register('signature_name')} />
              </div>
              <p className="text-[12px] text-[var(--led-muted)]">Date: {new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
            </GlassCard>)}

        {/* ── Review ── */}
          <GlassCard className="space-y-4">
            <h3 className="text-[14px] font-semibold text-[var(--led-ink)]">Review Your Application</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                <p className="text-[12px] font-medium text-[var(--led-muted)]">Applicant</p>
                <p className="text-[14px] font-semibold text-[var(--led-ink)]">{watch('applicant_title')} {watch('applicant_first_name')} {watch('applicant_last_name')}</p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                <p className="text-[12px] font-medium text-[var(--led-muted)]">Contact</p>
                <p className="text-[14px] font-semibold text-[var(--led-ink)]">{watch('applicant_mobile') || watch('applicant_email') || '—'}</p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                <p className="text-[12px] font-medium text-[var(--led-muted)]">Loan Type</p>
                <p className="text-[14px] font-semibold text-[var(--led-ink)] capitalize">
                  {lendEnabled
                    ? (selectedLoanTypes.map(t => t.replace(/_/g, ' ')).join(', ') || '—')
                    : `${tab === 'consumer' ? 'Consumer' : 'Commercial'} · ${currentPurposeLabel || 'No purpose selected'}`}
                </p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                <p className="text-[12px] font-medium text-[var(--led-muted)]">Employment</p>
                <p className="text-[14px] font-semibold text-[var(--led-ink)] capitalize">{watch('employment_category') === 'self_employed' ? 'Self-Employed' : 'Employed'}</p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                <p className="text-[12px] font-medium text-[var(--led-muted)]">Address</p>
                <p className="text-[14px] font-semibold text-[var(--led-ink)]">{[watch('applicant_suburb'), watch('applicant_state'), watch('applicant_postcode')].filter(Boolean).join(', ') || '—'}</p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                <p className="text-[12px] font-medium text-[var(--led-muted)]">Residency</p>
                <p className="text-[14px] font-semibold text-[var(--led-ink)]">{watch('residency_status')}</p>
              </div>
              {realEstateAssets.length > 0 && (
                <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3 sm:col-span-2">
                  <p className="text-[12px] font-medium text-[var(--led-muted)]">Properties</p>
                  <p className="text-[14px] font-semibold text-[var(--led-ink)]">{realEstateAssets.length} propert{realEstateAssets.length === 1 ? 'y' : 'ies'} listed</p>
                </div>
              )}
              {liabilities.length > 0 && (
                <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3 sm:col-span-2">
                  <p className="text-[12px] font-medium text-[var(--led-muted)]">Liabilities</p>
                  <p className="text-[14px] font-semibold text-[var(--led-ink)]">{liabilities.length} liabilit{liabilities.length === 1 ? 'y' : 'ies'} listed</p>
                </div>
              )}
              {uploadedDocs.length > 0 && (
                <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                  <p className="text-[12px] font-medium text-[var(--led-muted)]">Documents</p>
                  <p className="text-[14px] font-semibold text-[var(--led-ink)]">{uploadedDocs.length} uploaded</p>
                </div>
              )}
            </div>
            <p className="text-[13px] text-[var(--led-muted)]">Please review the details above. Once you submit, you can upload supporting documents on the next screen.</p>
          </GlassCard>

        {/* ── Submit ── */}
        <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={isSubmitting} size="lg">
              {isSubmitting
                ? (completeId ? 'Saving...' : 'Submitting...')
                : (completeId ? 'Save Changes' : 'Submit Application')}
            </Button>
          <Button type="button" variant="secondary" size="lg" onClick={() => completeId ? navigate(`/applications/${completeId}`) : navigate('/dashboard')}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
