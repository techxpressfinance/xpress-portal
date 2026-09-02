/**
 * ACN and ABN check-digit validation.
 *
 * Both numbers carry their own checksum, and a company's ABN ends in its ACN, so
 * a typo is catchable in the browser without asking anyone. That matters because
 * ASIC's company register has no per-record API to confirm the company against —
 * this is the whole of what we can verify offline.
 *
 * NOTE: backend copy at backend/app/services/acn.py — keep in sync.
 */

/** ACN: the ninth digit is a complement check digit over the first eight. */
const ACN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 1];
/** ABN: subtract 1 from the leading digit, then the weighted sum is divisible by 89. */
const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

/**
 * Entity types whose ABN is issued against their own ACN, so the two must agree.
 * A trust may *record* an ACN — its corporate trustee's — which its own ABN does
 * not encode, so a trust is deliberately not cross-checked.
 */
export const ACN_BEARING_ENTITY_TYPES: readonly string[] = ['company', 'trustee'];

export const digitsOnly = (value: string | null | undefined): string =>
  (value || '').replace(/\D/g, '');

/** Strip formatting. Returns '' for blank input; does not validate. */
export const normalizeAcn = (value: string | null | undefined): string => digitsOnly(value);

/** True when `value` is nine digits with a correct check digit. */
export function isValidAcn(value: string | null | undefined): boolean {
  const d = digitsOnly(value);
  if (d.length !== 9) return false;
  const total = ACN_WEIGHTS.reduce((sum, w, i) => sum + Number(d[i]) * w, 0);
  return (10 - (total % 10)) % 10 === Number(d[8]);
}

/** True when `value` is eleven digits satisfying the ABN modulus-89 check. */
export function isValidAbn(value: string | null | undefined): boolean {
  const d = digitsOnly(value);
  if (d.length !== 11) return false;
  const total = ABN_WEIGHTS.reduce(
    (sum, w, i) => sum + (i === 0 ? Number(d[0]) - 1 : Number(d[i])) * w,
    0,
  );
  return total % 89 === 0;
}

/** 051775556 -> "051 775 556" (the way an ACN is written down). */
export function formatAcn(value: string | null | undefined): string {
  const d = digitsOnly(value);
  return d.length === 9 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : value || '';
}

/** 51824753556 -> "51 824 753 556" (the way an ABN is written down). */
export function formatAbn(value: string | null | undefined): string {
  const d = digitsOnly(value);
  return d.length === 11
    ? `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`
    : value || '';
}

/**
 * A company's ABN is two check digits followed by its nine-digit ACN, so the ACN
 * reads straight off it. Returns null unless the ABN itself is valid — a mistyped
 * ABN would otherwise yield a confident, wrong ACN.
 *
 * The caller decides whether the entity *has* an ACN: a trust, partnership or
 * sole trader's ABN is not built from one. See `ACN_BEARING_ENTITY_TYPES`.
 */
export function acnFromAbn(abn: string | null | undefined): string | null {
  if (!isValidAbn(abn)) return null;
  return digitsOnly(abn).slice(2);
}

/**
 * Whether `abn`'s embedded ACN matches `acn`. Returns null when the question
 * can't be answered — either number missing or malformed — so a caller can tell
 * "disagree" from "nothing to compare".
 */
export function abnEncodesAcn(
  abn: string | null | undefined,
  acn: string | null | undefined,
): boolean | null {
  const derived = acnFromAbn(abn);
  const normalized = normalizeAcn(acn);
  if (!derived || !normalized || !isValidAcn(normalized)) return null;
  return derived === normalized;
}

/**
 * Explain what's wrong with an ACN, or null if it's fine. Blank is fine — an ACN
 * is optional everywhere it's captured. The ABN cross-check only runs for entity
 * types that carry their own ACN.
 */
export function acnValidationError(
  acn: string | null | undefined,
  abn?: string | null,
  entityType?: string | null,
): string | null {
  const normalized = normalizeAcn(acn);
  if (!normalized) return null;
  if (normalized.length !== 9) return `An ACN is 9 digits — got ${normalized.length}`;
  if (!isValidAcn(normalized)) return "That ACN's check digit doesn't match — it looks like a typo";
  if (
    entityType &&
    ACN_BEARING_ENTITY_TYPES.includes(entityType) &&
    abnEncodesAcn(abn, normalized) === false
  ) {
    return `This ACN doesn't match the ABN — a company's ABN ends in its ACN, so the ABN given implies ACN ${formatAcn(acnFromAbn(abn))}`;
  }
  return null;
}

/** Explain what's wrong with an ABN, or null if it's fine. Blank is fine. */
export function abnValidationError(abn: string | null | undefined): string | null {
  const d = digitsOnly(abn);
  if (!d) return null;
  if (d.length !== 11) return `An ABN is 11 digits — got ${d.length}`;
  if (!isValidAbn(d)) return "That ABN's check digit doesn't match — it looks like a typo";
  return null;
}
