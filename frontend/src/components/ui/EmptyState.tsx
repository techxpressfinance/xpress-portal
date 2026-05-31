import type { ReactNode } from 'react';

interface EmptyStateProps {
  title?: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export default function EmptyState({
  title = 'Nothing here yet',
  description = 'When data is available, it will appear here.',
  icon,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div className={`led-empty ${className}`}>
      <div className="led-empty-icon">
        {icon ?? (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10.5 6h3M12 3v3.75M12 12h.008v.008H12v-.008Z" />
          </svg>
        )}
      </div>
      <p className="text-[15px] font-medium text-[var(--led-ink)]">{title}</p>
      <p className="mt-1 text-[13px] text-[var(--led-muted)] max-w-xs mx-auto">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
