import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { Card, PageHeader, Button, Input, DatePicker, LoanTypeIcon } from '../../components/ui';
import { getErrorMessage } from '../../lib/utils';
import { VEHICLE_MAKES, PROPERTY_TYPES, LOAN_TERM_OPTIONS, VEHICLE_CONDITION_OPTIONS, LOAN_CATEGORIES, isBusinessSubType, isConsumerSubType, subTypeToLoanType, findLoanSubType } from '../../lib/constants';
import type { LoanCategory } from '../../lib/constants';
import { applicantDisplayName } from '../../lib/applicantName';
import { CheckIcon, DocumentTextIcon, XMarkIcon } from '@heroicons/react/24/outline';

const LABEL_CLS = 'block text-[13px] font-medium text-muted-foreground mb-2';
const LBL = 'block text-[12px] font-medium text-muted-foreground mb-1';



const EXTRA_DEFAULTS = {
  applicant_title: '',
  applicant_middle_name: '',
  applicant_dob: '',
  applicant_gender: '',
  applicant_marital_status: '',
  applicant_address: '',
  applicant_suburb: '',
  applicant_state: '',
  applicant_postcode: '',
  preferred_contact_method: '',
  id_type: 'license',
  id_number: '',
  id_issuing_state_country: '',
  id_expiry_date: '',
  applicant_residency_status: '',
  residential_status: '',
  time_at_address: '',
  applicant_num_dependants: '',
  has_partner: false,
  partner_working: false,
  employment_category: '',
  employment_type_detail: '',
  employment_start_date: '',
  employer_name: '',
  employer_industry: '',
  employer_contact_details: '',
  job_title: '',
  income_frequency: '',
  gross_income: '',
  primary_income_type: '',
  primary_income_amount: '',
  primary_income_frequency: '',
  monthly_living_expenses: '',
  rent_mortgage_payments: '',
  child_support: '',
  other_commitments: '',
  business_name: '',
  business_abn: '',
  trading_name: '',
  business_structure: '',
  gst_registered: false,
  num_directors: '',
  time_trading: '',
  emergency_contact_name: '',
  emergency_contact_relationship: '',
  emergency_contact_phone: '',
  previously_declined: false,
  change_of_circumstances: '',
  signature_name: '',
  // Equipment Finance
  eq_asset_type: '',
  eq_new_or_used: 'New',
  eq_asset_price: '',
  eq_deposit_amount: '',
  eq_vendor_type: 'Dealer',
  eq_estimated_repayment: '',
  eq_loan_term: '',
  eq_business_use_pct: '',
  // Business Loan
  bl_loan_purpose: '',
  bl_loan_amount: '',
  bl_loan_term: '',
  bl_purpose_type: 'Working Capital',
  // Commercial Property
  cp_purchase_or_refinance: 'Purchase',
  cp_security_address: '',
  cp_estimated_value: '',
  cp_existing_debt: '',
  // Home Loan
  hl_purchase_or_refinance: 'Purchase',
  hl_owner_or_investment: 'Owner Occupied',
  hl_property_value: '',
  hl_existing_lender: '',
  // Consumer Vehicle
  vehicle_make: '',
  vehicle_model: '',
  vehicle_year: '',
  vehicle_condition: 'New',
  vehicle_vin: '',
  vehicle_price: '',
  deposit_amount: '',
  loan_term: '5 years',
  vehicle_type: 'Car',
  // Consumer Property
  property_address: '',
  property_type: '',
  property_value: '',
  first_home_buyer: 'no',
  current_lender: '',
  current_balance: '',
  refinance_reason: '',
  // Personal Loan
  loan_purpose: '',
  // Commercial sub-type fields
  equipment_type: '',
  equipment_description: '',
  vendor_type: 'Dealer',
  property_use: '',
  fit_out_description: '',
  renovation_description: '',
  project_description: '',
  business_plan: '',
  startup_costs: '',
  business_purpose: '',
  business_details: '',
  purchase_price: '',
  business_type: '',
  recruitment_details: '',
  expansion_description: '',
  supplier_details: '',
  outstanding_invoices: '',
  purpose_description: '',
  estimated_cost: '',
};

interface AdditionalIncome { income_type: string; amount: string; frequency: string; }
interface RealEstateAsset { property_type: string; address: string; estimated_value: string; ownership_type: string; is_financed: string; lender: string; amount_owing: string; monthly_repayment: string; rental_income: string; }
interface OtherAsset { asset_type: string; value: string; }
interface LiabilityItem { liability_type: string; lender: string; balance: string; limit: string; monthly_repayment: string; }

interface PrevClient {
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  mobile?: string;
}

interface AddLeadProps {
  basePath?: string;
  title?: string;
  submitLabel?: string;
  skipEngagement?: boolean;
  showFullDetails?: boolean;
}

const str = (v: unknown): string => (v == null ? '' : String(v));

/** Short human reference for an application, matching the applications table. */
const appRef = (id: string) => `APP-${id.replace(/-/g, '').slice(-6).toUpperCase()}`;

/**
 * Everything a clone inherits from its source application, mapped back onto the
 * form's flat field bag. Loan fields are deliberately absent — they're the one
 * thing a clone fills in fresh.
 */
function cloneExtraFields(app: Record<string, unknown>, lend: Record<string, unknown>): Partial<typeof EXTRA_DEFAULTS> {
  const idDoc = (Array.isArray(lend.identification) ? lend.identification[0] : null) as Record<string, unknown> | null;
  const employment = (Array.isArray(lend.employments) ? lend.employments[0] : null) as Record<string, unknown> | null;
  const primaryIncome = (Array.isArray(lend.incomes) ? lend.incomes[0] : null) as Record<string, unknown> | null;
  const expenses = (lend.expenses ?? {}) as Record<string, unknown>;
  const isPassport = idDoc?.type === 'Passport';

  return {
    // Personal
    applicant_title: str(app.applicant_title),
    applicant_middle_name: str(app.applicant_middle_name),
    applicant_dob: str(app.applicant_dob),
    applicant_gender: str(app.applicant_gender),
    applicant_marital_status: str(app.applicant_marital_status),
    preferred_contact_method: str(app.preferred_contact_method),
    // Identification
    id_type: isPassport ? 'passport' : 'license',
    id_number: str(idDoc?.number),
    id_issuing_state_country: str(idDoc?.state ?? idDoc?.country),
    id_expiry_date: str(app.id_expiry_date ?? idDoc?.expiry_date),
    applicant_residency_status: str(app.applicant_residency_status),
    // Address & living situation
    applicant_address: str(app.applicant_address),
    applicant_suburb: str(app.applicant_suburb),
    applicant_state: str(app.applicant_state),
    applicant_postcode: str(app.applicant_postcode),
    residential_status: str(app.residential_status),
    time_at_address: str(app.time_at_address),
    applicant_num_dependants: app.applicant_num_dependants != null ? String(app.applicant_num_dependants) : '',
    has_partner: app.has_partner === true,
    partner_working: app.partner_working === true,
    // Employment & income
    employment_category: str(app.employment_category),
    employment_type_detail: str(employment?.employment_type),
    employment_start_date: str(employment?.start_date),
    employer_name: str(app.employer_name),
    employer_industry: str(app.employer_industry),
    employer_contact_details: str(employment?.contact_details),
    job_title: str(app.job_title),
    income_frequency: str(app.income_frequency),
    gross_income: app.gross_income != null ? String(app.gross_income) : '',
    primary_income_type: str(primaryIncome?.income_type),
    primary_income_amount: primaryIncome?.amount ? String(primaryIncome.amount) : '',
    primary_income_frequency: str(primaryIncome?.frequency),
    // Expenses
    monthly_living_expenses: expenses.monthly_living ? String(expenses.monthly_living) : '',
    rent_mortgage_payments: expenses.rent_mortgage ? String(expenses.rent_mortgage) : '',
    child_support: expenses.child_support ? String(expenses.child_support) : '',
    other_commitments: expenses.other_commitments ? String(expenses.other_commitments) : '',
    // Business / entity
    business_name: str(app.business_name),
    business_abn: str(app.business_abn),
    trading_name: str(app.trading_name),
    business_structure: str(app.business_structure),
    gst_registered: app.gst_registered === true,
    num_directors: app.num_directors != null ? String(app.num_directors) : '',
    time_trading: str(app.time_trading),
    // Emergency contact
    emergency_contact_name: str(app.emergency_contact_name),
    emergency_contact_relationship: str(app.emergency_contact_relationship),
    emergency_contact_phone: str(app.emergency_contact_phone),
    // Declarations: the credit history carries over, but the statement of
    // circumstances and the signature are re-taken for the new loan.
    previously_declined: app.previously_declined === true,
  };
}

