import { useState } from 'react';
import { Button, GlassCard, Input } from './ui';
import type { QuoteSheet, QuoteOption } from '../types';
import api from '../api/client';
import { useToast } from './Toast';
import { getErrorMessage } from '../lib/utils';

type OptionForm = {
  id?: string;
  lender_name: string;
  lender_product: string;
  is_recommended: boolean;
  purchase_price: string;
  deposit: string;
  loan_amount: string;
  loan_term_months: string;
  balloon_residual: string;
  interest_rate: string;
  comparison_rate: string;
  establishment_fee: string;
  monthly_account_fee: string;
  application_fee: string;
  brokerage: string;
  repayment_monthly: string;
  repayment_fortnightly: string;
  repayment_weekly: string;
  total_repayments: string;
  total_interest: string;
  total_fees: string;
  features: string;
  notes: string;
};

const blankOption = (): OptionForm => ({
  lender_name: '',
  lender_product: '',
  is_recommended: false,
  purchase_price: '',
  deposit: '',
  loan_amount: '',
  loan_term_months: '',
  balloon_residual: '',
  interest_rate: '',
  comparison_rate: '',
  establishment_fee: '',
  monthly_account_fee: '',
  application_fee: '',
  brokerage: '',
  repayment_monthly: '',
  repayment_fortnightly: '',
  repayment_weekly: '',
  total_repayments: '',
  total_interest: '',
  total_fees: '',
  features: '',
  notes: '',
});

function optionToForm(opt: QuoteOption): OptionForm {
  return {
    id: opt.id,
    lender_name: opt.lender_name,
    lender_product: opt.lender_product || '',
    is_recommended: opt.is_recommended,
    purchase_price: opt.purchase_price !== null ? String(opt.purchase_price) : '',
    deposit: opt.deposit !== null ? String(opt.deposit) : '',
    loan_amount: opt.loan_amount !== null ? String(opt.loan_amount) : '',
    loan_term_months: opt.loan_term_months !== null ? String(opt.loan_term_months) : '',
    balloon_residual: opt.balloon_residual !== null ? String(opt.balloon_residual) : '',
    interest_rate: opt.interest_rate !== null ? String(opt.interest_rate) : '',
    comparison_rate: opt.comparison_rate !== null ? String(opt.comparison_rate) : '',
    establishment_fee: opt.establishment_fee !== null ? String(opt.establishment_fee) : '',
    monthly_account_fee: opt.monthly_account_fee !== null ? String(opt.monthly_account_fee) : '',
    application_fee: opt.application_fee !== null ? String(opt.application_fee) : '',
    brokerage: opt.brokerage !== null ? String(opt.brokerage) : '',
    repayment_monthly: opt.repayment_monthly !== null ? String(opt.repayment_monthly) : '',
    repayment_fortnightly: opt.repayment_fortnightly !== null ? String(opt.repayment_fortnightly) : '',
    repayment_weekly: opt.repayment_weekly !== null ? String(opt.repayment_weekly) : '',
    total_repayments: opt.total_repayments !== null ? String(opt.total_repayments) : '',
    total_interest: opt.total_interest !== null ? String(opt.total_interest) : '',
    total_fees: opt.total_fees !== null ? String(opt.total_fees) : '',
    features: opt.features || '',
    notes: opt.notes || '',
  };
}

function formToPayload(form: OptionForm, index: number) {
  const num = (v: string) => (v.trim() === '' ? null : parseFloat(v));
  const int = (v: string) => (v.trim() === '' ? null : parseInt(v, 10));
  const str = (v: string) => (v.trim() === '' ? null : v.trim());
  return {
    lender_name: form.lender_name.trim(),
    lender_product: str(form.lender_product),
    sort_order: index,
    is_recommended: form.is_recommended,
    purchase_price: num(form.purchase_price),
    deposit: num(form.deposit),
    loan_amount: num(form.loan_amount),
    loan_term_months: int(form.loan_term_months),
    balloon_residual: num(form.balloon_residual),
    interest_rate: num(form.interest_rate),
    comparison_rate: num(form.comparison_rate),
    establishment_fee: num(form.establishment_fee),
    monthly_account_fee: num(form.monthly_account_fee),
    application_fee: num(form.application_fee),
    brokerage: num(form.brokerage),
    repayment_monthly: num(form.repayment_monthly),
    repayment_fortnightly: num(form.repayment_fortnightly),
    repayment_weekly: num(form.repayment_weekly),
    total_repayments: num(form.total_repayments),
    total_interest: num(form.total_interest),
    total_fees: num(form.total_fees),
    features: str(form.features),
    notes: str(form.notes),
  };
}

