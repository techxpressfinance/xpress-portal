import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ReferrerSearchResults } from './ui';
import { BriefcaseIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useReferrerSearch } from '../hooks/useReferrerSearch';
import { rafThrottle } from '../lib/utils';

export interface PickedReferrer {
  id: string;
  name: string;
}

/**
 * Pick the referrer partner who sent a lead — the sibling of ReferredByPicker,
 * which credits an existing client instead. A lead tagged here appears on the
 * referrer's progress link, and so does the application it converts into.
 */
export default function ReferrerPicker({
  value,
  onChange,
  disabled,
}: {
  value: PickedReferrer | null;
  onChange: (next: PickedReferrer | null) => void;
  disabled?: boolean;
}) {
  const [term, setTerm] = useState('');
  const matches = useReferrerSearch(value ? '' : term);
  // Portalled for the same reason as ReferredByPicker: inline, the results sit
  // in the modal's scroll container and get clipped.
  const inputRef = useRef<HTMLInputElement>(null);
  const [anchor, setAnchor] = useState<CSSProperties | null>(null);
  const showResults = !value && term.trim().length >= 2;

  useLayoutEffect(() => {
    if (!showResults) return;
    const place = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (rect) setAnchor({ position: 'fixed', top: rect.bottom, left: rect.left, width: rect.width, height: 0, zIndex: 9999 });
    };
    place();
    const reposition = rafThrottle(place);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      reposition.cancel();
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [showResults]);

  if (value) {
    return (
      <div className="led-input" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <BriefcaseIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Sent by referrer <strong>{value.name}</strong>
        </span>
        {!disabled && (
          <button
            type="button"
            className="led-btn led-btn-ghost led-btn-sm led-btn-icon"
            onClick={() => { onChange(null); setTerm(''); }}
            title="Remove referrer"
            aria-label="Remove referrer"
          >
            <XMarkIcon className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="text"
        className="led-input"
        placeholder="Sent by a referrer partner? Search by name, email or organisation…"
        value={term}
        disabled={disabled}
        onChange={(e) => setTerm(e.target.value)}
        style={{ width: '100%' }}
      />
      {showResults && anchor && createPortal(
        <div style={anchor}>
          <div style={{ position: 'relative', height: 0 }}>
            <ReferrerSearchResults
              matches={matches.matches}
              loading={matches.loading}
              searched={matches.searched}
              emptyLabel="No referrer matches that search"
              onSelect={(r) => { onChange({ id: r.id, name: r.full_name || r.email }); setTerm(''); }}
              onDismiss={() => setTerm('')}
            />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
