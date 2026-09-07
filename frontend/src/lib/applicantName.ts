/**
 * Naming the applicant on an application.
 *
 * `user_name` is the application's *owner*, not necessarily its applicant. A
 * client-owned application is the only case where the two are the same: staff
 * created applications (entity-first commercial, broker drafts) are owned by the
 * broker or admin who created them, and referrer leads are owned by the referrer.
 * Falling back to `user_name` there printed the creator's own name in the
 * Applicant column of every list, board and detail header.
 */

export interface ApplicantNameFields {
  applicant_type?: 'individual' | 'company' | null;
  applicant_title?: string | null;
  applicant_first_name?: string | null;
  applicant_middle_name?: string | null;
  applicant_last_name?: string | null;
  business_name?: string | null;
  user_name?: string | null;
  user_role?: string | null;
}

/** Roles that hold applications on someone else's behalf. */
const NON_APPLICANT_ROLES = new Set(['admin', 'broker', 'referrer', 'super_admin']);

/** True when the borrowing entity itself is the applicant, not a person. */
export function isCompanyApplicant(app: ApplicantNameFields): boolean {
  return app.applicant_type === 'company';
}

/**
 * The applicant's name as entered on the form, falling back to the account
 * holder only when a client owns the application. `''` when unknown.
 *
 * On a company application the entity is the applicant, so its name is returned
 * directly — there is no natural person to fall back through.
 */
export function applicantName(
  app: ApplicantNameFields,
  opts: { withTitle?: boolean } = {},
): string {
  if (isCompanyApplicant(app)) return app.business_name || '';
  const formName = [
    opts.withTitle ? app.applicant_title : null,
    app.applicant_first_name,
    opts.withTitle ? app.applicant_middle_name : null,
    app.applicant_last_name,
  ].filter(Boolean).join(' ');
  if (formName) return formName;
  if (app.user_name && !NON_APPLICANT_ROLES.has(app.user_role || '')) return app.user_name;
  return '';
}

/**
 * The applicant's name for display, falling back to the borrowing entity —
 * an entity-first commercial application has no natural person on it until a
 * director is added, and the company is the meaningful label until then.
 */
export function applicantDisplayName(app: ApplicantNameFields, fallback = ''): string {
  return applicantName(app) || app.business_name || fallback;
}

/**
 * The applicant's email, falling back to the account holder's only when a
 * client owns the application. Keeps a broker's own address off exported PDFs
 * of the applications they created.
 */
export function applicantEmail(
  app: ApplicantNameFields & { applicant_email?: string | null; user_email?: string | null },
): string | null {
  if (app.applicant_email) return app.applicant_email;
  // A company applicant has no personal inbox — its directors are contacted
  // individually as parties, so never borrow the owner's address here.
  if (isCompanyApplicant(app)) return null;
  if (app.user_email && !NON_APPLICANT_ROLES.has(app.user_role || '')) return app.user_email;
  return null;
}

/** The minimum of a party row (director / signatory) needed to name it. */
export interface PartyNameFields {
  is_primary?: boolean;
  applicant_first_name?: string | null;
  applicant_last_name?: string | null;
  applicant_email?: string | null;
  invite_email?: string | null;
}

export interface CounterpartFields extends ApplicantNameFields {
  additional_applicants?: PartyNameFields[] | null;
  pending_business_link?: { contact_name?: string | null } | null;
  trading_name?: string | null;
}

/** The other side of the application's headline name. */
export interface ApplicantCounterpart {
  /** 'person' when naming a director/contact behind an entity applicant,
   *  'entity' when naming the business behind an individual applicant. */
  kind: 'person' | 'entity';
  name: string;
  /** Further parties not named here, for a "+2" suffix. 0 when there are none. */
  extra: number;
}

function partyName(party: PartyNameFields): string {
  return [party.applicant_first_name, party.applicant_last_name].filter(Boolean).join(' ');
}

/**
 * The counterpart to the name a list or card already shows: the person behind a
 * company applicant, or the company behind an individual one.
 *
 * A card showing only "Acme Pty Ltd" tells a broker nothing about who they ring,
 * and one showing only "Jane Smith" hides which entity is borrowing — so
 * whichever side `applicantDisplayName` prints, this returns the other.
 *
 * Returns null when there is no counterpart, or when it would merely repeat the
 * headline name (an entity-first application with no director added yet shows
 * the entity in both places).
 */
export function applicantCounterpart(app: CounterpartFields): ApplicantCounterpart | null {
  const headline = applicantDisplayName(app);

  if (isCompanyApplicant(app)) {
    // The entity is borrowing; its directors are the people behind it. Prefer
    // the primary, then anyone with a name, then whoever was merely invited.
    const parties = app.additional_applicants || [];
    const named = parties.filter((p) => partyName(p));
    const pick = named.find((p) => p.is_primary) || named[0];
    const name = (pick && partyName(pick))
      // Legacy applicant-first apps flipped to 'company' keep an inline person.
      || [app.applicant_first_name, app.applicant_last_name].filter(Boolean).join(' ')
      || app.pending_business_link?.contact_name
      || (parties[0]?.applicant_email || parties[0]?.invite_email)
      || (app.user_name && !NON_APPLICANT_ROLES.has(app.user_role || '') ? app.user_name : '');
    if (!name || name === headline) return null;
    // Everyone bar the one named — the count is of parties, not just named ones,
    // since an invited-but-unfilled director is still a party on the deal.
    return { kind: 'person', name, extra: Math.max(parties.length - 1, 0) };
  }

  const entity = app.business_name || app.trading_name || '';
  if (!entity || entity === headline) return null;
  return { kind: 'entity', name: entity, extra: 0 };
}
