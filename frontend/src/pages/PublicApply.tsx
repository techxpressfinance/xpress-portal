import axios from 'axios';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useParams } from 'react-router-dom';
import { getTenantSlug } from '../api/client';

const publicApi = axios.create({ baseURL: '/api' });
publicApi.interceptors.request.use((config) => {
  const slug = getTenantSlug();
  if (slug) config.headers['X-Tenant-Slug'] = slug;
  return config;
});

interface AppData {
  id: string;
  applicant_first_name?: string;
  applicant_last_name?: string;
  applicant_mobile?: string;
  loan_type: string;
  amount: number;
  notes?: string;
  client_invite_email?: string;
}

interface FormData {
  applicant_first_name: string;
  applicant_middle_name: string;
  applicant_last_name: string;
  applicant_dob: string;
  applicant_gender: string;
  applicant_marital_status: string;
  applicant_mobile: string;
  applicant_address: string;
  applicant_suburb: string;
  applicant_state: string;
  applicant_postcode: string;
  applicant_residency_status: string;
  residential_status: string;
  employment_category: string;
  employer_name: string;
  employer_industry: string;
  job_title: string;
  income_frequency: string;
  gross_income: string;
  previously_declined: boolean;
  change_of_circumstances: boolean;
  signature_name: string;
  notes: string;
}

const STEPS = ['Your Details', 'Employment & Finances', 'Declaration'];

const AU_STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];

const labelClass = 'block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1';
const inputClass =
  'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-[14px] text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';
const selectClass = inputClass;

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className={labelClass}>
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

