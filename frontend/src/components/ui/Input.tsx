import { forwardRef, useId, useState, type InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  suffix?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, suffix, className = '', id: providedId, type = 'text', ...props }, ref) => {
    const generatedId = useId();
    const inputId = providedId || `input-${generatedId}`;
    const errorId = `${inputId}-error`;
    const isPassword = type === 'password';
    const [passwordVisible, setPasswordVisible] = useState(false);
    const hasEndAdornment = Boolean(suffix) || isPassword;

    return (
      <div>
        {label && (
          <label htmlFor={inputId} className="block text-[13px] font-medium text-foreground mb-1.5">{label}</label>
        )}
        {hasEndAdornment ? (
          <div className="relative">
            <input
              ref={ref}
              id={inputId}
              type={isPassword && passwordVisible ? 'text' : type}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              className={`led-input !h-10 sm:!text-[14px] ${hasEndAdornment ? 'pr-11' : ''} ${error ? '!border-[var(--led-danger)] !shadow-[0_0_0_3px_var(--led-danger-tint)]' : ''} ${className}`}
              {...props}
            />
            {suffix && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--led-muted)] text-sm">{suffix}</span>}
            {isPassword && (
              <button
                type="button"
                onClick={() => setPasswordVisible((visible) => !visible)}
                className="absolute inset-y-1 right-1 z-10 flex w-10 items-center justify-center rounded-md border border-[var(--led-line)] bg-[var(--led-surface)] text-[12px] font-semibold text-[var(--led-accent-ink)] shadow-sm transition-colors hover:bg-[var(--led-surface-2)] hover:text-[var(--led-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--led-accent)]"
                aria-label={passwordVisible ? 'Hide password' : 'Show password'}
                aria-pressed={passwordVisible}
              >
                {passwordVisible ? 'Hide' : 'Show'}
              </button>
            )}
          </div>
        ) : (
          <input
            ref={ref}
            id={inputId}
            type={type}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            className={`led-input !h-10 sm:!text-[14px] ${error ? '!border-[var(--led-danger)] !shadow-[0_0_0_3px_var(--led-danger-tint)]' : ''} ${className}`}
            {...props}
          />
        )}
        {error && <p id={errorId} role="alert" className="mt-1.5 text-[12px] text-destructive font-medium">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
export default Input;
