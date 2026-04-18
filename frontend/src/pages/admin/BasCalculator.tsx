import { type ReactNode, useState } from 'react';
import { GlassCard } from '../../components/ui';

// ── Shared helpers ────────────────────────────────────────────────────────────

function parseNum(s: string): number | null {
  const v = parseFloat(s);
  return isNaN(v) ? null : v;
}

function fmtCurrency(v: number): string {
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtRatio(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function CalcInput({ label, value, onChange, hint, prefix }: {
  label: string; value: string; onChange: (v: string) => void; hint?: string; prefix?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">{label}</label>
      <div className="relative">
        {prefix && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[14px] text-[var(--led-muted)]">{prefix}</span>}
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.00"
          className={`w-full rounded-[10px] border border-[var(--led-line)] bg-[var(--led-surface-2)] py-2.5 text-[14px] font-medium led-tnum text-[var(--led-ink)] placeholder:text-[var(--led-muted)] transition-colors focus:border-[var(--led-accent)] focus:outline-none ${prefix ? 'pl-7 pr-3' : 'px-3'}`}
        />
      </div>
      {hint && <p className="mt-1 text-[12px] text-[var(--led-muted)]">{hint}</p>}
    </div>
  );
}

function CalcSelect({ label, value, onChange, options, hint }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; hint?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-[10px] border border-[var(--led-line)] bg-[var(--led-surface-2)] px-3 py-2.5 text-[14px] font-medium text-[var(--led-ink)] transition-colors focus:border-[var(--led-accent)] focus:outline-none"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <p className="mt-1 text-[12px] text-[var(--led-muted)]">{hint}</p>}
    </div>
  );
}

function CalcToggle({ label, checked, onChange, hint }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors focus:outline-none ${checked ? 'border-[var(--led-accent)] bg-[var(--led-accent)]' : 'border-[var(--led-line)] bg-[var(--led-surface-2)]'}`}
      >
        <span className={`block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
      <div>
        <p className="text-[13px] font-medium text-[var(--led-ink)]">{label}</p>
        {hint && <p className="text-[12px] text-[var(--led-muted)]">{hint}</p>}
      </div>
    </div>
  );
}

function ResultRow({ label, value, sub, muted, indent }: {
  label: string; value: string; sub?: string; muted?: boolean; indent?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${indent ? 'pl-4' : ''}`}>
      <div className="min-w-0">
        <p className={`text-[13px] ${muted ? 'text-[var(--led-muted)]' : 'font-medium text-[var(--led-ink)]'}`}>{label}</p>
        {sub && <p className="text-[11px] text-[var(--led-muted)]">{sub}</p>}
      </div>
      <p className={`shrink-0 led-tnum text-[14px] ${muted ? 'text-[var(--led-muted)]' : 'font-semibold text-[var(--led-ink)]'}`}>{value}</p>
    </div>
  );
}

function ResultDivider() {
  return <div className="h-px bg-[var(--led-line)]" />;
}

// ── BAS Calculator ────────────────────────────────────────────────────────────

type BASCalcTab = 'surplus' | 'sales' | 'servicing';

function basCalcSurplus(totalSales: number, gstOnSales: number, nonCapPurchases: number, gstOnPurchases: number, totalPayments: number, fbt: number, oncostsRate: number): number {
  const salesNet = totalSales - gstOnSales;
  const purchasesNet = nonCapPurchases < gstOnPurchases * 11 ? gstOnPurchases * 10 : nonCapPurchases - gstOnPurchases;
  const oncosts = totalPayments * oncostsRate;
  return salesNet - (totalPayments + oncosts + fbt + purchasesNet);
}

function basCalcSalesAnalysis(gstOnSales: number, capex: number, gstOnExpenses: number, totalPayments: number, oncostsRate: number): { profit: number; expRatio: number; profitRatio: number } {
  const revenue = gstOnSales * 10;
  const expensesNet = gstOnExpenses * 10 - capex;
  const wages = totalPayments * (1 + oncostsRate);
  const totalExpenditure = expensesNet + wages;
  const profit = revenue - totalExpenditure;
  const expRatio = revenue > 0 ? totalExpenditure / revenue : 0;
  return { profit, expRatio, profitRatio: 1 - expRatio };
}

function basCalcServicing(surplus: number, capexAnnual: number, existingMonthly: number, proposedAnnual: number): number {
  return surplus + capexAnnual - existingMonthly * 12 - proposedAnnual;
}

function CalcResultItem({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[14px] border border-[var(--led-line)] bg-[var(--led-surface-2)] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">{label}</p>
      <p className="mt-2 text-[22px] font-semibold tracking-[-0.03em] led-tnum text-[var(--led-ink)]">{value}</p>
      {sub && <p className="mt-1 text-[12px] text-[var(--led-muted)]">{sub}</p>}
    </div>
  );
}

function BASCalculator() {
  const [tab, setTab] = useState<BASCalcTab>('surplus');
  const [surplusF, setSurplusF] = useState({ totalSales: '', gstOnSales: '', nonCapPurchases: '', gstOnPurchases: '', totalPayments: '', fbt: '', oncostsRate: '15' });
  const [salesF, setSalesF] = useState({ gstOnSales: '', capex: '', gstOnExpenses: '', totalPayments: '', oncostsRate: '15' });
  const [servicingF, setServicingF] = useState({ surplus: '', capexAnnual: '', existingMonthly: '', proposedAnnual: '' });

  const sParsed = { totalSales: parseNum(surplusF.totalSales), gstOnSales: parseNum(surplusF.gstOnSales), nonCapPurchases: parseNum(surplusF.nonCapPurchases), gstOnPurchases: parseNum(surplusF.gstOnPurchases), totalPayments: parseNum(surplusF.totalPayments), fbt: parseNum(surplusF.fbt) ?? 0, oncostsRate: (parseNum(surplusF.oncostsRate) ?? 15) / 100 };
  const surplusResult: number | null = sParsed.totalSales !== null && sParsed.gstOnSales !== null && sParsed.nonCapPurchases !== null && sParsed.gstOnPurchases !== null && sParsed.totalPayments !== null ? basCalcSurplus(sParsed.totalSales, sParsed.gstOnSales, sParsed.nonCapPurchases, sParsed.gstOnPurchases, sParsed.totalPayments, sParsed.fbt, sParsed.oncostsRate) : null;

  const aParsed = { gstOnSales: parseNum(salesF.gstOnSales), capex: parseNum(salesF.capex), gstOnExpenses: parseNum(salesF.gstOnExpenses), totalPayments: parseNum(salesF.totalPayments), oncostsRate: (parseNum(salesF.oncostsRate) ?? 15) / 100 };
  const salesResult = aParsed.gstOnSales !== null && aParsed.capex !== null && aParsed.gstOnExpenses !== null && aParsed.totalPayments !== null ? basCalcSalesAnalysis(aParsed.gstOnSales, aParsed.capex, aParsed.gstOnExpenses, aParsed.totalPayments, aParsed.oncostsRate) : null;

  const vParsed = { surplus: parseNum(servicingF.surplus), capexAnnual: parseNum(servicingF.capexAnnual), existingMonthly: parseNum(servicingF.existingMonthly), proposedAnnual: parseNum(servicingF.proposedAnnual) };
  const servicingResult: number | null = vParsed.surplus !== null && vParsed.capexAnnual !== null && vParsed.existingMonthly !== null && vParsed.proposedAnnual !== null ? basCalcServicing(vParsed.surplus, vParsed.capexAnnual, vParsed.existingMonthly, vParsed.proposedAnnual) : null;

  return (
    <GlassCard padding="none" className="flex flex-col">
      <div className="border-b border-[var(--led-line)] px-6 py-5">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Business Activity Statement</p>
            <h2 className="mt-1 text-[16px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">BAS Calculator</h2>
          </div>
          <div className="flex gap-1 rounded-[12px] border border-[var(--led-line)] bg-[var(--led-surface-2)] p-1">
            {(['surplus', 'sales', 'servicing'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`rounded-[8px] px-3 py-1.5 text-[12px] font-semibold transition-colors ${tab === t ? 'bg-[var(--led-accent)] text-white' : 'text-[var(--led-muted)] hover:text-[var(--led-ink)]'}`}>
                {t === 'surplus' ? 'BAS Surplus' : t === 'sales' ? 'Sales Analysis' : 'Servicing'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-6">
        {tab === 'surplus' && (
          <div className="grid gap-8 lg:grid-cols-2">
            <div className="space-y-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Inputs</p>
              <CalcInput label="Total Sales (incl. GST)" value={surplusF.totalSales} onChange={(v) => setSurplusF((f) => ({ ...f, totalSales: v }))} prefix="$" />
              <CalcInput label="GST on Sales" value={surplusF.gstOnSales} onChange={(v) => setSurplusF((f) => ({ ...f, gstOnSales: v }))} prefix="$" />
              <CalcInput label="Non-Capital Purchases (incl. GST)" value={surplusF.nonCapPurchases} onChange={(v) => setSurplusF((f) => ({ ...f, nonCapPurchases: v }))} prefix="$" />
              <CalcInput label="GST on Purchases" value={surplusF.gstOnPurchases} onChange={(v) => setSurplusF((f) => ({ ...f, gstOnPurchases: v }))} prefix="$" />
              <CalcInput label="Total Payments (Wages & Expenses)" value={surplusF.totalPayments} onChange={(v) => setSurplusF((f) => ({ ...f, totalPayments: v }))} prefix="$" />
              <div className="grid grid-cols-2 gap-4">
                <CalcInput label="FBT" value={surplusF.fbt} onChange={(v) => setSurplusF((f) => ({ ...f, fbt: v }))} prefix="$" hint="Optional, default $0" />
                <CalcInput label="Staff Oncosts (%)" value={surplusF.oncostsRate} onChange={(v) => setSurplusF((f) => ({ ...f, oncostsRate: v }))} hint="Default 15%" />
              </div>
            </div>
            <div className="flex flex-col gap-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Result</p>
              <CalcResultItem label="BAS Surplus" value={surplusResult !== null ? fmtCurrency(surplusResult) : '--'} sub={surplusResult !== null ? (surplusResult >= 0 ? 'Profit for the period' : 'Loss for the period') : 'Enter all required fields to calculate'} />
            </div>
          </div>
        )}

        {tab === 'sales' && (
          <div className="grid gap-8 lg:grid-cols-2">
            <div className="space-y-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Inputs</p>
              <CalcInput label="GST on Sales" value={salesF.gstOnSales} onChange={(v) => setSalesF((f) => ({ ...f, gstOnSales: v }))} prefix="$" />
              <CalcInput label="Capital Expenses (excl. GST)" value={salesF.capex} onChange={(v) => setSalesF((f) => ({ ...f, capex: v }))} prefix="$" />
              <CalcInput label="GST on Expenses" value={salesF.gstOnExpenses} onChange={(v) => setSalesF((f) => ({ ...f, gstOnExpenses: v }))} prefix="$" />
              <CalcInput label="Total Payments (Wages & Expenses)" value={salesF.totalPayments} onChange={(v) => setSalesF((f) => ({ ...f, totalPayments: v }))} prefix="$" />
              <CalcInput label="Staff Oncosts (%)" value={salesF.oncostsRate} onChange={(v) => setSalesF((f) => ({ ...f, oncostsRate: v }))} hint="Default 15%" />
            </div>
            <div className="space-y-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Results</p>
              <CalcResultItem label="Total Profit" value={salesResult !== null ? fmtCurrency(salesResult.profit) : '--'} />
              <CalcResultItem label="Expenses to Sales Ratio" value={salesResult !== null ? fmtRatio(salesResult.expRatio) : '--'} />
              <CalcResultItem label="Profit Ratio" value={salesResult !== null ? fmtRatio(salesResult.profitRatio) : '--'} sub={salesResult === null ? 'Enter all fields to calculate' : undefined} />
            </div>
          </div>
        )}

        {tab === 'servicing' && (
          <div className="grid gap-8 lg:grid-cols-2">
            <div className="space-y-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Inputs</p>
              <CalcInput label="Annual BAS Surplus" value={servicingF.surplus} onChange={(v) => setServicingF((f) => ({ ...f, surplus: v }))} prefix="$" hint="Annual profit/surplus — may be negative" />
              <CalcInput label="Capital Expenses (Annual Total)" value={servicingF.capexAnnual} onChange={(v) => setServicingF((f) => ({ ...f, capexAnnual: v }))} prefix="$" hint="Sum of 4 quarterly capital expenses" />
              <CalcInput label="Existing Loan Monthly Repayment" value={servicingF.existingMonthly} onChange={(v) => setServicingF((f) => ({ ...f, existingMonthly: v }))} prefix="$" hint="Will be annualised (× 12)" />
              <CalcInput label="Proposed New Loan (Annual Repayment)" value={servicingF.proposedAnnual} onChange={(v) => setServicingF((f) => ({ ...f, proposedAnnual: v }))} prefix="$" />
            </div>
            <div className="flex flex-col gap-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Result</p>
              <CalcResultItem label="BAS Servicing Capacity" value={servicingResult !== null ? fmtCurrency(servicingResult) : '--'} sub={servicingResult !== null ? (servicingResult >= 0 ? 'Positive servicing capacity' : 'Negative — loan may not be serviceable') : 'Enter all fields to calculate'} />
            </div>
          </div>
        )}
      </div>
    </GlassCard>
  );
}

// ── Pay Calculator ────────────────────────────────────────────────────────────

const TAX_BRACKETS: [number, number, number][] = [
  [0, 18200, 0.0],
  [18200, 45000, 0.16],
  [45000, 120000, 0.30],
  [120000, 180000, 0.37],
  [180000, Infinity, 0.45],
];

const HELP_BRACKETS: [number, number, number][] = [
  [0, 67000, 0.0],
  [67000, 125000, 0.15],
  [125000, 179285, 0.17],
  [179285, Infinity, 0.10],
];

const LITO_BRACKETS: [number, number, number][] = [
  [37500, 45000, 0.05],
  [45000, 66667, 0.015],
];

const MEDICARE_LEVY = 0.02;
const HOURS_PER_WEEK = 38;
const WEEKS_PER_YEAR = 52;

type PayCycle = 'hourly' | 'daily' | 'weekly' | 'fortnightly' | 'monthly' | 'annual';
type MedicareExemption = 'none' | 'half' | 'full';
type SacrificeFreq = 'weekly' | 'fortnightly' | 'monthly' | 'annual';

function annualize(amount: number, cycle: PayCycle): number {
  switch (cycle) {
    case 'hourly': return amount * HOURS_PER_WEEK * WEEKS_PER_YEAR;
    case 'daily': return amount * 260;
    case 'weekly': return amount * WEEKS_PER_YEAR;
    case 'fortnightly': return amount * 26;
    case 'monthly': return amount * 12;
    default: return amount;
  }
}

function calcIncomeTax(ti: number): number {
  let tax = 0;
  for (const [lower, upper, rate] of TAX_BRACKETS) {
    if (ti > lower) tax += (Math.min(upper, ti) - lower) * rate;
    else break;
  }
  return tax;
}

function calcLITO(ti: number): number {
  if (ti > 66667) return 0;
  let offset = 700;
  for (const [lower, upper, rate] of LITO_BRACKETS) {
    if (ti > lower) offset -= (Math.min(upper, ti) - lower) * rate;
  }
  return Math.max(0, offset);
}

function calcHELP(ti: number): number {
  let r = 0;
  for (const [lower, upper, rate] of HELP_BRACKETS) {
    if (ti > lower) r += (Math.min(upper, ti) - lower) * rate;
    else break;
  }
  return r;
}

interface PayResult {
  grossAnnual: number;
  superGuarantee: number;
  salarySacrifice: number;
  taxableIncome: number;
  incomeTax: number;
  medicare: number;
  help: number;
  lito: number;
  netAnnual: number;
}

function calcPay(
  salary: number, cycle: PayCycle, includesSuper: boolean,
  superRate: number, sacrificeAmount: number, sacrificeFreq: SacrificeFreq,
  studentLoan: boolean, medicare: MedicareExemption, deductions: number,
): PayResult {
  let grossAnnual = annualize(salary, cycle);

  let superGuarantee = 0;
  if (includesSuper) {
    const preSuperSalary = grossAnnual / (1 + superRate);
    superGuarantee = preSuperSalary * superRate;
    grossAnnual = preSuperSalary;
  } else {
    superGuarantee = grossAnnual * superRate;
  }

  const sacrificeMultiplier: Record<SacrificeFreq, number> = { weekly: 52, fortnightly: 26, monthly: 12, annual: 1 };
  const salarySacrifice = sacrificeAmount * sacrificeMultiplier[sacrificeFreq];

  const taxableIncome = Math.max(0, grossAnnual - salarySacrifice - deductions);
  const incomeTax = calcIncomeTax(taxableIncome);
  const medicareLevy = taxableIncome * MEDICARE_LEVY * (medicare === 'full' ? 0 : medicare === 'half' ? 0.5 : 1);
  const help = studentLoan ? calcHELP(taxableIncome) : 0;
  const lito = calcLITO(taxableIncome);

  const totalTax = Math.max(0, incomeTax + medicareLevy + help - lito);
  const netAnnual = taxableIncome - totalTax;

  return { grossAnnual, superGuarantee, salarySacrifice, taxableIncome, incomeTax, medicare: medicareLevy, help, lito, netAnnual };
}

function PayCalculator() {
  const [salary, setSalary] = useState('');
  const [cycle, setCycle] = useState<PayCycle>('annual');
  const [includesSuper, setIncludesSuper] = useState(false);
  const [superRate, setSuperRate] = useState('12');
  const [sacrificeAmount, setSacrificeAmount] = useState('');
  const [sacrificeFreq, setSacrificeFreq] = useState<SacrificeFreq>('annual');
  const [studentLoan, setStudentLoan] = useState(false);
  const [medicareExemption, setMedicareExemption] = useState<MedicareExemption>('none');
  const [deductions, setDeductions] = useState('');

  const salaryVal = parseNum(salary);
  const result: PayResult | null = salaryVal !== null
    ? calcPay(
        salaryVal, cycle, includesSuper,
        (parseNum(superRate) ?? 12) / 100,
        parseNum(sacrificeAmount) ?? 0, sacrificeFreq,
        studentLoan, medicareExemption,
        parseNum(deductions) ?? 0,
      )
    : null;

  const payCycleOptions = [
    { value: 'hourly', label: 'Hourly' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'fortnightly', label: 'Fortnightly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'annual', label: 'Annual' },
  ];

  const freqOptions = [
    { value: 'weekly', label: 'Weekly' },
    { value: 'fortnightly', label: 'Fortnightly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'annual', label: 'Annual' },
  ];

  const medicareOptions = [
    { value: 'none', label: 'Full levy (2%)' },
    { value: 'half', label: 'Half exemption (1%)' },
    { value: 'full', label: 'Full exemption (0%)' },
  ];

  return (
    <GlassCard padding="none" className="flex flex-col">
      <div className="border-b border-[var(--led-line)] px-6 py-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Australian Income Tax</p>
        <h2 className="mt-1 text-[16px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Pay Calculator</h2>
      </div>

      <div className="grid gap-8 p-6 lg:grid-cols-2">
        {/* Inputs */}
        <div className="space-y-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Income</p>

          <div className="grid grid-cols-2 gap-4">
            <CalcInput label="Salary / Rate" value={salary} onChange={setSalary} prefix="$" />
            <CalcSelect label="Pay Cycle" value={cycle} onChange={(v) => setCycle(v as PayCycle)} options={payCycleOptions} />
          </div>

          <CalcToggle label="Salary includes super" checked={includesSuper} onChange={setIncludesSuper} hint="Gross package includes SGC" />

          <CalcInput label="Super Rate (%)" value={superRate} onChange={setSuperRate} hint="Default 12% (SGC rate)" />

          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Salary Sacrifice (Pre-tax)</p>
            <div className="grid grid-cols-2 gap-4">
              <CalcInput label="Amount" value={sacrificeAmount} onChange={setSacrificeAmount} prefix="$" hint="Optional" />
              <CalcSelect label="Frequency" value={sacrificeFreq} onChange={(v) => setSacrificeFreq(v as SacrificeFreq)} options={freqOptions} />
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Deductions & Offsets</p>
            <CalcInput label="Annual Deductions" value={deductions} onChange={setDeductions} prefix="$" hint="Tax deductions, work expenses, etc." />
            <CalcSelect label="Medicare Levy" value={medicareExemption} onChange={(v) => setMedicareExemption(v as MedicareExemption)} options={medicareOptions} />
            <CalcToggle label="HELP / HECS student loan" checked={studentLoan} onChange={setStudentLoan} />
          </div>
        </div>

        {/* Results */}
        <div className="space-y-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Breakdown</p>

          {result === null ? (
            <div className="rounded-[14px] border border-dashed border-[var(--led-line)] px-4 py-10 text-center text-[13px] text-[var(--led-muted)]">
              Enter a salary to calculate take-home pay.
            </div>
          ) : (
            <div className="space-y-3 rounded-[16px] border border-[var(--led-line)] bg-[var(--led-surface-2)] p-5">
              <ResultRow label="Gross Annual Income" value={fmtCurrency(result.grossAnnual)} />
              <ResultRow label="Super Guarantee" value={fmtCurrency(result.superGuarantee)} muted />
              {result.salarySacrifice > 0 && <ResultRow label="Salary Sacrifice" value={`-${fmtCurrency(result.salarySacrifice)}`} muted indent />}
              <ResultDivider />
              <ResultRow label="Taxable Income" value={fmtCurrency(result.taxableIncome)} />
              <ResultDivider />
              <ResultRow label="Income Tax" value={`-${fmtCurrency(result.incomeTax)}`} muted indent />
              <ResultRow label="Medicare Levy" value={`-${fmtCurrency(result.medicare)}`} muted indent />
              {result.help > 0 && <ResultRow label="HELP Repayment" value={`-${fmtCurrency(result.help)}`} muted indent />}
              {result.lito > 0 && <ResultRow label="Low Income Tax Offset" value={`+${fmtCurrency(result.lito)}`} muted indent />}
              <ResultDivider />
              <ResultRow
                label="Net Annual Income"
                value={fmtCurrency(result.netAnnual)}
                sub={`Effective tax rate: ${((1 - result.netAnnual / result.taxableIncome) * 100).toFixed(1)}%`}
              />
              <ResultDivider />
              <div className="grid grid-cols-3 gap-3 pt-1">
                {[
                  { label: 'Monthly', divisor: 12 },
                  { label: 'Fortnightly', divisor: 26 },
                  { label: 'Weekly', divisor: 52 },
                ].map(({ label, divisor }) => (
                  <div key={label} className="rounded-[12px] border border-[var(--led-line)] bg-[var(--led-bg)] p-3 text-center">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--led-muted)]">{label}</p>
                    <p className="mt-1.5 text-[14px] font-semibold led-tnum text-[var(--led-ink)]">{fmtCurrency(result.netAnnual / divisor)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

// ── Ratios Calculator ─────────────────────────────────────────────────────────

type RatioSignal = 'good' | 'warn' | 'bad' | 'neutral';

interface RatioCard {
  label: string;
  value: number | null;
  format: 'x' | 'days' | 'pct';
  signal: RatioSignal;
  hint: string;
}

function signal(value: number | null, goodAbove?: number, warnAbove?: number): RatioSignal {
  if (value === null) return 'neutral';
  if (goodAbove !== undefined && value >= goodAbove) return 'good';
  if (warnAbove !== undefined && value >= warnAbove) return 'warn';
  return 'bad';
}

function signalBelow(value: number | null, goodBelow?: number, warnBelow?: number): RatioSignal {
  if (value === null) return 'neutral';
  if (goodBelow !== undefined && value <= goodBelow) return 'good';
  if (warnBelow !== undefined && value <= warnBelow) return 'warn';
  return 'bad';
}

function RatioCardItem({ card }: { card: RatioCard }) {
  const signalStyle: Record<RatioSignal, string> = {
    good: 'text-[var(--led-success)]',
    warn: 'text-[var(--led-warning)]',
    bad: 'text-[var(--led-danger,#ef4444)]',
    neutral: 'text-[var(--led-muted)]',
  };
  const dotStyle: Record<RatioSignal, string> = {
    good: 'bg-[var(--led-success)]',
    warn: 'bg-[var(--led-warning)]',
    bad: 'bg-[var(--led-danger,#ef4444)]',
    neutral: 'bg-[var(--led-line-strong)]',
  };

  const formatted = card.value === null ? '--'
    : card.format === 'x' ? `${card.value.toFixed(2)}x`
    : card.format === 'days' ? `${card.value.toFixed(1)} days`
    : `${card.value.toFixed(1)}%`;

  return (
    <div className="rounded-[14px] border border-[var(--led-line)] bg-[var(--led-surface-2)] p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--led-muted)] leading-tight">{card.label}</p>
        {card.value !== null && <span className={`h-2 w-2 shrink-0 rounded-full ${dotStyle[card.signal]}`} />}
      </div>
      <p className={`text-[20px] font-semibold tracking-[-0.03em] led-tnum ${card.value !== null ? signalStyle[card.signal] : 'text-[var(--led-muted)]'}`}>
        {formatted}
      </p>
      <p className="mt-1 text-[11px] text-[var(--led-muted)]">{card.hint}</p>
    </div>
  );
}

function RatiosCalculator() {
  const [f, setF] = useState({
    totalAssets: '', inventory: '', totalLiabilities: '', shareholderEquity: '',
    ebitda: '', ebit: '', totalInterestExpense: '', totalDebt: '', annualLoanRepayments: '',
    accountsReceivable: '', creditSales: '', averageDailySales: '',
    costOfGoodsSold: '', averageInventory: '', loanAmount: '', assetValue: '',
  });

  const s = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const n = (k: keyof typeof f) => parseNum(f[k]);

  const safe = (numerator: number, denominator: number | null, multiplier = 1): number | null =>
    denominator !== null && denominator !== 0 ? (numerator / denominator) * multiplier : null;

  const currentRatio = n('totalAssets') !== null && n('totalLiabilities') !== null ? safe(n('totalAssets')!, n('totalLiabilities')) : null;
  const quickRatio = n('totalAssets') !== null && n('inventory') !== null && n('totalLiabilities') !== null ? safe(n('totalAssets')! - n('inventory')!, n('totalLiabilities')) : null;
  const debtToIncome = n('totalDebt') !== null && n('ebitda') !== null ? safe(n('totalDebt')!, n('ebitda')) : null;
  const debtToEquity = n('totalLiabilities') !== null && n('shareholderEquity') !== null ? safe(n('totalLiabilities')!, n('shareholderEquity')) : null;
  const dscr = n('ebitda') !== null && n('annualLoanRepayments') !== null ? safe(n('ebitda')!, n('annualLoanRepayments')) : null;
  const interestCoverage = n('ebit') !== null && n('totalInterestExpense') !== null ? safe(n('ebit')!, n('totalInterestExpense')) : null;
  const grossDebtToEbitda = n('totalDebt') !== null && n('ebitda') !== null ? safe(n('totalDebt')!, n('ebitda')) : null;
  const dso = n('accountsReceivable') !== null && n('creditSales') !== null ? safe(n('accountsReceivable')! * 365, n('creditSales')) : null;
  const inventoryTurnover = n('costOfGoodsSold') !== null && n('averageInventory') !== null ? safe(n('costOfGoodsSold')!, n('averageInventory')) : null;
  const agedReceivables = n('accountsReceivable') !== null && n('averageDailySales') !== null ? safe(n('accountsReceivable')!, n('averageDailySales')) : null;
  const lvr = n('loanAmount') !== null && n('assetValue') !== null ? safe(n('loanAmount')!, n('assetValue'), 100) : null;

  const cards: RatioCard[] = [
    { label: 'Current Ratio', value: currentRatio, format: 'x', signal: signal(currentRatio, 2, 1), hint: '>2 strong · 1–2 adequate · <1 concern' },
    { label: 'Quick Ratio', value: quickRatio, format: 'x', signal: signal(quickRatio, 1, 0.5), hint: '>1 good · <0.5 liquidity concern' },
    { label: 'Debt to Income', value: debtToIncome, format: 'x', signal: signalBelow(debtToIncome, 2, 4), hint: '<2 low · 2–4 moderate · >4 high' },
    { label: 'Debt to Equity', value: debtToEquity, format: 'x', signal: signalBelow(debtToEquity, 1, 2), hint: '<1 low · 1–2 moderate · >2 high leverage' },
    { label: 'DSCR', value: dscr, format: 'x', signal: signal(dscr, 1.25, 1), hint: '>1.25 healthy · <1 cannot service debt' },
    { label: 'Interest Coverage', value: interestCoverage, format: 'x', signal: signal(interestCoverage, 3, 1.5), hint: '>3 comfortable · <1.5 concern' },
    { label: 'Gross Debt / EBITDA', value: grossDebtToEbitda, format: 'x', signal: signalBelow(grossDebtToEbitda, 3, 5), hint: '<3 low · 3–5 moderate · >5 high' },
    { label: 'Days Sales Outstanding', value: dso, format: 'days', signal: 'neutral', hint: 'Lower is better (industry dependent)' },
    { label: 'Inventory Turnover', value: inventoryTurnover, format: 'x', signal: 'neutral', hint: 'Higher is better (industry dependent)' },
    { label: 'Aged Receivables', value: agedReceivables, format: 'days', signal: 'neutral', hint: 'Lower indicates faster collection' },
    { label: 'Loan to Value Ratio', value: lvr, format: 'pct', signal: signalBelow(lvr, 80, 90), hint: '<80% standard · >80% LMI may apply' },
  ];

  const inputGroup = (title: string, children: ReactNode) => (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">{title}</p>
      {children}
    </div>
  );

  return (
    <GlassCard padding="none" className="flex flex-col">
      <div className="border-b border-[var(--led-line)] px-6 py-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Credit & Financial Analysis</p>
        <h2 className="mt-1 text-[16px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Financial Ratios</h2>
      </div>

      <div className="grid gap-8 p-6 lg:grid-cols-2">
        <div className="space-y-6 overflow-y-auto">
          {inputGroup('Balance Sheet', <>
            <div className="grid grid-cols-2 gap-4">
              <CalcInput label="Total Assets" value={f.totalAssets} onChange={s('totalAssets')} prefix="$" />
              <CalcInput label="Total Liabilities" value={f.totalLiabilities} onChange={s('totalLiabilities')} prefix="$" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <CalcInput label="Inventory" value={f.inventory} onChange={s('inventory')} prefix="$" />
              <CalcInput label="Shareholder Equity" value={f.shareholderEquity} onChange={s('shareholderEquity')} prefix="$" />
            </div>
          </>)}

          {inputGroup('Earnings', <>
            <div className="grid grid-cols-2 gap-4">
              <CalcInput label="EBITDA" value={f.ebitda} onChange={s('ebitda')} prefix="$" />
              <CalcInput label="EBIT" value={f.ebit} onChange={s('ebit')} prefix="$" />
            </div>
            <CalcInput label="Total Interest Expense" value={f.totalInterestExpense} onChange={s('totalInterestExpense')} prefix="$" />
          </>)}

          {inputGroup('Debt', <>
            <div className="grid grid-cols-2 gap-4">
              <CalcInput label="Total Debt" value={f.totalDebt} onChange={s('totalDebt')} prefix="$" />
              <CalcInput label="Annual Loan Repayments" value={f.annualLoanRepayments} onChange={s('annualLoanRepayments')} prefix="$" />
            </div>
          </>)}

          {inputGroup('Receivables & Sales', <>
            <CalcInput label="Accounts Receivable" value={f.accountsReceivable} onChange={s('accountsReceivable')} prefix="$" />
            <div className="grid grid-cols-2 gap-4">
              <CalcInput label="Total Credit Sales" value={f.creditSales} onChange={s('creditSales')} prefix="$" />
              <CalcInput label="Average Daily Sales" value={f.averageDailySales} onChange={s('averageDailySales')} prefix="$" />
            </div>
          </>)}

          {inputGroup('Inventory', <>
            <div className="grid grid-cols-2 gap-4">
              <CalcInput label="Cost of Goods Sold" value={f.costOfGoodsSold} onChange={s('costOfGoodsSold')} prefix="$" />
              <CalcInput label="Average Inventory" value={f.averageInventory} onChange={s('averageInventory')} prefix="$" />
            </div>
          </>)}

          {inputGroup('Property / Security', <>
            <div className="grid grid-cols-2 gap-4">
              <CalcInput label="Loan Amount" value={f.loanAmount} onChange={s('loanAmount')} prefix="$" />
              <CalcInput label="Asset Value" value={f.assetValue} onChange={s('assetValue')} prefix="$" />
            </div>
          </>)}
        </div>

        <div className="space-y-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Ratios</p>
          <div className="grid grid-cols-2 gap-3">
            {cards.map((card) => <RatioCardItem key={card.label} card={card} />)}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type TopTab = 'bas' | 'pay' | 'ratios';

export default function Calculators() {
  const [topTab, setTopTab] = useState<TopTab>('bas');

  const tabs: { value: TopTab; label: string }[] = [
    { value: 'bas', label: 'BAS Calculator' },
    { value: 'pay', label: 'Pay Calculator' },
    { value: 'ratios', label: 'Financial Ratios' },
  ];

  return (
    <div className="flex flex-col gap-6 pb-8">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="led-chip led-chip-accent">Tools</span>
        </div>
        <h1 className="text-[34px] font-semibold tracking-[-0.05em] text-[var(--led-ink)]">Calculators</h1>
        <p className="text-[14px] leading-6 text-[var(--led-muted)]">
          Financial calculators for BAS analysis, income tax assessment, and credit ratio analysis.
        </p>
      </div>

      <div className="flex gap-1 rounded-[12px] border border-[var(--led-line)] bg-[var(--led-surface-2)] p-1 w-fit">
        {tabs.map((t) => (
          <button
            key={t.value}
            onClick={() => setTopTab(t.value)}
            className={`rounded-[8px] px-5 py-2 text-[13px] font-semibold transition-colors ${topTab === t.value ? 'bg-[var(--led-accent)] text-white' : 'text-[var(--led-muted)] hover:text-[var(--led-ink)]'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {topTab === 'bas' && <BASCalculator />}
      {topTab === 'pay' && <PayCalculator />}
      {topTab === 'ratios' && <RatiosCalculator />}
    </div>
  );
}
