/**
 * Storage for an unsaved application draft.
 *
 * A draft holds the applicant's identity, income and ID details, so it lives in
 * sessionStorage: it survives a refresh, but ends with the tab and never
 * outlives a sign-out (see clearAllDrafts). It used to be written to
 * localStorage, which left that PII on shared computers indefinitely — any
 * draft still there is moved across once and removed.
 */
const DRAFT_PREFIX = 'application-draft-';

export function draftKeyFor(userId: string | undefined | null): string | null {
  return userId ? `${DRAFT_PREFIX}${userId}` : null;
}

export function readDraft(key: string): string | null {
  try {
    const legacy = localStorage.getItem(key);
    if (legacy !== null) {
      localStorage.removeItem(key);
      if (sessionStorage.getItem(key) === null) sessionStorage.setItem(key, legacy);
    }
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function hasDraft(key: string): boolean {
  return readDraft(key) !== null;
}

export function writeDraft(key: string, value: string): void {
  try { sessionStorage.setItem(key, value); } catch { /* storage unavailable — draft not kept */ }
}

export function clearDraft(key: string): void {
  try { sessionStorage.removeItem(key); } catch { /* ignore */ }
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

/** Remove every user's draft from this browser. Called on sign-out. */
export function clearAllDrafts(): void {
  for (const store of [sessionStorage, localStorage]) {
    try {
      Object.keys(store)
        .filter((k) => k.startsWith(DRAFT_PREFIX))
        .forEach((k) => store.removeItem(k));
    } catch { /* ignore */ }
  }
}
