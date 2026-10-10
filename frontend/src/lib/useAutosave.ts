import { useEffect, useRef } from 'react';

/** Run `save` a moment after the last edit while `dirty` is set. `version`
 *  should change on every edit so the wait restarts as the user types. */
export function useAutosave(dirty: boolean, version: unknown, save: () => void | Promise<void>, delayMs = 1000) {
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; });
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => { void saveRef.current(); }, delayMs);
    return () => clearTimeout(t);
  }, [dirty, version, delayMs]);
}
