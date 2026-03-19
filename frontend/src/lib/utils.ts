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