function buildLoanTypeDetails(extra: typeof EXTRA_DEFAULTS, subLoanType: string): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  const label = findLoanSubType(subLoanType)?.label;
  if (isConsumerSubType(subLoanType)) {
    details.consumer_loan_type = { type: subLoanType, label };
    if (['car', 'motorcycle', 'caravan', 'other_vehicle'].includes(subLoanType)) {
      details.vehicle_details = {
        type: extra.vehicle_type,
        make: extra.vehicle_make,
        model: extra.vehicle_model,
        year: extra.vehicle_year,
        condition: extra.vehicle_condition,
        vin: extra.vehicle_vin,
        price: parseFloat(extra.vehicle_price) || 0,
        deposit: parseFloat(extra.deposit_amount) || 0,
        loan_term: extra.loan_term,
      };
    } else if (subLoanType === 'personal') {
      details.personal_loan = {
        purpose: extra.loan_purpose,
        amount: parseFloat(extra.bl_loan_amount) || 0,
        term: extra.loan_term,
      };
    } else if (['purchase', 'refinance'].includes(subLoanType)) {
      details.property_details = {
        address: extra.property_address,
        property_type: extra.property_type,
        value: parseFloat(extra.property_value) || 0,
        deposit: subLoanType === 'purchase' ? parseFloat(extra.deposit_amount) || 0 : undefined,
        first_home_buyer: extra.first_home_buyer === 'yes',
        current_lender: subLoanType === 'refinance' ? extra.current_lender : undefined,
        current_balance: subLoanType === 'refinance' ? parseFloat(extra.current_balance) || 0 : undefined,
        refinance_reason: subLoanType === 'refinance' ? extra.refinance_reason : undefined,
        term: extra.loan_term,
      };
    }
  } else {
    details.commercial_loan_type = { type: subLoanType, label };
    if (['vehicles_or_transport', 'machinery_or_equipment'].includes(subLoanType)) {
      details.asset_details = {
        equipment_type: extra.equipment_type,
        description: extra.equipment_description,
        condition: extra.vehicle_condition,
        price: parseFloat(extra.vehicle_price) || 0,
        deposit: parseFloat(extra.deposit_amount) || 0,
        vendor_type: extra.vendor_type,
        business_use_pct: parseFloat(extra.eq_business_use_pct) || 0,
        term: extra.loan_term,
      };
    }
    if (['property', 'development_construction', 'new_fit_out', 'renovation'].includes(subLoanType)) {
      details.property_details = {
        address: extra.property_address,
        property_type: extra.property_type,
        property_use: extra.property_use,
        value: parseFloat(extra.property_value) || 0,
        loan_amount: parseFloat(extra.bl_loan_amount) || 0,
        term: extra.loan_term,
        project_description: subLoanType === 'development_construction' ? extra.project_description : undefined,
        fit_out_description: subLoanType === 'new_fit_out' ? extra.fit_out_description : undefined,
        renovation_description: subLoanType === 'renovation' ? extra.renovation_description : undefined,
      };
    }
    if (['new_business', 'purchase_business'].includes(subLoanType)) {
      details.business_details = {
        business_plan: subLoanType === 'new_business' ? extra.business_plan : undefined,
        startup_costs: subLoanType === 'new_business' ? parseFloat(extra.startup_costs) || 0 : undefined,
        industry: subLoanType === 'new_business' ? extra.business_purpose : undefined,
        business_details: subLoanType === 'purchase_business' ? extra.business_details : undefined,
        purchase_price: subLoanType === 'purchase_business' ? parseFloat(extra.purchase_price) || 0 : undefined,
        business_type: subLoanType === 'purchase_business' ? extra.business_type : undefined,
        loan_amount: parseFloat(extra.bl_loan_amount) || 0,
        term: extra.loan_term,
      };
    }
    if (['day_to_day_capital', 'expansion', 'staff_recruitment', 'pay_suppliers', 'waiting_for_invoices', 'other'].includes(subLoanType)) {
      details.working_capital = {
        recruitment_details: subLoanType === 'staff_recruitment' ? extra.recruitment_details : undefined,
        expansion_description: subLoanType === 'expansion' ? extra.expansion_description : undefined,
        supplier_details: subLoanType === 'pay_suppliers' ? extra.supplier_details : undefined,
        outstanding_invoices: subLoanType === 'waiting_for_invoices' ? extra.outstanding_invoices : undefined,
        purpose_description: subLoanType === 'other' ? extra.purpose_description : undefined,
        loan_amount: parseFloat(extra.bl_loan_amount) || 0,
        term: extra.loan_term,
      };
    }
  }
  return details;
}

