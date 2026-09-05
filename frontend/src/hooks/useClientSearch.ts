import { useEffect, useState } from 'react';
import api from '../api/client';
import type { Contact, PaginatedResponse } from '../types';

export interface ClientSearchState {
  matches: Contact[];
  loading: boolean;
  searched: boolean;
}

interface ClientSearchResponse {
  term: string;
  matches: Contact[];
}

/**
 * Debounced typeahead over the tenant's own clients.
 *
 * The client half of {@link useEntitySearch}: without it a client is only ever
 * identified by a typed email address, and one typo mints a second person —
 * and a second portal account — for the same human.
 *
 * Contact PII is encrypted at rest, so the list endpoint's `search` scores
 * against the decrypted-fields cache rather than SQL LIKE; name, email, phone
 * and licence number all match. Linked companies and the existing portal
 * account come back with each row so two same-named people can be told apart.
 *
 * Staff-only endpoint. Idle (and `searched: false`) until 2 characters.
 */
export function useClientSearch(term: string, debounceMs = 250): ClientSearchState {
  const q = (term || '').trim();
  const active = q.length >= 2;
  const [result, setResult] = useState<ClientSearchResponse>({ term: '', matches: [] });

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const t = setTimeout(() => {
      api.get<PaginatedResponse<Contact>>('/contacts', {
        params: {
          search: q,
          per_page: 8,
          include_organizations: true,
          include_client_account: true,
        },
      })
        .then(({ data }) => {
          if (!cancelled) setResult({ term: q, matches: data.items || [] });
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
