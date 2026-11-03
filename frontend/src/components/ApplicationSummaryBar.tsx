import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LOAN_CATEGORIES, applicationLoanCategory } from '../lib/constants';
import { applicantCounterpart, applicantDisplayName, applicantEmail, isCompanyApplicant } from '../lib/applicantName';
import type { LoanApplication } from '../types';

/**
 * The deal at a glance, pinned to the top of the scrolling page: applicant
 * (the only bold text), the entity behind them, guarantors (or the directors
 * standing in), loan category, amount and email, plus
 * an optional line above it with the breadcrumb on the left and page actions
 * (Download PDF, Clone, Delete…) on the right. Render it
 * as a direct child of the page root — sticky only holds within its parent.
 */
export default function ApplicationSummaryBar({ application, actions, breadcrumb }: { application: LoanApplication; actions?: ReactNode; breadcrumb?: ReactNode }) {
  // The veil only shows once the bar is pinned (the page has scrolled under
  // it); at rest it would blur the breadcrumb and action buttons above.
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const personName = (p: { applicant_first_name?: string | null; applicant_last_name?: string | null }) =>
    [p.applicant_first_name, p.applicant_last_name].filter(Boolean).join(' ');
  const headline = applicantDisplayName(application);
  const parties = application.additional_applicants || [];
  // Individual guarantors by name, then any company guaranteeing the loan.
  const guarantorNames = [
    ...parties.filter((p) => p.role === 'guarantor').map(personName),
    ...(application.corporate_guarantors || []).map((g) => g.organization_name),
  ].filter((n): n is string => Boolean(n));
  // Where nobody is recorded as a guarantor yet, the directors stand in — the
  // primary held inline on a company application, then the other parties —
  // labelled as directors, since that is all the application says they are.
  const directorNames = guarantorNames.length > 0 ? [] : [...new Set([
    isCompanyApplicant(application) ? personName(application) : '',
    ...parties.map(personName),
  ].filter((n) => n && n !== headline))];
  // The business a person is applying for. A company applicant is already the
  // headline name, so there is nothing further to name here.
  const counterpart = applicantCounterpart(application);
  const entityName = counterpart?.kind === 'entity' ? counterpart.name : '';
  const category = LOAN_CATEGORIES.find((c) => c.value === applicationLoanCategory(application))?.label;
  const email = applicantEmail(application);
  const chip = 'inline-flex items-center rounded-full px-3 py-1 text-[12.5px] font-medium';
  const glassChip = `${chip} bg-black/[0.045] text-[var(--led-ink-2,inherit)] ring-1 ring-inset ring-black/[0.06] dark:bg-white/10 dark:ring-white/10`;
  const details: ReactNode[] = [
    entityName && <span key="entity" className={glassChip}>Entity · {entityName}</span>,
    guarantorNames.length > 0 && (
      <OverflowChip key="guarantor" className={glassChip} label="Guarantor" names={guarantorNames} />
    ),
    directorNames.length > 0 && (
      <span key="director" className={glassChip}>Director · {directorNames.join(', ')}</span>
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
    <>
    {(breadcrumb || actions) && (
      // The breadcrumb and the page actions share one line.
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {breadcrumb}
        {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    )}
    {/* The offsets cancel <main>'s padding so the bar pins 12px from the top of
        the scroll area rather than below the padding. */}
    <div ref={sentinelRef} aria-hidden className="h-px -mb-px" />
    <div className="sticky z-30 -top-[4px] sm:-top-3 lg:-top-7 mb-5">
      {/* A progressive frosted veil behind the bar: content scrolling up blurs
          and fades into it instead of being cut off by a hard edge. */}
      <div
        aria-hidden
        className={`pointer-events-none absolute -inset-x-6 -top-8 -bottom-10 backdrop-blur-xl backdrop-saturate-150 transition-opacity duration-200 ${stuck ? 'opacity-100' : 'opacity-0'}`}
        style={{
          WebkitMaskImage: 'linear-gradient(to bottom, #000 0%, #000 62%, transparent 100%)',
          maskImage: 'linear-gradient(to bottom, #000 0%, #000 62%, transparent 100%)',
          background: 'linear-gradient(to bottom, color-mix(in srgb, var(--background, #fff) 70%, transparent) 0%, color-mix(in srgb, var(--background, #fff) 35%, transparent) 60%, transparent 100%)',
        }}
      />
      <div
        className="relative flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-[22px] border border-white/80 bg-white/45 ring-1 ring-black/[0.04] px-5 py-3 backdrop-blur-3xl backdrop-saturate-[1.8] dark:border-white/15 dark:bg-white/[0.06]"
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
          backgroundImage: [
            'linear-gradient(180deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0) 55%)',
            'radial-gradient(120% 140% at 0% 0%, rgba(99,102,241,0.10) 0%, transparent 50%)',
            'radial-gradient(120% 140% at 100% 100%, rgba(236,72,153,0.08) 0%, transparent 55%)',
          ].join(', '),
        }}
      >
        <strong className="text-[19px] font-bold tracking-[-0.02em] text-foreground">
          {headline || '—'}
        </strong>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">{details}</div>
      </div>
    </div>
    </>
  );
}

/**
 * "Label · First name +N": the first name inline, the rest in a popover on
 * hover or keyboard focus. With a single name it is a plain chip.
 */
function OverflowChip({ label, names, className }: { label: string; names: string[]; className: string }) {
  const [first, ...rest] = names;
  if (rest.length === 0) return <span className={className}>{label} · {first}</span>;
  return (
    <span
      tabIndex={0}
      aria-label={`${label}s: ${names.join(', ')}`}
      className={`${className} group relative cursor-default outline-none focus-visible:ring-2 focus-visible:ring-[var(--led-accent,currentColor)]`}
    >
      {label} · {first}
      <span className="ml-1.5 rounded-full bg-black/[0.07] px-1.5 text-[11.5px] font-semibold tabular-nums dark:bg-white/15">
        +{rest.length}
      </span>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute left-0 top-full z-50 mt-2 min-w-[12rem] max-w-[18rem] rounded-lg bg-[var(--led-ink,#18181b)] px-3 py-2 text-left text-[12px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100"
      >
        <span className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-white/60">Other {label.toLowerCase()}s</span>
        {rest.map((n, i) => <span key={`${n}-${i}`} className="block py-0.5">{n}</span>)}
      </span>
    </span>
  );
}
