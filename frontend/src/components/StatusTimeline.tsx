import type { ApplicationStatus } from '../types';

interface Props {
  currentStatus: ApplicationStatus;
}

const steps: { key: ApplicationStatus; label: string }[] = [
  { key: 'draft', label: 'Draft' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'reviewing', label: 'Under Review' },
  { key: 'approved', label: 'Approved' },
];

const statusOrder: Record<string, number> = {
  draft: 0,
  submitted: 1,
  reviewing: 2,
  approved: 3,
  rejected: -1,
};

export default function StatusTimeline({ currentStatus }: Props) {
  const currentIndex = statusOrder[currentStatus];
  const isRejected = currentStatus === 'rejected';

  if (isRejected) {
    return (
      <div className="rounded-2xl bg-destructive/8 p-5" style={{ animation: 'scaleIn 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}>
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive text-white">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </div>
          <div>
            <p className="text-[15px] font-semibold text-destructive">Application Rejected</p>
            <p className="text-[13px] text-muted-foreground">This application was not approved. Contact support for details.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center" style={{ animation: 'fadeIn 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}>
      {steps.map((step, i) => {
        const isCompleted = i < currentIndex;
        const isCurrent = i === currentIndex;

        return (
          <div key={step.key} className="flex items-center flex-1 last:flex-none" style={{ animation: `fadeInUp 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94) ${i * 80}ms both` }}>
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
                {isCompleted ? (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`mt-2 text-[12px] font-medium ${
                  isCompleted
                    ? 'text-success'
                    : isCurrent
                      ? 'text-foreground'
                      : 'text-muted-foreground'
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className="relative h-[2px] flex-1 mx-3 rounded-full bg-secondary overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-success transition-all duration-700"
                  style={{ width: i < currentIndex ? '100%' : '0%', transitionTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
