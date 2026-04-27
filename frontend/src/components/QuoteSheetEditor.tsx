import { useState, useMemo } from 'react';
import { Button, GlassCard, Input } from './ui';
import type { QuoteSheet, QuoteInputParameters } from '../types';
import api from '../api/client';
import { useToast } from './Toast';
import { getErrorMessage } from '../lib/utils';

// ── Default balloon percentages per term (from Excel) ─────────────────
const DEFAULT_BALLOON_PERCENTAGES: Record<string, number> = {
  '2': 62,
  '3': 55,
  '4': 42,
  '5': 35,
  '7': 0,
};

const TERMS = [5, 4, 3, 2, 7]; // Display order matching Excel

const DEFAULT_INPUTS: QuoteInputParameters = {
  asset_price: 0,
  asset_description: 'Motor Vehicle',
  deposit_percent: 10,
  establishment_fee: 500,
  ppsr_fee: 10,
  origination_fee: 100,
  brokerage_percent: 4,
  gst_on_brokerage: false,
  balloon_on_total_price: true,
  interest_rate: 5.99,
  gst_percent: 10,
  balloon_percentages: { ...DEFAULT_BALLOON_PERCENTAGES },
  fees_financed: true,
  show_interest_rate: false,
};

// ── PMT — Excel-compatible (type=0, arrears) ─────────────────────────
function pmt(rate: number, nper: number, pv: number, fv = 0): number {
  if (rate === 0) return -(pv + fv) / nper;
  const pvif = Math.pow(1 + rate, nper);
  return -(rate * (pv * pvif + fv)) / (pvif - 1);
}

const fmt2 = (n: number) => Math.round(n * 100) / 100;

// ── Derive all calculated values from inputs ─────────────────────────
function computeFromInputs(inputs: QuoteInputParameters) {
  const deposit = inputs.asset_price * (inputs.deposit_percent / 100);
  const amountBorrowed = inputs.asset_price - deposit;
  const totalFees = inputs.establishment_fee + inputs.ppsr_fee + inputs.origination_fee;
  const netAmount = inputs.fees_financed ? amountBorrowed + totalFees : amountBorrowed;

  // Brokerage calculation
  const brokerageBase = netAmount * (inputs.brokerage_percent / 100);
  const brokerageWithGst = brokerageBase * (1 + inputs.gst_percent / 100);
  const brokerage = inputs.gst_on_brokerage ? brokerageWithGst : brokerageBase;

  const amountFinanced = netAmount + brokerage;

  // Balloon base: total price or amount financed
  const balloonBase = inputs.balloon_on_total_price ? inputs.asset_price : amountFinanced;

  return { deposit, amountBorrowed, netAmount, brokerage, amountFinanced, balloonBase, totalFees };
}

type Scenario = {
  termYears: number;
  hasBalloon: boolean;
  balloon: number;
  balloonPercent: number;
  monthlyRepayment: number;
  weeklyRepayment: number;
  totalInterest: number;
};

function generateScenarios(inputs: QuoteInputParameters): Scenario[] {
  const { amountFinanced, balloonBase } = computeFromInputs(inputs);
  const rate = inputs.interest_rate / 100;
  const monthlyRate = rate / 12;

  const scenarios: Scenario[] = [];

  for (const termYears of TERMS) {
    const months = termYears * 12;
    const balloonPct = inputs.balloon_percentages[String(termYears)] ?? 0;
    const balloonAmount = fmt2(balloonBase * (balloonPct / 100));

    // No balloon variant
    const monthlyNoBalloon = -pmt(monthlyRate, months, amountFinanced);
    scenarios.push({
      termYears,
      hasBalloon: false,
      balloon: 0,
      balloonPercent: 0,
      monthlyRepayment: fmt2(monthlyNoBalloon),
      weeklyRepayment: fmt2(monthlyNoBalloon * 12 / 52),
      totalInterest: fmt2(monthlyNoBalloon * months - amountFinanced),
    });

    // With balloon variant (only if balloon % > 0)
    if (balloonPct > 0) {
      // Excel formula: PMT(rate/12, months, -(amountFinanced - balloon)) + balloon * rate/12
      const monthlyWithBalloon =
        pmt(monthlyRate, months, -(amountFinanced - balloonAmount)) + balloonAmount * monthlyRate;
      scenarios.push({
        termYears,
        hasBalloon: true,
        balloon: balloonAmount,
        balloonPercent: balloonPct,
        monthlyRepayment: fmt2(monthlyWithBalloon),
        weeklyRepayment: fmt2(monthlyWithBalloon * 12 / 52),
        totalInterest: fmt2((monthlyWithBalloon * months) - (amountFinanced - balloonAmount)),
      });
    }
  }

  return scenarios;
}

