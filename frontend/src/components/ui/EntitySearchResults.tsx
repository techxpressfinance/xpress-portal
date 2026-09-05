import { ENTITY_TYPE_CONFIG } from '../../lib/constants';
import type { EntitySearchResult, EntityType } from '../../types';

/** 51824753556 -> "51 824 753 556" (the way an ABN is written down). */
function formatAbn(abn: string): string {
  const d = (abn || '').replace(/\D/g, '');
  if (d.length !== 11) return abn;
  return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
}

/**
 * Typeahead panel for entities already in the tenant's book, anchored to the
 * field above it — the parent must be `relative`.
 *
 * Sits above {@link AbrNameSearchResults} in precedence: an entity we already
 * hold carries its ABN, its structure and its directors, so linking to it beats
 * re-registering the same company from the ABR under a new stub. Each row says
 * how many directors are on file, since those are the people who come across as
 * parties when the entity is the applicant.
 */
export default function EntitySearchResults({
  matches,
  loading,
  searched,
  onSelect,
  onDismiss,
}: {
  matches: EntitySearchResult[];
  loading?: boolean;
  searched?: boolean;
  onSelect: (entity: EntitySearchResult) => void;
  onDismiss?: () => void;
}) {
  const shell = 'absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border bg-background shadow-lg';

  if (loading) {
    return (
      <div className={`${shell} px-3 py-2 text-[12px] text-muted-foreground`}>
        Searching your entities…
      </div>
    );
  }
  // Nothing on file is the normal case for a new company — stay silent and let
  // the ABR panel underneath take the field.
  if (!matches.length || !searched) return null;

  return (
    <div className={shell}>
      <div className="flex items-center justify-between gap-2 border-b border-border bg-secondary/40 px-3 py-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Your entities · {matches.length}
        </span>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            Dismiss
          </button>
        )}
      </div>
      <ul className="max-h-64 overflow-y-auto">
        {matches.map((e) => {
          const typeConfig = e.entity_type ? ENTITY_TYPE_CONFIG[e.entity_type as EntityType] : null;
          const detail = [
            e.abn ? formatAbn(e.abn) : null,
            e.director_count ? `${e.director_count} director${e.director_count === 1 ? '' : 's'} on file` : null,
            e.application_count ? `${e.application_count} application${e.application_count === 1 ? '' : 's'}` : null,
          ].filter(Boolean).join(' · ');
          return (
            <li key={e.id} className="border-b border-border/50 last:border-b-0">
              <button
                type="button"
                onClick={() => onSelect(e)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-secondary/60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] leading-tight text-foreground">{e.name}</span>
                  {detail && (
                    <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground tabular-nums">
                      {detail}
                    </span>
                  )}
                </span>
                {typeConfig && (
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${typeConfig.className}`}>
                    {typeConfig.label}
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
