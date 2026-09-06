import type { User } from '../../types';

const referrerName = (r: User) => r.full_name || r.email || 'Unnamed referrer';

/**
 * Typeahead panel for the tenant's referrer accounts.
 *
 * By default it floats over the field above it — the parent must be `relative`.
 * Pass `inline` inside a short card: `.led-card` clips its overflow, so an
 * overlay that runs past the card's bottom edge is cut off rather than drawn
 * over the next card, and the list has to sit in the flow instead.
 *
 * The sibling of {@link ClientSearchResults}. Crediting the right referrer is
 * what gets them paid, so each row carries what tells two same-named referrers
 * apart — their email and the organisation they refer under — and flags a
 * deactivated account rather than letting it be picked blind.
 */
export default function ReferrerSearchResults({
  matches,
  loading,
  searched,
  heading,
  emptyLabel,
  inline = false,
  onSelect,
  onDismiss,
}: {
  matches: User[];
  loading?: boolean;
  searched?: boolean;
  /** Panel label — defaults to the count of matches. */
  heading?: string;
  /** Shown when a settled search matched nothing. Silent when omitted. */
  emptyLabel?: string;
  /** Render in the document flow instead of floating over the field. */
  inline?: boolean;
  onSelect: (referrer: User) => void;
  onDismiss?: () => void;
}) {
  const shell = inline
    ? 'mt-2 overflow-hidden rounded-xl border border-border bg-background'
    : 'absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border bg-background shadow-lg';

  if (loading) {
    return (
      <div className={`${shell} px-3 py-2 text-[12px] text-muted-foreground`}>
        Searching referrers…
      </div>
    );
  }
  if (!matches.length) {
    if (!searched || !emptyLabel) return null;
    return (
      <div className={`${shell} px-3 py-2 text-[12px] text-muted-foreground`}>
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className={shell}>
      <div className="flex items-center justify-between gap-2 border-b border-border bg-secondary/40 px-3 py-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {heading || `Referrers · ${matches.length}`}
        </span>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            No referrer
          </button>
        )}
      </div>
      <ul className="max-h-64 overflow-y-auto">
        {matches.map((r) => {
          const detail = [r.email, r.organization_name].filter(Boolean).join(' · ');
          return (
            <li key={r.id} className="border-b border-border/50 last:border-b-0">
              <button
                type="button"
                onClick={() => onSelect(r)}
                className={`flex w-full items-center gap-2 px-3 text-left transition-colors hover:bg-secondary/60 ${inline ? 'py-2.5' : 'py-1.5'}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] leading-tight text-foreground">{referrerName(r)}</span>
                  {detail && (
                    <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground">
                      {detail}
                    </span>
                  )}
                </span>
                {!r.is_active && (
                  <span
                    className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                    title="This referrer's account is deactivated"
                  >
                    Inactive
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
