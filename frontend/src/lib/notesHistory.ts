import type { ApplicationNote, NoteCategory, NotesHistory, NotesHistoryLoan } from '../types';
import { LOAN_TYPE_LABELS, STATUS_LABEL, SUBMISSION_STATUS_BADGE } from './constants';
import { formatDate, formatDateTime } from './utils';

/**
 * One source of truth for the client notes-history export. The PDF (a React
 * print block) and the Word file (lib/notesHistoryDocx) both render the
 * sections, entries and decline summary built here, so the two formats can
 * never disagree about what a loan's history says.
 */

/** Note tabs on a loan, in the order they appear under "Notes". */
export const NOTE_TABS: { category: NoteCategory; label: string }[] = [
  { category: 'general', label: 'Deal Notes' },
  { category: 'compliance', label: 'Compliance' },
  { category: 'learning', label: 'My Learnings' },
  { category: 'decline', label: 'Decline Notes' },
  { category: 'scratchpad', label: 'Sticky notes' },
];

export type FeedCategory = Exclude<NoteCategory, 'scratchpad'>;

/** Which notes a feed shows. Deal Notes keep their original rule: team or
 *  personal notes only, never ones shared out to the client or referrer. */
export function notesForCategory(notes: ApplicationNote[], category: FeedCategory): ApplicationNote[] {
  if (category === 'general') {
    return notes.filter(
      (n) => (n.category ?? 'general') === 'general'
        && n.visibility.length === 1
        && (n.visibility[0] === 'broker' || n.visibility[0] === 'personal'),
    );
  }
  return notes.filter((n) => n.category === category);
}

export type HistorySection = 'decline' | 'submissions' | 'compliance' | 'learning' | 'scratchpad' | 'general';

/** Export sections in reading order — the outcome first, then how we got there. */
export const HISTORY_SECTIONS: { key: HistorySection; label: string; defaultOn: boolean }[] = [
  { key: 'decline', label: 'Decline notes', defaultOn: true },
  { key: 'submissions', label: 'Submitted to lender', defaultOn: true },
  { key: 'compliance', label: 'Compliance notes', defaultOn: true },
  { key: 'learning', label: 'My Learnings', defaultOn: true },
  { key: 'scratchpad', label: 'Sticky notes', defaultOn: true },
  { key: 'general', label: 'Deal notes', defaultOn: false },
];

export type HistoryLayout = 'by_loan' | 'by_type';

export interface HistoryEntry {
  /** Bold lead-in, e.g. "Serviceability · Pepper Money" or "Pepper Money — Declined". */
  title?: string;
  /** Author and date line. */
  meta: string;
  /** Body paragraphs; the first may be the note itself. */
  body: string[];
}

export const DECLINED_STATUSES = new Set(['rejected', 'not_proceeding']);

export function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
}

export function loanTitle(loan: NotesHistoryLoan): string {
  return loan.sub_type_label || LOAN_TYPE_LABELS[loan.loan_type] || loan.loan_type;
}

export function loanOutcome(loan: NotesHistoryLoan): string {
  return STATUS_LABEL[loan.status] ?? loan.status;
}

export function loanBorrower(loan: NotesHistoryLoan): string {
  return (loan.applicant_type === 'company' ? loan.business_name : loan.applicant_name) || loan.business_name || loan.applicant_name || '—';
}

/** One-line loan heading used in both layouts. */
export function loanHeadline(loan: NotesHistoryLoan): string {
  return `${loan.ref} · ${loanTitle(loan)} · ${money(loan.amount)} · ${formatDate(loan.created_at)} · ${loanOutcome(loan)}`;
}

export function lendersSubmitted(loan: NotesHistoryLoan): string[] {
  return [...new Set(loan.submissions.map((s) => s.lender_name).filter((n): n is string => Boolean(n)))];
}

export function declineReasonsFor(loan: NotesHistoryLoan): string[] {
  return [
    ...new Set(
      loan.notes
        .filter((n) => n.category === 'decline' && n.decline_reason)
        .map((n) => n.decline_reason as string),
    ),
  ];
}

