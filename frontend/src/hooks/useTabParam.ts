import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Tab state backed by a URL search param, so tabs survive refresh, can be
 * deep-linked (?tab=documents), and back/forward walk through tab history.
 * The default tab keeps the param out of the URL; unknown values fall back
 * to the default so stale links land safely.
 */
export function useTabParam<T extends string>(
  defaultTab: T,
  validTabs: readonly T[],
  param = 'tab',
): [T, (tab: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get(param);
  const tab = raw && (validTabs as readonly string[]).includes(raw) ? (raw as T) : defaultTab;

  const setTab = useCallback(
    (next: T) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        if (next === defaultTab) params.delete(param);
        else params.set(param, next);
        return params;
      });
    },
    [setSearchParams, defaultTab, param],
  );

  return [tab, setTab];
}