// Convert scenarios to QuoteOption payloads for the API
function scenariosToOptions(inputs: QuoteInputParameters, scenarios: Scenario[]) {
  const { deposit, amountFinanced, brokerage } = computeFromInputs(inputs);

  return scenarios.map((s, i) => ({
    lender_name: `${s.termYears} Year${s.hasBalloon ? ` (${s.balloonPercent}% Balloon)` : ''}`,
    lender_product: null,
    sort_order: i,
    is_recommended: false,
    purchase_price: inputs.asset_price,
    deposit: fmt2(deposit),
    loan_amount: fmt2(amountFinanced),
    loan_term_months: s.termYears * 12,
    balloon_residual: s.balloon,
    interest_rate: inputs.interest_rate,
    comparison_rate: null,
    establishment_fee: inputs.establishment_fee,
    monthly_account_fee: null,
    application_fee: inputs.ppsr_fee + inputs.origination_fee,
    brokerage: fmt2(brokerage),
    repayment_monthly: s.monthlyRepayment,
    repayment_fortnightly: fmt2(s.monthlyRepayment * 12 / 26),
    repayment_weekly: s.weeklyRepayment,
    total_repayments: fmt2(s.monthlyRepayment * s.termYears * 12 + s.balloon),
    total_interest: s.totalInterest,
    total_fees: fmt2(inputs.establishment_fee + inputs.ppsr_fee + inputs.origination_fee + brokerage),
    features: null,
    notes: null,
  }));
}

interface QuoteSheetEditorProps {
  applicationId?: string;
  quoteSheet?: QuoteSheet;
  onSave: (sheet: QuoteSheet) => void;
  onCancel: () => void;
}

function parseInputParams(quoteSheet?: QuoteSheet): QuoteInputParameters {
  if (quoteSheet?.input_parameters) {
    try {
      return { ...DEFAULT_INPUTS, ...JSON.parse(quoteSheet.input_parameters) };
    } catch { /* fall through */ }
  }
  return { ...DEFAULT_INPUTS, balloon_percentages: { ...DEFAULT_BALLOON_PERCENTAGES } };
}

