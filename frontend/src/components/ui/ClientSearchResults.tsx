import type { Contact } from '../../types';

const contactName = (c: Contact) =>
  [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || 'Unnamed contact';

/**
 * Typeahead panel for clients already in the tenant's book, anchored to the
 * field above it — the parent must be `relative`.
 *
 * The sibling of {@link EntitySearchResults}, and the answer to the same
 * problem: a client typed in fresh each time becomes several people. Each row
 * carries what tells two same-named clients apart — their email, the companies
 * they're linked to, how many applications they already have — and says whether
 * they already have a portal login, since choosing someone who does reuses
 * their account instead of creating a second one.
 */
export default function ClientSearchResults({
  matches,
  loading,
  searched,
  onSelect,
  onDismiss,
}: {
  matches: Contact[];
  loading?: boolean;
  searched?: boolean;
  onSelect: (contact: Contact) => void;
  onDismiss?: () => void;
}) {
  const shell = 'absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border bg-background shadow-lg';

  if (loading) {
    return (
      <div className={`${shell} px-3 py-2 text-[12px] text-muted-foreground`}>
        Searching your clients…
      </div>
    );
  }
  // Nobody on file is the normal case for a genuinely new client — stay silent
  // rather than nagging about it on every keystroke of a new name.
  if (!matches.length || !searched) return null;

  return (
    <div className={shell}>
      <div className="flex items-center justify-between gap-2 border-b border-border bg-secondary/40 px-3 py-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Your clients · {matches.length}
        </span>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            New client
          </button>
        )}
      </div>
      <ul className="max-h-64 overflow-y-auto">
        {matches.map((c) => {
          const orgs = (c.organizations || []).map((o) => o.name).filter(Boolean);
          const detail = [
            c.email,
            orgs.length ? orgs.join(', ') : null,
            c.application_count
              ? `${c.application_count} application${c.application_count === 1 ? '' : 's'}`
              : null,
          ].filter(Boolean).join(' · ');
          return (
            <li key={c.id} className="border-b border-border/50 last:border-b-0">
              <button
                type="button"
                onClick={() => onSelect(c)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-secondary/60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] leading-tight text-foreground">{contactName(c)}</span>
                  {detail && (
                    <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground">
                      {detail}
                    </span>
                  )}
                </span>
                {c.client_account && (
                  <span
                    className="shrink-0 rounded bg-chart-2/10 px-1.5 py-0.5 text-[10px] font-medium text-chart-2"
                    title="This client already has a portal login — choosing them reuses it"
                  >
                    Has login
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
