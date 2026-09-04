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
          <label className="mb-1.5 block text-[13px] font-medium text-[var(--led-ink-2)]">{label}</label>
        )}
        <select
          ref={ref}
          className={`led-input !h-10 !text-[14px] cursor-pointer ${className}`}
          {...props}
        >
          {children}
        </select>
        {error && <p className="mt-1.5 text-[12px] font-medium text-[var(--led-danger)]">{error}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';
export default Select;