interface QuoteSheetEditorProps {
  applicationId: string;
  quoteSheet?: QuoteSheet;
  onSave: (sheet: QuoteSheet) => void;
  onCancel: () => void;
}

type FieldGroup = {
  title: string;
  fields: { key: keyof OptionForm; label: string; type: 'text' | 'number' | 'textarea' }[];
};

// Fields that can be auto-calculated
const CALCULABLE_FIELDS = new Set<keyof OptionForm>([
  'loan_amount', 'repayment_monthly', 'repayment_fortnightly', 'repayment_weekly',
  'total_repayments', 'total_interest', 'total_fees',
]);

// Source fields that trigger recalculation
const TRIGGER_FIELDS = new Set<keyof OptionForm>([
  'purchase_price', 'deposit', 'loan_term_months', 'interest_rate',
  'balloon_residual', 'repayment_monthly', 'loan_amount',
  'establishment_fee', 'application_fee', 'monthly_account_fee', 'brokerage',
  'total_repayments',
]);

const fmt2 = (n: number) => (Math.round(n * 100) / 100).toString();

/**
 * PMT function — mirrors Excel's PMT(rate, nper, pv, fv, type).
 * Calculates the periodic payment for a loan based on constant payments
 * and a constant interest rate.
 *
 * From the St George xlsx: PMT(rate/12, term, -amountFinanced, balloon, 1)
 * type=1 means advance (payment at beginning of period).
 *
 * Returns a positive number representing the payment amount.
 */
function pmt(ratePerPeriod: number, nper: number, pv: number, fv = 0, type = 1): number {
  if (ratePerPeriod === 0) {
    // Zero interest — simple division
    return -(pv + fv) / nper;
  }
  const pvif = Math.pow(1 + ratePerPeriod, nper);
  let payment = (ratePerPeriod * (pv * pvif + fv)) / (pvif - 1);
  if (type === 1) {
    // Advance: payment at start of period
    payment = payment / (1 + ratePerPeriod);
  }
  return -payment; // Return positive for a loan
}

