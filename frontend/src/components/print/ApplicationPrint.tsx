import type { CSSProperties, ReactNode } from 'react';
import XpressPrintHeader from './XpressPrintHeader';
import { A4_PRINT_WIDTH_PX, PRINT_INSET } from '../../lib/printPage';
import { DOC_TYPE_LABELS, LOAN_CATEGORIES, LOAN_TYPE_LABELS, STATUS_LABEL, categoryForSubType, findLoanSubType } from '../../lib/constants';
import { applicantCounterpart, applicantDisplayName, applicantEmail, applicantName, isCompanyApplicant } from '../../lib/applicantName';
import { formatAbn } from '../../lib/acn';
import { formatDate } from '../../lib/utils';
import type { Document, LoanApplicant, LoanApplication } from '../../types';

/**
 * The application export: everything on the file, laid out as one Xpress
 * document. Rendered off-screen and captured by html2pdf, so styling is inline
 * (html2canvas can't parse Tailwind's modern colours) and every field row is a
 * block-level `break-inside-avoid` wrapper — html2pdf's avoidance silently
 * fails on grid/flex children, which is what sliced rows across pages before.
 */

const NAVY = '#0d1f3c';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';

type Value = string | number | null | undefined | false;
type Field = [label: string, value: Value];

const MONEY_KEY = /(price|amount|value|cost|deposit|debt|balloon|payout|limit|balance|repayment|sales|income)/i;

function money(v: number | string | null | undefined): string {
  const n = Number(v);
  return v === null || v === undefined || v === '' || Number.isNaN(n) ? '' : `$${n.toLocaleString('en-AU')}`;
}

function yesNo(v: boolean | null | undefined): string | null {
  return v == null ? null : v ? 'Yes' : 'No';
}

/** "vehicle_make" → "Vehicle make". */
function humanise(key: string): string {
  const s = key.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A raw JSON answer as it should print. Money only where the key says so AND
 *  the value is numeric — "amount_type: fixed" must not become "$NaN". */
function formatAnswer(key: string, v: unknown): string {
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (v === 'yes' || v === 'no') return v === 'yes' ? 'Yes' : 'No';
  if (MONEY_KEY.test(key) && v !== '' && !Number.isNaN(Number(v))) return money(v as number);
  if (typeof v === 'string') return v.replace(/_/g, ' ');
  return String(v);
}

function address(...parts: (string | null | undefined)[]): string {
  const [street, ...rest] = parts;
  const locality = rest.filter(Boolean).join(' ');
  return [street, locality].filter(Boolean).join(', ');
}

function personName(p: { applicant_title?: string | null; applicant_first_name?: string | null; applicant_middle_name?: string | null; applicant_last_name?: string | null }): string {
  return [p.applicant_title, p.applicant_first_name, p.applicant_middle_name, p.applicant_last_name].filter(Boolean).join(' ');
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      {/* The heading travels with its first rows rather than being stranded at
          the foot of a page. paddingTop survives a push to a new page;
          marginTop collapses there. */}
      <div className="break-inside-avoid" style={{ paddingTop: 6 }}>
        <h2 style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: NAVY, borderBottom: `1.5px solid ${NAVY}`, paddingBottom: 4 }}>
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}

/** A section of label/value pairs that prints only when one is answered, so a
 *  heading never sits over nothing. */
function FieldSection({ title, fields }: { title: string; fields: Field[] }) {
  if (!fields.some(([, v]) => v !== null && v !== undefined && v !== false && v !== '')) return null;
  return <Section title={title}><Fields fields={fields} /></Section>;
}

