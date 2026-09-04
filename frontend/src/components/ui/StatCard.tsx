import { useEffect, useRef, useState, type ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: number | string;
  icon: ReactNode;
  gradient: string;
  loading?: boolean;
  valueColor?: string;
}

const toneStyles = {
  neutral: {
    icon: 'border-[var(--led-line)] bg-[var(--led-surface-2)] text-[var(--led-ink-2)]',
    rule: 'bg-[var(--led-line)]',
  },
  accent: {
    icon: 'border-transparent bg-[var(--led-accent-tint)] text-[var(--led-accent)]',
    rule: 'bg-[var(--led-accent)]',
  },
  success: {
    icon: 'border-transparent bg-[var(--led-success-tint)] text-[var(--led-success)]',
    rule: 'bg-[var(--led-success)]',
  },
  warning: {
    icon: 'border-transparent bg-[var(--led-warning-tint)] text-[var(--led-warning)]',
    rule: 'bg-[var(--led-warning)]',
  },
  danger: {
    icon: 'border-transparent bg-[var(--led-danger-tint)] text-[var(--led-danger)]',
    rule: 'bg-[var(--led-danger)]',
  },
} as const;

function useAnimatedCounter(target: number, duration = 600) {
  const [count, setCount] = useState(0);
  const ref = useRef<number>(0);

  useEffect(() => {
    if (target === 0) { setCount(0); return; }
    const start = ref.current;
    const diff = target - start;
    const startTime = performance.now();

    function step(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + diff * eased);
      setCount(current);
      if (progress < 1) requestAnimationFrame(step);
      else ref.current = target;
    }

    requestAnimationFrame(step);
  }, [target, duration]);

  return count;
}

export default function StatCard({ label, value, icon, gradient, loading = false, valueColor = 'text-foreground' }: StatCardProps) {
  const numericValue = typeof value === 'number' ? value : 0;
  const isNumeric = typeof value === 'number';
  const animated = useAnimatedCounter(loading ? 0 : numericValue);
  const tone =
    gradient.includes('success') ? toneStyles.success
    : gradient.includes('warning') ? toneStyles.warning
    : gradient.includes('destructive') || gradient.includes('danger') ? toneStyles.danger
    : gradient.includes('primary') ? toneStyles.accent
    : toneStyles.neutral;

  return (
    <div className="led-card relative overflow-hidden p-[14px_15px]">
      <div className={`absolute inset-x-0 top-0 h-px ${tone.rule}`} />
      <div className="flex items-start justify-between gap-4">
        <p className="led-label min-w-0 pt-0.5">{label}</p>
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border ${tone.icon}`}>
          {icon}
        </div>
      </div>
      {loading ? (
        <div className="mt-2 h-7 w-24 rounded-md shimmer" />
      ) : (
        <p className={`led-mono mt-2 text-[24px] font-medium tracking-[-0.02em] led-tnum ${valueColor}`}>
          {isNumeric ? animated : value}
        </p>
      )}
      <div className="mt-2.5 flex items-center justify-between gap-3">
        <span className="text-[12px] text-[var(--led-muted)]">Current position</span>
        <span className="text-[12px] text-[var(--led-muted-2)]">Live snapshot</span>
      </div>
    </div>
  );
}
