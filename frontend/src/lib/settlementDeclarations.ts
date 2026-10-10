// The two declarations a client signs at settlement: the early termination
// declaration (every deal) and the balloon payout declaration (only when the
// structure written carries a balloon).
//
// The term and balloon come from the application's lender pricing. Only the
// broker's choices are stored (on the application, as JSON): which pricing and
// structure, the application number, the payoff strategy, the broker named in
// the wording and who signs.
import type { LoanApplication, QuoteSheet } from '../types';
import { applicantDisplayName, applicantName, isCompanyApplicant } from './applicantName';
import { parseDirectDebitSettings, pickPricingSheet } from './directDebit';
import { fmtCurrency, parseLenderPricingInputs } from './lenderPricing';

export interface DeclarationSettings {
  /** The lender pricing it is drawn from; null = the direct debit request's, else the latest. */
  pricing_sheet_id: string | null;
  /** Which structure was written; null = the direct debit request's, else with the balloon when one is priced. */
  with_balloon: boolean | null;
  /** null = the application's own APP- reference. */
  application_number: string | null;
  /** null = the template's wording. */
  payoff_strategy: string | null;
  /** null = the application's assigned broker. */
  broker_name: string | null;
  /** null = the applicant and the other parties on the application. */
  signatories: string[] | null;
}

export const DECLARATION_DEFAULTS: DeclarationSettings = {
  pricing_sheet_id: null,
  with_balloon: null,
  application_number: null,
  payoff_strategy: null,
  broker_name: null,
  signatories: null,
};

export const DEFAULT_PAYOFF_STRATEGY =
  'To trade in the asset/vehicle and upgrade to a new/used asset at the end of the term of the loan.';

export function parseDeclarationSettings(application: Pick<LoanApplication, 'settlement_declarations'>): DeclarationSettings {
  if (!application.settlement_declarations) return { ...DECLARATION_DEFAULTS };
  try {
    const saved = JSON.parse(application.settlement_declarations) as Partial<DeclarationSettings>;
    return { ...DECLARATION_DEFAULTS, ...saved, signatories: Array.isArray(saved.signatories) ? saved.signatories : null };
  } catch {
    return { ...DECLARATION_DEFAULTS };
  }
}

/** "5 years" for whole years, otherwise "54 months". */
export function termLabel(months: number | null): string {
  if (!months) return '';
  if (months % 12 === 0) return `${months / 12} year${months === 12 ? '' : 's'}`;
  return `${months} months`;
}

/** Everyone who signs: the applicant (when a person) and the other parties. */
export function defaultSignatories(application: LoanApplication): string[] {
  const names = [
    isCompanyApplicant(application) ? '' : applicantName(application),
    ...(application.additional_applicants ?? []).map((p) =>
      [p.applicant_first_name, p.applicant_last_name].filter(Boolean).join(' ')),
  ].filter(Boolean);
  const unique = [...new Set(names)];
  return unique.length > 0 ? unique : [''];
}

export interface Declarations {
  sheet: QuoteSheet;
  applicationName: string;
  applicationNumber: string;
  /** "5 years" */
  term: string;
  hasBalloonOption: boolean;
  withBalloon: boolean;
  balloonAmount: number;
  /** null when the balloon was entered in dollars rather than as a %. */
  balloonPercent: number | null;
  /** "30% - $12,000.00" / "$12,000.00" / "$0.00" — the header line. */
  balloonLine: string;
  /** "30% ($12,000.00)" / "$12,000.00" / "NIL" — inside the wording. */
  balloonPhrase: string;
  /** "NA" on a deal with no balloon. */
  payoffStrategy: string;
  brokerName: string;
  signatories: string[];
}

export function buildDeclarations(
  quoteSheets: QuoteSheet[],
  settings: DeclarationSettings,
  application: LoanApplication,
): Declarations | null {
  // The same pricing and structure as the direct debit request unless the
  // broker picks otherwise here — both describe the one contract.
  const debit = parseDirectDebitSettings(application);
  const sheet = pickPricingSheet(quoteSheets, {
    ...debit,
    pricing_sheet_id: settings.pricing_sheet_id ?? debit.pricing_sheet_id,
  });
  if (!sheet) return null;

  const inputs = parseLenderPricingInputs(sheet);
  const options = [...sheet.options].sort((a, b) => a.sort_order - b.sort_order);
  const balloonOption = options.find((o) => (o.balloon_residual ?? 0) > 0);
  const withBalloon = balloonOption != null && (settings.with_balloon ?? debit.with_balloon ?? true);
  const balloonAmount = withBalloon ? (balloonOption?.balloon_residual ?? 0) : 0;
  const balloonPercent = withBalloon && inputs.balloon_amount == null && inputs.balloon_percent > 0
    ? inputs.balloon_percent
    : null;
  const months = inputs.term_months ?? options[0]?.loan_term_months ?? null;

  const dollars = fmtCurrency(balloonAmount);
  return {
    sheet,
    applicationName: applicantDisplayName(application),
    applicationNumber: settings.application_number
      ?? `APP-${application.id.replace(/-/g, '').slice(-6).toUpperCase()}`,
    term: termLabel(months),
    hasBalloonOption: balloonOption != null,
    withBalloon,
    balloonAmount,
    balloonPercent,
    balloonLine: balloonPercent != null ? `${balloonPercent}% - ${dollars}` : dollars,
    balloonPhrase: !withBalloon ? 'NIL' : balloonPercent != null ? `${balloonPercent}% (${dollars})` : dollars,
    payoffStrategy: withBalloon ? (settings.payoff_strategy ?? DEFAULT_PAYOFF_STRATEGY) : 'NA',
    brokerName: (settings.broker_name ?? application.assigned_broker_name ?? '').trim(),
    // A saved list of only blank names (an earlier save before the applicant was
    // known) must not mask the applicant's name.
    signatories: settings.signatories?.some((n) => n.trim())
      ? settings.signatories
      : defaultSignatories(application),
  };
}
