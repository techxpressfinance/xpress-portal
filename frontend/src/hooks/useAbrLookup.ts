import { useEffect, useState } from 'react';
import api from '../api/client';
import type { AbrRecord } from '../types';

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
