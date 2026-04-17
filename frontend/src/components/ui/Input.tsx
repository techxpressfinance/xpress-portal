import { forwardRef, type InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  suffix?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, suffix, className = '', ...props }, ref) => {
    return (
      <div>
        {label && (
          <label className="block text-[13px] font-medium text-foreground mb-1.5">{label}</label>
        )}
        {suffix ? (
          <div className="relative">
            <input
              ref={ref}
              className={`led-input !h-10 !text-[14px] ${error ? '!border-[var(--led-danger)] !shadow-[0_0_0_3px_var(--led-danger-tint)]' : ''} ${className}`}
              {...props}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--led-muted)] text-sm">{suffix}</span>
          </div>
        ) : (
          <input
            ref={ref}
            className={`led-input !h-10 !text-[14px] ${error ? '!border-[var(--led-danger)] !shadow-[0_0_0_3px_var(--led-danger-tint)]' : ''} ${className}`}
            {...props}
          />
        )}
        {error && <p className="mt-1.5 text-[12px] text-destructive font-medium">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
export default Input;
