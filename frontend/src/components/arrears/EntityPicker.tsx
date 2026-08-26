import { useEffect, useRef, useState } from 'react';
import api from '../../api/client';
import type { Contact, Organization } from '../../types';

/** A pick carries the company when the chosen row was a specific
 *  client↔company relation, so the modal can fill both sides at once. */
type Picked = { id: string; label: string; organization?: { id: string; name: string } | null };

/** A row in the dropdown: the pick itself plus the line under it that says
 *  which relation this is — the whole point when one person sits on several
 *  entities and only one of them holds the contract. */
type Row = Picked & { sublabel?: string };

/** ABNs are stored as typed, so show them as stored (matching Companies). */
const abnLine = (abn: string | null) => (abn ? `ABN ${abn}` : 'No ABN recorded');

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
  const [results, setResults] = useState<Row[]>([]);
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
            params: { search: term, per_page: 8, include_organizations: true },
          });
          if (cancelled) return;
          // One row per relation, not per person: a director of three entities
          // is three different contracts to choose between, and the sub-line
          // is what tells them apart. The trailing entity-less row keeps a
          // genuinely consumer contract from being pinned to a company.
          setResults(data.items.flatMap((c) => {
            const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || 'Unnamed';
            const orgs = c.organizations ?? [];
            if (orgs.length === 0) return [{ id: c.id, label: name, sublabel: c.email ?? undefined }];
            return [
              ...orgs.map((o) => ({
                id: c.id,
                label: name,
                organization: { id: o.id, name: o.name },
                sublabel: [o.name, o.role, abnLine(o.abn)].filter(Boolean).join(' · '),
              })),
              { id: c.id, label: name, organization: null, sublabel: 'No entity — consumer contract' },
            ];
          }));
        } else {
          const { data } = await api.get<{ items: Organization[] }>('/organizations', {
            params: { search: term, per_page: 8 },
          });
          if (!cancelled) {
            setResults(data.items.map((o) => ({
              id: o.id,
              label: o.name,
              sublabel: o.entity_type === 'trust' && !o.abn && o.no_abn_confirmed
                ? 'No ABN (confirmed)'
                : abnLine(o.abn),
            })));
          }
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
        placeholder={placeholder ?? `Search ${kind === 'contact' ? 'clients' : 'entities'}…`}
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
              key={`${r.id}:${r.organization?.id ?? 'none'}`}
              type="button"
              onClick={() => { onChange(r); setQuery(''); setOpen(false); }}
              className="block w-full px-3 py-2 text-left hover:bg-secondary"
            >
              <span className="block truncate text-[13px] text-foreground">{r.label}</span>
              {r.sublabel && (
                <span className="block truncate text-[12px] text-muted-foreground">{r.sublabel}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
