import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/Toast';
import { getErrorMessage } from '../../lib/utils';
import { GlassCard, Button, Input, PageHeader } from '../../components/ui';
import { AU_STATES, TITLE_OPTIONS, GENDER_OPTIONS, MARITAL_STATUS_OPTIONS, DOC_TYPE_LABELS } from '../../lib/constants';
import type { DocType } from '../../types';

const SELECT_CLS = 'w-full rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground h-10 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none';
const TEXTAREA_CLS = 'w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background placeholder:text-muted-foreground border border-transparent resize-none';
const LABEL_CLS = 'block text-[13px] font-medium text-muted-foreground mb-2';

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

const TOTAL_STEPS_LEND = 6;
const maxInternalStep = 6;
const STEP_LABELS_CONSUMER = ['Loan Details', 'Identification', 'Living & Employment', 'Financial Position', 'Declarations', 'Review'];
const STEP_LABELS_COMMERCIAL = ['Loan Details', 'Identification', 'Declarations', 'Review'];

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

  const [step, setStep] = useState(0);
  const [lendEnabled, setLendEnabled] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [checked, setChecked] = useState(false);

  const [selectedLoanTypes, setSelectedLoanTypes] = useState<string[]>([]);
  const [loanTypeError, setLoanTypeError] = useState('');

  const [additionalIncomes, setAdditionalIncomes] = useState<AdditionalIncome[]>([]);
  const [realEstateAssets, setRealEstateAssets] = useState<RealEstateAsset[]>([]);
  const [otherAssets, setOtherAssets] = useState<OtherAsset[]>([]);
  const [liabilities, setLiabilities] = useState<Liability[]>([]);

  const [tab, setTab] = useState<'consumer' | 'commercial'>('consumer');
  const [purposeId, setPurposeId] = useState<number | ''>('');
  const [commercialPurposeId, setCommercialPurposeId] = useState<number | ''>('');
  const [comBusinessName, setComBusinessName] = useState('');
  const [comAbn, setComAbn] = useState('');
  const [parentIndustryId, setParentIndustryId] = useState<number | ''>('');
  const [subIndustryId, setSubIndustryId] = useState<number | ''>('');
  const [comPostcode, setComPostcode] = useState('');
  const [comMonthlySales, setComMonthlySales] = useState('');

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
    trigger,
    setValue,
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
    },
  });

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
      setValue('applicant_first_name', parts[0] || '');
      if (parts.length > 2) {
        setValue('applicant_middle_name', parts.slice(1, -1).join(' '));
        setValue('applicant_last_name', parts[parts.length - 1]);
      } else if (parts.length === 2) {
        setValue('applicant_last_name', parts[1]);
      }
    }
    if (user?.email) setValue('applicant_email', user.email);
  }, [user, setValue]);

  const totalSteps = lendEnabled ? TOTAL_STEPS_LEND : (tab === 'commercial' ? 4 : 6);
  const stepLabels = lendEnabled ? STEP_LABELS_CONSUMER : (tab === 'commercial' ? STEP_LABELS_COMMERCIAL : STEP_LABELS_CONSUMER);
  const toUiStep = (internal: number) => {
    if (!lendEnabled && tab === 'commercial' && internal >= 5) return internal - 2;
    return internal;
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

  const onSubmit = async (data: FormData) => {
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

    try {
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

      const res = await api.post('/applications', payload);
      toast('Application created successfully!', 'success');
      navigate(`/applications/${res.data.id}`);
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to create application'), 'error');
    }
  };

  // ── Acknowledgment ──
  if (!acknowledged) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Important Information" subtitle="Please read the following information carefully before proceeding" />
        <GlassCard>
          <div className="max-h-80 overflow-y-auto rounded-xl bg-secondary p-5 text-[14px] text-foreground leading-relaxed space-y-4">
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
              <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} className="h-4 w-4 rounded border-border accent-[var(--primary)]" />
              <span className="text-[13px] text-foreground">I have read and understood the above information</span>
            </label>
          </div>
        </GlassCard>
        <div className="mt-6 flex gap-3">
          <Button size="lg" disabled={!checked} onClick={() => { setAcknowledged(true); setStep(1); }}>Continue</Button>
          <Button variant="secondary" size="lg" onClick={() => navigate('/dashboard')}>Cancel</Button>
        </div>
      </div>
    );
  }

  const progress = (toUiStep(step) / (lendEnabled ? 6 : (tab === 'commercial' ? 4 : 6))) * 100;

  const currentPurposeLabel = tab === 'consumer'
    ? CONSUMER_PURPOSES.find(p => p.id === purposeId)?.label
    : COMMERCIAL_PURPOSES.find(p => p.id === commercialPurposeId)?.label;

  const uiTotal = lendEnabled ? 6 : (tab === 'commercial' ? 4 : 6);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New Loan Application" subtitle={stepLabels[toUiStep(step) - 1] || `Step ${step}`} />

      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] font-medium text-muted-foreground">Step {toUiStep(step)} of {uiTotal}</span>
          <span className="text-[12px] font-medium text-muted-foreground">{Math.round(progress)}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
          <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">

        {/* ── Step 1: Loan Type & Details ── */}
        {step === 1 && (
          <>
            {lendEnabled ? (
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
                          <label key={v} className={`flex-1 cursor-pointer rounded-xl p-3 text-center text-[13px] font-medium transition-all ${watch('cp_purchase_or_refinance') === v ? 'bg-primary/10 text-primary ring-1 ring-primary/30' : 'bg-secondary text-muted-foreground hover:bg-secondary/80'}`}>
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
                    <h3 className="text-[14px] font-semibold text-foreground">🏠 Home Loan Details</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className={LABEL_CLS}>Purchase or Refinance?</label>
                        <div className="flex gap-3">
                          {['Purchase', 'Refinance'].map(v => (
                            <label key={v} className={`flex-1 cursor-pointer rounded-xl p-3 text-center text-[13px] font-medium transition-all ${watch('hl_purchase_or_refinance') === v ? 'bg-primary/10 text-primary ring-1 ring-primary/30' : 'bg-secondary text-muted-foreground hover:bg-secondary/80'}`}>
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
                      {watch('hl_purchase_or_refinance') === 'Refinance' && (
                        <div>
                          <label className={LABEL_CLS}>Existing Lender</label>
                          <Input placeholder="e.g. ANZ" {...register('hl_existing_lender')} />
                        </div>
                      )}
                    </div>
                  </GlassCard>
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
            ) : (
              <>
                <div className="flex gap-1 p-1 rounded-xl bg-secondary w-fit">
                  {(['consumer', 'commercial'] as const).map(t => (
                    <button key={t} type="button" onClick={() => handleTabChange(t)}
                      className={`px-5 py-2 rounded-lg text-[13px] font-medium transition-all ${tab === t ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                      {t === 'consumer' ? 'Consumer Loan' : 'Commercial Loan'}
                    </button>
                  ))}
                </div>
                <GlassCard className="space-y-4">
                  <h3 className="text-[14px] font-semibold text-foreground">Loan Details</h3>
                  {tab === 'consumer' && (
                    <div>
                      <label className={LABEL_CLS}>Purpose</label>
                      <select value={purposeId} onChange={e => setPurposeId(e.target.value ? Number(e.target.value) : '')} className={SELECT_CLS}>
                        <option value="">Select purpose...</option>
                        {CONSUMER_PURPOSES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                    </div>
                  )}
                  {tab === 'commercial' && (
                    <>
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
                        <label className={LABEL_CLS}>Purpose</label>
                        <select value={commercialPurposeId} onChange={e => setCommercialPurposeId(e.target.value ? Number(e.target.value) : '')} className={SELECT_CLS}>
                          <option value="">Select purpose...</option>
                          {COMMERCIAL_PURPOSES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </select>
                      </div>
                    </>
                  )}
                  <div>
                    <label className={LABEL_CLS}>Loan Amount *</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 z-10 text-[14px] font-semibold text-muted-foreground pointer-events-none">$</span>
                      <Input type="number" step="0.01" min="1" placeholder="100,000" style={{ paddingLeft: '2rem' }} error={errors.amount?.message} {...register('amount', { required: 'Required', min: { value: 1, message: 'Must be positive' } })} />
                    </div>
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Notes <span className="font-normal">(optional)</span></label>
                    <textarea {...register('notes')} rows={3} className={TEXTAREA_CLS} placeholder="Any additional information about your loan requirement..." />
                  </div>
                </GlassCard>
              </>
            )}
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
                  <label className={LABEL_CLS}>Gender <span className="font-normal">(optional)</span></label>
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
                  <label className={LABEL_CLS}>First Name *</label>
                  <Input placeholder="First name" error={errors.applicant_first_name?.message} {...register('applicant_first_name', { required: 'Required' })} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Middle Name <span className="font-normal">(optional)</span></label>
                  <Input placeholder="Middle name" {...register('applicant_middle_name')} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Last Name *</label>
                  <Input placeholder="Last name" error={errors.applicant_last_name?.message} {...register('applicant_last_name', { required: 'Required' })} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={LABEL_CLS}>Date of Birth *</label>
                  <Input type="date" error={errors.applicant_dob?.message} {...register('applicant_dob', { required: 'Required' })} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Number of Dependants</label>
                  <Input type="number" min="0" max="20" {...register('num_dependants')} />
                </div>
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
                  <label className={LABEL_CLS}>ID Number *</label>
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
                  <label className={LABEL_CLS}>Expiry Date *</label>
                  <Input type="date" {...register('id_expiry_date')} />
                </div>
              </div>
            </GlassCard>

            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-foreground">Residency Status</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {['Australian Citizen', 'Permanent Resident', 'Temporary Visa', 'Other'].map(r => (
                  <label key={r} className={`flex cursor-pointer items-center gap-3 rounded-xl p-3 transition-all ${residencyStatus === r ? 'bg-primary/5 ring-1 ring-primary/30' : 'bg-secondary hover:bg-secondary/80'}`}>
                    <input type="radio" value={r} {...register('residency_status')} className="h-4 w-4 accent-[var(--primary)]" />
                    <span className="text-[13px] font-medium text-foreground">{r}</span>
                  </label>
                ))}
              </div>
              {residencyStatus === 'Other' && (
                <Input placeholder="Please specify..." {...register('residency_other')} />
              )}
            </GlassCard>

            {!lendEnabled && tab === 'commercial' && (
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

            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-foreground">Contact Details</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={LABEL_CLS}>Email Address *</label>
                  <Input type="email" placeholder="you@example.com" {...register('applicant_email')} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Mobile Number *</label>
                  <Input type="tel" placeholder="04XX XXX XXX" error={errors.applicant_mobile?.message} {...register('applicant_mobile', { required: 'Required' })} />
                </div>
              </div>
              <div>
                <label className={LABEL_CLS}>Preferred Contact Method</label>
                <select {...register('preferred_contact_method')} className={SELECT_CLS}>
                  {['Email', 'Mobile', 'Either'].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </GlassCard>
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
                      <Input type="date" {...register('employment_start_date')} />
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

              {additionalIncomes.length > 0 && (
                <div className="space-y-3">
                  <p className="text-[13px] font-semibold text-foreground">Additional Income</p>
                  {additionalIncomes.map((inc, idx) => (
                    <div key={idx} className="rounded-xl bg-secondary/40 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] font-medium text-muted-foreground">Income Source {idx + 1}</span>
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
                <div>
                  <label className={LABEL_CLS}>Name</label>
                  <Input placeholder="Jane Smith" {...register('emergency_contact_name')} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Relationship</label>
                  <Input placeholder="Spouse, Parent, etc." {...register('emergency_contact_relationship')} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Phone Number</label>
                  <Input type="tel" placeholder="04XX XXX XXX" {...register('emergency_contact_phone')} />
                </div>
              </div>
            </GlassCard>

            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-foreground">Signature</h3>
              <div>
                <label className={LABEL_CLS}>Digital Signature — Type your full name</label>
                <Input placeholder="Your full legal name" {...register('signature_name')} />
              </div>
              <p className="text-[12px] text-muted-foreground">Date: {new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
            </GlassCard>
          </>
        )}

        {/* ── Step 6: Review ── */}
        {step === 6 && (
          <GlassCard className="space-y-4">
            <h3 className="text-[14px] font-semibold text-foreground">Review Your Application</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-secondary/50 p-3">
                <p className="text-[12px] font-medium text-muted-foreground">Applicant</p>
                <p className="text-[14px] font-semibold text-foreground">{watch('applicant_title')} {watch('applicant_first_name')} {watch('applicant_last_name')}</p>
              </div>
              <div className="rounded-xl bg-secondary/50 p-3">
                <p className="text-[12px] font-medium text-muted-foreground">Contact</p>
                <p className="text-[14px] font-semibold text-foreground">{watch('applicant_mobile') || watch('applicant_email') || '—'}</p>
              </div>
              <div className="rounded-xl bg-secondary/50 p-3">
                <p className="text-[12px] font-medium text-muted-foreground">Loan Type</p>
                <p className="text-[14px] font-semibold text-foreground capitalize">
                  {lendEnabled
                    ? (selectedLoanTypes.map(t => t.replace(/_/g, ' ')).join(', ') || '—')
                    : `${tab === 'consumer' ? 'Consumer' : 'Commercial'} · ${currentPurposeLabel || 'No purpose selected'}`}
                </p>
              </div>
              <div className="rounded-xl bg-secondary/50 p-3">
                <p className="text-[12px] font-medium text-muted-foreground">Employment</p>
                <p className="text-[14px] font-semibold text-foreground capitalize">{watch('employment_category') === 'self_employed' ? 'Self-Employed' : 'Employed'}</p>
              </div>
              <div className="rounded-xl bg-secondary/50 p-3">
                <p className="text-[12px] font-medium text-muted-foreground">Address</p>
                <p className="text-[14px] font-semibold text-foreground">{[watch('applicant_suburb'), watch('applicant_state'), watch('applicant_postcode')].filter(Boolean).join(', ') || '—'}</p>
              </div>
              <div className="rounded-xl bg-secondary/50 p-3">
                <p className="text-[12px] font-medium text-muted-foreground">Residency</p>
                <p className="text-[14px] font-semibold text-foreground">{watch('residency_status')}</p>
              </div>
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
              {uploadedDocs.length > 0 && (
                <div className="rounded-xl bg-secondary/50 p-3">
                  <p className="text-[12px] font-medium text-muted-foreground">Documents</p>
                  <p className="text-[14px] font-semibold text-foreground">{uploadedDocs.length} uploaded</p>
                </div>
              )}
            </div>
            <p className="text-[13px] text-muted-foreground">Please review the details above. Once you submit, you can upload supporting documents on the next screen.</p>
          </GlassCard>
        )}

        {/* ── Navigation ── */}
        <div className="flex flex-wrap gap-3">
          {step > 1 && (
            <Button type="button" variant="secondary" size="lg" onClick={goBack}>Back</Button>
          )}
          {step < totalSteps ? (
            <Button type="button" size="lg" onClick={goNext}>Continue</Button>
          ) : (
            <Button type="submit" loading={isSubmitting} size="lg">
              {isSubmitting ? 'Submitting...' : 'Submit Application'}
            </Button>
          )}
          {lendEnabled && step > 1 && step < totalSteps && (
            <Button type="button" variant="secondary" size="lg" onClick={() => setStep(totalSteps)}>Skip to Review</Button>
          )}
          <Button type="button" variant="secondary" size="lg" onClick={() => navigate('/dashboard')}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
