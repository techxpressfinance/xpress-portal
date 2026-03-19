import { forwardRef, type InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', ...props }, ref) => {
    return (
      <div>
        {label && (
          <label className="block text-[13px] font-medium text-foreground mb-1.5">{label}</label>
        )}
        <input
          ref={ref}
          className={`w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background placeholder:text-muted-foreground h-11 border border-transparent ${error ? 'ring-2 ring-destructive/30 bg-destructive/5' : ''} ${className}`}
          {...props}
        />
        {error && <p className="mt-1.5 text-[12px] text-destructive font-medium">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
export default Input;
