// Per-fee choices on lender pricing and client quotes. Lenders differ in how
// they build a repayment — one finances its establishment fee but takes the VIR
// up front, another the reverse — so each fee says on its own whether it is
// financed into the loan. Each also says whether the figure typed includes GST:
// a display/entry choice only (the repayment maths uses the figure as typed);
// the private ledger reads it to keep its income lines ex GST.
//
// Stored in the sheet's input_parameters blob. Sheets saved before these
// existed have neither map and follow the one `fees_financed` switch.

export type FeeKey = 'establishment_fee' | 'ppsr_fee' | 'origination_fee' | 'vir_fee';
export const FEE_KEYS: FeeKey[] = ['establishment_fee', 'ppsr_fee', 'origination_fee', 'vir_fee'];

export interface FeeOptionInputs {
  establishment_fee: number;
  ppsr_fee: number;
  origination_fee: number;
  vir_fee: number;
  /** The sheet-wide default every fee without its own choice follows. */
  fees_financed: boolean;
  fee_financed?: Partial<Record<FeeKey, boolean>>;
  fee_gst_inclusive?: Partial<Record<FeeKey | 'brokerage', boolean>>;
  /** Brokerage financed into the loan (the default) or paid separately. */
  brokerage_financed?: boolean;
}

export const isFeeFinanced = (inputs: FeeOptionInputs, key: FeeKey): boolean =>
  inputs.fee_financed?.[key] ?? inputs.fees_financed;

export const isFeeGstInclusive = (inputs: FeeOptionInputs, key: FeeKey): boolean =>
  inputs.fee_gst_inclusive?.[key] === true;

export const isBrokerageFinanced = (inputs: FeeOptionInputs): boolean => inputs.brokerage_financed !== false;

/** All fees, the part financed into the loan, and the part paid up front. */
export function feeTotals(inputs: FeeOptionInputs) {
  let financed = 0;
  let upfront = 0;
  for (const k of FEE_KEYS) {
    const v = inputs[k] || 0;
    if (isFeeFinanced(inputs, k)) financed += v;
    else upfront += v;
  }
  return { total: financed + upfront, financed, upfront };
}

/** Every fee financed, none, or a mix — for labels like "(sep.)". */
export function financedState(inputs: FeeOptionInputs): 'all' | 'none' | 'mixed' {
  const charged = FEE_KEYS.filter((k) => (inputs[k] || 0) > 0);
  const keys = charged.length ? charged : FEE_KEYS;
  const on = keys.filter((k) => isFeeFinanced(inputs, k)).length;
  return on === keys.length ? 'all' : on === 0 ? 'none' : 'mixed';
}

/** The other side of a typed figure: what it is ex GST, its GST, inc GST. */
export function gstSplit(amount: number, inclusive: boolean, gstPercent = 10) {
  const rate = gstPercent / 100;
  const ex = inclusive ? amount / (1 + rate) : amount;
  const round = (n: number) => Math.round(n * 100) / 100;
  return { ex: round(ex), gst: round(ex * rate), inc: round(ex * (1 + rate)) };
}

/** Set one fee's choice, leaving the rest as they are. */
export function withFeeOption<T extends FeeOptionInputs>(
  inputs: T, map: 'fee_financed' | 'fee_gst_inclusive', key: FeeKey, value: boolean,
): T {
  return { ...inputs, [map]: { ...(inputs[map] ?? {}), [key]: value } };
}

/** The sheet-wide switch: every fee financed (or not), per-fee choices cleared. */
export function withAllFeesFinanced<T extends FeeOptionInputs>(inputs: T, financed: boolean): T {
  return { ...inputs, fees_financed: financed, fee_financed: {} };
}
