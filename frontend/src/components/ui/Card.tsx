import { forwardRef, type ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const paddingMap = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
};

const Card = forwardRef<HTMLDivElement, CardProps>(function Card({ children, className = '', interactive = false, padding = 'md' }, ref) {
  return (
    <div
      ref={ref}
      className={`led-card ${interactive ? 'hover:shadow-md hover:border-[var(--led-line-strong)] hover:-translate-y-[1px] transition-all cursor-pointer' : ''} ${paddingMap[padding]} ${className}`}
    >
      {children}
    </div>
  );
});

export default Card;
