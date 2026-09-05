import { useEffect, useState } from 'react';
import api from '../api/client';
import type { EntitySearchResult } from '../types';

export interface EntitySearchState {
  matches: EntitySearchResult[];
  loading: boolean;
  searched: boolean;
}

interface EntitySearchResponse {
  term: string;
  matches: EntitySearchResult[];
}

/**
 * Debounced typeahead over the tenant's own entity book.
 *
 * The counterpart to {@link useAbrNameSearch}: this searches entities we already
 * hold, so the business-details fields can link an application to the existing
 * company (and its directors) instead of minting another stub for a name that is
 * already on file. Staff-only endpoint — callers on client/referrer forms should
 * not use it.
 *
 * Idle (and `searched: false`) until the term reaches 2 characters, and results
 * carry the term that produced them so a stale list is never shown while a newer
 * term is in flight.
 */
export function useEntitySearch(name: string, debounceMs = 250): EntitySearchState {
  const term = (name || '').trim();
  const active = term.length >= 2;
  const [result, setResult] = useState<EntitySearchResponse>({ term: '', matches: [] });

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const t = setTimeout(() => {
      api.get<EntitySearchResult[]>('/organizations/search', { params: { q: term } })
        .then(({ data }) => {
          if (!cancelled) setResult({ term, matches: data || [] });
        })
        .catch(() => {
          if (!cancelled) setResult({ term, matches: [] });
        });
    }, debounceMs);
    return () => { cancelled = true; clearTimeout(t); };
  }, [term, active, debounceMs]);

  const settled = active && result.term === term;
  return {
    matches: settled ? result.matches : [],
    loading: active && !settled,
    searched: settled,
  };
}
