/**
 * Extract a user-friendly error message from an API error.
 */
export function getErrorMessage(err: unknown, fallback: string): string {
  if (
    err &&
    typeof err === 'object' &&
    'response' in err &&
    (err as any).response?.data?.detail
  ) {
    return (err as any).response.data.detail;
  }
  return fallback;
}

/**
 * Format a date string or Date object to locale date string.
 */
export function formatDate(dateStr: string | Date): string {
  return new Date(dateStr).toLocaleDateString();
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
  const then = new Date(date).getTime();
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
 * Whole-dollar money with k/M suffix. e.g. 1_500_000 → "$1.5M".
 */
export function fmtMoneyK(n: number): string {
  if (!Number.isFinite(n)) return '$0';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (abs >= 1_000) return '$' + Math.round(n / 1_000) + 'k';
  return '$' + Math.round(n);
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
  const then = new Date(date).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}
