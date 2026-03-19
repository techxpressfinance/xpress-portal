import { useEffect, useRef, useState, type ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: number | string;
  icon: ReactNode;
  gradient: string;
  loading?: boolean;
  valueColor?: string;
}

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

export default function StatCard({ label, value, icon, loading = false, valueColor = 'text-foreground' }: StatCardProps) {
  const numericValue = typeof value === 'number' ? value : 0;
  const isNumeric = typeof value === 'number';
  const animated = useAnimatedCounter(loading ? 0 : numericValue);

  return (
    <div className="rounded-2xl bg-card text-card-foreground shadow-[0_0_0_1px_var(--border),0_1px_3px_0_rgba(0,0,0,0.04),0_2px_8px_0_rgba(0,0,0,0.02)] relative overflow-hidden p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
          {icon}
        </div>
      </div>
      {loading ? (
        <div className="h-8 w-16 rounded-lg shimmer" />
      ) : (
        <p className={`text-[28px] font-semibold tracking-tight ${valueColor}`}>
          {isNumeric ? animated : value}
        </p>
      )}
    </div>
  );
}
