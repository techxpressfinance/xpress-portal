import { type ReactNode, useEffect, useRef, useState } from 'react';
import { GlassCard } from '../../components/ui';
import { useTabParam } from '../../hooks/useTabParam';

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

function CalcResultItem({ label, value, sub, signal }: {
  label: string; value: string; sub?: string; signal?: 'positive' | 'negative' | 'neutral';
}) {
  const valueColor = signal === 'positive' ? 'text-[var(--led-success)]'
    : signal === 'negative' ? 'text-[var(--led-danger,#ef4444)]'
    : 'text-[var(--led-ink)]';
  return (
    <div className="rounded-[14px] border border-[var(--led-line)] bg-[var(--led-surface-2)] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">{label}</p>
      <p className={`mt-2 text-[22px] font-semibold tracking-[-0.03em] led-tnum ${valueColor}`}>{value}</p>
      {sub && <p className="mt-1 text-[12px] text-[var(--led-muted)]">{sub}</p>}
    </div>
  );
}

// ── BAS Types ─────────────────────────────────────────────────────────────────

type BASMode = 'quarterly' | 'monthly';
type BASTab = 'collator' | 'servicing' | 'sales';

interface PeriodInput {
  date: string;
  totalSales: string;
  gstOnSales: string;
  nonCapPurchases: string;
  gstOnPurchases: string;
  wages: string;
  fbt: string;
}

interface PeriodCalc {
  salesNetGST: number | null;
  purchasesNetGST: number | null;
  staffOncosts: number | null;
  totalExpenses: number | null;
  basSurplus: number | null;
}

interface CapexEntry { description: string; amount: string; }
interface LoanEntry { description: string; monthly: string; }

export interface BASCalcState {
  mode: BASMode;
  oncostsRate: string;
  periods: PeriodInput[];
  capexEntries: CapexEntry[];
  loanEntries: LoanEntry[];
  proposedLoan: LoanEntry;
}

// ── BAS Calculation Functions ─────────────────────────────────────────────────

function calcPeriod(p: PeriodInput, rate: number): PeriodCalc {
  const totalSales = parseNum(p.totalSales);
  const gstOnSales = parseNum(p.gstOnSales);
  const nonCapPurchases = parseNum(p.nonCapPurchases) ?? 0;
  const gstOnPurchases = parseNum(p.gstOnPurchases);
  const wages = parseNum(p.wages);
  const fbt = parseNum(p.fbt) ?? 0;

  if (totalSales === null || gstOnSales === null || gstOnPurchases === null || wages === null) {
    return { salesNetGST: null, purchasesNetGST: null, staffOncosts: null, totalExpenses: null, basSurplus: null };
  }

  const salesNetGST = totalSales - gstOnSales;
  // If G11 < 1B × 11, purchases net = 1B × 10 (i.e. ignore G11 entry)
  const purchasesNetGST = nonCapPurchases < gstOnPurchases * 11
    ? gstOnPurchases * 10
    : nonCapPurchases - gstOnPurchases;
  const staffOncosts = wages * rate;
  const totalExpenses = purchasesNetGST + wages + staffOncosts + fbt;
  const basSurplus = salesNetGST - totalExpenses;

  return { salesNetGST, purchasesNetGST, staffOncosts, totalExpenses, basSurplus };
}

function sumOrNull(vals: (number | null)[]): number | null {
  const nums = vals.filter((v): v is number => v !== null);
  return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) : null;
}

function aggregateMonthsToQuarters(periods: PeriodInput[]): PeriodInput[] {
  return Array.from({ length: 4 }, (_, qi) => {
    const months = periods.slice(qi * 3, qi * 3 + 3);
    const sumField = (field: keyof PeriodInput): string => {
      const hasData = months.some(m => m[field] !== '');
      if (!hasData) return '';
      const total = months.reduce((acc, m) => {
        const v = parseNum(m[field] as string);
        return v !== null ? acc + v : acc;
      }, 0);
      return String(total);
    };
    return {
      date: months[2]?.date ?? '',
      totalSales: sumField('totalSales'),
      gstOnSales: sumField('gstOnSales'),
      nonCapPurchases: sumField('nonCapPurchases'),
      gstOnPurchases: sumField('gstOnPurchases'),
      wages: sumField('wages'),
      fbt: sumField('fbt'),
    };
  });
}

// ── Collator Table Cells ──────────────────────────────────────────────────────

function TLabelCell({ children, semibold }: { children: ReactNode; semibold?: boolean }) {
  return (
    <td className={`sticky left-0 z-10 border-b border-r border-[var(--led-line)] bg-[var(--led-bg)] px-3 py-2 text-[12px] whitespace-nowrap min-w-[220px] ${semibold ? 'font-semibold text-[var(--led-ink)]' : 'font-medium text-[var(--led-ink)]'}`}>
      {children}
    </td>
  );
}

function TItemCell({ children }: { children: ReactNode }) {
  return (
    <td className="border-b border-r border-[var(--led-line)] bg-[var(--led-bg)] px-3 py-2 text-[11px] font-mono text-[var(--led-muted)] whitespace-nowrap w-10 text-center">
      {children}
    </td>
  );
}

