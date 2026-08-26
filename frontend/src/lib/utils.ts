/**
 * Extract a user-friendly error message from an API error.
 */
export function getErrorMessage(err: unknown, fallback: string): string {
  // Axios errors are Error instances, so check the API response detail first —
  // otherwise we'd return the generic "Request failed with status code 409".
  if (err && typeof err === 'object' && 'response' in err) {
    const detail = (err as any).response?.data?.detail;
    // Pydantic v2 validation errors: array of {msg, loc, type, input}
    if (Array.isArray(detail)) {
      const msg = detail[0]?.msg;
      // Pydantic prefixes custom validator messages with "Value error, " —
      // drop it so the toast reads as a sentence.
      if (typeof msg === 'string') return msg.replace(/^Value error,\s*/, '');
    }
    if (typeof detail === 'string' && detail) return detail;
  }
  if (err instanceof Error) {
    return err.message || fallback;
  }
  return fallback;
}

// SQLite strips timezone info; bare strings from the API must be treated as UTC.
function parseAsUTC(date: string | Date): Date {
  if (typeof date === 'string' && !date.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(date)) {
    return new Date(date + 'Z');
  }
  return new Date(date as string);
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—';
  return parseAsUTC(date).toLocaleDateString('en-AU');
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return '—';
  return parseAsUTC(date).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Convert a stored (UTC) datetime into a value for <input type="datetime-local"> in local time. */
export function toDateTimeLocalInput(date: string | Date | null | undefined): string {
  if (!date) return '';
  const d = parseAsUTC(date);
  if (isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

/** Convert a local <input type="datetime-local"> value into a UTC ISO string for the API. */
export function dateTimeLocalToUTC(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function formatTime(date: string | Date | null | undefined): string {
  if (!date) return '—';
  return parseAsUTC(date).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
}

export function formatShortDate(date: string | Date | null | undefined): string {
  if (!date) return '—';
  return parseAsUTC(date).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' });
}

/**
 * Get up to 2-character uppercase initials from a full name.
 */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Human-friendly relative time (e.g. "3d ago", "just now").
 */
export function relativeTime(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const then = parseAsUTC(date).getTime();
  if (Number.isNaN(then)) return '—';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

/**
 * Whole-dollar money with comma separators. e.g. 1_500_000 → "$1,500,000".
 */
export function fmtMoneyK(n: number): string {
  if (!Number.isFinite(n)) return '$0';
  return '$' + Math.round(n).toLocaleString('en-AU');
}

/**
 * Deterministic OKLCH avatar color from a seed string.
 */
export function avatarColor(seed: string): string {
  const hues = [25, 60, 165, 210, 268, 300, 340];
  let sum = 0;
  for (let i = 0; i < seed.length; i++) sum += seed.charCodeAt(i);
  return `oklch(0.62 0.14 ${hues[sum % hues.length]})`;
}

/**
 * Whole-number days elapsed since a timestamp. Returns 0 for invalid dates.
 */
export function daysSince(date: string | Date | null | undefined): number {
  if (!date) return 0;
  const then = parseAsUTC(date).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}
