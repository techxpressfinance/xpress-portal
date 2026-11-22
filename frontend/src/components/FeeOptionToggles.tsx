import {
  financedState,
  gstSplit,
  isBrokerageFinanced,
  isFeeFinanced,
  isFeeGstInclusive,
  withAllFeesFinanced,
  withFeeOption,
  type FeeKey,
  type FeeOptionInputs,
} from '../lib/feeOptions';

const money = (n: number) => `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A two-way switch small enough to sit under a field. */
function Switch({ value, options, onChange, label }: {
  value: boolean;
  options: [string, string]; // [label when true, label when false]
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <div className="inline-flex rounded-md border border-border/60 p-px" role="radiogroup" aria-label={label}>
      {[true, false].map((v, i) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`rounded px-1.5 py-0.5 text-[10.5px] font-semibold transition-colors ${value === v ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {options[i]}
        </button>
      ))}
    </div>
  );
}

/** Under one fee: was it typed inc or ex GST (display only — the repayment
 *  uses the figure as typed), and is it financed into the loan or paid up
 *  front. Shows the other side of the GST. */
export default function FeeOptionToggles<T extends FeeOptionInputs>({ inputs, fee, onChange, gstPercent = 10 }: {
  inputs: T;
  fee: FeeKey;
  onChange: (next: T) => void;
  gstPercent?: number;
}) {
  const amount = inputs[fee] || 0;
  const inclusive = isFeeGstInclusive(inputs, fee);
  const financed = isFeeFinanced(inputs, fee);
  const split = gstSplit(amount, inclusive, gstPercent);
  return (
    <div className="mt-1 space-y-1">
      <div className="flex flex-wrap gap-1">
        <Switch label="GST" value={inclusive} options={['Inc GST', 'Ex GST']} onChange={(v) => onChange(withFeeOption(inputs, 'fee_gst_inclusive', fee, v))} />
        <Switch label="Financed in" value={financed} options={['Financed', 'Upfront']} onChange={(v) => onChange(withFeeOption(inputs, 'fee_financed', fee, v))} />
      </div>
      {amount > 0 && (
        <p className="text-[10.5px] text-muted-foreground tabular-nums">
          {inclusive ? `${money(split.ex)} ex + ${money(split.gst)} GST` : `${money(split.inc)} inc GST`}
          {financed ? '' : ' · paid separately'}
        </p>
      )}
    </div>
  );
}

/** Brokerage financed into the loan (the usual) or paid separately. Its GST is
 *  the existing "GST on brokerage" switch beside it. */
export function BrokerageFinancedToggle<T extends FeeOptionInputs>({ inputs, onChange, labelClassName }: {
  inputs: T;
  onChange: (next: T) => void;
  labelClassName: string;
}) {
  const financed = isBrokerageFinanced(inputs);
  return (
    <div>
      <label className={labelClassName}>Brokerage financed in</label>
      <div className="h-9 flex items-center">
        <Switch label="Brokerage financed in" value={financed} options={['Yes — in the loan', 'No — separate']} onChange={(v) => onChange({ ...inputs, brokerage_financed: v })} />
      </div>
    </div>
  );
}

/** The sheet-wide fees switch, which now also shows when fees are mixed. */
export function FeesFinancedSummary<T extends FeeOptionInputs>({ inputs, onChange, labelClassName, selectClassName }: {
  inputs: T;
  onChange: (next: T) => void;
  labelClassName: string;
  selectClassName: string;
}) {
  const state = financedState(inputs);
  return (
    <div>
      <label className={labelClassName}>Fees Treatment</label>
      <select
        value={state}
        onChange={(e) => { if (e.target.value !== 'mixed') onChange(withAllFeesFinanced(inputs, e.target.value === 'all')); }}
        className={selectClassName}
      >
        <option value="all">All financed (added to loan)</option>
        <option value="none">All non-financed (separate)</option>
        {state === 'mixed' && <option value="mixed">Mixed — set per fee</option>}
      </select>
    </div>
  );
}
