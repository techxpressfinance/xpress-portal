import { forwardRef, type ReactNode } from 'react';

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const paddingMap = {
  none: '',
  sm: 'p-5',
  md: 'p-6',
  lg: 'p-8',
};

const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(function GlassCard({ children, className = '', interactive = false, padding = 'md' }, ref) {
  return (
    <div
      ref={ref}
      className={`rounded-2xl bg-card text-card-foreground shadow-[0_0_0_1px_var(--border),0_1px_3px_0_rgba(0,0,0,0.04),0_2px_8px_0_rgba(0,0,0,0.02)] ${interactive ? 'glass-card-interactive cursor-pointer' : ''} ${paddingMap[padding]} ${className}`}
    >
      {children}
    </div>
  );
});

export default GlassCard;
