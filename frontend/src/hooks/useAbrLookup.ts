import { useEffect, useState } from 'react';
import api from '../api/client';
import type { AbrNameMatch, AbrRecord } from '../types';

export interface AbrLookupState {
  record: AbrRecord | null;
  loading: boolean;
  enabled: boolean;
}

/**
 * Debounced lookup against the Australian Business Register.
 *
 * Returns `enabled: false` when the backend doesn't have `ABR_GUID` configured —
 * callers should hide the ABR UI in that case.
 */
export function useAbrLookup(abn: string, debounceMs = 400): AbrLookupState {
  const [state, setState] = useState<AbrLookupState>({ record: null, loading: false, enabled: true });
  useEffect(() => {
    const digits = (abn || '').replace(/\D/g, '');
    if (digits.length !== 11) {
      setState(s => ({ ...s, record: null, loading: false }));
      return;
    }
    let cancelled = false;
    setState(s => ({ ...s, loading: true }));
    const t = setTimeout(() => {
      api.get('/organizations/abr-lookup', { params: { abn: digits } })
        .then(({ data }) => {
          if (cancelled) return;
          setState({
            record: data.record || null,
            loading: false,
            enabled: data.enabled !== false,
          });
        })
        .catch(() => {
          if (!cancelled) setState({ record: null, loading: false, enabled: true });
        });
    }, debounceMs);
    return () => { cancelled = true; clearTimeout(t); };
  }, [abn, debounceMs]);
  return state;
}

export interface AbrNameSearchState {
  matches: AbrNameMatch[];
  loading: boolean;
  enabled: boolean;
  searched: boolean;
}

interface AbrNameSearchResult {
  term: string;
  matches: AbrNameMatch[];
  enabled: boolean;
}

/**
 * Debounced ABR search by entity, business or trading name.
 *
 * Idle (and `searched: false`) until the term reaches 3 characters, so callers can
 * tell "nothing typed yet" apart from "searched and found nothing". Results are
 * tagged with the term that produced them, so a stale list is never shown while a
 * newer term is still in flight.
 */
export function useAbrNameSearch(name: string, debounceMs = 450): AbrNameSearchState {
  const term = (name || '').trim();
  const active = term.length >= 3;
  const [result, setResult] = useState<AbrNameSearchResult>({ term: '', matches: [], enabled: true });

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const t = setTimeout(() => {
      api.get('/organizations/abr-search', { params: { name: term } })
        .then(({ data }) => {
          if (!cancelled) setResult({ term, matches: data.matches || [], enabled: data.enabled !== false });
        })
        .catch(() => {
          if (!cancelled) setResult({ term, matches: [], enabled: true });
        });
    }, debounceMs);
    return () => { cancelled = true; clearTimeout(t); };
  }, [term, active, debounceMs]);

  const settled = active && result.term === term;
  return {
    matches: settled ? result.matches : [],
    loading: active && !settled,
    enabled: result.enabled,
    searched: settled,
  };
}
