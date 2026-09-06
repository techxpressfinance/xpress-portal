// Residency status is stored as a free-text column and the forms that write it
// grew apart — "Temporary Visa" on the client form, "Temporary Resident" on the
// referrer form, snake_case codes on the public form. New writes use the labels
// below; `isVisaHolder` and `normalizeResidencyStatus` keep the older values
// working so existing applications still show (and edit) their visa details.

export const RESIDENCY_STATUSES = [
  'Australian Citizen',
  'Permanent Resident',
  'Visa Holder',
  'Other',
] as const;

export type ResidencyStatus = (typeof RESIDENCY_STATUSES)[number];

/** Australian visa subclasses a broker is likely to see on an application. */
export const VISA_CATEGORIES = [
  'Skilled Independent (189)',
  'Skilled Nominated (190)',
  'Skilled Work Regional (491)',
  'Employer Nomination Scheme (186)',
  'Skilled Employer Sponsored Regional (494)',
  'Temporary Skill Shortage (482)',
  'Temporary Graduate (485)',
  'Student (500)',
  'Partner (820/801)',
  'Partner — offshore (309/100)',
  'Business Innovation and Investment (188)',
  'Working Holiday (417/462)',
  'Visitor (600)',
  'Bridging visa',
  'Special Category — NZ (444)',
  'Other',
] as const;

/** True when the status means the applicant holds a visa, legacy labels included. */
export function isVisaHolder(status?: string | null): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return s.includes('visa') || s.includes('temporary');
}

/** Map any stored status onto one of RESIDENCY_STATUSES so pickers can match it. */
export function normalizeResidencyStatus(status?: string | null): string {
  if (!status) return '';
  const s = status.toLowerCase();
  if (s.includes('citizen') && !s.includes('nz') && !s.includes('new zealand')) return 'Australian Citizen';
  if (s.includes('permanent')) return 'Permanent Resident';
  if (isVisaHolder(s)) return 'Visa Holder';
  return (RESIDENCY_STATUSES as readonly string[]).includes(status) ? status : 'Other';
}
