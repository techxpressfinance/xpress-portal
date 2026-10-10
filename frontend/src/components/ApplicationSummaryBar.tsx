import type { ReactNode } from 'react';
import { LOAN_CATEGORIES, applicationLoanCategory } from '../lib/constants';
import { applicantDisplayName, applicantEmail } from '../lib/applicantName';
import type { LoanApplication } from '../types';

/**
 * The deal at a glance, pinned to the top of the scrolling page: applicant
 * (the only bold text), guarantors, loan category, amount and email. Render it
 * as a direct child of the page root — sticky only holds within its parent.
 */
export default function ApplicationSummaryBar({ application }: { application: LoanApplication }) {
  const guarantorNames = (application.corporate_guarantors || [])
    .map((g) => g.organization_name)
    .filter(Boolean);
  const category = LOAN_CATEGORIES.find((c) => c.value === applicationLoanCategory(application))?.label;
  const email = applicantEmail(application);
  const chip = 'inline-flex items-center rounded-full px-3 py-1 text-[12.5px] font-medium';
  const glassChip = `${chip} bg-black/[0.045] text-[var(--led-ink-2,inherit)] ring-1 ring-inset ring-black/[0.06] dark:bg-white/10 dark:ring-white/10`;
  const details: ReactNode[] = [
    guarantorNames.length > 0 && (
      <span key="guarantor" className={glassChip}>Guarantor · {guarantorNames.join(', ')}</span>
    ),
    category && <span key="category" className={glassChip}>{category}</span>,
    application.amount != null && (
      <span key="amount" className="px-1 text-[15px] font-semibold tabular-nums tracking-tight text-foreground" style={{ fontFamily: 'inherit' }}>
        ${Number(application.amount).toLocaleString('en-AU')}
      </span>
    ),
    email && <span key="email" className="px-1 text-[13px] text-muted-foreground">{email}</span>,
  ].filter(Boolean);

  return (
    // The offsets cancel <main>'s padding so the bar pins 12px from the top of
    // the scroll area rather than below the padding.
    <div className="sticky z-30 -top-[4px] sm:-top-3 lg:-top-7 -mx-1 mb-5">
      <div
        className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-[22px] border border-white/80 bg-white/60 ring-1 ring-black/[0.04] px-5 py-3 backdrop-blur-2xl backdrop-saturate-[1.8] dark:border-white/15 dark:bg-white/[0.08]"
        style={{
          // Depth on every side: zero-offset halos (so the shadow shows above and
          // beside the bar too, not just below), then a lift that grows downward,
          // then the bright inner edges that make the glass read as raised.
          boxShadow: [
            '0 0 0 0.5px rgba(15,23,42,0.10)',
            '0 0 8px rgba(15,23,42,0.08)',
            '0 0 28px rgba(15,23,42,0.12)',
            '0 0 64px rgba(15,23,42,0.10)',
            '0 6px 14px -4px rgba(15,23,42,0.16)',
            '0 24px 48px -10px rgba(15,23,42,0.28)',
            'inset 0 1px 0 rgba(255,255,255,0.95)',
            'inset 0 -1px 0 rgba(255,255,255,0.3)',
            'inset 0 0 18px rgba(255,255,255,0.35)',
          ].join(', '),
          // A faint top-lit sheen over the frost.
          backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 60%)',
        }}
      >
        <strong className="text-[19px] font-bold tracking-[-0.02em] text-foreground">
          {applicantDisplayName(application) || '—'}
        </strong>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">{details}</div>
      </div>
    </div>
  );
}
