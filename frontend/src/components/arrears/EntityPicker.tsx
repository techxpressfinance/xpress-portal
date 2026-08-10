import { useEffect, useRef, useState } from 'react';
import api from '../../api/client';
import type { Contact, Organization } from '../../types';

type Picked = { id: string; label: string };

/**
 * Type-ahead over contacts or companies. Arrears records must attach to a real
 * portal record (that's what makes them show up on contact/company pages), so
 * this deliberately offers no free-text fallback — an unknown party has to be
 * created in Contacts/Companies first.
 */
export default function EntityPicker({
  kind,
  value,
  valueLabel,
  onChange,
  label,
  placeholder,
  disabled,
}: {
  kind: 'contact' | 'organization';
  value: string | null;
  valueLabel: string | null;
  onChange: (picked: Picked | null) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Picked[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        if (kind === 'contact') {
          const { data } = await api.get<{ items: Contact[] }>('/contacts', {
            params: { search: term, per_page: 8 },
          });
          if (!cancelled) {
            setResults(data.items.map((c) => ({
              id: c.id,
              label: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || 'Unnamed',
            })));
          }
        } else {
          const { data } = await api.get<{ items: Organization[] }>('/organizations', {
            params: { search: term, per_page: 8 },
          });
          if (!cancelled) setResults(data.items.map((o) => ({ id: o.id, label: o.name })));
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, kind]);

  if (value) {
    return (
      <div>
        <label className="block text-[13px] font-medium text-foreground mb-1.5">{label}</label>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2">
          <span className="truncate text-[14px] text-foreground">{valueLabel || value}</span>
          {!disabled && (
            <button
              type="button"
              onClick={() => { onChange(null); setQuery(''); }}
              className="shrink-0 text-[12px] font-medium text-muted-foreground hover:text-destructive"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <label className="block text-[13px] font-medium text-foreground mb-1.5">{label}</label>
      <input
        className="led-input !h-10 !text-[14px]"
        value={query}
        disabled={disabled}
        placeholder={placeholder ?? `Search ${kind === 'contact' ? 'clients' : 'companies'}…`}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && query.trim().length >= 2 && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
          {searching && <p className="px-3 py-2 text-[13px] text-muted-foreground">Searching…</p>}
          {!searching && results.length === 0 && (
            <p className="px-3 py-2 text-[13px] text-muted-foreground">
              No match. Create the {kind === 'contact' ? 'client' : 'company'} first.
            </p>
          )}
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => { onChange(r); setQuery(''); setOpen(false); }}
              className="block w-full truncate px-3 py-2 text-left text-[13px] text-foreground hover:bg-secondary"
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
