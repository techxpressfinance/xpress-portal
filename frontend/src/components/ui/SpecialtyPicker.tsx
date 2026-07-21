import { LOAN_CATEGORIES } from '../../lib/constants';
import type { LoanCategory } from '../../types';

interface SpecialtyPickerProps {
  value: LoanCategory[];
  onChange: (next: LoanCategory[]) => void;
  disabled?: boolean;
}

/**
 * Multi-select of the loan categories a broker specialises in. Advisory only —
 * specialties default a broker's board and application views, they never limit
 * what they can open or be assigned.
 */
export default function SpecialtyPicker({ value, onChange, disabled }: SpecialtyPickerProps) {
  const toggle = (category: LoanCategory) =>
    onChange(value.includes(category) ? value.filter((c) => c !== category) : [...value, category]);

  return (
    <div className="flex flex-wrap gap-2">
      {LOAN_CATEGORIES.map((c) => {
        const selected = value.includes(c.value);
        return (
          <button
            key={c.value}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => toggle(c.value)}
            // Selection colour must come from a led-chip-* variant: .led-chip is
            // unlayered CSS, so it outranks Tailwind's layered bg-/text- utilities.
            className={`led-chip cursor-pointer transition-opacity disabled:opacity-50 disabled:cursor-not-allowed ${selected ? 'led-chip-accent' : 'opacity-70 hover:opacity-100'}`}
          >
            <span aria-hidden="true" style={{ fontSize: 10, width: 8 }}>{selected ? '✓' : ''}</span>
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
