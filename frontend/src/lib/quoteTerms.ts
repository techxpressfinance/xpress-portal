// Quote-sheet loan terms.
//
// Terms are stored in MONTHS everywhere (balloon map keys, selected_terms,
// preferred_term, QuoteOption.loan_term_months) so a broker can quote any term
// — 18 months, 19 months — not just whole years. Sheets saved before custom
// terms existed stored YEARS ("2", "3", 5 …); `migrateQuoteParams` converts
// those on read and stamps `terms_in_months` so it only happens once.

// Standard terms in display order (increasing: 1 through 7 years).
export const STANDARD_TERM_MONTHS = [12, 24, 36, 48, 60, 72, 84];

export const MIN_TERM_MONTHS = 1;
export const MAX_TERM_MONTHS = 120;

/** "5 Year" / "18 Month" */
export const termLabel = (months: number): string =>
  months % 12 === 0 ? `${months / 12} Year` : `${months} Month`;

/** "5yr" / "18mo" */
export const termLabelShort = (months: number): string =>
  months % 12 === 0 ? `${months / 12}yr` : `${months}mo`;

// ATO minimum residual values for vehicle leases, by whole-year term. The ATO
// publishes 1–5yr; 6yr/7yr continue the same ~9.375%-per-year line.
const STANDARD_RESIDUAL_BY_YEAR: Record<number, number> = {
  1: 65.63,
  2: 56.25,
  3: 46.88,
  4: 37.5,
  5: 28.13,
  6: 18.75,
  7: 9.38,
};

/**
 * Standard residual for any term: whole years come straight off the ATO table,
 * in-between months (e.g. 18) are linearly interpolated between neighbours.
 */
export function standardResidualPercent(months: number): number {
  const years = months / 12;
  if (years <= 1) return STANDARD_RESIDUAL_BY_YEAR[1];
  if (years >= 7) return STANDARD_RESIDUAL_BY_YEAR[7];
  const lo = Math.floor(years);
  const hi = Math.ceil(years);
  if (lo === hi) return STANDARD_RESIDUAL_BY_YEAR[lo];
  const v = STANDARD_RESIDUAL_BY_YEAR[lo]
    + (STANDARD_RESIDUAL_BY_YEAR[hi] - STANDARD_RESIDUAL_BY_YEAR[lo]) * (years - lo);
  return Math.round(v * 100) / 100;
}

/** Standard terms first (increasing order), then custom terms ascending. */
export function sortTerms(months: number[]): number[] {
  return [...months].sort((a, b) => {
    const ai = STANDARD_TERM_MONTHS.indexOf(a);
    const bi = STANDARD_TERM_MONTHS.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a - b;
  });
}

/** Distinct terms (months) quoted by a sheet's options, in display order. */
export function optionTermMonths(options: { loan_term_months: number | null }[]): number[] {
  return sortTerms([...new Set(options.map(o => o.loan_term_months ?? 0))].filter(m => m > 0));
}

// Rekey a per-term map whose keys are years ("2") to months ("24").
function rekeyToMonths(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const years = Number(key);
    out[Number.isFinite(years) ? String(Math.round(years * 12)) : key] = val;
  }
  return out;
}

/**
 * Normalise a parsed `input_parameters` blob to month-based terms. Idempotent —
 * anything already carrying `terms_in_months` is returned untouched.
 */
export function migrateQuoteParams<T extends Record<string, unknown>>(params: T): T {
  if (!params || params.terms_in_months === true) return params;
  const out: Record<string, unknown> = { ...params, terms_in_months: true };
  if (params.balloon_percentages) out.balloon_percentages = rekeyToMonths(params.balloon_percentages);
  if (params.balloon_amounts) out.balloon_amounts = rekeyToMonths(params.balloon_amounts);
  if (Array.isArray(params.selected_terms)) {
    out.selected_terms = (params.selected_terms as unknown[])
      .map(t => Math.round(Number(t) * 12))
      .filter(t => Number.isFinite(t));
  }
  if (typeof params.preferred_term === 'number') {
    out.preferred_term = Math.round(params.preferred_term * 12);
  }
  return out as T;
}
