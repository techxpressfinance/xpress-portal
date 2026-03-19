import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/Toast';
import { getErrorMessage } from '../../lib/utils';
import { GlassCard, Button, Input, PageHeader } from '../../components/ui';
import { AU_STATES, TITLE_OPTIONS, GENDER_OPTIONS, MARITAL_STATUS_OPTIONS, CREDIT_HISTORY_OPTIONS, RESIDENCY_OPTIONS } from '../../lib/constants';

interface FormData {
  loan_type: string;
  amount: string;
  notes: string;
  loan_purpose_id: string;
  loan_term_requested: string;
  // Personal
  applicant_title: string;
  applicant_first_name: string;
  applicant_last_name: string;
  applicant_middle_name: string;
  applicant_dob: string;
  applicant_gender: string;
  applicant_marital_status: string;
  // Address
  applicant_address: string;
  applicant_suburb: string;
  applicant_state: string;
  applicant_postcode: string;
  // Business
  business_abn: string;
  business_name: string;
  business_registration_date: string;
  business_industry_id: string;
  business_monthly_sales: string;
  // Financial — stored as JSON in lend_extra_data
  employer_name: string;
  employment_type: string;
  employment_start_date: string;
  income_type: string;
  income_amount: string;
  living_status: string;
  dependants: string;
  credit_history: string;
  residency_status: string;
  // Identification
  id_type: string;
  id_license_number: string;
  id_license_state: string;
  id_medicare_number: string;
  id_medicare_ref: string;
  id_passport_number: string;
  id_passport_country: string;
}

const loanTypes = [
  { value: 'personal', label: 'Personal Loan', description: 'For personal expenses, travel, or emergencies', icon: '\u{1F4B3}' },
  { value: 'home', label: 'Home Loan', description: 'Purchase or renovate your dream home', icon: '\u{1F3E0}' },
  { value: 'business', label: 'Business Loan', description: 'Grow your business with flexible financing', icon: '\u{1F4BC}' },
  { value: 'vehicle', label: 'Vehicle Loan', description: 'Finance your car, bike, or commercial vehicle', icon: '\u{1F697}' },
];

const TOTAL_STEPS_BUSINESS = 7;
const TOTAL_STEPS_CONSUMER = 7;