function Sub({ children }: { children: ReactNode }) {
  return (
    <div className="break-inside-avoid" style={{ paddingTop: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#111' }}>{children}</div>
    </div>
  );
}

/** Label/value pairs, two to a row. Blank answers are dropped. */
function Fields({ fields }: { fields: Field[] }) {
  const shown = fields.filter(([, v]) => v !== null && v !== undefined && v !== false && v !== '');
  const rows: Field[][] = [];
  for (let i = 0; i < shown.length; i += 2) rows.push(shown.slice(i, i + 2));
  return (
    <>
      {rows.map((row, i) => (
        <div key={i} className="break-inside-avoid" style={{ display: 'flex', gap: 16, borderBottom: `1px solid ${LINE}`, padding: '5px 0' }}>
          {row.map(([label, value]) => (
            <div key={label} style={{ flex: 1, minWidth: 0, display: 'flex', gap: 8 }}>
              <div style={{ width: 120, flex: 'none', fontSize: 9.5, color: MUTED }}>{label}</div>
              <div style={{ flex: 1, minWidth: 0, fontSize: 10.5, color: '#111', fontWeight: 600, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{value}</div>
            </div>
          ))}
          {row.length === 1 && <div style={{ flex: 1 }} />}
        </div>
      ))}
    </>
  );
}

const th: CSSProperties = { textAlign: 'left', padding: '5px 8px', fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${NAVY}` };
const td: CSSProperties = { padding: '5px 8px', fontSize: 10, color: '#111', borderBottom: `1px solid ${LINE}`, verticalAlign: 'top' };

/** A table whose rows each avoid a page break. Built from block rows rather
 *  than <tr>s, which html2pdf cannot push to the next page. */
function Table({ head, rows, widths }: { head: string[]; rows: ReactNode[][]; widths: string[] }) {
  return (
    <>
      <div className="break-inside-avoid" style={{ display: 'flex', marginTop: 6 }}>
        {head.map((h, i) => <div key={h} style={{ ...th, width: widths[i] }}>{h}</div>)}
      </div>
      {rows.map((r, i) => (
        <div key={i} className="break-inside-avoid" style={{ display: 'flex' }}>
          {r.map((cell, j) => <div key={j} style={{ ...td, width: widths[j], wordBreak: 'break-word' }}>{cell}</div>)}
        </div>
      ))}
    </>
  );
}

function partyFields(p: LoanApplicant): Field[] {
  return [
    ['Role', p.role ? humanise(p.role) : null],
    ['Date of birth', p.applicant_dob ? formatDate(p.applicant_dob) : null],
    ['Email', p.applicant_email],
    ['Mobile', p.applicant_mobile],
    ['Residency', p.applicant_residency_status],
    ['Marital status', p.applicant_marital_status],
    ['Address', address(p.applicant_address, p.applicant_suburb, p.applicant_state, p.applicant_postcode)],
    ['Employer', p.employer_name],
    ['Job title', p.job_title],
  ];
}

export default function ApplicationPrint({
  application,
  documents,
  referrer,
}: {
  application: LoanApplication;
  documents: Document[];
  referrer: { full_name: string | null; organization_name?: string | null } | null;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let extra: Record<string, any> = {};
  try { if (application.lend_extra_data) extra = JSON.parse(application.lend_extra_data); } catch { /* unreadable JSON prints as no extra data */ }

  const company = isCompanyApplicant(application);
  const ref = `APP-${application.id.replace(/-/g, '').slice(-6).toUpperCase()}`;
  const headline = applicantDisplayName(application, 'Loan application');
  const counterpart = applicantCounterpart(application);

  const loanDetails: Record<string, Record<string, unknown>> = extra.loan_type_details || {};
  const subType: string | undefined = (loanDetails.consumer_loan_type?.type || loanDetails.commercial_loan_type?.type) as string | undefined;
  const subTypeLabel = subType
    ? findLoanSubType(subType)?.label || (loanDetails.consumer_loan_type?.label || loanDetails.commercial_loan_type?.label) as string || humanise(subType)
    : null;
  const categoryLabel = subType ? LOAN_CATEGORIES.find((c) => c.value === categoryForSubType(subType))?.label : null;
  const loanLabel = subTypeLabel || LOAN_TYPE_LABELS[application.loan_type] || humanise(application.loan_type);

  const idEntry = Array.isArray(extra.identification) ? extra.identification[0] : null;
  const emp = Array.isArray(extra.employments) ? extra.employments[0] : null;
  const incomes: { income_type?: string; amount?: number; frequency?: string }[] =
    Array.isArray(extra.incomes) ? extra.incomes.filter((i: { amount?: number }) => (i.amount ?? 0) > 0) : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const realEstate: Record<string, any>[] = Array.isArray(extra.assets?.real_estate) ? extra.assets.real_estate : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const otherAssets: Record<string, any>[] = Array.isArray(extra.assets?.other) ? extra.assets.other : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const liabilities: Record<string, any>[] = Array.isArray(extra.liabilities) ? extra.liabilities : [];
  const expenses: Record<string, number> = extra.expenses || {};

  const parties = application.additional_applicants || [];
  // On a company application every director is a party; on an individual one
  // the inline applicant is the primary, so only the others are listed.
  const directors = company ? parties : parties.filter((p) => !p.is_primary);
  const guarantors = application.corporate_guarantors || [];
  const conditions = application.approval_conditions || [];
  const brokers = (application.assigned_brokers || []).map((b) => b.full_name).filter(Boolean).join(', ') || application.assigned_broker_name;

  const hasEntity = company || application.business_name || application.business_abn;
  const personHeading = company ? 'Primary contact' : 'Applicant';
  // applicantName returns the entity on a company application; the person
  // block wants the human, so read the inline name directly there.
  const person = company ? personName(application) : applicantName(application, { withTitle: true });

  // The detail groups other than the sub-type picker, with blanks removed.
  const detailGroups = Object.entries(loanDetails)
    .filter(([key, val]) => val && typeof val === 'object' && !['consumer_loan_type', 'commercial_loan_type'].includes(key))
    .map(([key, val]) => [key, Object.entries(val).filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== 0 && v !== false && typeof v !== 'object')] as const)
    .filter(([, entries]) => entries.length > 0);

  const expenseFields: Field[] = [
    ['Living expenses', expenses.monthly_living > 0 && `${money(expenses.monthly_living)} / month`],
    ['Rent / mortgage', expenses.rent_mortgage > 0 && `${money(expenses.rent_mortgage)} / month`],
    ['Child support', expenses.child_support > 0 && `${money(expenses.child_support)} / month`],
    ['Other commitments', expenses.other_commitments > 0 && `${money(expenses.other_commitments)} / month`],
  ];

  const summary: [string, string][] = [
    ['Amount', money(application.amount)],
    ['Loan', loanLabel],
    ['Status', STATUS_LABEL[application.status] || humanise(application.status)],
    ['Created', formatDate(application.created_at)],
  ];

  return (
    // Exactly the PDF's inner page width — html2pdf crops anything wider.
    // overflow:hidden keeps scrollWidth equal to it so the capture isn't shifted.
    <div style={{ background: '#fff', color: '#111', width: A4_PRINT_WIDTH_PX.portrait, paddingBottom: 16, overflow: 'hidden', fontFamily: 'Helvetica, Arial, sans-serif' }}>
      <XpressPrintHeader
        eyebrow={`Loan Application${categoryLabel ? ` · ${categoryLabel}` : ''}`}
        title={headline}
        subtitle={[
          counterpart && `${counterpart.kind === 'person' ? 'Director' : 'Entity'}: ${counterpart.name}${counterpart.extra ? ` +${counterpart.extra}` : ''}`,
          guarantors.length > 0 && `Guarantor: ${guarantors.map((g) => g.organization_name).filter(Boolean).join(', ')}`,
          ref,
          application.lend_ref && `Lend ref ${application.lend_ref}`,
        ].filter(Boolean).join('  ·  ')}
      />

      <div style={{ padding: `0 ${PRINT_INSET}px` }}>
        {/* At-a-glance strip */}
        <div className="break-inside-avoid" style={{ display: 'flex', border: `1px solid ${LINE}`, borderRadius: 4 }}>
          {summary.map(([k, v], i) => (
            <div key={k} style={{ flex: 1, padding: '8px 12px', borderLeft: i ? `1px solid ${LINE}` : undefined }}>
              <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED }}>{k}</div>
              <div style={{ fontSize: k === 'Amount' ? 16 : 11.5, fontWeight: 700, color: NAVY, marginTop: 3 }}>{v || '—'}</div>
            </div>
          ))}
        </div>

        <FieldSection title="The deal" fields={[
            ['Broker', brokers],
            ['Referred by', referrer && (referrer.organization_name || referrer.full_name)],
            ['Introduced by', application.referred_by?.name],
            ['Approving lender', application.approval_lender_name],
            ['Term requested', application.loan_term_requested ? `${application.loan_term_requested} months` : null],
            ['Cloned from', application.cloned_from_id && `APP-${application.cloned_from_id.replace(/-/g, '').slice(-6).toUpperCase()}`],
        ]} />

        {hasEntity && (
          <FieldSection title={company ? 'Borrowing entity' : 'Business'} fields={[
              ['Name', application.business_name],
              ['ABN', application.business_abn && formatAbn(application.business_abn)],
              ['Trading name', application.trading_name],
              ['Structure', application.business_structure && humanise(application.business_structure)],
              ['Registered', application.business_registration_date && formatDate(application.business_registration_date)],
              ['Time trading', application.time_trading],
              ['GST registered', yesNo(application.gst_registered)],
              ['Monthly sales', application.business_monthly_sales ? money(application.business_monthly_sales) : null],
              ['No. of directors', application.num_directors],
              ['Other directors', extra.other_directors as string],
          ]} />
        )}

        <FieldSection title={personHeading} fields={[
              ['Full name', person],
              ['Date of birth', application.applicant_dob && formatDate(application.applicant_dob)],
              ['Email', applicantEmail(application)],
              ['Mobile', application.applicant_mobile],
              ['Gender', application.applicant_gender],
              ['Marital status', application.applicant_marital_status],
              ['Preferred contact', application.preferred_contact_method],
              ['Residency', application.applicant_residency_status],
              ['Visa', [application.applicant_visa_category, application.applicant_visa_number].filter(Boolean).join(' · ')],
              ['ID', [idEntry?.type, idEntry?.number].filter(Boolean).join(' · ')],
              ['ID issued by', idEntry?.state || idEntry?.country],
              ['ID expiry', (idEntry?.expiry_date || application.id_expiry_date) && formatDate(idEntry?.expiry_date || application.id_expiry_date)],
              ['Address', address(application.applicant_address, application.applicant_suburb, application.applicant_state, application.applicant_postcode)],
              ['Living situation', application.residential_status],
              ['Time at address', application.time_at_address],
              ['Dependants', application.applicant_num_dependants],
              ['Partner', company ? null : yesNo(application.has_partner)],
              ['Partner working', company ? null : yesNo(application.partner_working)],
        ]} />

        {directors.length > 0 && (
          <Section title={company ? 'Directors' : 'Other applicants'}>
            {directors.map((p) => (
              <div key={p.id}>
                <Sub>{personName(p) || p.applicant_email || 'Invited — not yet completed'}{p.is_primary ? ' (primary)' : ''}</Sub>
                <Fields fields={partyFields(p)} />
              </div>
            ))}
          </Section>
        )}

        {guarantors.length > 0 && (
          <Section title="Corporate guarantors">
            {guarantors.map((g) => (
              <div key={g.id}>
                <Sub>{g.organization_name || 'Guarantor'}{g.organization_abn ? ` · ABN ${formatAbn(g.organization_abn)}` : ''}</Sub>
                <Fields fields={[['Signatories', g.signatories.map((s) => personName(s) || s.applicant_email).filter(Boolean).join(', ') || 'None yet']]} />
              </div>
            ))}
          </Section>
        )}

        <FieldSection title="Employment" fields={[
              ['Type', application.employment_category && humanise(application.employment_category)],
              ['Employer', application.employer_name || emp?.employer_name],
              ['Job title', application.job_title || emp?.job_title],
              ['Basis', emp?.employment_type && humanise(emp.employment_type)],
              ['Started', emp?.start_date && formatDate(emp.start_date)],
              ['Industry', application.employer_industry || emp?.industry],
              ['Gross income', application.gross_income ? money(application.gross_income) : null],
              ['Paid', application.income_frequency],
              ['Employer contact', emp?.contact_details],
        ]} />

        {detailGroups.length > 0 && (
          <Section title="Loan details">
            {detailGroups.map(([group, entries]) => (
              <div key={group}>
                <Sub>{humanise(group)}</Sub>
                <Fields fields={entries.map(([k, v]) => [humanise(k), formatAnswer(k, v)])} />
              </div>
            ))}
          </Section>
        )}

        {incomes.length > 0 && (
          <Section title="Income">
            <Table
              head={['Source', 'Amount', 'Frequency']}
              widths={['50%', '25%', '25%']}
              rows={incomes.map((i) => [i.income_type ? humanise(i.income_type) : '—', money(i.amount), i.frequency ? humanise(i.frequency) : '—'])}
            />
          </Section>
        )}

        {expenseFields.some(([, v]) => v) && (
          <Section title="Monthly expenses">
            <Fields fields={expenseFields} />
          </Section>
        )}

        {(realEstate.length > 0 || otherAssets.length > 0) && (
          <Section title="Assets">
            <Table
              head={['Asset', 'Detail', 'Value', 'Owing']}
              widths={['24%', '44%', '16%', '16%']}
              rows={[
                ...realEstate.map((a, i) => [
                  a.property_type ? humanise(String(a.property_type)) : `Property ${i + 1}`,
                  [a.address, a.ownership_type && `Ownership: ${a.ownership_type}`, a.is_financed === 'yes' && a.lender && `Lender: ${a.lender}`].filter(Boolean).join(' · '),
                  money(a.estimated_value),
                  a.is_financed === 'yes' ? money(a.amount_owing) : '',
                ]),
                ...otherAssets.map((a, i) => [
                  a.asset_type ? humanise(String(a.asset_type)) : `Asset ${i + 1}`,
                  a.description || '',
                  money(a.value),
                  '',
                ]),
              ]}
            />
          </Section>
        )}

        {liabilities.length > 0 && (
          <Section title="Liabilities">
            <Table
              head={['Liability', 'Lender', 'Balance', 'Limit', 'Monthly']}
              widths={['26%', '26%', '16%', '16%', '16%']}
              rows={liabilities.map((l, i) => [
                l.liability_type ? humanise(String(l.liability_type)) : `Liability ${i + 1}`,
                l.lender || '',
                money(l.balance),
                money(l.limit),
                money(l.monthly_repayment),
              ])}
            />
          </Section>
        )}

        <FieldSection title="Declarations" fields={[
              ['Previously declined', yesNo(application.previously_declined)],
              ['Change of circumstances', yesNo(application.change_of_circumstances)],
              ['Emergency contact', application.emergency_contact_name && [
                application.emergency_contact_name,
                application.emergency_contact_relationship && `(${application.emergency_contact_relationship})`,
                application.emergency_contact_phone,
              ].filter(Boolean).join(' ')],
              ['Signed by', application.signature_name],
        ]} />

        {conditions.length > 0 && (
          <Section title={`Approval conditions${application.approval_lender_name ? ` — ${application.approval_lender_name}` : ''}`}>
            {[...conditions].sort((a, b) => a.sort_order - b.sort_order).map((c) => (
              <div key={c.id} className="break-inside-avoid" style={{ display: 'flex', gap: 8, padding: '5px 0', borderBottom: `1px solid ${LINE}`, fontSize: 10.5 }}>
                <span style={{ width: 14, flex: 'none', fontWeight: 700, color: c.is_completed ? '#15803d' : MUTED }}>{c.is_completed ? '✓' : '○'}</span>
                <span style={{ flex: 1 }}>{c.text}</span>
              </div>
            ))}
          </Section>
        )}

        {application.notes && (
          <Section title="Notes">
            <div className="break-inside-avoid" style={{ fontSize: 10.5, color: '#333', whiteSpace: 'pre-wrap', paddingTop: 6 }}>{application.notes}</div>
          </Section>
        )}

        {documents.length > 0 && (
          <Section title={`Documents (${documents.length})`}>
            <Table
              head={['Type', 'File', 'Uploaded', 'Verified']}
              widths={['28%', '44%', '16%', '12%']}
              rows={documents.map((d) => [
                DOC_TYPE_LABELS[d.doc_type] || humanise(d.doc_type),
                d.original_filename,
                formatDate(d.uploaded_at),
                <span style={{ fontWeight: 700, color: d.is_verified ? '#15803d' : MUTED }}>{d.is_verified ? 'Yes' : 'No'}</span>,
              ])}
            />
          </Section>
        )}
      </div>
    </div>
  );
}
