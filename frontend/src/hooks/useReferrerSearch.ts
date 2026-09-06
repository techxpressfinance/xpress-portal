import { useEffect, useState } from 'react';
import api from '../api/client';
import type { User } from '../types';

export interface ReferrerSearchState {
  matches: User[];
  loading: boolean;
  searched: boolean;
}

interface ReferrerSearchResponse {
  term: string;
  matches: User[];
}

/**
 * Debounced typeahead over the tenant's referrer accounts.
 *
 * The sibling of {@link useClientSearch}, for crediting a lead that arrived
 * outside the portal. A dropdown of every referrer stops scaling the moment a
 * tenant has more than a screenful of them, so the list is searched on the
 * server instead: name, email and organisation are all plaintext columns on
 * `User`, so `/users` matches them with a plain LIKE.
 *
 * Staff-only endpoint. Idle (and `searched: false`) until 2 characters.
 */
export function useReferrerSearch(term: string, debounceMs = 250): ReferrerSearchState {
  const q = (term || '').trim();
  const active = q.length >= 2;
  const [result, setResult] = useState<ReferrerSearchResponse>({ term: '', matches: [] });

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const t = setTimeout(() => {
      api.get<User[]>('/users', { params: { role: 'referrer', search: q, limit: 8 } })
        .then(({ data }) => {
          if (!cancelled) setResult({ term: q, matches: Array.isArray(data) ? data : [] });
        })
        .catch(() => {
          if (!cancelled) setResult({ term: q, matches: [] });
        });
    }, debounceMs);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, active, debounceMs]);

  const settled = active && result.term === q;
  return {
    matches: settled ? result.matches : [],
    loading: active && !settled,
    searched: settled,
  };
}