export default function NewApplication() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [lendEnabled, setLendEnabled] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [checked, setChecked] = useState(false);

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
      employment_type: 'Full Time',
      income_type: 'Salary',
      credit_history: 'Clear',
      residency_status: 'Australian Citizen',
      dependants: '0',
    },
  });

  const selectedType = watch('loan_type');
  const idType = watch('id_type');
  const isBusiness = selectedType === 'business';

  // Check if Lend is enabled (silently)
  useEffect(() => {
    api.get('/lend/config').then(({ data }) => setLendEnabled(data.enabled)).catch(() => {});
  }, []);

  // Pre-fill name from user
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
  }, [user, setValue]);

  const totalSteps = lendEnabled ? (isBusiness ? TOTAL_STEPS_BUSINESS : TOTAL_STEPS_CONSUMER) : 2;

  const stepFields: Record<number, (keyof FormData)[]> = {
    1: ['loan_type', 'amount'],
    2: ['applicant_first_name', 'applicant_last_name', 'applicant_dob'],
    3: ['applicant_address', 'applicant_suburb', 'applicant_state', 'applicant_postcode'],
    4: isBusiness ? ['business_abn', 'business_name'] : ['employer_name', 'income_amount'],
    5: isBusiness ? ['employer_name', 'income_amount'] : ['id_type'],
    6: ['id_type'],
  };

  const goNext = async () => {
    const fields = stepFields[step];
    if (fields) {
      const valid = await trigger(fields);
      if (!valid) return;
    }
    setStep((s) => Math.min(s + 1, totalSteps));
  };

  const goBack = () => setStep((s) => Math.max(s - 1, 1));

  const onSubmit = async (data: FormData) => {
    // Build lend_extra_data JSON
    const extraData: Record<string, unknown> = {};

    // Employment
    if (data.employer_name) {
      extraData.employments = [{
        employer_name: data.employer_name,
        employment_type: data.employment_type,
        start_date: data.employment_start_date,
      }];
    }

    // Income
    if (data.income_amount) {
      extraData.incomes = [{
        income_type: data.income_type,
        amount: parseFloat(data.income_amount) || 0,
        frequency: 'Monthly',
      }];
    }

    // Dependants
    extraData.dependants = parseInt(data.dependants) || 0;
    extraData.credit_history = data.credit_history;
    extraData.residency_status = data.residency_status;
    extraData.living_status = data.living_status;

    // Identification
    const identification: Record<string, string>[] = [];
    if (data.id_type === 'license' && data.id_license_number) {
      identification.push({
        type: 'Drivers Licence',
        number: data.id_license_number,
        state: data.id_license_state,
      });
    } else if (data.id_type === 'medicare' && data.id_medicare_number) {
      identification.push({
        type: 'Medicare',
        number: data.id_medicare_number,
        reference: data.id_medicare_ref,
      });
    } else if (data.id_type === 'passport' && data.id_passport_number) {
      identification.push({
        type: 'Passport',
        number: data.id_passport_number,
        country: data.id_passport_country || 'Australia',
      });
    }
    if (identification.length) extraData.identification = identification;

    try {
      const payload: Record<string, unknown> = {
        loan_type: data.loan_type,
        amount: parseFloat(data.amount),
        notes: data.notes || null,
      };

      if (lendEnabled) {
        payload.applicant_title = data.applicant_title;
        payload.applicant_first_name = data.applicant_first_name;
        payload.applicant_last_name = data.applicant_last_name;
        payload.applicant_middle_name = data.applicant_middle_name || null;
        payload.applicant_dob = data.applicant_dob || null;
        payload.applicant_gender = data.applicant_gender;
        payload.applicant_marital_status = data.applicant_marital_status;
        payload.applicant_address = data.applicant_address;
        payload.applicant_suburb = data.applicant_suburb;
        payload.applicant_state = data.applicant_state;
        payload.applicant_postcode = data.applicant_postcode;
        payload.loan_purpose_id = data.loan_purpose_id ? parseInt(data.loan_purpose_id) : null;
        payload.loan_term_requested = data.loan_term_requested ? parseInt(data.loan_term_requested) : null;

        if (isBusiness) {
          payload.business_abn = data.business_abn || null;
          payload.business_name = data.business_name || null;
          payload.business_registration_date = data.business_registration_date || null;
          payload.business_industry_id = data.business_industry_id ? parseInt(data.business_industry_id) : null;
          payload.business_monthly_sales = data.business_monthly_sales ? parseFloat(data.business_monthly_sales) : null;
        }

        payload.lend_extra_data = JSON.stringify(extraData);
      }

      const res = await api.post('/applications', payload);
      toast('Application created successfully!', 'success');
      navigate(`/applications/${res.data.id}`);
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to create application'), 'error');
    }
  };

  // Step 0: Acknowledgment
  if (!acknowledged) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Important Information" subtitle="Please read the following information carefully before proceeding" />

        <GlassCard>
          <div className="max-h-80 overflow-y-auto rounded-xl bg-secondary p-5 text-[14px] text-foreground leading-relaxed space-y-4">
            <h3 className="text-[15px] font-semibold">Loan Application Disclosure</h3>
            <p>
              By submitting a loan application through this portal, you acknowledge and agree to the following terms and conditions. Please read this information carefully before proceeding.
            </p>
            <p>
              <strong>Information Accuracy:</strong> All information provided in your loan application must be accurate and complete. Providing false or misleading information may result in the denial of your application and could have legal consequences.
            </p>
            <p>
              <strong>Credit Check Authorization:</strong> By submitting your application, you authorize us to perform credit checks and verify the information you have provided. This may include contacting third-party agencies and financial institutions.
            </p>
            <p>
              <strong>Data Privacy:</strong> Your personal and financial information will be handled in accordance with our privacy policy. We are committed to protecting your data and will only use it for the purposes of processing your loan application.
            </p>
            <p>
              <strong>No Guarantee of Approval:</strong> Submitting an application does not guarantee loan approval. All applications are subject to review and assessment based on our lending criteria.
            </p>
            <p>
              <strong>Document Requirements:</strong> You may be required to submit additional supporting documents during the review process. Failure to provide requested documents in a timely manner may delay or result in the denial of your application.
            </p>
          </div>

          <div className="mt-5">
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30 accent-[var(--primary)]"
              />
              <span className="text-[13px] text-foreground">I have read and understood the above information</span>
            </label>
          </div>
        </GlassCard>

        <div className="mt-6 flex gap-3">
          <Button size="lg" disabled={!checked} onClick={() => { setAcknowledged(true); setStep(1); }}>
            Continue
          </Button>
          <Button variant="secondary" size="lg" onClick={() => navigate('/dashboard')}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // Progress bar
  const progress = (step / totalSteps) * 100;

  const stepLabels = lendEnabled
    ? ['Loan Details', 'Personal Info', 'Address', isBusiness ? 'Business Details' : 'Financial Info', isBusiness ? 'Financial Info' : 'Identification', isBusiness ? 'Identification' : 'Review', isBusiness ? 'Review' : '']
    : ['Loan Details', 'Review'];

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New Loan Application" subtitle={stepLabels[step - 1] || `Step ${step}`} />

      {/* Progress Bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] font-medium text-muted-foreground">Step {step} of {totalSteps}</span>
          <span className="text-[12px] font-medium text-muted-foreground">{Math.round(progress)}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
          <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Step 1: Loan Details */}
        {step === 1 && (
          <>
            <GlassCard>
              <label className="block text-[13px] font-medium text-muted-foreground mb-4">Select Loan Type</label>
              <div className="grid gap-3 sm:grid-cols-2">
                {loanTypes.map((type) => (
                  <label
                    key={type.value}
                    className={`relative flex cursor-pointer items-start gap-3 rounded-2xl p-4 transition-all duration-200 ${
                      selectedType === type.value
                        ? 'bg-primary/5 ring-2 ring-primary/30 shadow-[0_0_0_1px_var(--primary)]'
                        : 'bg-secondary hover:bg-secondary/80'
                    }`}
                  >
                    <input
                      type="radio"
                      value={type.value}
                      {...register('loan_type', { required: 'Please select a loan type' })}
                      className="sr-only"
                    />
                    <span className="text-2xl">{type.icon}</span>
                    <div>
                      <p className={`text-[14px] font-semibold ${selectedType === type.value ? 'text-primary' : 'text-foreground'}`}>
                        {type.label}
                      </p>
                      <p className="text-[13px] text-muted-foreground mt-0.5">{type.description}</p>
                    </div>
                    {selectedType === type.value && (
                      <div className="absolute top-3 right-3">
                        <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                      </div>
                    )}
                  </label>
                ))}
              </div>
              {errors.loan_type && (
                <p className="mt-2 text-[12px] text-destructive">{errors.loan_type.message}</p>
              )}
            </GlassCard>

            <GlassCard className="space-y-5">
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">Loan Amount</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[14px] font-semibold text-muted-foreground">$</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="1"
                    placeholder="50,000"
                    className="pl-8"
                    error={errors.amount?.message}
                    {...register('amount', {
                      required: 'Please enter an amount',
                      min: { value: 1, message: 'Amount must be positive' },
                    })}
                  />
                </div>
              </div>

              {lendEnabled && (
                <div>
                  <label className="block text-[13px] font-medium text-muted-foreground mb-2">
                    Loan Term (months) <span className="text-muted-foreground font-normal">(optional)</span>
                  </label>
                  <Input
                    type="number"
                    min="1"
                    max="360"
                    placeholder="12"
                    {...register('loan_term_requested')}
                  />
                </div>
              )}

              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">
                  Notes <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <textarea
                  {...register('notes')}
                  rows={3}
                  className="w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background placeholder:text-muted-foreground border border-transparent"
                  placeholder="Any additional information about your loan requirement..."
                />
              </div>
            </GlassCard>
          </>
        )}

        {/* Step 2: Personal Info (Lend enabled) */}
        {step === 2 && lendEnabled && (
          <GlassCard className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">Title</label>
                <select
                  {...register('applicant_title')}
                  className="w-full rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground h-10 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {TITLE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">Gender</label>
                <select
                  {...register('applicant_gender')}
                  className="w-full rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground h-10 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {GENDER_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">First Name</label>
                <Input
                  placeholder="First name"
                  error={errors.applicant_first_name?.message}
                  {...register('applicant_first_name', { required: 'First name is required' })}
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">Last Name</label>
                <Input
                  placeholder="Last name"
                  error={errors.applicant_last_name?.message}
                  {...register('applicant_last_name', { required: 'Last name is required' })}
                />
              </div>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-2">
                Middle Name <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Input placeholder="Middle name" {...register('applicant_middle_name')} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">Date of Birth</label>
                <Input
                  type="date"
                  error={errors.applicant_dob?.message}
                  {...register('applicant_dob', { required: 'Date of birth is required' })}
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">Marital Status</label>
                <select
                  {...register('applicant_marital_status')}
                  className="w-full rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground h-10 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {MARITAL_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </GlassCard>
        )}

        {/* Step 3: Address (Lend enabled) */}
        {step === 3 && lendEnabled && (
          <GlassCard className="space-y-5">
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-2">Street Address</label>
              <Input
                placeholder="123 Main Street"
                error={errors.applicant_address?.message}
                {...register('applicant_address', { required: 'Address is required' })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">Suburb</label>
                <Input
                  placeholder="Suburb"
                  error={errors.applicant_suburb?.message}
                  {...register('applicant_suburb', { required: 'Suburb is required' })}
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">State</label>
                <select
                  {...register('applicant_state', { required: 'State is required' })}
                  className="w-full rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground h-10 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {AU_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">Postcode</label>
                <Input
                  placeholder="2000"
                  maxLength={4}
                  error={errors.applicant_postcode?.message}
                  {...register('applicant_postcode', { required: 'Postcode is required', pattern: { value: /^\d{4}$/, message: 'Invalid postcode' } })}
                />
              </div>
            </div>
          </GlassCard>
        )}

        {/* Step 4: Business Details (business only) OR Financial Info (consumer) */}
        {step === 4 && lendEnabled && isBusiness && (
          <GlassCard className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">ABN</label>
                <Input
                  placeholder="12 345 678 901"
                  error={errors.business_abn?.message}
                  {...register('business_abn', { required: 'ABN is required' })}
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">Business Name</label>
                <Input
                  placeholder="Your Business Pty Ltd"
                  error={errors.business_name?.message}
                  {...register('business_name', { required: 'Business name is required' })}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">Registration Date</label>
                <Input type="date" {...register('business_registration_date')} />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">Monthly Sales ($)</label>
                <Input type="number" step="0.01" min="0" placeholder="10000" {...register('business_monthly_sales')} />
              </div>
            </div>
          </GlassCard>
        )}

        {/* Financial Info step — step 4 for consumer, step 5 for business */}
        {((step === 4 && lendEnabled && !isBusiness) || (step === 5 && lendEnabled && isBusiness)) && (
          <GlassCard className="space-y-5">
            <h3 className="text-[15px] font-semibold text-foreground">Employment & Income</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">Employer Name</label>
                <Input
                  placeholder="Employer"
                  error={errors.employer_name?.message}
                  {...register('employer_name', { required: 'Employer name is required' })}
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">Employment Type</label>
                <select
                  {...register('employment_type')}
                  className="w-full rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground h-10 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="Full Time">Full Time</option>
                  <option value="Part Time">Part Time</option>
                  <option value="Casual">Casual</option>
                  <option value="Contract">Contract</option>
                  <option value="Self Employed">Self Employed</option>
                </select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">Employment Start Date</label>
                <Input type="date" {...register('employment_start_date')} />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">Monthly Income ($)</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="5000"
                  error={errors.income_amount?.message}
                  {...register('income_amount', { required: 'Income amount is required' })}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">Dependants</label>
                <Input type="number" min="0" max="20" {...register('dependants')} />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">Credit History</label>
                <select
                  {...register('credit_history')}
                  className="w-full rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground h-10 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {CREDIT_HISTORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">Residency</label>
                <select
                  {...register('residency_status')}
                  className="w-full rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground h-10 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {RESIDENCY_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
          </GlassCard>
        )}

        {/* Identification step — step 5 for consumer, step 6 for business */}
        {((step === 5 && lendEnabled && !isBusiness) || (step === 6 && lendEnabled && isBusiness)) && (
          <GlassCard className="space-y-5">
            <h3 className="text-[15px] font-semibold text-foreground">Identification</h3>
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-2">ID Type</label>
              <div className="flex gap-3">
                {(['license', 'medicare', 'passport'] as const).map((t) => (
                  <label key={t} className={`flex-1 cursor-pointer rounded-xl p-3 text-center text-[13px] font-medium transition-all ${idType === t ? 'bg-primary/10 text-primary ring-1 ring-primary/30' : 'bg-secondary text-muted-foreground hover:bg-secondary/80'}`}>
                    <input type="radio" value={t} {...register('id_type')} className="sr-only" />
                    {t === 'license' ? 'Driver Licence' : t === 'medicare' ? 'Medicare' : 'Passport'}
                  </label>
                ))}
              </div>
            </div>
            {idType === 'license' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-[13px] font-medium text-muted-foreground mb-2">Licence Number</label>
                  <Input placeholder="12345678" {...register('id_license_number')} />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-muted-foreground mb-2">State Issued</label>
                  <select
                    {...register('id_license_state')}
                    className="w-full rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground h-10 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    {AU_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            )}
            {idType === 'medicare' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-[13px] font-medium text-muted-foreground mb-2">Medicare Number</label>
                  <Input placeholder="1234 56789 0" {...register('id_medicare_number')} />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-muted-foreground mb-2">Reference Number</label>
                  <Input placeholder="1" {...register('id_medicare_ref')} />
                </div>
              </div>
            )}
            {idType === 'passport' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-[13px] font-medium text-muted-foreground mb-2">Passport Number</label>
                  <Input placeholder="PA1234567" {...register('id_passport_number')} />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-muted-foreground mb-2">Country of Issue</label>
                  <Input placeholder="Australia" {...register('id_passport_country')} />
                </div>
              </div>
            )}
          </GlassCard>
        )}

        {/* Review step — last step for both */}
        {step === totalSteps && (
          <GlassCard className="space-y-4">
            <h3 className="text-[15px] font-semibold text-foreground">Review Your Application</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-secondary/50 p-3">
                <p className="text-[12px] font-medium text-muted-foreground">Loan Type</p>
                <p className="text-[14px] font-semibold text-foreground capitalize">{selectedType}</p>
              </div>
              <div className="rounded-xl bg-secondary/50 p-3">
                <p className="text-[12px] font-medium text-muted-foreground">Amount</p>
                <p className="text-[14px] font-semibold text-foreground">${Number(watch('amount') || 0).toLocaleString()}</p>
              </div>
              {lendEnabled && (
                <>
                  <div className="rounded-xl bg-secondary/50 p-3">
                    <p className="text-[12px] font-medium text-muted-foreground">Applicant</p>
                    <p className="text-[14px] font-semibold text-foreground">{watch('applicant_title')} {watch('applicant_first_name')} {watch('applicant_last_name')}</p>
                  </div>
                  <div className="rounded-xl bg-secondary/50 p-3">
                    <p className="text-[12px] font-medium text-muted-foreground">Address</p>
                    <p className="text-[14px] font-semibold text-foreground">{watch('applicant_suburb')}, {watch('applicant_state')} {watch('applicant_postcode')}</p>
                  </div>
                </>
              )}
            </div>
            <p className="text-[13px] text-muted-foreground">
              You can upload required documents after creating the application.
            </p>
          </GlassCard>
        )}

        {/* Non-Lend: show simple form on step 1, submit on step 2 */}
        {!lendEnabled && step === 2 && (
          <GlassCard className="space-y-4">
            <h3 className="text-[15px] font-semibold text-foreground">Review Your Application</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-secondary/50 p-3">
                <p className="text-[12px] font-medium text-muted-foreground">Loan Type</p>
                <p className="text-[14px] font-semibold text-foreground capitalize">{selectedType}</p>
              </div>
              <div className="rounded-xl bg-secondary/50 p-3">
                <p className="text-[12px] font-medium text-muted-foreground">Amount</p>
                <p className="text-[14px] font-semibold text-foreground">${Number(watch('amount') || 0).toLocaleString()}</p>
              </div>
            </div>
          </GlassCard>
        )}

        {/* Navigation */}
        <div className="flex gap-3">
          {step > 1 && (
            <Button type="button" variant="secondary" size="lg" onClick={goBack}>
              Back
            </Button>
          )}
          {step < totalSteps ? (
            <Button type="button" size="lg" onClick={goNext}>
              Continue
            </Button>
          ) : (
            <Button type="submit" loading={isSubmitting} size="lg">
              {isSubmitting ? 'Creating...' : 'Create Application'}
            </Button>
          )}
          <Button type="button" variant="secondary" size="lg" onClick={() => navigate('/dashboard')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