/** Derive calculable fields from source fields. Only fills empty or previously-computed fields. */
function recalculate(opt: OptionForm, computed: Set<keyof OptionForm>): { updated: OptionForm; newComputed: Set<keyof OptionForm> } {
  const next = { ...opt };
  const nc = new Set(computed);
  const num = (v: string) => (v.trim() === '' ? NaN : parseFloat(v));

  const canSet = (key: keyof OptionForm) => next[key] === '' || nc.has(key);

  // ── Loan Amount = Purchase Price − Deposit ───────────────────────
  const pp = num(next.purchase_price);
  const dep = num(next.deposit);
  if (!isNaN(pp) && !isNaN(dep) && canSet('loan_amount')) {
    next.loan_amount = fmt2(pp - dep);
    nc.add('loan_amount');
  } else if (canSet('loan_amount') && (isNaN(pp) || isNaN(dep))) {
    if (nc.has('loan_amount')) { next.loan_amount = ''; nc.delete('loan_amount'); }
  }

  // ── Amount to be Financed ────────────────────────────────────────
  // From xlsx C28: Total Amount Financed = Loan Amount + Brokerage + Establishment Fee
  const loanAmt = num(next.loan_amount);
  const est = num(next.establishment_fee);
  const appFee = num(next.application_fee);
  const brok = num(next.brokerage);
  const amountFinanced = (isNaN(loanAmt) ? 0 : loanAmt)
    + (isNaN(est) ? 0 : est)
    + (isNaN(appFee) ? 0 : appFee)
    + (isNaN(brok) ? 0 : brok);

  // ── Monthly Repayment via PMT ────────────────────────────────────
  // From xlsx: PMT(rate/12, term, -amountFinanced, balloon, 1)
  const rate = num(next.interest_rate);   // annual % e.g. 6.4
  const term = num(next.loan_term_months);
  const balloon = num(next.balloon_residual);
  const rateDecimal = !isNaN(rate) ? rate / 100 : NaN; // 6.4% → 0.064

  if (!isNaN(rateDecimal) && !isNaN(term) && term > 0 && !isNaN(loanAmt) && canSet('repayment_monthly')) {
    const monthlyRate = rateDecimal / 12;
    const fv = isNaN(balloon) ? 0 : balloon;
    const payment = pmt(monthlyRate, term, -amountFinanced, fv, 1);
    next.repayment_monthly = fmt2(payment);
    nc.add('repayment_monthly');
  } else if (canSet('repayment_monthly') && (isNaN(rateDecimal) || isNaN(term) || isNaN(loanAmt))) {
    if (nc.has('repayment_monthly')) { next.repayment_monthly = ''; nc.delete('repayment_monthly'); }
  }

  // ── Fortnightly = Monthly × 12 / 26 ─────────────────────────────
  const monthly = num(next.repayment_monthly);
  if (!isNaN(monthly) && canSet('repayment_fortnightly')) {
    next.repayment_fortnightly = fmt2(monthly * 12 / 26);
    nc.add('repayment_fortnightly');
  } else if (canSet('repayment_fortnightly') && isNaN(monthly)) {
    if (nc.has('repayment_fortnightly')) { next.repayment_fortnightly = ''; nc.delete('repayment_fortnightly'); }
  }

  // ── Weekly = Monthly × 12 / 52 ──────────────────────────────────
  if (!isNaN(monthly) && canSet('repayment_weekly')) {
    next.repayment_weekly = fmt2(monthly * 12 / 52);
    nc.add('repayment_weekly');
  } else if (canSet('repayment_weekly') && isNaN(monthly)) {
    if (nc.has('repayment_weekly')) { next.repayment_weekly = ''; nc.delete('repayment_weekly'); }
  }

  // ── Total Repayments = Monthly × Term + Balloon ──────────────────
  // From xlsx J38: =J36*C19+C34
  const bal = isNaN(balloon) ? 0 : balloon;
  if (!isNaN(monthly) && !isNaN(term) && canSet('total_repayments')) {
    next.total_repayments = fmt2(monthly * term + bal);
    nc.add('total_repayments');
  } else if (canSet('total_repayments') && (isNaN(monthly) || isNaN(term))) {
    if (nc.has('total_repayments')) { next.total_repayments = ''; nc.delete('total_repayments'); }
  }

  // ── Total Interest = Total Repayments − Loan Amount ──────────────
  // From xlsx J43: =J38-J11 (total fees/charges/interest)
  const totalRep = num(next.total_repayments);
  if (!isNaN(totalRep) && !isNaN(loanAmt) && canSet('total_interest')) {
    const ti = totalRep - loanAmt;
    next.total_interest = fmt2(ti >= 0 ? ti : 0);
    nc.add('total_interest');
  } else if (canSet('total_interest') && (isNaN(totalRep) || isNaN(loanAmt))) {
    if (nc.has('total_interest')) { next.total_interest = ''; nc.delete('total_interest'); }
  }

  // ── Total Fees = Establishment + Application + (Monthly Fee × Term) + Brokerage ──
  const mf = num(next.monthly_account_fee);
  const hasAnyFee = !isNaN(est) || !isNaN(appFee) || !isNaN(mf) || !isNaN(brok);
  if (hasAnyFee && canSet('total_fees')) {
    const monthlyFeeTotal = !isNaN(mf) && !isNaN(term) ? mf * term : (isNaN(mf) ? 0 : mf);
    next.total_fees = fmt2(
      (isNaN(est) ? 0 : est) + (isNaN(appFee) ? 0 : appFee)
      + monthlyFeeTotal + (isNaN(brok) ? 0 : brok)
    );
    nc.add('total_fees');
  } else if (canSet('total_fees') && !hasAnyFee) {
    if (nc.has('total_fees')) { next.total_fees = ''; nc.delete('total_fees'); }
  }

  return { updated: next, newComputed: nc };
}