export default function PublicApply() {
  const { token } = useParams<{ token: string }>();
  const [appData, setAppData] = useState<AppData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [step, setStep] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  const { register, handleSubmit, formState: { errors, isSubmitting }, setValue } = useForm<FormData>({
    defaultValues: {
      applicant_first_name: '',
      applicant_middle_name: '',
      applicant_last_name: '',
      applicant_dob: '',
      applicant_gender: '',
      applicant_marital_status: '',
      applicant_mobile: '',
      applicant_address: '',
      applicant_suburb: '',
      applicant_state: '',
      applicant_postcode: '',
      applicant_residency_status: '',
      residential_status: '',
      employment_category: '',
      employer_name: '',
      employer_industry: '',
      job_title: '',
      income_frequency: '',
      gross_income: '',
      previously_declined: false,
      change_of_circumstances: false,
      signature_name: '',
      notes: '',
    },
  });

  useEffect(() => {
    if (!token) return;
    publicApi.get(`/public/apply/${token}`)
      .then((res) => {
        setAppData(res.data);
        if (res.data.applicant_first_name) setValue('applicant_first_name', res.data.applicant_first_name);
        if (res.data.applicant_last_name) setValue('applicant_last_name', res.data.applicant_last_name);
        if (res.data.applicant_mobile) setValue('applicant_mobile', res.data.applicant_mobile);
        setLoading(false);
      })
      .catch((err) => {
        if (err.response?.status === 400) setAlreadySubmitted(true);
        else setNotFound(true);
        setLoading(false);
      });
  }, [token]);

  const onSubmit = async (data: FormData) => {
    await publicApi.post(`/public/apply/${token}`, {
      ...data,
      gross_income: data.gross_income ? parseFloat(data.gross_income) : undefined,
    });
    setSubmitted(true);
  };

  const fmt = (n: number) =>
    n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${(n / 1_000).toFixed(0)}K` : `$${n}`;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
        <div className="max-w-md w-full text-center bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
          <div className="h-14 w-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <svg className="h-7 w-7 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Link not found</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm">This application link is invalid or has expired. Please contact Xpress Finance for a new link.</p>
        </div>
      </div>
    );
  }

  if (alreadySubmitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
        <div className="max-w-md w-full text-center bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
          <div className="h-14 w-14 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-4">
            <svg className="h-7 w-7 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Already submitted</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Your application has already been submitted. The Xpress Finance team will be in touch shortly.</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
        <div className="max-w-md w-full text-center bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
          <div className="h-14 w-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <svg className="h-7 w-7 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Application submitted!</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Thank you. The Xpress Finance team will review your details and be in touch shortly.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <img src="/xpress.png" alt="Xpress Finance" className="h-8 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <span className="text-lg font-bold text-gray-900 dark:text-white">Xpress Finance</span>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Loan summary */}
        {appData && (
          <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-4 mb-6">
            <p className="text-[13px] text-blue-700 dark:text-blue-300 font-medium">
              Your application — <span className="capitalize">{appData.loan_type}</span> loan for <span className="font-bold">{fmt(appData.amount)}</span>
            </p>
          </div>
        )}

        {/* Info banner */}
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-700 rounded-xl p-4 mb-6 flex gap-3">
          <svg className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
          </svg>
          <p className="text-[13px] text-amber-700 dark:text-amber-300">
            You only need to fill in the fields you know. The application can be submitted even if some non-critical information is missing.
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-8">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2 flex-1 last:flex-none">
              <div className="flex items-center gap-2">
                <div className={`h-7 w-7 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0 transition-colors ${i < step ? 'bg-green-500 text-white' : i === step ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                  {i < step ? (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  ) : i + 1}
                </div>
                <span className={`text-[12px] font-medium hidden sm:block ${i === step ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>{label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-px mx-2 ${i < step ? 'bg-green-400' : 'bg-gray-200 dark:bg-gray-700'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">

            {/* Step 0: Personal Details */}
            {step === 0 && (
              <div className="space-y-5">
                <h2 className="text-[16px] font-semibold text-gray-900 dark:text-white mb-4">Your Details</h2>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="First Name" required>
                    <input {...register('applicant_first_name', { required: 'Required' })} className={inputClass} placeholder="Jane" />
                    {errors.applicant_first_name && <p className="text-red-500 text-[12px] mt-1">{errors.applicant_first_name.message}</p>}
                  </Field>
                  <Field label="Middle Name">
                    <input {...register('applicant_middle_name')} className={inputClass} placeholder="Optional" />
                  </Field>
                </div>

                <Field label="Last Name" required>
                  <input {...register('applicant_last_name', { required: 'Required' })} className={inputClass} placeholder="Smith" />
                  {errors.applicant_last_name && <p className="text-red-500 text-[12px] mt-1">{errors.applicant_last_name.message}</p>}
                </Field>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Date of Birth">
                    <input type="date" {...register('applicant_dob')} className={inputClass} />
                  </Field>
                  <Field label="Gender">
                    <select {...register('applicant_gender')} className={selectClass}>
                      <option value="">Select…</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="non_binary">Non-binary</option>
                      <option value="prefer_not_to_say">Prefer not to say</option>
                    </select>
                  </Field>
                </div>

                <Field label="Marital Status">
                  <select {...register('applicant_marital_status')} className={selectClass}>
                    <option value="">Select…</option>
                    <option value="single">Single</option>
                    <option value="married">Married</option>
                    <option value="defacto">De facto</option>
                    <option value="divorced">Divorced</option>
                    <option value="widowed">Widowed</option>
                  </select>
                </Field>

                <Field label="Mobile">
                  <input {...register('applicant_mobile')} className={inputClass} placeholder="04XX XXX XXX" />
                </Field>

                <Field label="Residential Address">
                  <input {...register('applicant_address')} className={inputClass} placeholder="123 Example St" />
                </Field>

                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-1">
                    <Field label="Suburb">
                      <input {...register('applicant_suburb')} className={inputClass} placeholder="Suburb" />
                    </Field>
                  </div>
                  <Field label="State">
                    <select {...register('applicant_state')} className={selectClass}>
                      <option value="">Select…</option>
                      {AU_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </Field>
                  <Field label="Postcode">
                    <input {...register('applicant_postcode')} className={inputClass} placeholder="2000" maxLength={4} />
                  </Field>
                </div>

                <Field label="Residency Status">
                  <select {...register('applicant_residency_status')} className={selectClass}>
                    <option value="">Select…</option>
                    <option value="citizen">Australian Citizen</option>
                    <option value="permanent_resident">Permanent Resident</option>
                    <option value="temporary_resident">Temporary Resident</option>
                    <option value="visa_holder">Visa Holder</option>
                  </select>
                </Field>

                <Field label="Residential Status">
                  <select {...register('residential_status')} className={selectClass}>
                    <option value="">Select…</option>
                    <option value="owner">Owner</option>
                    <option value="renting">Renting</option>
                    <option value="living_with_parents">Living with Parents</option>
                    <option value="boarding">Boarding</option>
                  </select>
                </Field>
              </div>
            )}

            {/* Step 1: Employment & Finances */}
            {step === 1 && (
              <div className="space-y-5">
                <h2 className="text-[16px] font-semibold text-gray-900 dark:text-white mb-4">Employment & Finances</h2>

                <Field label="Employment Category">
                  <select {...register('employment_category')} className={selectClass}>
                    <option value="">Select…</option>
                    <option value="full_time">Full Time</option>
                    <option value="part_time">Part Time</option>
                    <option value="casual">Casual</option>
                    <option value="self_employed">Self Employed</option>
                    <option value="unemployed">Unemployed</option>
                    <option value="retired">Retired</option>
                  </select>
                </Field>

                <Field label="Employer Name">
                  <input {...register('employer_name')} className={inputClass} placeholder="Company Pty Ltd" />
                </Field>

                <Field label="Employer Industry">
                  <input {...register('employer_industry')} className={inputClass} placeholder="e.g. Healthcare, Construction" />
                </Field>

                <Field label="Job Title">
                  <input {...register('job_title')} className={inputClass} placeholder="e.g. Software Engineer" />
                </Field>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Income Frequency">
                    <select {...register('income_frequency')} className={selectClass}>
                      <option value="">Select…</option>
                      <option value="weekly">Weekly</option>
                      <option value="fortnightly">Fortnightly</option>
                      <option value="monthly">Monthly</option>
                      <option value="annually">Annually</option>
                    </select>
                  </Field>
                  <Field label="Gross Income">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                      <input
                        {...register('gross_income')}
                        type="number"
                        min="0"
                        step="1"
                        className={inputClass + ' pl-7'}
                        placeholder="0"
                      />
                    </div>
                  </Field>
                </div>
              </div>
            )}

            {/* Step 2: Declaration */}
            {step === 2 && (
              <div className="space-y-5">
                <h2 className="text-[16px] font-semibold text-gray-900 dark:text-white mb-4">Declaration</h2>

                <div className="space-y-3">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" {...register('previously_declined')} className="mt-0.5 h-4 w-4 rounded border-gray-300" />
                    <span className="text-[13px] text-gray-700 dark:text-gray-300">
                      I have previously been declined for credit in the last 12 months.
                    </span>
                  </label>

                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" {...register('change_of_circumstances')} className="mt-0.5 h-4 w-4 rounded border-gray-300" />
                    <span className="text-[13px] text-gray-700 dark:text-gray-300">
                      My financial circumstances have changed significantly in the last 12 months.
                    </span>
                  </label>
                </div>

                <Field label="Additional Notes">
                  <textarea
                    {...register('notes')}
                    rows={3}
                    className={inputClass}
                    placeholder="Any additional information you'd like to share…"
                  />
                </Field>

                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <p className="text-[12px] text-gray-500 dark:text-gray-400 mb-3">
                    By typing your full name below, you confirm that the information provided is true and correct to the best of your knowledge.
                  </p>
                  <Field label="Full Name (Signature)" required>
                    <input
                      {...register('signature_name', { required: 'Please sign with your full name' })}
                      className={inputClass}
                      placeholder="Your full legal name"
                    />
                    {errors.signature_name && <p className="text-red-500 text-[12px] mt-1">{errors.signature_name.message}</p>}
                  </Field>
                </div>

                <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed">
                  By submitting this form you authorise Xpress Finance to collect, use and disclose your personal information for the purposes of assessing your application. Your information will be handled in accordance with the Privacy Act 1988.
                </div>
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="flex justify-between mt-6">
            <button
              type="button"
              onClick={() => setStep(s => s - 1)}
              className={`px-5 py-2.5 rounded-xl text-[14px] font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${step === 0 ? 'invisible' : ''}`}
            >
              Back
            </button>

            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => setStep(s => s + 1)}
                className="px-6 py-2.5 rounded-xl text-[14px] font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              >
                Continue
              </button>
            ) : (
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-6 py-2.5 rounded-xl text-[14px] font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-60"
              >
                {isSubmitting ? 'Submitting…' : 'Submit Application'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
