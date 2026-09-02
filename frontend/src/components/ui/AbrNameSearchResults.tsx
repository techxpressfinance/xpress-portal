import { useState } from 'react';
import api from '../../api/client';
import type { AbrNameMatch, AbrRecord } from '../../types';

/** 51824753556 -> "51 824 753 556" (the way an ABN is written down). */
function formatAbn(abn: string): string {
  const d = (abn || '').replace(/\D/g, '');
  if (d.length !== 11) return abn;
  return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
}

/**
 * Typeahead panel for ABR name-search hits. Renders as an overlay anchored to the
 * field above it, so the form underneath doesn't reflow while the user types — the
 * parent must be `relative`.
 *
 * Selecting a row resolves the full ABR record by ABN before handing it to
 * `onSelect`, so callers always get the registered entity name rather than the
 * trading name the search happened to match on.
 */
export default function AbrNameSearchResults({
  matches,
  loading,
  searched,
  onSelect,
  onDismiss,
}: {
  matches: AbrNameMatch[];
  loading?: boolean;
  searched?: boolean;
  onSelect: (record: AbrRecord, match: AbrNameMatch) => void;
  onDismiss?: () => void;
}) {
  const [resolving, setResolving] = useState<string | null>(null);

  const choose = async (match: AbrNameMatch) => {
    setResolving(match.abn);
    try {
      const { data } = await api.get('/organizations/abr-lookup', { params: { abn: match.abn } });
      if (data.record) onSelect(data.record, match);
    } catch {
      // Leave the panel open so the user can retry or pick another row.
    } finally {
      setResolving(null);
    }
  };

  const shell = 'absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border bg-background shadow-lg';

  if (loading) {
    return (
      <div className={`${shell} px-3 py-2 text-[12px] text-muted-foreground`}>
        Searching the Australian Business Register…
      </div>
    );
  }
  if (!matches.length) {
    if (!searched) return null;
    return (
      <div className={`${shell} px-3 py-2 text-[12px] text-muted-foreground`}>
        No ABR matches for that name.
      </div>
    );
  }

  return (
    <div className={shell}>
      <div className="flex items-center justify-between gap-2 border-b border-border bg-secondary/40 px-3 py-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Australian Business Register · {matches.length}
        </span>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            Dismiss
          </button>
        )}
      </div>
      <ul className="max-h-64 overflow-y-auto">
        {matches.map(m => {
          const cancelled = (m.status || '').toLowerCase() === 'cancelled';
          const place = [m.state, m.postcode].filter(Boolean).join(' ');
          return (
            <li key={m.abn} className="border-b border-border/50 last:border-b-0">
              <button
                type="button"
                disabled={resolving !== null}
                onClick={() => choose(m)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-secondary/60 disabled:opacity-60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] leading-tight text-foreground">{m.name}</span>
                  <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground">
                    <span className="tabular-nums">{formatAbn(m.abn)}</span>
                    {m.name_type ? ` · ${m.name_type}` : ''}
                    {place ? ` · ${place}` : ''}
                  </span>
                </span>
                {cancelled && (
                  <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-destructive/10 text-destructive">
                    Cancelled
                  </span>
                )}
                {resolving === m.abn && (
                  <span className="shrink-0 text-[11px] text-muted-foreground">Loading…</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
