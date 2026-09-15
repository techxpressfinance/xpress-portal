import type { AwaitingParty, Journey } from '../types';
import { CheckIcon, ClockIcon, XMarkIcon } from '@heroicons/react/24/outline';

/**
 * Where a referred client is up to, for the referrer watching.
 *
 * Two parts, and the second is the one that matters. The step track says which
 * phase of the journey the file is in; the panel under it says whose move it is.
 * A referrer can do exactly one thing about a file in progress — chase their own
 * client — so the view's job is to tell them whether this is one of those times,
 * and to say plainly when it is not. Silence is what makes referrers ring the
 * desk; "nothing needed from you" is the answer that saves the call.
 *
 * It never shows the stage title, the owning team or the lender: those describe
 * how the deal is being worked, which is the desk's business.
 */

interface Props {
  journey: Journey;
}

/** What each party's turn means to a referrer, in their words. `nudge` marks
 *  the one case where they should act — it colours the panel and nothing else
 *  does. */
const AWAITING_COPY: Record<AwaitingParty, { title: string; detail: string; nudge: boolean }> = {
  client: {
    title: 'Waiting on your client',
    detail: 'We have asked them for what we need. Nothing moves until it arrives.',
    nudge: true,
  },
  desk: {
    title: 'With our team',
    detail: 'We are working on it. Nothing needed from you or your client.',
    nudge: false,
  },
  lender: {
    title: 'With the lender',
    detail: 'The lender is reviewing it. Nothing needed from you or your client.',
    nudge: false,
  },
  supplier: {
    title: 'Waiting on the supplier',
    detail: 'We are waiting on paperwork from the seller. Nothing needed from you or your client.',
    nudge: false,
  },
  referrer: {
    title: 'With you',
    detail: 'This inquiry has not been turned into an application yet.',
    nudge: true,
  },
  none: { title: '', detail: '', nudge: false },
};

const CLOSED_COPY: Record<string, { title: string; detail: string }> = {
  rejected: {
    title: 'Not approved',
    detail: 'This application was not approved. Get in touch if you would like to talk through the options.',
  },
  not_proceeding: {
    title: 'Not proceeding',
    detail: 'This application was closed before settlement.',
  },
};

function waitedFor(days: number | null): string {
  if (days == null) return '';
  if (days === 0) return 'since today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

export default function JourneyTracker({ journey }: Props) {
  const { phases, phase_index: currentIndex, awaiting, closed, days_waiting: days } = journey;

  // A closed file is not partway along anything, so the track would be a row of
  // greyed circles saying nothing. Replace it outright.
  if (closed) {
    const copy = CLOSED_COPY[closed] ?? CLOSED_COPY.not_proceeding;
    return (
      <div className="rounded-2xl bg-destructive/8 p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive text-white">
            <XMarkIcon className="h-5 w-5" strokeWidth={2} />
          </div>
          <div>
            <p className="text-[15px] font-semibold text-destructive">{copy.title}</p>
            <p className="text-[13px] text-muted-foreground">{copy.detail}</p>
          </div>
        </div>
      </div>
    );
  }

  const copy = awaiting ? AWAITING_COPY[awaiting] : null;
  const showPanel = Boolean(copy?.title);

  return (
    <div className="space-y-4">
      <div className="flex items-center" style={{ animation: 'fadeIn 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}>
        {phases.map((phase, i) => {
          const isCompleted = currentIndex != null && i < currentIndex;
          const isCurrent = i === currentIndex;

          return (
            <div
              key={phase}
              className="flex items-center flex-1 last:flex-none"
              style={{ animation: `fadeInUp 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94) ${i * 80}ms both` }}
            >
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-medium transition-all duration-300 ${
                    isCompleted
                      ? 'bg-success text-success-foreground'
                      : isCurrent
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-muted-foreground'
                  }`}
                >
                  {isCompleted ? <CheckIcon className="h-4 w-4" strokeWidth={2.5} /> : i + 1}
                </div>
                <span
                  className={`mt-2 text-center text-[12px] font-medium ${
                    isCompleted ? 'text-success' : isCurrent ? 'text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {phase}
                </span>
              </div>
              {i < phases.length - 1 && (
                <div className="relative h-[2px] flex-1 mx-3 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-success transition-all duration-700"
                    style={{
                      width: currentIndex != null && i < currentIndex ? '100%' : '0%',
                      transitionTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showPanel && copy && (
        <div
          className={`flex items-start gap-3 rounded-xl px-4 py-3 ${
            copy.nudge ? 'bg-warning/10 border border-warning/30' : 'bg-secondary'
          }`}
        >
          <div className={`mt-0.5 shrink-0 ${copy.nudge ? 'text-warning' : 'text-muted-foreground'}`}>
            {copy.nudge ? <ClockIcon className="h-5 w-5" strokeWidth={2} /> : <CheckIcon className="h-5 w-5" strokeWidth={2} />}
          </div>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-foreground">
              {copy.title}
              {days != null && (
                <span className="font-normal text-muted-foreground"> &middot; {waitedFor(days)}</span>
              )}
            </p>
            <p className="text-[13px] text-muted-foreground">{copy.detail}</p>
          </div>
        </div>
      )}
    </div>
  );
}