export default function QuoteSheetEditor({ applicationId, quoteSheet, onSave, onCancel }: QuoteSheetEditorProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState(quoteSheet?.title || '');
  const [brokerNotes, setBrokerNotes] = useState(quoteSheet?.broker_notes || '');
  const [inputs, setInputs] = useState<QuoteInputParameters>(() => parseInputParams(quoteSheet));
  const [saving, setSaving] = useState(false);

  const updateInput = <K extends keyof QuoteInputParameters>(key: K, value: QuoteInputParameters[K]) => {
    setInputs(prev => ({ ...prev, [key]: value }));
  };

  const updateBalloonPct = (term: string, value: number) => {
    setInputs(prev => ({
      ...prev,
      balloon_percentages: { ...prev.balloon_percentages, [term]: value },
    }));
  };

  // Derived values
  const derived = useMemo(() => computeFromInputs(inputs), [inputs]);
  const scenarios = useMemo(() => {
    if (inputs.asset_price <= 0) return [];
    return generateScenarios(inputs);
  }, [inputs]);

  const isStandalone = !applicationId;
  const baseUrl = isStandalone ? '/quote-sheets' : `/applications/${applicationId}/quote-sheets`;

  const handleSave = async () => {
    if (inputs.asset_price <= 0) {
      toast('Please enter a valid asset price', 'error');
      return;
    }

    setSaving(true);
    const inputParamsJson = JSON.stringify(inputs);
    const options = scenariosToOptions(inputs, scenarios);

    try {
      if (quoteSheet) {
        // Update existing: patch sheet, then replace all options
        await api.patch(`${baseUrl}/${quoteSheet.id}`, {
          title: title.trim() || null,
          broker_notes: brokerNotes.trim() || null,
          input_parameters: inputParamsJson,
        });

        // Delete all existing options
        for (const existing of quoteSheet.options) {
          await api.delete(`${baseUrl}/${quoteSheet.id}/options/${existing.id}`);
        }

        // Add new generated options
        for (const opt of options) {
          await api.post(`${baseUrl}/${quoteSheet.id}/options`, opt);
        }

        const { data } = await api.get(`${baseUrl}/${quoteSheet.id}`);
        onSave(data);
        toast('Quote sheet updated', 'success');
      } else {
        const payload = {
          title: title.trim() || null,
          broker_notes: brokerNotes.trim() || null,
          input_parameters: inputParamsJson,
          options,
        };
        const { data } = await api.post(baseUrl, payload);
        onSave(data);
        toast('Quote sheet created', 'success');
      }
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to save quote sheet'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const fmtCurrency = (n: number) =>
    `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

        {/* ── INPUT Parameters ─────────────────────────────────────── */}
        <div className="border border-border rounded-xl p-5 space-y-5">
          <h3 className="text-sm font-semibold text-foreground">Loan Parameters</h3>

          {/* Row 0: Asset description */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Asset / Loan Type"
              placeholder="e.g. Motor Vehicle, Industrial Equipment, Land, Boat"
              value={inputs.asset_description}
              onChange={e => updateInput('asset_description', e.target.value)}
            />
          </div>

          {/* Row 1: Core loan details */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-start">
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1.5">Asset Price</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <input
                  type="number"
                  step="any"
                  value={inputs.asset_price || ''}
                  onChange={e => updateInput('asset_price', parseFloat(e.target.value) || 0)}
                  className="w-full h-[44px] pl-7 pr-4 rounded-xl bg-secondary text-[14px] text-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background border border-transparent"
                />
              </div>
            </div>
            <Input
              label="Deposit"
              type="number"
              step="any"
              value={inputs.deposit_percent || ''}
              onChange={e => updateInput('deposit_percent', parseFloat(e.target.value) || 0)}
              suffix="%"
            />
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1.5">Deposit</label>
              <div className="h-[44px] flex items-center px-4 rounded-xl bg-muted/50 text-sm text-foreground font-medium">
                {fmtCurrency(derived.deposit)}
              </div>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1.5">Amount Borrowed</label>
              <div className="h-[44px] flex items-center px-4 rounded-xl bg-muted/50 text-sm text-foreground font-medium">
                {fmtCurrency(derived.amountBorrowed)}
              </div>
            </div>
          </div>

          {/* Row 2: Fees */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-start">
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1.5">Loan Establishment Fee</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <input
                  type="number"
                  step="any"
                  value={inputs.establishment_fee || ''}
                  onChange={e => updateInput('establishment_fee', parseFloat(e.target.value) || 0)}
                  className="w-full h-[44px] pl-7 pr-4 rounded-xl bg-secondary text-[14px] text-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background border border-transparent"
                />
              </div>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1.5">PPSR</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <input
                  type="number"
                  step="any"
                  value={inputs.ppsr_fee || ''}
                  onChange={e => updateInput('ppsr_fee', parseFloat(e.target.value) || 0)}
                  className="w-full h-[44px] pl-7 pr-4 rounded-xl bg-secondary text-[14px] text-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background border border-transparent"
                />
              </div>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1.5">Origination Fee</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <input
                  type="number"
                  step="any"
                  value={inputs.origination_fee || ''}
                  onChange={e => updateInput('origination_fee', parseFloat(e.target.value) || 0)}
                  className="w-full h-[44px] pl-7 pr-4 rounded-xl bg-secondary text-[14px] text-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background border border-transparent"
                />
              </div>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1.5">Fees Treatment</label>
              <select
                value={inputs.fees_financed ? 'financed' : 'non-financed'}
                onChange={e => updateInput('fees_financed', e.target.value === 'financed')}
                className="w-full h-[44px] px-4 rounded-xl bg-secondary text-[14px] text-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background border border-transparent"
              >
                <option value="financed">Financed (added to loan)</option>
                <option value="non-financed">Non-Financed (charged separately)</option>
              </select>
            </div>
          </div>

          {/* Row 2b: Computed amounts */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-start">
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1.5">Total Fees</label>
              <div className="h-[44px] flex items-center px-4 rounded-xl bg-muted/50 text-sm text-foreground font-medium">
                {fmtCurrency(derived.totalFees)}
                {!inputs.fees_financed && <span className="ml-1.5 text-[10px] text-warning font-semibold uppercase">(separate)</span>}
              </div>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1.5">Amount to be Financed</label>
              <div className="h-[44px] flex items-center px-4 rounded-xl bg-muted/50 text-sm text-foreground font-medium">
                {fmtCurrency(derived.amountFinanced)}
              </div>
            </div>
          </div>

          {/* Row 3: Brokerage & Rate */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-start">
            <Input
              label="Brokerage"
              type="number"
              step="any"
              value={inputs.brokerage_percent || ''}
              onChange={e => updateInput('brokerage_percent', parseFloat(e.target.value) || 0)}
              suffix="%"
            />
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1.5">Brokerage</label>
              <div className="h-[44px] flex items-center px-4 rounded-xl bg-muted/50 text-sm text-foreground font-medium">
                {fmtCurrency(derived.brokerage)}
              </div>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1.5">GST on Brokerage</label>
              <button
                type="button"
                onClick={() => updateInput('gst_on_brokerage', !inputs.gst_on_brokerage)}
                className={`h-[44px] w-full px-3 rounded-xl text-xs font-medium transition-colors ${inputs.gst_on_brokerage
                  ? 'bg-primary/10 text-primary border border-primary/30'
                  : 'bg-muted text-muted-foreground border border-transparent'
                  }`}
              >
                {inputs.gst_on_brokerage ? 'With GST' : 'Without GST'}
              </button>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1.5">Lender Interest Rate</label>
              <div className="relative">
                <input
                  type="number"
                  step="any"
                  value={inputs.interest_rate || ''}
                  onChange={e => updateInput('interest_rate', parseFloat(e.target.value) || 0)}
                  className="w-full h-[44px] px-4 pr-8 rounded-xl bg-secondary text-[14px] text-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background border border-transparent"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
              </div>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1.5">Show Rate to Client</label>
              <button
                type="button"
                onClick={() => updateInput('show_interest_rate', !inputs.show_interest_rate)}
                className={`h-[44px] w-full px-3 rounded-xl text-xs font-medium transition-colors ${inputs.show_interest_rate
                  ? 'bg-primary/10 text-primary border border-primary/30'
                  : 'bg-muted text-muted-foreground border border-transparent'
                  }`}
              >
                {inputs.show_interest_rate ? 'Visible to client' : 'Hidden from client'}
              </button>
            </div>
          </div>

          {/* Row 4: GST Rate */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-start">
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1.5">GST</label>
              <div className="relative">
                <input
                  type="number"
                  step="any"
                  value={inputs.gst_percent || ''}
                  onChange={e => updateInput('gst_percent', parseFloat(e.target.value) || 0)}
                  className="w-full h-[44px] px-4 pr-8 rounded-xl bg-secondary text-[14px] text-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background border border-transparent"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
              </div>
            </div>
          </div>

          {/* Row 4: Balloon config */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-start">
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1.5">Balloon calculated on</label>
              <button
                type="button"
                onClick={() => updateInput('balloon_on_total_price', !inputs.balloon_on_total_price)}
                className={`h-[44px] w-full px-4 rounded-xl text-sm font-medium transition-colors border ${inputs.balloon_on_total_price
                  ? 'bg-primary/10 text-primary border-primary/30'
                  : 'bg-muted text-muted-foreground border-transparent'
                  }`}
              >
                {inputs.balloon_on_total_price ? 'Total Price' : 'Amount Financed'}
              </button>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1.5">Balloon Base</label>
              <div className="h-[44px] flex items-center px-4 rounded-xl bg-muted/50 text-sm text-foreground font-medium">
                {fmtCurrency(derived.balloonBase)}
              </div>
            </div>
          </div>
        </div>

        {/* ── Balloon % per Term ───────────────────────────────────── */}
        <div className="border border-border rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Balloon % per Term</h3>
          <div className="grid grid-cols-5 gap-3">
            {TERMS.map(t => (
              <Input
                key={t}
                label={`${t} Year`}
                type="number"
                step="any"
                value={inputs.balloon_percentages[String(t)] ?? 0}
                onChange={e => updateBalloonPct(String(t), parseFloat(e.target.value) || 0)}
                className="!text-center"
                suffix="%"
              />
            ))}
          </div>
        </div>

        {/* ── Live Preview ─────────────────────────────────────────── */}
        {scenarios.length > 0 && (
          <div className="border border-border rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Preview — Generated Scenarios</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 text-muted-foreground font-medium">Term</th>
                    <th className="text-left py-2 px-3 text-muted-foreground font-medium">Balloon</th>
                    <th className="text-right py-2 px-3 text-muted-foreground font-medium">Monthly</th>
                    <th className="text-right py-2 px-3 text-muted-foreground font-medium">Weekly</th>
                    <th className="text-right py-2 px-3 text-muted-foreground font-medium">Total Interest</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarios.map((s, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-2 px-3 font-medium">{s.termYears} Year{!s.hasBalloon ? '' : ''}</td>
                      <td className="py-2 px-3 text-muted-foreground">
                        {s.hasBalloon ? `${s.balloonPercent}% (${fmtCurrency(s.balloon)})` : 'None'}
                      </td>
                      <td className="py-2 px-3 text-right font-semibold">{fmtCurrency(s.monthlyRepayment)}</td>
                      <td className="py-2 px-3 text-right">{fmtCurrency(s.weeklyRepayment)}</td>
                      <td className="py-2 px-3 text-right">{fmtCurrency(s.totalInterest)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
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
