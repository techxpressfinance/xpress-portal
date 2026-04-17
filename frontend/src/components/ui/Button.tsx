import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
}

const variantStyles: Record<Variant, string> = {
  primary: 'led-btn-primary',
  secondary: 'led-btn-outline',
  ghost: 'led-btn-ghost',
  danger: 'led-btn-danger',
  success: 'led-btn-outline !text-[var(--led-success)] hover:!bg-[var(--led-success-tint)]', // led-btn-success doesn't exist, adapt it
};

const sizeStyles: Record<Size, string> = {
  sm: 'led-btn-sm',
  md: '', // led-btn default size is md
  lg: 'h-10 px-5 text-[14px]', // custom for lg
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading = false, disabled, children, className = '', ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`led-btn ${variantStyles[variant]} ${sizeStyles[size]} disabled:opacity-50 disabled:pointer-events-none ${className}`}
        {...props}
      >
        {loading && (
          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
export default Button;
