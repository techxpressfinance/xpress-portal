import { forwardRef, type SelectHTMLAttributes } from 'react';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, children, className = '', ...props }, ref) => {
    return (
      <div>
        {label && (
          <label className="block text-[13px] font-medium text-foreground mb-1.5">{label}</label>
        )}
        <select
          ref={ref}
          className={`rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background h-10 border border-transparent cursor-pointer ${className}`}
          {...props}
        >
          {children}
        </select>
        {error && <p className="mt-1.5 text-[12px] text-destructive font-medium">{error}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';
export default Select;