export default function AddLead({ basePath = '/referrer/applications', title = 'Add Lead', submitLabel, skipEngagement = false, showFullDetails = false }: AddLeadProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [searchParams] = useSearchParams();

  // Clone mode: start from an existing application. Personal and company details
  // are copied in; only the loan details are entered fresh.
  const cloneFromId = searchParams.get('cloneFrom') || '';
  const [cloneSource, setCloneSource] = useState<{ id: string; name: string } | null>(null);
  const [cloneLoading, setCloneLoading] = useState(!!cloneFromId);
  const [createdAppId, setCreatedAppId] = useState<string | null>(null);

  // Client
  const [clientMode, setClientMode] = useState<'new' | 'existing'>('new');
  const [prevClients, setPrevClients] = useState<PrevClient[]>([]);
  const [prevClientsLoading, setPrevClientsLoading] = useState(false);
  const [prevClientSearch, setPrevClientSearch] = useState('');
  const [selectedPrevClient, setSelectedPrevClient] = useState<PrevClient | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');

  // Engagement
  const [engagementModel, setEngagementModel] = useState<'direct_engagement' | 'self_managed' | ''>('');
  const [engagementError, setEngagementError] = useState('');

  // Referrer credit (staff form only) — for leads that arrived outside the
  // portal (e.g. WhatsApp) where the referrer never submitted through the app.
  const [referrers, setReferrers] = useState<{ id: string; name: string; organization?: string | null }[]>([]);
  const [creditReferrerId, setCreditReferrerId] = useState('');

  // Extra client detail fields (shown when self_managed)
  const [extra, setExtraFields] = useState(EXTRA_DEFAULTS);
  const setExtra = <K extends keyof typeof EXTRA_DEFAULTS>(key: K, value: typeof EXTRA_DEFAULTS[K]) =>
    setExtraFields(prev => ({ ...prev, [key]: value }));

  // Financial position arrays
  const [additionalIncomes, setAdditionalIncomes] = useState<AdditionalIncome[]>([]);
  const [realEstateAssets, setRealEstateAssets] = useState<RealEstateAsset[]>([]);
  const [otherAssets, setOtherAssets] = useState<OtherAsset[]>([]);
  const [liabilities, setLiabilities] = useState<LiabilityItem[]>([]);

  // Application
  const [loanType, setLoanType] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState<LoanCategory>('asset_finance');
  const [subLoanType, setSubLoanType] = useState('');
  const [comBusinessName, setComBusinessName] = useState('');
  const [comAbn, setComAbn] = useState('');
  const [files, setFiles] = useState<File[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Auto-save draft to backend so brokers/admins can see it before submission
  const [draftAppId, setDraftAppId] = useState<string | null>(null);
  const draftCreatingRef = useRef(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSelfManaged = showFullDetails || engagementModel === 'self_managed';
  const isBusinessLoan = loanType === 'business_loan';
  const businessSubType = isBusinessSubType(subLoanType);

  useEffect(() => {
    if (clientMode !== 'existing') return;
    setPrevClientsLoading(true);
    const endpoint = skipEngagement ? '/users' : '/referrer/clients';
    api.get(endpoint)
      .then(({ data }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw: any[] = Array.isArray(data) ? data : (data.items || data.data || []);
        const list = skipEngagement
          ? raw.filter((u: { role: string; email: string }) => u.role === 'client' && !u.email.endsWith('@deleted.invalid'))
          : raw;
        setPrevClients(list.map(c => {
          const fName = c.first_name || c.full_name?.split(' ')[0] || '';
          const lName = c.last_name || c.full_name?.split(' ').slice(1).join(' ') || '';
          return {
            name: [fName, lName].filter(Boolean).join(' '),
            firstName: fName,
            lastName: lName,
            email: c.email,
            mobile: c.mobile || c.phone || undefined,
          };
        }));
      })
      .catch(() => { })
      .finally(() => setPrevClientsLoading(false));
  }, [clientMode, skipEngagement]);

  // Staff form only: load the tenant's referrers so the lead can be credited.
  useEffect(() => {
    if (!skipEngagement) return;
    api.get('/users', { params: { role: 'referrer' } })
      .then(({ data }) => {
        const raw: { id: string; full_name: string | null; email: string; organization_name?: string | null }[] = Array.isArray(data) ? data : [];
        setReferrers(raw.map(u => ({ id: u.id, name: u.full_name || u.email, organization: u.organization_name })));
      })
      .catch(() => { });
  }, [skipEngagement]);

  // Load the application being cloned and lay its client + company details over
  // the empty form. The loan sections are intentionally left untouched.
  useEffect(() => {
    if (!cloneFromId) return;
    let cancelled = false;
    api.get(`/applications/${cloneFromId}`)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const app = data as Record<string, unknown>;
        const lend: Record<string, unknown> = (() => {
          if (typeof app.lend_extra_data !== 'string') return {};
          try {
            const parsed = JSON.parse(app.lend_extra_data);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
          } catch { return {}; }
        })();

        setFirstName(str(app.applicant_first_name));
        setLastName(str(app.applicant_last_name));
        setEmail(str(app.applicant_email || app.user_email));
        setMobile(str(app.applicant_mobile));
        setComBusinessName(str(app.business_name));
        setComAbn(str(app.business_abn));
        setExtraFields(prev => ({ ...prev, ...cloneExtraFields(app, lend) }));

        // The primary income lives in its own fields; the rest are the extras list.
        const incomes = Array.isArray(lend.incomes) ? lend.incomes.slice(1) : [];
        setAdditionalIncomes(incomes.map((row) => {
          const i = (row ?? {}) as Record<string, unknown>;
          return {
            income_type: str(i.income_type) || 'Rental Income',
            amount: i.amount ? String(i.amount) : '',
            frequency: str(i.frequency) || 'Monthly',
          };
        }));

        const assets = (lend.assets ?? {}) as Record<string, unknown>;
        setRealEstateAssets((Array.isArray(assets.real_estate) ? assets.real_estate : []).map((row) => {
          const a = (row ?? {}) as Record<string, unknown>;
          return {
            property_type: str(a.property_type) || 'Home',
            address: str(a.address),
            estimated_value: str(a.estimated_value),
            ownership_type: str(a.ownership_type) || 'Sole',
            is_financed: str(a.is_financed) || 'no',
            lender: str(a.lender),
            amount_owing: str(a.amount_owing),
            monthly_repayment: str(a.monthly_repayment),
            rental_income: str(a.rental_income),
          };
        }));
        setOtherAssets((Array.isArray(assets.other) ? assets.other : []).map((row) => {
          const a = (row ?? {}) as Record<string, unknown>;
          return { asset_type: str(a.asset_type) || 'Vehicles', value: str(a.value) };
        }));
        setLiabilities((Array.isArray(lend.liabilities) ? lend.liabilities : []).map((row) => {
          const l = (row ?? {}) as Record<string, unknown>;
          return {
            liability_type: str(l.liability_type) || 'Home Loans',
            lender: str(l.lender),
            balance: str(l.balance),
            limit: str(l.limit),
            monthly_repayment: str(l.monthly_repayment),
          };
        }));

        setCloneSource({
          id: str(app.id),
          name: applicantDisplayName({
            applicant_first_name: str(app.applicant_first_name),
            applicant_last_name: str(app.applicant_last_name),
            business_name: str(app.business_name),
            user_name: str(app.user_name),
            user_role: str(app.user_role),
          }),
        });
      })
      .catch(() => toast('Could not load the application to clone.', 'error'))
      .finally(() => { if (!cancelled) setCloneLoading(false); });
    return () => { cancelled = true; };
  }, [cloneFromId, toast]);

  const deleteDraft = async (id: string) => {
    try { await api.delete(`/applications/${id}`); } catch { /* ignore */ }
  };

  // Create a draft in the backend once we have the minimum required fields.
  // Intentionally excludes client_engagement_model and applicant_email so the
  // backend does not create a client account or send invitation emails — those
  // should only happen on explicit submission.
  useEffect(() => {
    if (engagementModel === 'direct_engagement') return;
    // A clone starts from a real application already — no placeholder draft.
    if (cloneFromId) return;
    if (!firstName.trim() || !lastName.trim() || !email.trim()) return;
    if (!subLoanType || !amount || parseFloat(amount) <= 0) return;
    if (draftAppId || draftCreatingRef.current) return;

    const effectiveLoanType = subTypeToLoanType(subLoanType);
    const timer = setTimeout(async () => {
      if (draftAppId || draftCreatingRef.current) return;
      draftCreatingRef.current = true;
      try {
        const { data: app } = await api.post('/applications', {
          loan_type: effectiveLoanType,
          amount: parseFloat(amount),
          applicant_first_name: firstName.trim(),
          applicant_last_name: lastName.trim(),
          ...(mobile.trim() && { applicant_mobile: mobile.trim() }),
          ...(notes.trim() && { notes: notes.trim() }),
          ...(isBusinessSubType(subLoanType) && {
            business_name: comBusinessName.trim() || null,
            business_abn: comAbn.trim() || null,
          }),
        });
        setDraftAppId(app.id);
      } catch {
        // silently fail — user can still submit normally
      } finally {
        draftCreatingRef.current = false;
      }
    }, 1500);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstName, lastName, email, subLoanType, amount, engagementModel]);

  // Delete draft when referrer switches to direct_engagement (which creates its own application).
  useEffect(() => {
    if (engagementModel === 'direct_engagement' && draftAppId) {
      const id = draftAppId;
      setDraftAppId(null);
      deleteDraft(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagementModel]);

  // Patch the draft as the referrer keeps filling in details.
  useEffect(() => {
    if (!draftAppId) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(async () => {
      const effectiveLoanType = subLoanType ? subTypeToLoanType(subLoanType) : null;
      const patch: Record<string, unknown> = {
        applicant_first_name: firstName.trim() || null,
        applicant_last_name: lastName.trim() || null,
        applicant_mobile: mobile.trim() || null,
        notes: notes.trim() || null,
        ...(effectiveLoanType && { loan_type: effectiveLoanType }),
        ...(parseFloat(amount) > 0 && { amount: parseFloat(amount) }),
        ...(isBusinessSubType(subLoanType) && {
          business_name: comBusinessName.trim() || null,
          business_abn: comAbn.trim() || null,
        }),
      };
      try {
        await api.patch(`/applications/${draftAppId}`, patch);
      } catch {
        // silently fail
      }
    }, 1500);
    return () => { if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current); };
  }, [draftAppId, firstName, lastName, email, mobile, notes, amount, subLoanType, comBusinessName, comAbn]);

  const handleFileAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setFiles(prev => [...prev, file]);
  };

  const handleSubmit = async () => {
    if (!skipEngagement && !engagementModel) { setEngagementError('Please select who will engage with the client'); return; }
    if (!firstName.trim() || !lastName.trim()) { toast("Please enter the client's name", 'error'); return; }
    if (!email.trim()) { toast("Please enter the client's email", 'error'); return; }
    if (!subLoanType) { toast('Please select a loan type', 'error'); return; }
    // ABN is required for full business-purpose applications (broker/admin create).
    // Quick referrer lead capture stays lenient — broker fills the ABN in later.
    const commercialAbn = (comAbn.trim() || extra.business_abn.trim());
    if (showFullDetails && businessSubType && !commercialAbn) {
      toast('ABN is required for business loan applications', 'error');
      return;
    }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) { toast('Please enter a valid amount', 'error'); return; }

    const effectiveLoanType = subTypeToLoanType(subLoanType);

    setSubmitting(true);
    try {
      let appId: string;

      if (engagementModel === 'direct_engagement') {
        // Create a real client account + draft application owned by the client
        const { data: result } = await api.post('/referrer/direct-referral', {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim(),
          mobile: mobile.trim() || null,
          company_name: businessSubType ? comBusinessName.trim() || null : null,
          loan_type: effectiveLoanType,
          amount: parseFloat(amount),
          notes: notes.trim() || null,
          business_name: businessSubType ? comBusinessName.trim() || null : null,
          business_abn: businessSubType ? comAbn.trim() || null : null,
          lend_extra_data: JSON.stringify({
            loan_type_details: buildLoanTypeDetails(extra, subLoanType),
          }),
        });
        appId = result.application_id;
      } else {
        const extraPayload = isSelfManaged ? {
          applicant_title: extra.applicant_title || null,
          applicant_middle_name: extra.applicant_middle_name || null,
          applicant_dob: extra.applicant_dob || null,
          applicant_gender: extra.applicant_gender || null,
          applicant_marital_status: extra.applicant_marital_status || null,
          applicant_address: extra.applicant_address || null,
          applicant_suburb: extra.applicant_suburb || null,
          applicant_state: extra.applicant_state || null,
          applicant_postcode: extra.applicant_postcode || null,
          preferred_contact_method: extra.preferred_contact_method || null,
          id_expiry_date: extra.id_expiry_date || null,
          applicant_residency_status: extra.applicant_residency_status || null,
          residential_status: extra.residential_status || null,
          time_at_address: extra.time_at_address || null,
          applicant_num_dependants: extra.applicant_num_dependants ? parseInt(extra.applicant_num_dependants) : null,
          has_partner: extra.has_partner,
          partner_working: extra.partner_working,
          employment_category: extra.employment_category || null,
          employer_name: extra.employer_name || null,
          employer_industry: extra.employer_industry || null,
          job_title: extra.job_title || null,
          income_frequency: extra.income_frequency || null,
          gross_income: extra.gross_income ? parseFloat(extra.gross_income) : null,
          business_name: extra.business_name || null,
          business_abn: extra.business_abn || null,
          trading_name: extra.trading_name || null,
          business_structure: extra.business_structure || null,
          gst_registered: extra.gst_registered,
          num_directors: extra.num_directors ? parseInt(extra.num_directors) : null,
          time_trading: extra.time_trading || null,
          emergency_contact_name: extra.emergency_contact_name || null,
          emergency_contact_relationship: extra.emergency_contact_relationship || null,
          emergency_contact_phone: extra.emergency_contact_phone || null,
          previously_declined: extra.previously_declined,
          change_of_circumstances: extra.change_of_circumstances || null,
          signature_name: extra.signature_name || null,
          lend_extra_data: JSON.stringify({
            identification: extra.id_number ? [{
              type: extra.id_type === 'license' ? 'Drivers Licence' : 'Passport',
              number: extra.id_number,
              [extra.id_type === 'license' ? 'state' : 'country']: extra.id_issuing_state_country,
              expiry_date: extra.id_expiry_date,
            }] : [],
            employments: [{
              employment_type: extra.employment_type_detail || null,
              start_date: extra.employment_start_date || null,
              contact_details: extra.employer_contact_details || null,
            }],
            incomes: [
              ...(extra.primary_income_amount ? [{ income_type: extra.primary_income_type || 'Salary', amount: parseFloat(extra.primary_income_amount) || 0, frequency: extra.primary_income_frequency || extra.income_frequency }] : []),
              ...additionalIncomes.map(ai => ({ income_type: ai.income_type, amount: parseFloat(ai.amount) || 0, frequency: ai.frequency })),
            ].filter(i => i.amount > 0),
            expenses: {
              monthly_living: parseFloat(extra.monthly_living_expenses) || 0,
              rent_mortgage: parseFloat(extra.rent_mortgage_payments) || 0,
              child_support: parseFloat(extra.child_support) || 0,
              other_commitments: parseFloat(extra.other_commitments) || 0,
            },
            assets: { real_estate: realEstateAssets, other: otherAssets },
            liabilities,
            loan_type_details: buildLoanTypeDetails(extra, subLoanType),
          }),
        } : {};

        const payload = {
          loan_type: effectiveLoanType,
          amount: parseFloat(amount),
          ...(engagementModel && { client_engagement_model: engagementModel }),
          applicant_first_name: firstName.trim(),
          applicant_last_name: lastName.trim(),
          applicant_email: email.trim(),
          applicant_mobile: mobile.trim() || null,
          notes: notes.trim() || null,
          status: 'application_received',
          ...extraPayload,
          // Business-purpose values take priority, falling back to the detail-section
          // business fields. Placed after extraPayload so they aren't nulled out.
          ...(businessSubType ? {
            business_name: (comBusinessName.trim() || extra.business_name.trim()) || null,
            business_abn: (comAbn.trim() || extra.business_abn.trim()) || null,
          } : {}),
        };

        // Cloning keeps the source's client, company link, brokers and parties;
        // this payload only carries the fresh loan details and any edits made to
        // the copied client details.
        const { data: app } = cloneFromId
          ? await api.post(`/applications/${cloneFromId}/clone`, payload)
          : await api.post('/applications', payload);
        appId = app.id;

        // Credit the selected referrer for this lead (staff form only). The
        // application must have resolved to a client-owned account to attribute.
        // Clones inherit the client's existing attribution.
        if (!cloneFromId && creditReferrerId && app.user_role === 'client' && app.user_id) {
          try {
            await api.post(`/users/${app.user_id}/referrer`, { referrer_id: creditReferrerId });
          } catch {
            toast('Application created, but the referrer could not be linked — this client may already have one.', 'error');
          }
        }
      }

      // Upload files
      await Promise.allSettled(
        files.map(file => {
          const form = new FormData();
          form.append('file', file);
          form.append('doc_type', 'other');
          return api.post(`/documents/upload/${appId}`, form, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
        })
      );

      // Clean up the auto-saved draft now that the real application exists
      if (draftAppId && engagementModel !== 'direct_engagement') {
        const id = draftAppId;
        setDraftAppId(null);
        deleteDraft(id);
      }

      setCreatedAppId(appId);
      setDone(true);
    } catch (err: unknown) {
      toast(getErrorMessage(err, cloneFromId ? 'Failed to clone application' : 'Failed to submit lead'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    if (draftAppId) {
      const id = draftAppId;
      setDraftAppId(null);
      deleteDraft(id);
    }
    setClientMode('new'); setSelectedPrevClient(null); setPrevClientSearch('');
    setFirstName(''); setLastName(''); setEmail(''); setMobile('');
    setEngagementModel(''); setEngagementError(''); setCreditReferrerId('');
    setExtraFields(EXTRA_DEFAULTS);
    setAdditionalIncomes([]); setRealEstateAssets([]); setOtherAssets([]); setLiabilities([]);
    setLoanType(''); setAmount(''); setNotes(''); setCategory('asset_finance'); setSubLoanType(''); setComBusinessName(''); setComAbn(''); setFiles([]);
    setDone(false);
  };

  // ── Success ───────────────────────────────────────────────────────────────

  if (done) {
    return (
      <div className="mx-auto max-w-md">
        <Card>
          <div className="text-center space-y-5 py-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
              <CheckIcon className="h-7 w-7 text-success" strokeWidth={2} />
            </div>
            <div>
              <p className="text-[18px] font-semibold text-foreground">
                {cloneFromId ? 'Application cloned!' : 'Lead submitted!'}
              </p>
              <p className="text-[14px] text-muted-foreground mt-1.5">
                {cloneFromId
                  ? `The new application carries ${firstName || 'the client'}'s personal and company details. Documents and signatures start fresh.`
                  : engagementModel === 'direct_engagement'
                    ? `Your broker has been notified and will review the lead. They'll invite ${firstName} once they've set up the form.`
                    : `Your broker will review and follow up with ${firstName}.`}
              </p>
            </div>
            <div className="flex gap-3 justify-center">
              {cloneFromId && createdAppId ? (
                <Button onClick={() => navigate(`${basePath}/${createdAppId}`)}>Open Application</Button>
              ) : (
                <Button onClick={() => navigate(basePath)}>View Applications</Button>
              )}
              {cloneFromId ? (
                <Button variant="secondary" onClick={() => navigate(basePath)}>View Applications</Button>
              ) : (
                <Button variant="secondary" onClick={reset}>Add Another</Button>
              )}
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // ── Single page form ──────────────────────────────────────────────────────

  const filtered = prevClients.filter(c => {
    const q = prevClientSearch.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
  });

  if (cloneLoading) {
    return (
      <div className="mx-auto max-w-xl">
        <Card>
          <p className="text-[14px] text-muted-foreground text-center py-8">Loading the application to clone...</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader
        title={cloneFromId ? 'Clone Application' : title}
        subtitle={cloneFromId
          ? 'Personal and company details are copied — enter the new loan details'
          : 'Fill in the details and submit — your broker handles the rest'}
      />

      {cloneFromId && cloneSource && (
        <Card className="space-y-1">
          <p className="text-[14px] font-semibold text-foreground">
            Cloning {appRef(cloneSource.id)}{cloneSource.name ? ` · ${cloneSource.name}` : ''}
          </p>
          <p className="text-[12.5px] text-muted-foreground">
            The client, their company, directors and guarantors carry over. Documents,
            signatures and the loan details start fresh — check the copied details below
            are still current before submitting.
          </p>
        </Card>
      )}

      {/* Client */}
      <Card className="space-y-4">
        <p className="text-[15px] font-semibold text-foreground">Client</p>
        {!cloneFromId && (
          <div className="flex gap-2">
            <button type="button"
              onClick={() => { setClientMode('new'); setSelectedPrevClient(null); }}
              className={`flex-1 rounded-xl border py-2 text-[13px] font-medium transition-colors ${clientMode === 'new' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/30'}`}
            >New client</button>
            <button type="button"
              onClick={() => setClientMode('existing')}
              className={`flex-1 rounded-xl border py-2 text-[13px] font-medium transition-colors ${clientMode === 'existing' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/30'}`}
            >Existing client</button>
          </div>
        )}

        {!cloneFromId && clientMode === 'existing' && (
          <div className="space-y-2">
            {selectedPrevClient ? (
              <div className="flex items-center justify-between rounded-xl border border-primary bg-primary/5 px-4 py-3">
                <div>
                  <p className="text-[14px] font-medium text-foreground">{selectedPrevClient.name}</p>
                  <p className="text-[12px] text-muted-foreground">{selectedPrevClient.email}{selectedPrevClient.mobile ? ` · ${selectedPrevClient.mobile}` : ''}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { setSelectedPrevClient(null); setPrevClientSearch(''); }}
                  className="text-[12px] font-medium text-primary hover:underline shrink-0 ml-3"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <Input placeholder="Search by name or email..." value={prevClientSearch} onChange={e => setPrevClientSearch(e.target.value)} />
                <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                  {prevClientsLoading && <p className="text-[13px] text-muted-foreground text-center py-3">Loading...</p>}
                  {!prevClientsLoading && filtered.length === 0 && (
                    <p className="text-[13px] text-muted-foreground text-center py-3">No Existing clients found</p>
                  )}
                  {filtered.map((c, i) => (
                    <button key={i} type="button"
                      onClick={() => { setSelectedPrevClient(c); setFirstName(c.firstName); setLastName(c.lastName); setEmail(c.email); setMobile(c.mobile ?? ''); }}
                      className="w-full text-left rounded-xl border border-border px-4 py-3 transition-colors hover:border-primary/30"
                    >
                      <p className="text-[14px] font-medium text-foreground">{c.name}</p>
                      <p className="text-[12px] text-muted-foreground">{c.email}{c.mobile ? ` · ${c.mobile}` : ''}</p>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL_CLS}>First Name *</label>
            <Input placeholder="John" value={firstName} onChange={e => setFirstName(e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLS}>Last Name *</label>
            <Input placeholder="Smith" value={lastName} onChange={e => setLastName(e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLS}>Email *</label>
            <Input type="email" placeholder="john@example.com" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLS}>Mobile <span className="font-normal">(optional)</span></label>
            <Input type="tel" placeholder="04XX XXX XXX" value={mobile} onChange={e => setMobile(e.target.value)} />
          </div>
        </div>
      </Card>

      {/* Engagement */}
      {!skipEngagement && <Card className="space-y-3">
        <p className="text-[15px] font-semibold text-foreground">Who will engage with the client?</p>
        <label className={`flex items-start gap-3 rounded-xl border p-3.5 cursor-pointer transition-colors ${engagementModel === 'direct_engagement' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'}`}>
          <input type="radio" name="engagement" value="direct_engagement" checked={engagementModel === 'direct_engagement'} onChange={() => { setEngagementModel('direct_engagement'); setEngagementError(''); }} className="mt-0.5 accent-primary shrink-0" />
          <div>
            <p className="text-[14px] font-medium text-foreground">Xpress Finance will engage with the client</p>
            <p className="text-[12px] text-muted-foreground mt-0.5">Our team will contact and work with the client directly.</p>
          </div>
        </label>
        <label className={`flex items-start gap-3 rounded-xl border p-3.5 cursor-pointer transition-colors ${engagementModel === 'self_managed' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'}`}>
          <input type="radio" name="engagement" value="self_managed" checked={engagementModel === 'self_managed'} onChange={() => { setEngagementModel('self_managed'); setEngagementError(''); }} className="mt-0.5 accent-primary shrink-0" />
          <div>
            <p className="text-[14px] font-medium text-foreground">I will engage with the client</p>
            <p className="text-[12px] text-muted-foreground mt-0.5">You'll fill in all the details on the client's behalf.</p>
          </div>
        </label>
        {engagementError && <p className="text-[12px] text-destructive">{engagementError}</p>}
      </Card>}

      {/* Referrer credit — staff form only; a clone keeps the client's existing referrer */}
      {skipEngagement && !cloneFromId && (
        <Card className="space-y-3">
          <div>
            <p className="text-[15px] font-semibold text-foreground">Referrer <span className="text-[13px] font-normal text-muted-foreground">(optional)</span></p>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              If this lead came from a referrer outside the portal (e.g. via WhatsApp), select them here so they're credited.
            </p>
          </div>
          {referrers.length > 0 ? (
            <select value={creditReferrerId} onChange={e => setCreditReferrerId(e.target.value)} className="led-input">
              <option value="">No referrer</option>
              {referrers.map(r => (
                <option key={r.id} value={r.id}>{r.name}{r.organization ? ` — ${r.organization}` : ''}</option>
              ))}
            </select>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              No referrer accounts found — add referrers under Referrer Management to credit them here.
            </p>
          )}
        </Card>
      )}

      {/* Tab switcher + Loan type section */}
      <Card className="space-y-4">
        <p className="text-[15px] font-semibold text-foreground">What does the client need?</p>
        <div className="flex rounded-xl bg-secondary p-1 gap-1">
          {LOAN_CATEGORIES.map(c => (
            <button key={c.value} type="button" onClick={() => { setCategory(c.value); setSubLoanType(''); }}
              className={`flex-1 rounded-lg py-2 text-[13px] font-medium transition-all ${category === c.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >{c.label}</button>
          ))}
        </div>

        {/* Sub-types for the active category */}
        <div className="grid grid-cols-2 gap-2">
          {(LOAN_CATEGORIES.find(c => c.value === category)?.types ?? []).map(type => {
            const active = subLoanType === type.value;
            return (
              <button key={type.value} type="button" onClick={() => setSubLoanType(type.value)}
                className={`rounded-xl border p-3 text-left transition-all ${active ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border hover:border-primary/30 hover:bg-secondary/50'}`}
              >
                <LoanTypeIcon type={type.value} className="h-5 w-5 text-muted-foreground" />
                <p className="text-[13px] font-medium text-foreground mt-1">{type.label}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{type.description}</p>
              </button>
            );
          })}
        </div>

        {/* Business identity for business-purpose sub-types */}
        {businessSubType && (
          <div>
            <label className={LBL}>Business / Entity Name</label>
            <input type="text" className="led-input" placeholder="Acme Pty Ltd" value={comBusinessName} onChange={e => setComBusinessName(e.target.value)} />
          </div>
        )}

        {/* Consumer sub-forms */}
        {subLoanType && !businessSubType && (
          <>
            {/* Vehicle sub-types: car, motorcycle, caravan, other_vehicle */}
            {['car', 'motorcycle', 'caravan', 'other_vehicle'].includes(subLoanType) && (
              <div className="space-y-3 border-t border-border pt-4">
                <p className="text-[13px] font-semibold text-foreground">Vehicle Details</p>
                {subLoanType === 'other_vehicle' && (
                  <div>
                    <label className={LBL}>Vehicle Type</label>
                    <input type="text" className="led-input" placeholder="e.g. Boat, Jet Ski" value={extra.vehicle_type} onChange={e => setExtra('vehicle_type', e.target.value)} />
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={LBL}>Make</label>
                    <select value={extra.vehicle_make} onChange={e => setExtra('vehicle_make', e.target.value)} className="led-input">
                      <option value="">Select make...</option>
                      {VEHICLE_MAKES.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={LBL}>Model</label>
                    <input type="text" className="led-input" placeholder="e.g. Corolla" value={extra.vehicle_model} onChange={e => setExtra('vehicle_model', e.target.value)} />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className={LBL}>Year</label>
                    <input type="text" inputMode="numeric" className="led-input" placeholder="2024" value={extra.vehicle_year} onChange={e => setExtra('vehicle_year', e.target.value.replace(/[^0-9]/g, ''))} />
                  </div>
                  <div>
                    <label className={LBL}>Condition</label>
                    <select value={extra.vehicle_condition} onChange={e => setExtra('vehicle_condition', e.target.value)} className="led-input">
                      {VEHICLE_CONDITION_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={LBL}>VIN <span className="font-normal">(optional)</span></label>
                    <input type="text" className="led-input" placeholder="1HGCM82633A123456" value={extra.vehicle_vin} onChange={e => setExtra('vehicle_vin', e.target.value)} />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={LBL}>Vehicle Price ($)</label>
                    <input type="text" inputMode="numeric" className="led-input" placeholder="35,000" value={extra.vehicle_price} onChange={e => setExtra('vehicle_price', e.target.value.replace(/[^0-9.]/g, ''))} />
                  </div>
                  <div>
                    <label className={LBL}>Deposit ($) <span className="font-normal">(optional)</span></label>
                    <input type="text" inputMode="numeric" className="led-input" placeholder="5,000" value={extra.deposit_amount} onChange={e => setExtra('deposit_amount', e.target.value.replace(/[^0-9.]/g, ''))} />
                  </div>
                </div>
                <div>
                  <label className={LBL}>Preferred Loan Term</label>
                  <select value={extra.loan_term} onChange={e => setExtra('loan_term', e.target.value)} className="led-input">
                    {LOAN_TERM_OPTIONS.slice(0, 7).map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            )}
            {/* Consumer Property: purchase, refinance */}
            {['purchase', 'refinance'].includes(subLoanType) && (
              <div className="space-y-3 border-t border-border pt-4">
                <p className="text-[13px] font-semibold text-foreground">{subLoanType === 'purchase' ? 'Property Purchase' : 'Refinance'} Details</p>
                {subLoanType === 'refinance' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className={LBL}>Current Lender</label>
                      <input type="text" className="led-input" placeholder="e.g. ANZ" value={extra.current_lender} onChange={e => setExtra('current_lender', e.target.value)} />
                    </div>
                    <div>
                      <label className={LBL}>Current Balance ($)</label>
                      <input type="text" inputMode="numeric" className="led-input" placeholder="400,000" value={extra.current_balance} onChange={e => setExtra('current_balance', e.target.value.replace(/[^0-9.]/g, ''))} />
                    </div>
                  </div>
                )}
                {subLoanType === 'refinance' && (
                  <div>
                    <label className={LBL}>Reason for Refinance</label>
                    <input type="text" className="led-input" placeholder="Better rate, cash out, etc." value={extra.refinance_reason} onChange={e => setExtra('refinance_reason', e.target.value)} />
                  </div>
                )}
                <div>
                  <label className={LBL}>Property Address</label>
                  <input type="text" className="led-input" placeholder="123 Main St, Sydney NSW 2000" value={extra.property_address} onChange={e => setExtra('property_address', e.target.value)} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={LBL}>Property Type</label>
                    <select value={extra.property_type} onChange={e => setExtra('property_type', e.target.value)} className="led-input">
                      <option value="">Select...</option>
                      {PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={LBL}>Property Value ($)</label>
                    <input type="text" inputMode="numeric" className="led-input" placeholder="800,000" value={extra.property_value} onChange={e => setExtra('property_value', e.target.value.replace(/[^0-9.]/g, ''))} />
                  </div>
                </div>
                {subLoanType === 'purchase' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className={LBL}>Deposit ($) <span className="font-normal">(optional)</span></label>
                      <input type="text" inputMode="numeric" className="led-input" placeholder="100,000" value={extra.deposit_amount} onChange={e => setExtra('deposit_amount', e.target.value.replace(/[^0-9.]/g, ''))} />
                    </div>
                    <div>
                      <label className={LBL}>First Home Buyer?</label>
                      <select value={extra.first_home_buyer} onChange={e => setExtra('first_home_buyer', e.target.value)} className="led-input">
                        <option value="no">No</option>
                        <option value="yes">Yes</option>
                      </select>
                    </div>
                  </div>
                )}
                <div>
                  <label className={LBL}>Preferred Loan Term</label>
                  <select value={extra.loan_term} onChange={e => setExtra('loan_term', e.target.value)} className="led-input">
                    {LOAN_TERM_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            )}
            {/* Consumer Personal Loan */}
            {subLoanType === 'personal' && (
              <div className="space-y-3 border-t border-border pt-4">
                <p className="text-[13px] font-semibold text-foreground">Personal Loan Details</p>
                <div>
                  <label className={LBL}>Loan Purpose</label>
                  <textarea rows={2} className="w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground resize-none"
                    placeholder="Describe what the loan is for..."
                    value={extra.loan_purpose}
                    onChange={e => setExtra('loan_purpose', e.target.value)}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={LBL}>Loan Amount ($)</label>
                    <input type="text" inputMode="numeric" className="led-input" placeholder="25,000" value={extra.bl_loan_amount} onChange={e => setExtra('bl_loan_amount', e.target.value.replace(/[^0-9.]/g, ''))} />
                  </div>
                  <div>
                    <label className={LBL}>Preferred Term</label>
                    <select value={extra.loan_term} onChange={e => setExtra('loan_term', e.target.value)} className="led-input">
                      {LOAN_TERM_OPTIONS.slice(0, 7).map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Business sub-forms */}
        {businessSubType && (
          <>
            {subLoanType && (
              <div className="space-y-3 border-t border-border pt-4">
                {/* Vehicles or Transport / Machinery or Equipment */}
                {['vehicles_or_transport', 'machinery_or_equipment'].includes(subLoanType) && (
                  <div className="space-y-3">
                    <p className="text-[13px] font-semibold text-foreground">{subLoanType === 'vehicles_or_transport' ? 'Equipment' : 'Equipment'} Details</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className={LBL}>{subLoanType === 'vehicles_or_transport' ? 'Equipment Type' : 'Equipment Type'}</label>
                        <input type="text" className="led-input" placeholder={subLoanType === 'vehicles_or_transport' ? 'e.g. Truck, Van' : 'e.g. Excavator, Printer'} value={extra.equipment_type} onChange={e => setExtra('equipment_type', e.target.value)} />
                      </div>
                      <div>
                        <label className={LBL}>Vendor Type</label>
                        <select value={extra.vendor_type} onChange={e => setExtra('vendor_type', e.target.value)} className="led-input">
                          <option value="Dealer">Dealer</option>
                          <option value="Private">Private</option>
                        </select>
                      </div>
                    </div>
                    {subLoanType === 'vehicles_or_transport' && (
                      <>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className={LBL}>Make</label>
                            <select value={extra.vehicle_make} onChange={e => setExtra('vehicle_make', e.target.value)} className="led-input">
                              <option value="">Select make...</option>
                              {VEHICLE_MAKES.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className={LBL}>Model</label>
                            <input type="text" className="led-input" placeholder="e.g. HiAce" value={extra.vehicle_model} onChange={e => setExtra('vehicle_model', e.target.value)} />
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className={LBL}>Year</label>
                            <input type="text" inputMode="numeric" className="led-input" placeholder="2024" value={extra.vehicle_year} onChange={e => setExtra('vehicle_year', e.target.value.replace(/[^0-9]/g, ''))} />
                          </div>
                          <div>
                            <label className={LBL}>Condition</label>
                            <select value={extra.vehicle_condition} onChange={e => setExtra('vehicle_condition', e.target.value)} className="led-input">
                              {VEHICLE_CONDITION_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </div>
                        </div>
                      </>
                    )}
                    <div>
                      <label className={LBL}>Description <span className="font-normal">(optional)</span></label>
                      <textarea rows={2} className="w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground resize-none"
                        placeholder="Describe the asset..."
                        value={extra.equipment_description}
                        onChange={e => setExtra('equipment_description', e.target.value)}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className={LBL}>Price ($)</label>
                        <input type="text" inputMode="numeric" className="led-input" placeholder="150,000" value={extra.vehicle_price} onChange={e => setExtra('vehicle_price', e.target.value.replace(/[^0-9.]/g, ''))} />
                      </div>
                      <div>
                        <label className={LBL}>Deposit ($)</label>
                        <input type="text" inputMode="numeric" className="led-input" placeholder="20,000" value={extra.deposit_amount} onChange={e => setExtra('deposit_amount', e.target.value.replace(/[^0-9.]/g, ''))} />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className={LBL}>Business Use %</label>
                        <input type="text" inputMode="numeric" className="led-input" placeholder="80" value={extra.eq_business_use_pct} onChange={e => setExtra('eq_business_use_pct', e.target.value.replace(/[^0-9.]/g, ''))} />
                      </div>
                      <div>
                        <label className={LBL}>Loan Term</label>
                        <select value={extra.loan_term} onChange={e => setExtra('loan_term', e.target.value)} className="led-input">
                          {LOAN_TERM_OPTIONS.slice(0, 7).map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {/* Property / Development & Construction / New Fit-out / Renovation */}
                {['property', 'development_construction', 'new_fit_out', 'renovation'].includes(subLoanType) && (
                  <div className="space-y-3">
                    <p className="text-[13px] font-semibold text-foreground">Property Details</p>
                    {subLoanType === 'development_construction' && (
                      <div>
                        <label className={LBL}>Project Description</label>
                        <textarea rows={2} className="w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground resize-none"
                          placeholder="Describe the development..."
                          value={extra.project_description}
                          onChange={e => setExtra('project_description', e.target.value)}
                        />
                      </div>
                    )}
                    {subLoanType === 'new_fit_out' && (
                      <div>
                        <label className={LBL}>Fit-out Description</label>
                        <textarea rows={2} className="w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground resize-none"
                          placeholder="Describe the fit-out..."
                          value={extra.fit_out_description}
                          onChange={e => setExtra('fit_out_description', e.target.value)}
                        />
                      </div>
                    )}
                    {subLoanType === 'renovation' && (
                      <div>
                        <label className={LBL}>Renovation Description</label>
                        <textarea rows={2} className="w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground resize-none"
                          placeholder="Describe the renovation..."
                          value={extra.renovation_description}
                          onChange={e => setExtra('renovation_description', e.target.value)}
                        />
                      </div>
                    )}
                    <div>
                      <label className={LBL}>Property Address</label>
                      <input type="text" className="led-input" placeholder="123 Main St, Sydney NSW 2000" value={extra.property_address} onChange={e => setExtra('property_address', e.target.value)} />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <label className={LBL}>Property Type</label>
                        <select value={extra.property_type} onChange={e => setExtra('property_type', e.target.value)} className="led-input">
                          <option value="">Select...</option>
                          {PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={LBL}>Property Use</label>
                        <select value={extra.property_use} onChange={e => setExtra('property_use', e.target.value)} className="led-input">
                          <option value="">Select...</option>
                          <option value="Owner Occupied">Owner Occupied</option>
                          <option value="Investment">Investment</option>
                          <option value="Mixed Use">Mixed Use</option>
                        </select>
                      </div>
                      <div>
                        <label className={LBL}>Estimated Value ($)</label>
                        <input type="text" inputMode="numeric" className="led-input" placeholder="1,000,000" value={extra.property_value} onChange={e => setExtra('property_value', e.target.value.replace(/[^0-9.]/g, ''))} />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className={LBL}>Loan Amount ($)</label>
                        <input type="text" inputMode="numeric" className="led-input" placeholder="650,000" value={extra.bl_loan_amount} onChange={e => setExtra('bl_loan_amount', e.target.value.replace(/[^0-9.]/g, ''))} />
                      </div>
                      <div>
                        <label className={LBL}>Loan Term</label>
                        <select value={extra.loan_term} onChange={e => setExtra('loan_term', e.target.value)} className="led-input">
                          {LOAN_TERM_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {/* New Business / Purchase Business */}
                {['new_business', 'purchase_business'].includes(subLoanType) && (
                  <div className="space-y-3">
                    <p className="text-[13px] font-semibold text-foreground">{subLoanType === 'new_business' ? 'New Business' : 'Business Purchase'} Details</p>
                    {subLoanType === 'new_business' && (
                      <>
                        <div>
                          <label className={LBL}>Business Plan</label>
                          <textarea rows={3} className="w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground resize-none"
                            placeholder="Outline your business plan..."
                            value={extra.business_plan}
                            onChange={e => setExtra('business_plan', e.target.value)}
                          />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className={LBL}>Startup Costs ($)</label>
                            <input type="text" inputMode="numeric" className="led-input" placeholder="100,000" value={extra.startup_costs} onChange={e => setExtra('startup_costs', e.target.value.replace(/[^0-9.]/g, ''))} />
                          </div>
                          <div>
                            <label className={LBL}>Industry / Purpose</label>
                            <input type="text" className="led-input" placeholder="e.g. Cafe, IT Consulting" value={extra.business_purpose} onChange={e => setExtra('business_purpose', e.target.value)} />
                          </div>
                        </div>
                      </>
                    )}
                    {subLoanType === 'purchase_business' && (
                      <>
                        <div>
                          <label className={LBL}>Business Details</label>
                          <textarea rows={2} className="w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground resize-none"
                            placeholder="Describe the business being purchased..."
                            value={extra.business_details}
                            onChange={e => setExtra('business_details', e.target.value)}
                          />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className={LBL}>Purchase Price ($)</label>
                            <input type="text" inputMode="numeric" className="led-input" placeholder="500,000" value={extra.purchase_price} onChange={e => setExtra('purchase_price', e.target.value.replace(/[^0-9.]/g, ''))} />
                          </div>
                          <div>
                            <label className={LBL}>Business Type</label>
                            <input type="text" className="led-input" placeholder="e.g. Cafe, Retail Store" value={extra.business_type} onChange={e => setExtra('business_type', e.target.value)} />
                          </div>
                        </div>
                      </>
                    )}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className={LBL}>Loan Amount ($)</label>
                        <input type="text" inputMode="numeric" className="led-input" placeholder="200,000" value={extra.bl_loan_amount} onChange={e => setExtra('bl_loan_amount', e.target.value.replace(/[^0-9.]/g, ''))} />
                      </div>
                      <div>
                        <label className={LBL}>Loan Term</label>
                        <select value={extra.loan_term} onChange={e => setExtra('loan_term', e.target.value)} className="led-input">
                          {LOAN_TERM_OPTIONS.slice(0, 7).map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {/* Working capital sub-types: day_to_day_capital, expansion, staff_recruitment, pay_suppliers, waiting_for_invoices, other */}
                {['day_to_day_capital', 'expansion', 'staff_recruitment', 'pay_suppliers', 'waiting_for_invoices', 'other'].includes(subLoanType) && (
                  <div className="space-y-3">
                    <p className="text-[13px] font-semibold text-foreground">Working Capital Details</p>
                    {subLoanType === 'staff_recruitment' && (
                      <div>
                        <label className={LBL}>Recruitment Details</label>
                        <textarea rows={2} className="w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground resize-none"
                          placeholder="Describe hiring needs..."
                          value={extra.recruitment_details}
                          onChange={e => setExtra('recruitment_details', e.target.value)}
                        />
                      </div>
                    )}
                    {subLoanType === 'expansion' && (
                      <div>
                        <label className={LBL}>Expansion Description</label>
                        <textarea rows={2} className="w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground resize-none"
                          placeholder="Describe expansion plans..."
                          value={extra.expansion_description}
                          onChange={e => setExtra('expansion_description', e.target.value)}
                        />
                      </div>
                    )}
                    {subLoanType === 'pay_suppliers' && (
                      <div>
                        <label className={LBL}>Supplier Details</label>
                        <textarea rows={2} className="w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground resize-none"
                          placeholder="Describe supplier payments needed..."
                          value={extra.supplier_details}
                          onChange={e => setExtra('supplier_details', e.target.value)}
                        />
                      </div>
                    )}
                    {subLoanType === 'waiting_for_invoices' && (
                      <div>
                        <label className={LBL}>Outstanding Invoices</label>
                        <textarea rows={2} className="w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground resize-none"
                          placeholder="Describe outstanding invoices..."
                          value={extra.outstanding_invoices}
                          onChange={e => setExtra('outstanding_invoices', e.target.value)}
                        />
                      </div>
                    )}
                    {subLoanType === 'other' && (
                      <div>
                        <label className={LBL}>Purpose Description</label>
                        <textarea rows={2} className="w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground resize-none"
                          placeholder="Describe the purpose..."
                          value={extra.purpose_description}
                          onChange={e => setExtra('purpose_description', e.target.value)}
                        />
                      </div>
                    )}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className={LBL}>Loan Amount ($)</label>
                        <input type="text" inputMode="numeric" className="led-input" placeholder="50,000" value={extra.bl_loan_amount} onChange={e => setExtra('bl_loan_amount', e.target.value.replace(/[^0-9.]/g, ''))} />
                      </div>
                      <div>
                        <label className={LBL}>Loan Term</label>
                        <select value={extra.loan_term} onChange={e => setExtra('loan_term', e.target.value)} className="led-input">
                          {LOAN_TERM_OPTIONS.slice(0, 7).map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </Card>

      {/* Amount + Notes */}
      <Card className="space-y-4">
        <div>
          <label className={LABEL_CLS}>Approximate Amount *</label>
          <div className="flex h-10 overflow-hidden rounded-lg border border-[var(--led-line-2)] bg-[var(--led-surface)] transition-all focus-within:border-[var(--led-accent)] focus-within:shadow-[0_0_0_3px_var(--led-accent-tint)]">
            <span className="flex shrink-0 items-center border-r border-[var(--led-line-2)] bg-secondary/60 px-3.5 text-[13px] font-medium text-muted-foreground">AUD $</span>
            <input
              type="text"
              inputMode="numeric"
              placeholder="0"
              value={amount}
              onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              className="flex-1 bg-transparent px-3.5 text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>
        <div>
          <label className={LABEL_CLS}>Notes <span className="font-normal">(optional)</span></label>
          <textarea
            placeholder="Any context about the client's situation, purpose, or urgency..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background placeholder:text-muted-foreground border border-transparent resize-none"
          />
        </div>
      </Card>

      {/* ── Self-managed: full client detail sections ─────────────────────── */}
      {isSelfManaged && (
        <>
          {/* Applicant Identity */}
          <Card className="space-y-4">
            <p className="text-[15px] font-semibold text-foreground">Applicant Identity</p>
            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <label className={LBL}>Title</label>
                <select value={extra.applicant_title} onChange={e => setExtra('applicant_title', e.target.value)} className="led-input">
                  <option value="">—</option>
                  {['Mr', 'Mrs', 'Ms', 'Miss', 'Dr'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={LBL}>Middle Name</label>
                <input type="text" className="led-input" placeholder="Optional" value={extra.applicant_middle_name} onChange={e => setExtra('applicant_middle_name', e.target.value)} />
              </div>
              <div>
                <DatePicker
                  label="Date of Birth"
                  value={extra.applicant_dob}
                  onChange={(v) => setExtra('applicant_dob', v)}
                  placeholder="Select date"
                  className="led-input"
                />
              </div>
              <div>
                <label className={LBL}>Gender</label>
                <select value={extra.applicant_gender} onChange={e => setExtra('applicant_gender', e.target.value)} className="led-input">
                  <option value="">—</option>
                  {['Male', 'Female', 'Other'].map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={LBL}>Marital Status</label>
                <select value={extra.applicant_marital_status} onChange={e => setExtra('applicant_marital_status', e.target.value)} className="led-input">
                  <option value="">—</option>
                  {['Single', 'Married', 'De Facto', 'Separated', 'Divorced', 'Widowed'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={LBL}>Preferred Contact</label>
                <select value={extra.preferred_contact_method} onChange={e => setExtra('preferred_contact_method', e.target.value)} className="led-input">
                  <option value="">—</option>
                  {['Phone', 'Email', 'SMS'].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
          </Card>

          {/* Identification */}
          <Card className="space-y-4">
            <p className="text-[15px] font-semibold text-foreground">Identification</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={LBL}>Residency Status</label>
                <select value={extra.applicant_residency_status} onChange={e => setExtra('applicant_residency_status', e.target.value)} className="led-input">
                  <option value="">—</option>
                  {['Australian Citizen', 'Permanent Resident', 'Temporary Resident', 'Non-Resident'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={LBL}>ID Type</label>
                <select value={extra.id_type} onChange={e => setExtra('id_type', e.target.value)} className="led-input">
                  <option value="license">Driver's Licence</option>
                  <option value="passport">Passport</option>
                </select>
              </div>
              <div>
                <label className={LBL}>ID Number</label>
                <input type="text" className="led-input" placeholder="e.g. 12345678" value={extra.id_number} onChange={e => setExtra('id_number', e.target.value)} />
              </div>
              <div>
                <label className={LBL}>{extra.id_type === 'license' ? 'Issuing State' : 'Issuing Country'}</label>
                {extra.id_type === 'license' ? (
                  <select value={extra.id_issuing_state_country} onChange={e => setExtra('id_issuing_state_country', e.target.value)} className="led-input">
                    <option value="">—</option>
                    {['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <input type="text" className="led-input" placeholder="e.g. Australia" value={extra.id_issuing_state_country} onChange={e => setExtra('id_issuing_state_country', e.target.value)} />
                )}
              </div>
              <div>
                <DatePicker
                  label="ID Expiry Date"
                  value={extra.id_expiry_date}
                  onChange={(v) => setExtra('id_expiry_date', v)}
                  placeholder="Select date"
                  className="led-input"
                />
              </div>
            </div>
          </Card>

          {/* Address */}
          <Card className="space-y-4">
            <p className="text-[15px] font-semibold text-foreground">Address</p>
            <div>
              <label className={LBL}>Street Address</label>
              <input type="text" className="led-input" placeholder="123 Main St" value={extra.applicant_address} onChange={e => setExtra('applicant_address', e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className={LBL}>Suburb</label>
                <input type="text" className="led-input" placeholder="Melbourne" value={extra.applicant_suburb} onChange={e => setExtra('applicant_suburb', e.target.value)} />
              </div>
              <div>
                <label className={LBL}>State</label>
                <select value={extra.applicant_state} onChange={e => setExtra('applicant_state', e.target.value)} className="led-input">
                  <option value="">—</option>
                  {['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={LBL}>Postcode</label>
                <input type="text" className="led-input" placeholder="3000" maxLength={4} value={extra.applicant_postcode} onChange={e => setExtra('applicant_postcode', e.target.value.replace(/\D/g, ''))} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={LBL}>Residential Status</label>
                <select value={extra.residential_status} onChange={e => setExtra('residential_status', e.target.value)} className="led-input">
                  <option value="">—</option>
                  {['Owner', 'Renting', 'Living with parents', 'Other'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={LBL}>Time at Address</label>
                <input type="text" className="led-input" placeholder="e.g. 2 years" value={extra.time_at_address} onChange={e => setExtra('time_at_address', e.target.value)} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className={LBL}>No. of Dependants</label>
                <input type="number" min="0" className="led-input" value={extra.applicant_num_dependants} onChange={e => setExtra('applicant_num_dependants', e.target.value)} />
              </div>
              <div className="flex flex-col justify-end pb-[2px]">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" className="h-4 w-4 rounded accent-primary" checked={extra.has_partner} onChange={e => setExtra('has_partner', e.target.checked)} />
                  <span className="text-[13px] font-medium text-foreground">Has a partner</span>
                </label>
              </div>
              <div className="flex flex-col justify-end pb-[2px]">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" className="h-4 w-4 rounded accent-primary" checked={extra.partner_working} onChange={e => setExtra('partner_working', e.target.checked)} />
                  <span className="text-[13px] font-medium text-foreground">Partner is working</span>
                </label>
              </div>
            </div>
          </Card>

          {/* Employment & Income */}
          <Card className="space-y-4">
            <p className="text-[15px] font-semibold text-foreground">Employment & Income</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={LBL}>Employment Category</label>
                <select value={extra.employment_category} onChange={e => setExtra('employment_category', e.target.value)} className="led-input">
                  <option value="">—</option>
                  {['Full-time', 'Part-time', 'Casual', 'Self-employed', 'Contract', 'Retired', 'Unemployed'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className={LBL}>Employment Type</label>
                <select value={extra.employment_type_detail} onChange={e => setExtra('employment_type_detail', e.target.value)} className="led-input">
                  <option value="">—</option>
                  {['Full Time', 'Part Time', 'Casual', 'Fixed Term', 'Contract'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={LBL}>Employer Name</label>
                <input type="text" className="led-input" value={extra.employer_name} onChange={e => setExtra('employer_name', e.target.value)} />
              </div>
              <div>
                <DatePicker
                  label="Employment Start Date"
                  value={extra.employment_start_date}
                  onChange={(v) => setExtra('employment_start_date', v)}
                  placeholder="Select date"
                  className="led-input"
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={LBL}>Industry</label>
                <input type="text" className="led-input" value={extra.employer_industry} onChange={e => setExtra('employer_industry', e.target.value)} />
              </div>
              <div>
                <label className={LBL}>Job Title</label>
                <input type="text" className="led-input" value={extra.job_title} onChange={e => setExtra('job_title', e.target.value)} />
              </div>
            </div>
            <div>
              <label className={LBL}>Employer Contact Details</label>
              <input type="text" className="led-input" placeholder="Phone or email" value={extra.employer_contact_details} onChange={e => setExtra('employer_contact_details', e.target.value)} />
            </div>
            <p className="text-[13px] font-medium text-foreground pt-1">Primary Income</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className={LBL}>Income Type</label>
                <select value={extra.primary_income_type} onChange={e => setExtra('primary_income_type', e.target.value)} className="led-input">
                  <option value="">—</option>
                  {['Salary', 'Wages', 'Self-Employment', 'Rental Income', 'Investment', 'Pension', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={LBL}>Frequency</label>
                <select value={extra.primary_income_frequency || extra.income_frequency} onChange={e => { setExtra('primary_income_frequency', e.target.value); setExtra('income_frequency', e.target.value); }} className="led-input">
                  <option value="">—</option>
                  {['Weekly', 'Fortnightly', 'Monthly', 'Annually'].map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <label className={LBL}>Amount (AUD)</label>
                <div className="flex h-10 overflow-hidden rounded-lg border border-[var(--led-line-2)] bg-[var(--led-surface)] transition-all focus-within:border-[var(--led-accent)] focus-within:shadow-[0_0_0_3px_var(--led-accent-tint)]">
                  <span className="flex shrink-0 items-center border-r border-[var(--led-line-2)] bg-secondary/60 px-3 text-[13px] font-medium text-muted-foreground">$</span>
                  <input type="text" inputMode="numeric" placeholder="0" className="flex-1 bg-transparent px-3 text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
                    value={extra.primary_income_amount || extra.gross_income} onChange={e => { const v = e.target.value.replace(/[^0-9.]/g, ''); setExtra('primary_income_amount', v); setExtra('gross_income', v); }} />
                </div>
              </div>
            </div>

            {/* Additional incomes */}
            {additionalIncomes.map((inc, i) => (
              <div key={i} className="grid gap-3 sm:grid-cols-3 rounded-xl border border-border p-3 relative">
                <button type="button" onClick={() => setAdditionalIncomes(prev => prev.filter((_, j) => j !== i))} className="absolute top-2 right-2 text-muted-foreground hover:text-destructive">
                  <XMarkIcon className="h-4 w-4" />
                </button>
                <div>
                  <label className={LBL}>Income Type</label>
                  <select value={inc.income_type} onChange={e => setAdditionalIncomes(prev => prev.map((x, j) => j === i ? { ...x, income_type: e.target.value } : x))} className="led-input">
                    {['Rental Income', 'Investment', 'Pension', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className={LBL}>Frequency</label>
                  <select value={inc.frequency} onChange={e => setAdditionalIncomes(prev => prev.map((x, j) => j === i ? { ...x, frequency: e.target.value } : x))} className="led-input">
                    {['Weekly', 'Fortnightly', 'Monthly', 'Annually'].map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div>
                  <label className={LBL}>Amount ($)</label>
                  <input type="text" inputMode="numeric" className="led-input" value={inc.amount} onChange={e => setAdditionalIncomes(prev => prev.map((x, j) => j === i ? { ...x, amount: e.target.value.replace(/[^0-9.]/g, '') } : x))} />
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setAdditionalIncomes(prev => [...prev, { income_type: 'Rental Income', amount: '', frequency: 'Monthly' }])} className="text-[13px] text-primary hover:underline">
              + Add additional income
            </button>
          </Card>

          {/* Expenses */}
          <Card className="space-y-4">
            <p className="text-[15px] font-semibold text-foreground">Monthly Expenses</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={LBL}>Living Expenses (AUD/mo)</label>
                <div className="flex h-10 overflow-hidden rounded-lg border border-[var(--led-line-2)] bg-[var(--led-surface)] transition-all focus-within:border-[var(--led-accent)] focus-within:shadow-[0_0_0_3px_var(--led-accent-tint)]">
                  <span className="flex shrink-0 items-center border-r border-[var(--led-line-2)] bg-secondary/60 px-3 text-[13px] font-medium text-muted-foreground">$</span>
                  <input type="text" inputMode="numeric" placeholder="0" className="flex-1 bg-transparent px-3 text-[14px] text-foreground outline-none placeholder:text-muted-foreground" value={extra.monthly_living_expenses} onChange={e => setExtra('monthly_living_expenses', e.target.value.replace(/[^0-9.]/g, ''))} />
                </div>
              </div>
              <div>
                <label className={LBL}>Rent / Mortgage (AUD/mo)</label>
                <div className="flex h-10 overflow-hidden rounded-lg border border-[var(--led-line-2)] bg-[var(--led-surface)] transition-all focus-within:border-[var(--led-accent)] focus-within:shadow-[0_0_0_3px_var(--led-accent-tint)]">
                  <span className="flex shrink-0 items-center border-r border-[var(--led-line-2)] bg-secondary/60 px-3 text-[13px] font-medium text-muted-foreground">$</span>
                  <input type="text" inputMode="numeric" placeholder="0" className="flex-1 bg-transparent px-3 text-[14px] text-foreground outline-none placeholder:text-muted-foreground" value={extra.rent_mortgage_payments} onChange={e => setExtra('rent_mortgage_payments', e.target.value.replace(/[^0-9.]/g, ''))} />
                </div>
              </div>
              <div>
                <label className={LBL}>Child Support (AUD/mo)</label>
                <div className="flex h-10 overflow-hidden rounded-lg border border-[var(--led-line-2)] bg-[var(--led-surface)] transition-all focus-within:border-[var(--led-accent)] focus-within:shadow-[0_0_0_3px_var(--led-accent-tint)]">
                  <span className="flex shrink-0 items-center border-r border-[var(--led-line-2)] bg-secondary/60 px-3 text-[13px] font-medium text-muted-foreground">$</span>
                  <input type="text" inputMode="numeric" placeholder="0" className="flex-1 bg-transparent px-3 text-[14px] text-foreground outline-none placeholder:text-muted-foreground" value={extra.child_support} onChange={e => setExtra('child_support', e.target.value.replace(/[^0-9.]/g, ''))} />
                </div>
              </div>
              <div>
                <label className={LBL}>Other Commitments (AUD/mo)</label>
                <div className="flex h-10 overflow-hidden rounded-lg border border-[var(--led-line-2)] bg-[var(--led-surface)] transition-all focus-within:border-[var(--led-accent)] focus-within:shadow-[0_0_0_3px_var(--led-accent-tint)]">
                  <span className="flex shrink-0 items-center border-r border-[var(--led-line-2)] bg-secondary/60 px-3 text-[13px] font-medium text-muted-foreground">$</span>
                  <input type="text" inputMode="numeric" placeholder="0" className="flex-1 bg-transparent px-3 text-[14px] text-foreground outline-none placeholder:text-muted-foreground" value={extra.other_commitments} onChange={e => setExtra('other_commitments', e.target.value.replace(/[^0-9.]/g, ''))} />
                </div>
              </div>
            </div>
          </Card>

          {/* Assets */}
          <Card className="space-y-4">
            <p className="text-[15px] font-semibold text-foreground">Assets</p>

            {/* Real estate */}
            {realEstateAssets.map((asset, i) => (
              <div key={i} className="rounded-xl border border-border p-4 space-y-3 relative">
                <button type="button" onClick={() => setRealEstateAssets(prev => prev.filter((_, j) => j !== i))} className="absolute top-2 right-2 text-muted-foreground hover:text-destructive">
                  <XMarkIcon className="h-4 w-4" />
                </button>
                <p className="text-[13px] font-medium text-foreground">Real Estate {i + 1}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={LBL}>Property Type</label>
                    <select value={asset.property_type} onChange={e => setRealEstateAssets(prev => prev.map((x, j) => j === i ? { ...x, property_type: e.target.value } : x))} className="led-input">
                      {['Home', 'Investment Property', 'Commercial', 'Land', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={LBL}>Ownership</label>
                    <select value={asset.ownership_type} onChange={e => setRealEstateAssets(prev => prev.map((x, j) => j === i ? { ...x, ownership_type: e.target.value } : x))} className="led-input">
                      {['Sole', 'Joint', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className={LBL}>Address</label>
                  <input type="text" className="led-input" value={asset.address} onChange={e => setRealEstateAssets(prev => prev.map((x, j) => j === i ? { ...x, address: e.target.value } : x))} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={LBL}>Estimated Value ($)</label>
                    <input type="text" inputMode="numeric" className="led-input" value={asset.estimated_value} onChange={e => setRealEstateAssets(prev => prev.map((x, j) => j === i ? { ...x, estimated_value: e.target.value.replace(/[^0-9.]/g, '') } : x))} />
                  </div>
                  <div>
                    <label className={LBL}>Financed?</label>
                    <select value={asset.is_financed} onChange={e => setRealEstateAssets(prev => prev.map((x, j) => j === i ? { ...x, is_financed: e.target.value } : x))} className="led-input">
                      <option value="no">No</option>
                      <option value="yes">Yes</option>
                    </select>
                  </div>
                  {asset.is_financed === 'yes' && (
                    <>
                      <div>
                        <label className={LBL}>Lender</label>
                        <input type="text" className="led-input" value={asset.lender} onChange={e => setRealEstateAssets(prev => prev.map((x, j) => j === i ? { ...x, lender: e.target.value } : x))} />
                      </div>
                      <div>
                        <label className={LBL}>Amount Owing ($)</label>
                        <input type="text" inputMode="numeric" className="led-input" value={asset.amount_owing} onChange={e => setRealEstateAssets(prev => prev.map((x, j) => j === i ? { ...x, amount_owing: e.target.value.replace(/[^0-9.]/g, '') } : x))} />
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setRealEstateAssets(prev => [...prev, { property_type: 'Home', address: '', estimated_value: '', ownership_type: 'Sole', is_financed: 'no', lender: '', amount_owing: '', monthly_repayment: '', rental_income: '' }])} className="text-[13px] text-primary hover:underline">
              + Add real estate asset
            </button>

            {/* Other assets */}
            {otherAssets.map((asset, i) => (
              <div key={i} className="grid gap-3 sm:grid-cols-2 rounded-xl border border-border p-3 relative">
                <button type="button" onClick={() => setOtherAssets(prev => prev.filter((_, j) => j !== i))} className="absolute top-2 right-2 text-muted-foreground hover:text-destructive">
                  <XMarkIcon className="h-4 w-4" />
                </button>
                <div>
                  <label className={LBL}>Asset Type</label>
                  <select value={asset.asset_type} onChange={e => setOtherAssets(prev => prev.map((x, j) => j === i ? { ...x, asset_type: e.target.value } : x))} className="led-input">
                    {['Vehicles', 'Savings', 'Shares', 'Superannuation', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className={LBL}>Value ($)</label>
                  <input type="text" inputMode="numeric" className="led-input" value={asset.value} onChange={e => setOtherAssets(prev => prev.map((x, j) => j === i ? { ...x, value: e.target.value.replace(/[^0-9.]/g, '') } : x))} />
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setOtherAssets(prev => [...prev, { asset_type: 'Vehicles', value: '' }])} className="text-[13px] text-primary hover:underline">
              + Add other asset
            </button>
          </Card>

          {/* Liabilities */}
          <Card className="space-y-4">
            <p className="text-[15px] font-semibold text-foreground">Liabilities</p>
            {liabilities.map((liab, i) => (
              <div key={i} className="rounded-xl border border-border p-4 space-y-3 relative">
                <button type="button" onClick={() => setLiabilities(prev => prev.filter((_, j) => j !== i))} className="absolute top-2 right-2 text-muted-foreground hover:text-destructive">
                  <XMarkIcon className="h-4 w-4" />
                </button>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={LBL}>Liability Type</label>
                    <select value={liab.liability_type} onChange={e => setLiabilities(prev => prev.map((x, j) => j === i ? { ...x, liability_type: e.target.value } : x))} className="led-input">
                      {['Home Loans', 'Car Loan', 'Personal Loan', 'Credit Card', 'Business Loan', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={LBL}>Lender</label>
                    <input type="text" className="led-input" value={liab.lender} onChange={e => setLiabilities(prev => prev.map((x, j) => j === i ? { ...x, lender: e.target.value } : x))} />
                  </div>
                  <div>
                    <label className={LBL}>Balance ($)</label>
                    <input type="text" inputMode="numeric" className="led-input" value={liab.balance} onChange={e => setLiabilities(prev => prev.map((x, j) => j === i ? { ...x, balance: e.target.value.replace(/[^0-9.]/g, '') } : x))} />
                  </div>
                  <div>
                    <label className={LBL}>Monthly Repayment ($)</label>
                    <input type="text" inputMode="numeric" className="led-input" value={liab.monthly_repayment} onChange={e => setLiabilities(prev => prev.map((x, j) => j === i ? { ...x, monthly_repayment: e.target.value.replace(/[^0-9.]/g, '') } : x))} />
                  </div>
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setLiabilities(prev => [...prev, { liability_type: 'Home Loans', lender: '', balance: '', limit: '', monthly_repayment: '' }])} className="text-[13px] text-primary hover:underline">
              + Add liability
            </button>
          </Card>

          {/* Business Details */}
          {(businessSubType || isBusinessLoan || extra.business_name || extra.business_abn) && (
            <Card className="space-y-4">
              <p className="text-[15px] font-semibold text-foreground">Business Details</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={LBL}>Business Name</label>
                  <input type="text" className="led-input" value={extra.business_name} onChange={e => setExtra('business_name', e.target.value)} />
                </div>
                <div>
                  <label className={LBL}>ABN{businessSubType ? ' *' : ''}</label>
                  <input type="text" className="led-input" value={extra.business_abn} onChange={e => setExtra('business_abn', e.target.value)} />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={LBL}>Trading Name</label>
                  <input type="text" className="led-input" value={extra.trading_name} onChange={e => setExtra('trading_name', e.target.value)} />
                </div>
                <div>
                  <label className={LBL}>Business Structure</label>
                  <select value={extra.business_structure} onChange={e => setExtra('business_structure', e.target.value)} className="led-input">
                    <option value="">—</option>
                    {['Sole Trader', 'Partnership', 'Company', 'Trust'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className={LBL}>Time Trading</label>
                  <input type="text" className="led-input" placeholder="e.g. 3 years" value={extra.time_trading} onChange={e => setExtra('time_trading', e.target.value)} />
                </div>
                <div>
                  <label className={LBL}>No. of Directors</label>
                  <input type="number" min="1" className="led-input" value={extra.num_directors} onChange={e => setExtra('num_directors', e.target.value)} />
                </div>
                <div className="flex flex-col justify-end pb-[2px]">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input type="checkbox" className="h-4 w-4 rounded accent-primary" checked={extra.gst_registered} onChange={e => setExtra('gst_registered', e.target.checked)} />
                    <span className="text-[13px] font-medium text-foreground">GST Registered</span>
                  </label>
                </div>
              </div>
            </Card>
          )}

          {/* Emergency Contact */}
          <Card className="space-y-4">
            <p className="text-[15px] font-semibold text-foreground">Emergency Contact</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className={LBL}>Name</label>
                <input type="text" className="led-input" value={extra.emergency_contact_name} onChange={e => setExtra('emergency_contact_name', e.target.value)} />
              </div>
              <div>
                <label className={LBL}>Relationship</label>
                <input type="text" className="led-input" placeholder="e.g. Spouse, Parent" value={extra.emergency_contact_relationship} onChange={e => setExtra('emergency_contact_relationship', e.target.value)} />
              </div>
              <div>
                <label className={LBL}>Phone</label>
                <input type="tel" className="led-input" placeholder="04XX XXX XXX" value={extra.emergency_contact_phone} onChange={e => setExtra('emergency_contact_phone', e.target.value)} />
              </div>
            </div>
          </Card>

          {/* Declarations */}
          <Card className="space-y-4">
            <p className="text-[15px] font-semibold text-foreground">Declarations</p>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" className="h-4 w-4 rounded accent-primary" checked={extra.previously_declined} onChange={e => setExtra('previously_declined', e.target.checked)} />
              <span className="text-[13px] font-medium text-foreground">Client has previously been declined for credit</span>
            </label>
            <div>
              <label className={LBL}>Change of Circumstances</label>
              <textarea rows={2}
                className="w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground resize-none"
                placeholder="Any changes in financial circumstances..."
                value={extra.change_of_circumstances}
                onChange={e => setExtra('change_of_circumstances', e.target.value)}
              />
            </div>
            <div>
              <label className={LBL}>Signature Name</label>
              <input type="text" className="led-input" placeholder="Full legal name" value={extra.signature_name} onChange={e => setExtra('signature_name', e.target.value)} />
            </div>
          </Card>

        </>
      )}

      {/* Attachments */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-[15px] font-semibold text-foreground">Attachments <span className="text-[13px] font-normal text-muted-foreground">(optional)</span></p>
            <p className="text-[12px] text-muted-foreground mt-0.5">Payslips, bank statements, IDs</p>
          </div>
          <Button size="sm" variant="secondary" type="button" onClick={() => fileInput.current?.click()}>+ Add File</Button>
          <input ref={fileInput} type="file" className="hidden" onChange={handleFileAdd} />
        </div>
        {files.length === 0 ? (
          <button type="button" onClick={() => fileInput.current?.click()}
            className="w-full rounded-xl border-2 border-dashed border-border hover:border-primary/40 transition-colors py-5 text-center"
          >
            <p className="text-[13px] text-muted-foreground">Click to attach files</p>
          </button>
        ) : (
          <div className="space-y-2">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg bg-secondary px-3 py-2.5">
                <DocumentTextIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-[13px] text-foreground flex-1 truncate">{f.name}</span>
                <button type="button" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive transition-colors">
                  <XMarkIcon className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => fileInput.current?.click()} className="text-[13px] text-primary hover:underline">
              + Add another file
            </button>
          </div>
        )}
      </Card>

      <div className="flex gap-3 pb-6">
        <Button size="lg" onClick={handleSubmit} disabled={submitting}>
          {submitting
            ? (cloneFromId ? 'Cloning...' : 'Submitting...')
            : (cloneFromId ? 'Create Cloned Application' : (submitLabel ?? 'Submit Lead'))}
        </Button>
        <Button variant="secondary" size="lg" onClick={() => navigate(basePath)}>Cancel</Button>
      </div>
    </div>
  );
}