function authorLine(name: string | null, at: string, editedBy?: string | null, editedAt?: string | null): string {
  const base = `${name || 'Staff'} · ${formatDateTime(at)}`;
  return editedAt ? `${base} · edited${editedBy ? ` by ${editedBy}` : ''} ${formatDateTime(editedAt)}` : base;
}

export function sectionEntries(loan: NotesHistoryLoan, section: HistorySection): HistoryEntry[] {
  if (section === 'submissions') {
    return loan.submissions.map((s) => {
      const terms = [
        s.offered_amount !== null ? `Offered ${money(s.offered_amount)}` : '',
        s.offered_rate !== null ? `${s.offered_rate}%` : '',
      ].filter(Boolean).join(' at ');
      return {
        title: `${s.lender_name || 'Lender'} — ${SUBMISSION_STATUS_BADGE[s.status]?.label ?? s.status}${terms ? ` · ${terms}` : ''}`,
        meta: [
          `Submitted ${formatDate(s.submitted_at)}${s.submitted_by_name ? ` by ${s.submitted_by_name}` : ''}`,
          s.responded_at ? `responded ${formatDate(s.responded_at)}` : '',
        ].filter(Boolean).join(' · '),
        body: [
          s.conditions ? `Conditions: ${s.conditions}` : '',
          s.notes ? `Notes: ${s.notes}` : '',
        ].filter(Boolean),
      };
    });
  }
  return loan.notes
    .filter((n) => n.category === section && n.content.trim())
    .map((n) => {
      if (section === 'scratchpad') {
        return {
          meta: `Last edited by ${n.updated_by_name || n.author_name || 'Staff'} · ${formatDateTime(n.updated_at || n.created_at)}`,
          body: [n.content],
        };
      }
      const title = section === 'decline'
        ? [n.decline_reason || 'No reason tagged', n.lender_name].filter(Boolean).join(' · ')
        : undefined;
      return {
        title,
        meta: authorLine(n.author_name, n.created_at, n.updated_by_name, n.updated_at),
        body: [n.content],
      };
    });
}

export interface DeclineSummary {
  outcomes: { label: string; count: number }[];
  byReason: { label: string; count: number }[];
  byLender: { label: string; count: number }[];
  declineNotes: number;
}

function tally(values: string[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * The pattern across the chosen loans, read before any detail: how they ended,
 * why they were declined, and who declined them. A lender counts once per loan
 * — whether the decline was logged on its submission, on a decline note, or both.
 */
export function declineSummary(loans: NotesHistoryLoan[]): DeclineSummary {
  const outcome = (l: NotesHistoryLoan) =>
    l.status === 'settled' ? 'Settled'
      : l.status === 'approval' ? 'Approved'
      : l.status === 'rejected' ? 'Rejected'
      : l.status === 'not_proceeding' ? 'Not proceeding'
      : 'In progress';
  const reasons: string[] = [];
  const lenders: string[] = [];
  let declineNotes = 0;
  for (const loan of loans) {
    const declines = loan.notes.filter((n) => n.category === 'decline');
    declineNotes += declines.length;
    declines.forEach((n) => reasons.push(n.decline_reason || 'No reason tagged'));
    const declinedBy = new Set<string>();
    loan.submissions.filter((s) => s.status === 'declined' && s.lender_name).forEach((s) => declinedBy.add(s.lender_name as string));
    declines.filter((n) => n.lender_name).forEach((n) => declinedBy.add(n.lender_name as string));
    lenders.push(...declinedBy);
  }
  return { outcomes: tally(loans.map(outcome)), byReason: tally(reasons), byLender: tally(lenders), declineNotes };
}

export function historyFileBase(history: NotesHistory): string {
  const name = history.subject.name.replace(/[^\w-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'client';
  return `notes-history-${name}-${new Date().toISOString().slice(0, 10)}`;
}

export function sectionLabel(key: HistorySection): string {
  return HISTORY_SECTIONS.find((s) => s.key === key)?.label ?? key;
}
