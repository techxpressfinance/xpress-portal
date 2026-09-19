import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ClientSearchResults } from './ui';
import { UserIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useClientSearch } from '../hooks/useClientSearch';
import { rafThrottle } from '../lib/utils';
import type { Contact, ReferredBy } from '../types';

function contactToReferredBy(contact: Contact): ReferredBy {
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim();
  return { contact_id: contact.id, name: name || contact.email || 'Unnamed contact', email: contact.email };
}

/**
 * Pick the existing client who referred a deal. Searches the contact book, so a
 * past client with no portal login can be credited. Marketing attribution only
 * — see LoanApplication.referred_by_contact_id.
 */
export default function ReferredByPicker({
  value,
  onChange,
  disabled,
  placeholder = 'Referred by an existing client? Search by name, email or phone…',
}: {
  value: ReferredBy | null;
  onChange: (next: ReferredBy | null) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [term, setTerm] = useState('');
  const matches = useClientSearch(value ? '' : term);
  // The results render in a portal pinned under the input: inline, they sit in
  // the enclosing card's stacking context and the next card paints over them.
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
        <UserIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Referred by <strong>{value.name}</strong>
          {value.email && <span style={{ color: 'var(--led-muted)' }}> · {value.email}</span>}
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
        placeholder={placeholder}
        value={term}
        disabled={disabled}
        onChange={(e) => setTerm(e.target.value)}
        style={{ width: '100%' }}
      />
      {showResults && anchor && createPortal(
        // Zero-height box at the input's bottom edge; the results hang off it
        // (they position themselves top-full of their parent).
        <div style={anchor}>
          <div style={{ position: 'relative', height: 0 }}>
            <ClientSearchResults
              matches={matches.matches}
              loading={matches.loading}
              searched={matches.searched}
              onSelect={(contact) => { onChange(contactToReferredBy(contact)); setTerm(''); }}
              onDismiss={() => setTerm('')}
            />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
