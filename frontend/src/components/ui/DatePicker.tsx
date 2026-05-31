import { useEffect, useRef, useState, forwardRef, type InputHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { format, parseISO, isValid } from 'date-fns';
import { DayPicker } from 'react-day-picker';

interface DatePickerProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  label?: string;
  error?: string;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  clearable?: boolean;
}

const formatInputDate = (date: Date) => format(date, 'yyyy-MM-dd');

const parseDate = (val: string): Date | undefined => {
  if (!val) return undefined;
  const d = parseISO(val);
  return isValid(d) ? d : undefined;
};

const DatePicker = forwardRef<HTMLInputElement, DatePickerProps>(
  ({ label, error, value, onChange, placeholder = 'Select date…', className = '', clearable = true, disabled, ...props }, ref) => {
    const [open, setOpen] = useState(false);
    const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
    const containerRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const selectedDate = parseDate(value || '');

    const updatePosition = () => {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const dropdownHeight = 340;
      const top = spaceBelow >= dropdownHeight || spaceBelow >= rect.top
        ? rect.bottom + window.scrollY + 6
        : rect.top + window.scrollY - dropdownHeight - 6;
      setDropdownStyle({
        position: 'absolute',
        top,
        left: rect.left + window.scrollX,
        minWidth: Math.max(rect.width, 300),
        zIndex: 9999,
      });
    };

    useEffect(() => {
      const handleClick = (e: MouseEvent) => {
        const target = e.target as Node;
        if (!containerRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
          setOpen(false);
        }
      };
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setOpen(false);
      };
      const handleReposition = () => { if (open) updatePosition(); };
      if (open) {
        document.addEventListener('mousedown', handleClick);
        document.addEventListener('keydown', handleEscape);
        window.addEventListener('scroll', handleReposition, true);
        window.addEventListener('resize', handleReposition);
      }
      return () => {
        document.removeEventListener('mousedown', handleClick);
        document.removeEventListener('keydown', handleEscape);
        window.removeEventListener('scroll', handleReposition, true);
        window.removeEventListener('resize', handleReposition);
      };
    }, [open]);

    const handleToggle = () => {
      if (disabled) return;
      if (!open) updatePosition();
      setOpen(!open);
    };

    const handleSelect = (date: Date | undefined) => {
      if (date) onChange?.(formatInputDate(date));
      setOpen(false);
    };

    const handleClear = (e: React.MouseEvent) => {
      e.stopPropagation();
      onChange?.('');
    };

    const displayValue = selectedDate ? format(selectedDate, 'dd MMM yyyy') : '';

    const dropdown = open ? createPortal(
      <div
        ref={dropdownRef}
        style={dropdownStyle}
        className="rounded-xl border border-slate-200 bg-white shadow-xl p-3"
      >
        <DayPicker
          mode="single"
          selected={selectedDate}
          onSelect={handleSelect}
          captionLayout="dropdown"
          startMonth={new Date(1900, 0)}
          endMonth={new Date(new Date().getFullYear() + 5, 11)}
          classNames={{
            months: 'flex flex-col gap-3',
            month: 'flex flex-col gap-2',
            nav: 'flex justify-between items-center mb-1',
            button_previous: 'h-7 w-7 flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 transition-colors',
            button_next: 'h-7 w-7 flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 transition-colors',
            month_caption: 'flex justify-center items-center gap-2 px-2',
            caption_label: 'hidden',
            dropdowns: 'flex gap-1',
            dropdown: 'text-[13px] bg-slate-100 border border-slate-200 rounded-md px-2 py-1 text-slate-800 font-medium focus:outline-none focus:ring-1 focus:ring-slate-400 cursor-pointer',
            month_grid: 'w-full border-collapse',
            weekdays: 'flex',
            weekday: 'w-9 h-8 text-[11px] font-semibold text-slate-400 uppercase text-center flex items-center justify-center',
            week: 'flex w-full mt-0.5',
            day: 'w-9 h-9 p-0 flex items-center justify-center',
            day_button: 'w-full h-full flex items-center justify-center rounded-lg text-[13px] font-medium text-slate-700 cursor-pointer hover:bg-slate-100 transition-colors',
            selected: '[&>button]:bg-slate-800 [&>button]:text-white [&>button]:hover:bg-slate-700',
            today: '[&>button]:ring-1 [&>button]:ring-slate-400 [&>button]:font-semibold',
            outside: '[&>button]:text-slate-300',
            disabled: '[&>button]:text-slate-300 [&>button]:cursor-not-allowed [&>button]:hover:bg-transparent',
          }}
        />
      </div>,
      document.body
    ) : null;

    return (
      <div ref={containerRef} className="relative">
        {label && (
          <label className="block text-[13px] font-medium text-foreground mb-1.5">{label}</label>
        )}
        <button
          ref={buttonRef}
          type="button"
          onClick={handleToggle}
          className={`led-input text-left flex items-center justify-between h-10 w-full cursor-pointer ${error ? '!border-[var(--led-danger)] !shadow-[0_0_0_3px_var(--led-danger-tint)]' : ''} ${className}`}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <span className={displayValue ? 'text-[var(--led-ink)]' : 'text-[var(--led-muted-2)]'}>
            {displayValue || placeholder}
          </span>
          <div className="flex items-center gap-1.5">
            {clearable && displayValue && (
              <span
                role="button"
                tabIndex={-1}
                onClick={handleClear}
                className="flex items-center justify-center w-4 h-4 rounded-sm text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </span>
            )}
            <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
            </svg>
          </div>
        </button>
        {error && <p className="mt-1.5 text-[12px] text-destructive font-medium">{error}</p>}

        <input
          ref={ref}
          type="date"
          value={value || ''}
          onChange={(e) => onChange?.(e.target.value)}
          className="sr-only"
          tabIndex={-1}
          {...props}
        />

        {dropdown}
      </div>
    );
  }
);

DatePicker.displayName = 'DatePicker';

export default DatePicker;
