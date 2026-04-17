import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export default function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-8">
      <div>
        <h1 className="led-h-page">{title}</h1>
        {subtitle && <p className="text-[14px] text-[var(--led-muted)] mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
