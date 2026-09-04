import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export default function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="led-h-page">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-[var(--led-muted)]">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