function TInputCell({ value, onChange, isOptional, isDate }: {
  value: string; onChange: (v: string) => void; isOptional?: boolean; isDate?: boolean;
}) {
  return (
    <td className="border-b border-r border-[var(--led-line)] px-1.5 py-1.5">
      <input
        type={isDate ? 'text' : 'number'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={isDate ? 'dd/mm/yy' : isOptional ? '—' : '0'}
        className="w-full min-w-[100px] rounded-[6px] border border-[var(--led-line)] bg-[var(--led-bg)] px-2 py-1 text-[12px] font-medium led-tnum text-[var(--led-ink)] placeholder:text-[var(--led-muted)] transition-colors focus:border-[var(--led-accent)] focus:outline-none"
      />
    </td>
  );
}

function TCalcCell({ value, prominent, right }: { value: number | null; prominent?: boolean; right?: boolean }) {
  const color = prominent && value !== null
    ? value >= 0 ? 'text-[var(--led-success)]' : 'text-[var(--led-danger,#ef4444)]'
    : value !== null ? 'text-[var(--led-ink)]' : 'text-[var(--led-muted)]';
  return (
    <td className={`border-b border-r border-[var(--led-line)] bg-[var(--led-surface-2)] px-3 py-2 text-[12px] font-medium led-tnum whitespace-nowrap min-w-[110px] ${right !== false ? 'text-right' : ''} ${color} ${prominent ? 'font-semibold' : ''}`}>
      {value !== null ? fmtCurrency(value) : '--'}
    </td>
  );
}

function THeader({ children, sticky }: { children: ReactNode; sticky?: boolean }) {
  return (
    <th className={`border-b border-r border-[var(--led-line)] bg-[var(--led-surface-2)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--led-muted)] text-center whitespace-nowrap ${sticky ? 'sticky left-0 z-20' : ''}`}>
      {children}
    </th>
  );
}

function TSectionRow({ label, colSpan }: { label: string; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="border-b border-[var(--led-line)] bg-[var(--led-surface-2)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">
        {label}
      </td>
    </tr>
  );
}

// ── BAS Calculator ────────────────────────────────────────────────────────────

const EMPTY_PERIOD: PeriodInput = {
  date: '', totalSales: '', gstOnSales: '', nonCapPurchases: '',
  gstOnPurchases: '', wages: '', fbt: '',
};

export function BASCalculator({ initialState, onStateChange }: {
  initialState?: BASCalcState;
  onStateChange?: (s: BASCalcState) => void;
} = {}) {
  const _onSC = useRef(onStateChange);
  useEffect(() => { _onSC.current = onStateChange; });

  const [mode, setMode] = useState<BASMode>(initialState?.mode ?? 'quarterly');
  // Component-local, not URL-backed: BASCalculator is also embedded inside
  // ApplicationCalculators on application pages, where a ?subtab= param would
  // pollute the host page's URL and history.
  const [tab, setTab] = useState<BASTab>('collator');
  const [oncostsRate, setOncostsRate] = useState(initialState?.oncostsRate ?? '15');

  const [periods, setPeriods] = useState<PeriodInput[]>(
    initialState?.periods ?? Array.from({ length: 12 }, () => ({ ...EMPTY_PERIOD }))
  );

  const [capexEntries, setCapexEntries] = useState<CapexEntry[]>(
    initialState?.capexEntries ?? [
      { description: '', amount: '' },
      { description: '', amount: '' },
      { description: '', amount: '' },
    ]
  );

  const [loanEntries, setLoanEntries] = useState<LoanEntry[]>(
    initialState?.loanEntries ?? Array.from({ length: 7 }, () => ({ description: '', monthly: '' }))
  );

  const [proposedLoan, setProposedLoan] = useState<LoanEntry>(
    initialState?.proposedLoan ?? { description: '', monthly: '' }
  );

  useEffect(() => {
    _onSC.current?.({ mode, oncostsRate, periods, capexEntries, loanEntries, proposedLoan });
  }, [mode, oncostsRate, periods, capexEntries, loanEntries, proposedLoan]);

  // ── Derived values ────────────────────────────────────────────────────────

  const rate = (parseNum(oncostsRate) ?? 15) / 100;
  const periodCount = mode === 'quarterly' ? 4 : 12;
  const activePeriods = periods.slice(0, periodCount);
  const calcs = activePeriods.map(p => calcPeriod(p, rate));

  const annualSurplus = sumOrNull(calcs.map(c => c.basSurplus));
  const monthlySurplus = annualSurplus !== null ? annualSurplus / 12 : null;

  const totalSalesNetGST = sumOrNull(calcs.map(c => c.salesNetGST));
  const totalPurchasesNetGST = sumOrNull(calcs.map(c => c.purchasesNetGST));
  const totalStaffOncosts = sumOrNull(calcs.map(c => c.staffOncosts));
  const totalAllExpenses = sumOrNull(calcs.map(c => c.totalExpenses));

  const sumInput = (field: keyof PeriodInput): number | null =>
    sumOrNull(activePeriods.map(p => parseNum(p[field] as string)));

  // Servicing
  const capexAmounts = capexEntries.map(e => parseNum(e.amount));
  const totalCapex = sumOrNull(capexAmounts);
  const loanAnnuals = loanEntries.map(l => {
    const m = parseNum(l.monthly);
    return m !== null ? m * 12 : null;
  });
  const proposedAnnual = (() => {
    const m = parseNum(proposedLoan.monthly);
    return m !== null ? m * 12 : null;
  })();
  const totalAnnualLoans = sumOrNull([...loanAnnuals, proposedAnnual]);
  const servSurplus = annualSurplus !== null && totalAnnualLoans !== null
    ? annualSurplus + (totalCapex ?? 0) - totalAnnualLoans
    : null;

  // Sales analysis quarterly data
  const quarterlyPeriods = mode === 'quarterly' ? activePeriods : aggregateMonthsToQuarters(periods);
  const capexPerQuarter = totalCapex !== null ? totalCapex / 4 : 0;

  const updatePeriod = (idx: number, field: keyof PeriodInput, val: string) =>
    setPeriods(prev => prev.map((p, i) => i === idx ? { ...p, [field]: val } : p));

  const periodLabels = mode === 'quarterly'
    ? ['Q1', 'Q2', 'Q3', 'Q4']
    : Array.from({ length: 12 }, (_, i) => `M${i + 1}`);

  const tableColCount = 2 + periodCount + 1;

  return (
    <GlassCard padding="none" className="flex flex-col">
      {/* Card header */}
      <div className="border-b border-[var(--led-line)] px-6 py-5">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Business Activity Statement</p>
            <h2 className="mt-1 text-[16px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">BAS Calculator</h2>
          </div>
          <div className="flex gap-1 rounded-[12px] border border-[var(--led-line)] bg-[var(--led-surface-2)] p-1">
            {(['collator', 'servicing', 'sales'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-[8px] px-3 py-1.5 text-[12px] font-semibold transition-colors ${tab === t ? 'bg-[var(--led-accent)] text-white' : 'text-[var(--led-muted)] hover:text-[var(--led-ink)]'}`}
              >
                {t === 'collator' ? 'BAS Collator' : t === 'servicing' ? 'Servicing' : 'Sales Analysis'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-6">

        {/* ── BAS Collator Tab ─────────────────────────────────────────────── */}
        {tab === 'collator' && (
          <div className="space-y-6">
            {/* Controls row */}
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex gap-1 rounded-[10px] border border-[var(--led-line)] bg-[var(--led-surface-2)] p-1">
                {(['quarterly', 'monthly'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`rounded-[7px] px-3 py-1 text-[12px] font-semibold capitalize transition-colors ${mode === m ? 'bg-[var(--led-accent)] text-white' : 'text-[var(--led-muted)] hover:text-[var(--led-ink)]'}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--led-muted)]">Staff Oncosts</label>
                <input
                  type="number"
                  value={oncostsRate}
                  onChange={(e) => setOncostsRate(e.target.value)}
                  className="w-16 rounded-[8px] border border-[var(--led-line)] bg-[var(--led-surface-2)] px-2 py-1 text-[13px] font-medium led-tnum text-[var(--led-ink)] focus:border-[var(--led-accent)] focus:outline-none"
                />
                <span className="text-[13px] text-[var(--led-muted)]">%</span>
              </div>
            </div>

            {/* Collator table */}
            <div className="overflow-x-auto rounded-[12px] border border-[var(--led-line)]">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <THeader sticky>Field</THeader>
                    <THeader>Item</THeader>
                    {periodLabels.map(l => <THeader key={l}>{l}</THeader>)}
                    <THeader>Annual</THeader>
                  </tr>
                  {/* Date row */}
                  <tr>
                    <TLabelCell><span className="text-[var(--led-muted)]">Period End Date</span></TLabelCell>
                    <TItemCell>—</TItemCell>
                    {activePeriods.map((p, i) => (
                      <TInputCell key={i} value={p.date} onChange={(v) => updatePeriod(i, 'date', v)} isDate />
                    ))}
                    <TCalcCell value={null} />
                  </tr>
                </thead>

                <tbody>
                  <TSectionRow label="Income" colSpan={tableColCount} />

                  <tr>
                    <TLabelCell>Total Sales <span className="text-[var(--led-muted)] font-normal">(incl. GST)</span></TLabelCell>
                    <TItemCell>G1</TItemCell>
                    {activePeriods.map((p, i) => (
                      <TInputCell key={i} value={p.totalSales} onChange={(v) => updatePeriod(i, 'totalSales', v)} />
                    ))}
                    <TCalcCell value={sumInput('totalSales')} />
                  </tr>

                  <tr>
                    <TLabelCell>GST on Sales</TLabelCell>
                    <TItemCell>1A</TItemCell>
                    {activePeriods.map((p, i) => (
                      <TInputCell key={i} value={p.gstOnSales} onChange={(v) => updatePeriod(i, 'gstOnSales', v)} />
                    ))}
                    <TCalcCell value={sumInput('gstOnSales')} />
                  </tr>

                  <tr className="bg-[var(--led-surface-2)]">
                    <TLabelCell><em>Sales Net of GST</em></TLabelCell>
                    <TItemCell>—</TItemCell>
                    {calcs.map((c, i) => <TCalcCell key={i} value={c.salesNetGST} />)}
                    <TCalcCell value={totalSalesNetGST} />
                  </tr>

                  <TSectionRow label="Deductions" colSpan={tableColCount} />

                  <tr>
                    <TLabelCell>Non-Capital Purchases <span className="text-[var(--led-muted)] font-normal">(optional)</span></TLabelCell>
                    <TItemCell>G11</TItemCell>
                    {activePeriods.map((p, i) => (
                      <TInputCell key={i} value={p.nonCapPurchases} onChange={(v) => updatePeriod(i, 'nonCapPurchases', v)} isOptional />
                    ))}
                    <TCalcCell value={sumInput('nonCapPurchases')} />
                  </tr>

                  <tr>
                    <TLabelCell>GST on Purchases</TLabelCell>
                    <TItemCell>1B</TItemCell>
                    {activePeriods.map((p, i) => (
                      <TInputCell key={i} value={p.gstOnPurchases} onChange={(v) => updatePeriod(i, 'gstOnPurchases', v)} />
                    ))}
                    <TCalcCell value={sumInput('gstOnPurchases')} />
                  </tr>

                  <tr className="bg-[var(--led-surface-2)]">
                    <TLabelCell><em>Purchases Net of GST</em></TLabelCell>
                    <TItemCell>—</TItemCell>
                    {calcs.map((c, i) => <TCalcCell key={i} value={c.purchasesNetGST} />)}
                    <TCalcCell value={totalPurchasesNetGST} />
                  </tr>

                  <tr>
                    <TLabelCell>Total Salary, Wages &amp; Other Payments</TLabelCell>
                    <TItemCell>W1</TItemCell>
                    {activePeriods.map((p, i) => (
                      <TInputCell key={i} value={p.wages} onChange={(v) => updatePeriod(i, 'wages', v)} />
                    ))}
                    <TCalcCell value={sumInput('wages')} />
                  </tr>

                  <tr className="bg-[var(--led-surface-2)]">
                    <TLabelCell><em>Staff Oncosts ({oncostsRate}%)</em></TLabelCell>
                    <TItemCell>—</TItemCell>
                    {calcs.map((c, i) => <TCalcCell key={i} value={c.staffOncosts} />)}
                    <TCalcCell value={totalStaffOncosts} />
                  </tr>

                  <tr>
                    <TLabelCell>FBT <span className="text-[var(--led-muted)] font-normal">(optional)</span></TLabelCell>
                    <TItemCell>6A</TItemCell>
                    {activePeriods.map((p, i) => (
                      <TInputCell key={i} value={p.fbt} onChange={(v) => updatePeriod(i, 'fbt', v)} isOptional />
                    ))}
                    <TCalcCell value={sumInput('fbt')} />
                  </tr>

                  <tr className="bg-[var(--led-surface-2)]">
                    <TLabelCell><em>Total Expenses Net of GST</em></TLabelCell>
                    <TItemCell>—</TItemCell>
                    {calcs.map((c, i) => <TCalcCell key={i} value={c.totalExpenses} />)}
                    <TCalcCell value={totalAllExpenses} />
                  </tr>

                  <TSectionRow label="BAS Surplus" colSpan={tableColCount} />

                  <tr>
                    <TLabelCell semibold>BAS Surplus</TLabelCell>
                    <TItemCell>—</TItemCell>
                    {calcs.map((c, i) => <TCalcCell key={i} value={c.basSurplus} prominent />)}
                    <TCalcCell value={annualSurplus} prominent />
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <CalcResultItem
                label="Annual BAS Surplus"
                value={annualSurplus !== null ? fmtCurrency(annualSurplus) : '--'}
                sub={annualSurplus !== null ? (annualSurplus >= 0 ? 'Profit for the year' : 'Loss for the year') : 'Enter period data to calculate'}
                signal={annualSurplus !== null ? (annualSurplus >= 0 ? 'positive' : 'negative') : 'neutral'}
              />
              <CalcResultItem
                label="Monthly BAS Surplus"
                value={monthlySurplus !== null ? fmtCurrency(monthlySurplus) : '--'}
                sub="Annual ÷ 12"
                signal={monthlySurplus !== null ? (monthlySurplus >= 0 ? 'positive' : 'negative') : 'neutral'}
              />
            </div>

            <p className="text-[11px] text-[var(--led-muted)]">
              G11 is optional — if not declared on BAS, leave blank and enter 1B only.
              When G11 &lt; (1B × 11), Purchases Net of GST = 1B × 10.
            </p>
          </div>
        )}

        {/* ── Servicing Tab ─────────────────────────────────────────────────── */}
        {tab === 'servicing' && (
          <div className="space-y-8">
            {/* BAS Surplus from collator */}
            <div className="rounded-[14px] border border-[var(--led-line)] bg-[var(--led-surface-2)] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Annual BAS Surplus — from Collator</p>
              <p className={`mt-2 text-[22px] font-semibold tracking-[-0.03em] led-tnum ${annualSurplus !== null ? (annualSurplus >= 0 ? 'text-[var(--led-success)]' : 'text-[var(--led-danger,#ef4444)]') : 'text-[var(--led-muted)]'}`}>
                {annualSurplus !== null ? fmtCurrency(annualSurplus) : '--'}
              </p>
              {annualSurplus === null && (
                <p className="mt-1 text-[12px] text-[var(--led-muted)]">Complete the BAS Collator tab to auto-populate</p>
              )}
            </div>

            <div className="grid gap-8 lg:grid-cols-2">
              {/* Left: inputs */}
              <div className="space-y-6">

                {/* Capital Expenses */}
                <div className="space-y-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Asset Purchase Add Back (Ex GST)</p>
                  {capexEntries.map((e, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        type="text"
                        value={e.description}
                        onChange={(ev) => setCapexEntries(prev => prev.map((x, j) => j === i ? { ...x, description: ev.target.value } : x))}
                        placeholder={`Capital Expense ${i + 1}`}
                        className="min-w-0 flex-1 rounded-[8px] border border-[var(--led-line)] bg-[var(--led-surface-2)] px-3 py-2 text-[13px] text-[var(--led-ink)] placeholder:text-[var(--led-muted)] focus:border-[var(--led-accent)] focus:outline-none"
                      />
                      <div className="relative">
                        <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-[13px] text-[var(--led-muted)]">$</span>
                        <input
                          type="number"
                          value={e.amount}
                          onChange={(ev) => setCapexEntries(prev => prev.map((x, j) => j === i ? { ...x, amount: ev.target.value } : x))}
                          placeholder="0"
                          className="w-[110px] rounded-[8px] border border-[var(--led-line)] bg-[var(--led-surface-2)] py-2 pl-7 pr-3 text-[13px] font-medium led-tnum text-[var(--led-ink)] placeholder:text-[var(--led-muted)] focus:border-[var(--led-accent)] focus:outline-none"
                        />
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-[var(--led-line)] pt-2">
                    <span className="text-[12px] font-semibold text-[var(--led-muted)] uppercase tracking-[0.1em]">Total Capital Purchases</span>
                    <span className="text-[13px] font-semibold led-tnum text-[var(--led-ink)]">
                      {totalCapex !== null ? fmtCurrency(totalCapex) : '--'}
                    </span>
                  </div>
                </div>

                {/* Loan Commitments */}
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Loan Commitments</p>
                  <div className="grid grid-cols-[20px_1fr_100px_90px] gap-x-2 items-center text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--led-muted)] px-1">
                    <span>#</span><span>Description</span><span className="text-right">Monthly</span><span className="text-right">Annual</span>
                  </div>
                  {loanEntries.map((l, i) => (
                    <div key={i} className="grid grid-cols-[20px_1fr_100px_90px] gap-x-2 items-center">
                      <span className="text-[11px] text-[var(--led-muted)] text-center">{i + 1}</span>
                      <input
                        type="text"
                        value={l.description}
                        onChange={(ev) => setLoanEntries(prev => prev.map((x, j) => j === i ? { ...x, description: ev.target.value } : x))}
                        placeholder="Description"
                        className="rounded-[7px] border border-[var(--led-line)] bg-[var(--led-surface-2)] px-2 py-1.5 text-[12px] text-[var(--led-ink)] placeholder:text-[var(--led-muted)] focus:border-[var(--led-accent)] focus:outline-none"
                      />
                      <div className="relative">
                        <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-[11px] text-[var(--led-muted)]">$</span>
                        <input
                          type="number"
                          value={l.monthly}
                          onChange={(ev) => setLoanEntries(prev => prev.map((x, j) => j === i ? { ...x, monthly: ev.target.value } : x))}
                          placeholder="0"
                          className="w-full rounded-[7px] border border-[var(--led-line)] bg-[var(--led-surface-2)] py-1.5 pl-6 pr-2 text-[12px] font-medium led-tnum text-[var(--led-ink)] placeholder:text-[var(--led-muted)] focus:border-[var(--led-accent)] focus:outline-none"
                        />
                      </div>
                      <span className="text-right text-[12px] font-medium led-tnum text-[var(--led-ink)]">
                        {loanAnnuals[i] !== null ? fmtCurrency(loanAnnuals[i]!) : '--'}
                      </span>
                    </div>
                  ))}

                  {/* Proposed loan */}
                  <div className="grid grid-cols-[20px_1fr_100px_90px] gap-x-2 items-center border-t border-[var(--led-line)] pt-2">
                    <span className="text-[11px] font-semibold text-[var(--led-accent)] text-center">P</span>
                    <input
                      type="text"
                      value={proposedLoan.description}
                      onChange={(e) => setProposedLoan(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Proposed loan"
                      className="rounded-[7px] border border-[var(--led-line)] bg-[var(--led-surface-2)] px-2 py-1.5 text-[12px] text-[var(--led-ink)] placeholder:text-[var(--led-muted)] focus:border-[var(--led-accent)] focus:outline-none"
                    />
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-[11px] text-[var(--led-muted)]">$</span>
                      <input
                        type="number"
                        value={proposedLoan.monthly}
                        onChange={(e) => setProposedLoan(prev => ({ ...prev, monthly: e.target.value }))}
                        placeholder="0"
                        className="w-full rounded-[7px] border border-[var(--led-line)] bg-[var(--led-surface-2)] py-1.5 pl-6 pr-2 text-[12px] font-medium led-tnum text-[var(--led-ink)] placeholder:text-[var(--led-muted)] focus:border-[var(--led-accent)] focus:outline-none"
                      />
                    </div>
                    <span className="text-right text-[12px] font-medium led-tnum text-[var(--led-ink)]">
                      {proposedAnnual !== null ? fmtCurrency(proposedAnnual) : '--'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between border-t border-[var(--led-line)] pt-2">
                    <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[var(--led-muted)]">Total Annual Expenses</span>
                    <span className="text-[13px] font-semibold led-tnum text-[var(--led-ink)]">
                      {totalAnnualLoans !== null ? fmtCurrency(totalAnnualLoans) : '--'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Right: results */}
              <div className="space-y-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Servicing Result</p>

                <div className="space-y-3 rounded-[16px] border border-[var(--led-line)] bg-[var(--led-surface-2)] p-5">
                  <ResultRow label="Annual BAS Surplus" value={annualSurplus !== null ? fmtCurrency(annualSurplus) : '--'} />
                  {totalCapex !== null && totalCapex > 0 && (
                    <ResultRow label="+ Capital Purchases Add Back" value={fmtCurrency(totalCapex)} muted indent />
                  )}
                  {totalAnnualLoans !== null && (
                    <ResultRow label="− Total Annual Loan Expenses" value={fmtCurrency(totalAnnualLoans)} muted indent />
                  )}
                  <ResultDivider />
                  <ResultRow
                    label="BAS Servicing Capacity"
                    value={servSurplus !== null ? fmtCurrency(servSurplus) : '--'}
                    sub={servSurplus !== null
                      ? (servSurplus >= 0 ? 'Positive servicing capacity' : 'Negative — loan may not be serviceable')
                      : 'Complete collator and enter commitments'}
                  />
                </div>

                <CalcResultItem
                  label="BAS Servicing Capacity"
                  value={servSurplus !== null ? fmtCurrency(servSurplus) : '--'}
                  sub={servSurplus !== null ? (servSurplus >= 0 ? 'Positive servicing capacity' : 'Negative — loan may not be serviceable') : undefined}
                  signal={servSurplus !== null ? (servSurplus >= 0 ? 'positive' : 'negative') : 'neutral'}
                />
              </div>
            </div>
          </div>
        )}

        {/* ── Sales Analysis Tab ───────────────────────────────────────────── */}
        {tab === 'sales' && (
          <div className="space-y-6">
            <p className="text-[12px] text-[var(--led-muted)]">
              {mode === 'monthly'
                ? 'Monthly data aggregated into quarters (M1–M3 = Q1, etc.).'
                : 'Per-quarter revenue and expenditure breakdown.'}
              {totalCapex !== null && totalCapex > 0
                ? ` Capex (${fmtCurrency(totalCapex)}) distributed evenly across 4 quarters.`
                : ' Enter capital expenses in the Servicing tab to apply capex distribution.'}
            </p>

            <div className="overflow-x-auto rounded-[12px] border border-[var(--led-line)]">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <THeader sticky>Metric</THeader>
                    <THeader>Q1</THeader>
                    <THeader>Q2</THeader>
                    <THeader>Q3</THeader>
                    <THeader>Q4</THeader>
                  </tr>
                </thead>
                <tbody>
                  <TSectionRow label="Revenue" colSpan={5} />

                  <tr>
                    <TLabelCell>GST on Sales (1A)</TLabelCell>
                    {quarterlyPeriods.map((p, i) => <TCalcCell key={i} value={parseNum(p.gstOnSales)} />)}
                  </tr>

                  <tr className="bg-[var(--led-surface-2)]">
                    <TLabelCell><em>Total Revenue (1A × 10)</em></TLabelCell>
                    {quarterlyPeriods.map((p, i) => {
                      const v = parseNum(p.gstOnSales);
                      return <TCalcCell key={i} value={v !== null ? v * 10 : null} />;
                    })}
                  </tr>

                  <TSectionRow label="Expenditure" colSpan={5} />

                  <tr>
                    <TLabelCell>GST on Expenses (1B)</TLabelCell>
                    {quarterlyPeriods.map((p, i) => <TCalcCell key={i} value={parseNum(p.gstOnPurchases)} />)}
                  </tr>

                  <tr>
                    <TLabelCell><span className="text-[var(--led-muted)]">Capex (total ÷ 4)</span></TLabelCell>
                    {[0, 1, 2, 3].map(i => (
                      <TCalcCell key={i} value={totalCapex !== null && totalCapex > 0 ? capexPerQuarter : null} />
                    ))}
                  </tr>

                  <tr className="bg-[var(--led-surface-2)]">
                    <TLabelCell><em>Effective Expenses (1B − Capex)</em></TLabelCell>
                    {quarterlyPeriods.map((p, i) => {
                      const v = parseNum(p.gstOnPurchases);
                      return <TCalcCell key={i} value={v !== null ? v - capexPerQuarter : null} />;
                    })}
                  </tr>

                  <tr>
                    <TLabelCell>Wages (W1)</TLabelCell>
                    {quarterlyPeriods.map((p, i) => <TCalcCell key={i} value={parseNum(p.wages)} />)}
                  </tr>

                  <tr className="bg-[var(--led-surface-2)]">
                    <TLabelCell semibold><em>Total Expenditure (Eff. Exp × 10 + Wages)</em></TLabelCell>
                    {quarterlyPeriods.map((p, i) => {
                      const gstExp = parseNum(p.gstOnPurchases);
                      const wages = parseNum(p.wages);
                      if (gstExp === null || wages === null) return <TCalcCell key={i} value={null} />;
                      return <TCalcCell key={i} value={(gstExp - capexPerQuarter) * 10 + wages} />;
                    })}
                  </tr>

                  <TSectionRow label="Ratios" colSpan={5} />

                  <tr>
                    <TLabelCell>Expenses to Sales Ratio</TLabelCell>
                    {quarterlyPeriods.map((p, i) => {
                      const gstSales = parseNum(p.gstOnSales);
                      const gstExp = parseNum(p.gstOnPurchases);
                      const wages = parseNum(p.wages);
                      if (!gstSales || gstExp === null || wages === null) {
                        return <td key={i} className="border-b border-r border-[var(--led-line)] bg-[var(--led-surface-2)] px-3 py-2 text-right text-[12px] text-[var(--led-muted)] min-w-[110px]">--</td>;
                      }
                      const ratio = ((gstExp - capexPerQuarter) * 10 + wages) / (gstSales * 10);
                      return (
                        <td key={i} className="border-b border-r border-[var(--led-line)] bg-[var(--led-surface-2)] px-3 py-2 text-right text-[12px] font-medium led-tnum text-[var(--led-ink)] min-w-[110px]">
                          {fmtRatio(ratio)}
                        </td>
                      );
                    })}
                  </tr>

                  <tr>
                    <TLabelCell semibold>Profit Ratio</TLabelCell>
                    {quarterlyPeriods.map((p, i) => {
                      const gstSales = parseNum(p.gstOnSales);
                      const gstExp = parseNum(p.gstOnPurchases);
                      const wages = parseNum(p.wages);
                      if (!gstSales || gstExp === null || wages === null) {
                        return <td key={i} className="border-b border-r border-[var(--led-line)] bg-[var(--led-surface-2)] px-3 py-2 text-right text-[12px] text-[var(--led-muted)] min-w-[110px]">--</td>;
                      }
                      const profitRatio = 1 - ((gstExp - capexPerQuarter) * 10 + wages) / (gstSales * 10);
                      const color = profitRatio >= 0.3 ? 'text-[var(--led-success)]'
                        : profitRatio >= 0.1 ? 'text-[var(--led-warning)]'
                        : 'text-[var(--led-danger,#ef4444)]';
                      return (
                        <td key={i} className={`border-b border-r border-[var(--led-line)] bg-[var(--led-surface-2)] px-3 py-2 text-right text-[12px] font-semibold led-tnum min-w-[110px] ${color}`}>
                          {fmtRatio(profitRatio)}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="text-[11px] text-[var(--led-muted)]">
              Any significant quarter-to-quarter changes should be noted in credit notes.
            </p>
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

export interface PayCalcState {
  salary: string;
  cycle: PayCycle;
  includesSuper: boolean;
  superRate: string;
  sacrificeAmount: string;
  sacrificeFreq: SacrificeFreq;
  studentLoan: boolean;
  medicareExemption: MedicareExemption;
  deductions: string;
}

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

export function PayCalculator({ initialState, onStateChange }: {
  initialState?: PayCalcState;
  onStateChange?: (s: PayCalcState) => void;
} = {}) {
  const _onSC = useRef(onStateChange);
  useEffect(() => { _onSC.current = onStateChange; });

  const [salary, setSalary] = useState(initialState?.salary ?? '');
  const [cycle, setCycle] = useState<PayCycle>(initialState?.cycle ?? 'annual');
  const [includesSuper, setIncludesSuper] = useState(initialState?.includesSuper ?? false);
  const [superRate, setSuperRate] = useState(initialState?.superRate ?? '12');
  const [sacrificeAmount, setSacrificeAmount] = useState(initialState?.sacrificeAmount ?? '');
  const [sacrificeFreq, setSacrificeFreq] = useState<SacrificeFreq>(initialState?.sacrificeFreq ?? 'annual');
  const [studentLoan, setStudentLoan] = useState(initialState?.studentLoan ?? false);
  const [medicareExemption, setMedicareExemption] = useState<MedicareExemption>(initialState?.medicareExemption ?? 'none');
  const [deductions, setDeductions] = useState(initialState?.deductions ?? '');

  useEffect(() => {
    _onSC.current?.({ salary, cycle, includesSuper, superRate, sacrificeAmount, sacrificeFreq, studentLoan, medicareExemption, deductions });
  }, [salary, cycle, includesSuper, superRate, sacrificeAmount, sacrificeFreq, studentLoan, medicareExemption, deductions]);

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
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Deductions &amp; Offsets</p>
            <CalcInput label="Annual Deductions" value={deductions} onChange={setDeductions} prefix="$" hint="Tax deductions, work expenses, etc." />
            <CalcSelect label="Medicare Levy" value={medicareExemption} onChange={(v) => setMedicareExemption(v as MedicareExemption)} options={medicareOptions} />
            <CalcToggle label="HELP / HECS student loan" checked={studentLoan} onChange={setStudentLoan} />
          </div>
        </div>

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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
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

export interface RatiosCalcState {
  totalAssets: string; inventory: string; totalLiabilities: string; shareholderEquity: string;
  ebitda: string; ebit: string; totalInterestExpense: string; totalDebt: string;
  annualLoanRepayments: string; accountsReceivable: string; creditSales: string;
  averageDailySales: string; costOfGoodsSold: string; averageInventory: string;
  loanAmount: string; assetValue: string;
}

type RatioSignal = 'good' | 'warn' | 'bad' | 'neutral';

interface RatioCard {
  label: string;
  value: number | null;
  format: 'x' | 'days' | 'pct';
  signal: RatioSignal;
  hint: string;
}

function ratioSignal(value: number | null, goodAbove?: number, warnAbove?: number): RatioSignal {
  if (value === null) return 'neutral';
  if (goodAbove !== undefined && value >= goodAbove) return 'good';
  if (warnAbove !== undefined && value >= warnAbove) return 'warn';
  return 'bad';
}

function ratioSignalBelow(value: number | null, goodBelow?: number, warnBelow?: number): RatioSignal {
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

export function RatiosCalculator({ initialState, onStateChange }: {
  initialState?: RatiosCalcState;
  onStateChange?: (s: RatiosCalcState) => void;
} = {}) {
  const _onSC = useRef(onStateChange);
  useEffect(() => { _onSC.current = onStateChange; });

  const [f, setF] = useState<RatiosCalcState>(initialState ?? {
    totalAssets: '', inventory: '', totalLiabilities: '', shareholderEquity: '',
    ebitda: '', ebit: '', totalInterestExpense: '', totalDebt: '', annualLoanRepayments: '',
    accountsReceivable: '', creditSales: '', averageDailySales: '',
    costOfGoodsSold: '', averageInventory: '', loanAmount: '', assetValue: '',
  });

  useEffect(() => {
    _onSC.current?.(f);
  }, [f]);

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
    { label: 'Current Ratio', value: currentRatio, format: 'x', signal: ratioSignal(currentRatio, 2, 1), hint: '>2 strong · 1–2 adequate · <1 concern' },
    { label: 'Quick Ratio', value: quickRatio, format: 'x', signal: ratioSignal(quickRatio, 1, 0.5), hint: '>1 good · <0.5 liquidity concern' },
    { label: 'Debt to Income', value: debtToIncome, format: 'x', signal: ratioSignalBelow(debtToIncome, 2, 4), hint: '<2 low · 2–4 moderate · >4 high' },
    { label: 'Debt to Equity', value: debtToEquity, format: 'x', signal: ratioSignalBelow(debtToEquity, 1, 2), hint: '<1 low · 1–2 moderate · >2 high leverage' },
    { label: 'DSCR', value: dscr, format: 'x', signal: ratioSignal(dscr, 1.25, 1), hint: '>1.25 healthy · <1 cannot service debt' },
    { label: 'Interest Coverage', value: interestCoverage, format: 'x', signal: ratioSignal(interestCoverage, 3, 1.5), hint: '>3 comfortable · <1.5 concern' },
    { label: 'Gross Debt / EBITDA', value: grossDebtToEbitda, format: 'x', signal: ratioSignalBelow(grossDebtToEbitda, 3, 5), hint: '<3 low · 3–5 moderate · >5 high' },
    { label: 'Days Sales Outstanding', value: dso, format: 'days', signal: 'neutral', hint: 'Lower is better (industry dependent)' },
    { label: 'Inventory Turnover', value: inventoryTurnover, format: 'x', signal: 'neutral', hint: 'Higher is better (industry dependent)' },
    { label: 'Aged Receivables', value: agedReceivables, format: 'days', signal: 'neutral', hint: 'Lower indicates faster collection' },
    { label: 'Loan to Value Ratio', value: lvr, format: 'pct', signal: ratioSignalBelow(lvr, 80, 90), hint: '<80% standard · >80% LMI may apply' },
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
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Credit &amp; Financial Analysis</p>
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
  const [topTab, setTopTab] = useTabParam<TopTab>('bas', ['bas', 'pay', 'ratios']);

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
        <h1 className="text-[26px] sm:text-[34px] font-semibold tracking-[-0.05em] text-[var(--led-ink)]">Calculators</h1>
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
