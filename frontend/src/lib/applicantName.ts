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