const FIELD_GROUPS: FieldGroup[] = [
  {
    title: 'Lender',
    fields: [
      { key: 'lender_name', label: 'Lender Name', type: 'text' },
      { key: 'lender_product', label: 'Product', type: 'text' },
    ],
  },
  {
    title: 'Loan Details',
    fields: [
      { key: 'purchase_price', label: 'Purchase Price ($)', type: 'number' },
      { key: 'deposit', label: 'Deposit ($)', type: 'number' },
      { key: 'loan_amount', label: 'Loan Amount ($)', type: 'number' },
      { key: 'loan_term_months', label: 'Term (months)', type: 'number' },
      { key: 'balloon_residual', label: 'Balloon / Residual ($)', type: 'number' },
    ],
  },
  {
    title: 'Rates',
    fields: [
      { key: 'interest_rate', label: 'Interest Rate (%)', type: 'number' },
      { key: 'comparison_rate', label: 'Comparison Rate (%)', type: 'number' },
    ],
  },
  {
    title: 'Fees',
    fields: [
      { key: 'establishment_fee', label: 'Establishment Fee ($)', type: 'number' },
      { key: 'application_fee', label: 'Application Fee ($)', type: 'number' },
      { key: 'monthly_account_fee', label: 'Monthly Fee ($)', type: 'number' },
      { key: 'brokerage', label: 'Brokerage ($)', type: 'number' },
    ],
  },
  {
    title: 'Repayments',
    fields: [
      { key: 'repayment_monthly', label: 'Monthly ($)', type: 'number' },
      { key: 'repayment_fortnightly', label: 'Fortnightly ($)', type: 'number' },
      { key: 'repayment_weekly', label: 'Weekly ($)', type: 'number' },
    ],
  },
  {
    title: 'Totals',
    fields: [
      { key: 'total_repayments', label: 'Total Repayments ($)', type: 'number' },
      { key: 'total_interest', label: 'Total Interest ($)', type: 'number' },
      { key: 'total_fees', label: 'Total Fees ($)', type: 'number' },
    ],
  },
  {
    title: 'Additional Info',
    fields: [
      { key: 'features', label: 'Features', type: 'textarea' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
];

export default function QuoteSheetEditor({ applicationId, quoteSheet, onSave, onCancel }: QuoteSheetEditorProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState(quoteSheet?.title || '');
  const [brokerNotes, setBrokerNotes] = useState(quoteSheet?.broker_notes || '');
  const [options, setOptions] = useState<OptionForm[]>(
    quoteSheet && quoteSheet.options.length > 0
      ? quoteSheet.options.map(optionToForm)
      : [blankOption()]
  );
  const [saving, setSaving] = useState(false);

  // Track which fields were auto-computed per option (by index)
  const [computedFields, setComputedFields] = useState<Set<keyof OptionForm>[]>(
    () => (quoteSheet?.options || [blankOption()]).map(() => new Set<keyof OptionForm>())
  );

  const updateOption = (index: number, key: keyof OptionForm, value: string | boolean) => {
    setOptions(prev => {
      const updated = prev.map((o, i) => (i === index ? { ...o, [key]: value } : o));

      // If user manually edits a computed field, remove it from computed set
      if (typeof value === 'string' && CALCULABLE_FIELDS.has(key)) {
        setComputedFields(cf => cf.map((s, i) => {
          if (i !== index) return s;
          const ns = new Set(s);
          ns.delete(key);
          return ns;
        }));
      }

      // If user changed a trigger field, recalculate derived fields
      if (typeof value === 'string' && TRIGGER_FIELDS.has(key)) {
        const opt = updated[index];
        const currentComputed = computedFields[index] || new Set<keyof OptionForm>();
        const { updated: recalced, newComputed } = recalculate(opt, currentComputed);
        updated[index] = recalced;
        setComputedFields(cf => cf.map((s, i) => i === index ? newComputed : s));
      }

      return updated;
    });
  };

  const addOption = () => {
    if (options.length >= 4) return;
    setOptions(prev => [...prev, blankOption()]);
    setComputedFields(prev => [...prev, new Set<keyof OptionForm>()]);
  };

  const removeOption = (index: number) => {
    if (options.length <= 1) return;
    setOptions(prev => prev.filter((_, i) => i !== index));
    setComputedFields(prev => prev.filter((_, i) => i !== index));
  };

  const toggleRecommended = (index: number) => {
    setOptions(prev =>
      prev.map((o, i) => ({ ...o, is_recommended: i === index ? !o.is_recommended : false }))
    );
  };

  const handleSave = async () => {
    // Validate at least one option has a lender name
    if (!options.some(o => o.lender_name.trim())) {
      toast('At least one option must have a lender name', 'error');
      return;
    }

    const validOptions = options.filter(o => o.lender_name.trim());
    setSaving(true);

    try {
      if (quoteSheet) {
        // Update existing: patch sheet, then replace options via delete + add
        await api.patch(`/applications/${applicationId}/quote-sheets/${quoteSheet.id}`, {
          title: title.trim() || null,
          broker_notes: brokerNotes.trim() || null,
        });

        // Delete removed options
        const newIds = new Set(validOptions.map(o => o.id).filter(Boolean));
        for (const existing of quoteSheet.options) {
          if (!newIds.has(existing.id)) {
            await api.delete(`/applications/${applicationId}/quote-sheets/${quoteSheet.id}/options/${existing.id}`);
          }
        }

        // Update existing + add new options
        for (let i = 0; i < validOptions.length; i++) {
          const opt = validOptions[i];
          const payload = formToPayload(opt, i);
          if (opt.id) {
            await api.patch(`/applications/${applicationId}/quote-sheets/${quoteSheet.id}/options/${opt.id}`, payload);
          } else {
            await api.post(`/applications/${applicationId}/quote-sheets/${quoteSheet.id}/options`, payload);
          }
        }

        // Refetch the full sheet
        const { data } = await api.get(`/applications/${applicationId}/quote-sheets/${quoteSheet.id}`);
        onSave(data);
        toast('Quote sheet updated', 'success');
      } else {
        // Create new
        const payload = {
          title: title.trim() || null,
          broker_notes: brokerNotes.trim() || null,
          options: validOptions.map((o, i) => formToPayload(o, i)),
        };
        const { data } = await api.post(`/applications/${applicationId}/quote-sheets`, payload);
        onSave(data);
        toast('Quote sheet created', 'success');
      }
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to save quote sheet'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <GlassCard>
      <div className="space-y-6">
        {/* Sheet-level fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Title"
            placeholder="e.g. Vehicle Finance Options"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
          <div>
            <label className="block text-[13px] font-medium text-foreground mb-1.5">Broker Notes (internal)</label>
            <textarea
              className="w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background placeholder:text-muted-foreground border border-transparent min-h-[44px]"
              placeholder="Internal notes (not visible to client)"
              value={brokerNotes}
              onChange={e => setBrokerNotes(e.target.value)}
              rows={1}
            />
          </div>
        </div>

        {/* Options columns */}
        <div className="overflow-x-auto">
          <div className="flex gap-4" style={{ minWidth: `${options.length * 280}px` }}>
            {options.map((opt, idx) => (
              <div
                key={idx}
                className={`flex-1 min-w-[260px] rounded-xl border p-4 space-y-4 ${
                  opt.is_recommended ? 'border-success bg-success/5' : 'border-border'
                }`}
              >
                {/* Column header */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-muted-foreground">Option {idx + 1}</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleRecommended(idx)}
                      className={`text-xs px-2 py-1 rounded-full transition-colors ${
                        opt.is_recommended
                          ? 'bg-success/20 text-success font-medium'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                      title="Mark as recommended"
                    >
                      {opt.is_recommended ? 'Recommended' : 'Recommend'}
                    </button>
                    {options.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeOption(idx)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        title="Remove option"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                {/* Field groups */}
                {FIELD_GROUPS.map(group => (
                  <div key={group.title}>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      {group.title}
                    </p>
                    <div className="space-y-2">
                      {group.fields.map(field => {
                        const isComputed = computedFields[idx]?.has(field.key) ?? false;
                        return (
                          <div key={field.key} className="relative">
                            {field.type === 'textarea' ? (
                              <div>
                                <label className="block text-[12px] text-muted-foreground mb-1">{field.label}</label>
                                <textarea
                                  className="w-full rounded-lg bg-secondary px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background placeholder:text-muted-foreground border border-transparent min-h-[60px]"
                                  value={opt[field.key] as string}
                                  onChange={e => updateOption(idx, field.key, e.target.value)}
                                  placeholder={field.label}
                                  rows={2}
                                />
                              </div>
                            ) : (
                              <div className="relative">
                                <Input
                                  label={
                                    isComputed
                                      ? `${field.label} ⚡`
                                      : field.label
                                  }
                                  type={field.type}
                                  step={field.type === 'number' ? 'any' : undefined}
                                  value={opt[field.key] as string}
                                  onChange={e => updateOption(idx, field.key, e.target.value)}
                                  placeholder={field.label}
                                  className={`!text-[13px] !h-9 !py-1.5 !rounded-lg ${isComputed ? '!text-chart-2' : ''}`}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Add option button */}
        {options.length < 4 && (
          <button
            type="button"
            onClick={addOption}
            className="w-full py-3 border-2 border-dashed border-border rounded-xl text-sm text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
          >
            + Add Lender Option
          </button>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <Button onClick={handleSave} loading={saving}>
            {quoteSheet ? 'Update Quote Sheet' : 'Create Quote Sheet'}
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </div>
    </GlassCard>
  );
}
