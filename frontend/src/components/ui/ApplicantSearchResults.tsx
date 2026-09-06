import { ENTITY_TYPE_CONFIG } from '../../lib/constants';
import { formatAbn } from '../../lib/acn';
import type { Contact, EntitySearchResult, EntityType } from '../../types';

const contactName = (c: Contact) =>
  [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || 'Unnamed contact';

const GROUP_CLS = 'border-b border-border bg-secondary/40 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground';
const ROW_CLS = 'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-secondary/60';

/**
 * One typeahead over both books at once — the tenant's clients and its entities
 * — anchored to the field above it (the parent must be `relative`).
 *
 * The applicant on a file is a person on some deals and a company on others, and
 * which one it is isn't known until the broker recognises the name they typed.
 * Searching only contacts forces that decision up front and hides the entity
 * that is already on file, so the same company gets retyped into a second stub.
 * Both kinds of row come back from one term; picking decides the applicant type.
 *
 * The single-book siblings, {@link ClientSearchResults} and
 * {@link EntitySearchResults}, still serve the fields that can only take one.
 */
export default function ApplicantSearchResults({
  contacts,
  entities,
  loading,
  searched,
  onSelectContact,
  onSelectEntity,
  onDismiss,
}: {
  contacts: Contact[];
  entities: EntitySearchResult[];
  loading?: boolean;
  searched?: boolean;
  onSelectContact: (contact: Contact) => void;
  onSelectEntity: (entity: EntitySearchResult) => void;
  onDismiss?: () => void;
}) {
  const shell = 'absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border bg-background shadow-lg';

  if (loading) {
    return (
      <div className={`${shell} px-3 py-2 text-[12px] text-muted-foreground`}>
        Searching your clients and entities…
      </div>
    );
  }
  // Nothing on file is the normal case for a genuinely new client — stay silent
  // rather than nagging about it on every keystroke of a new name.
  if ((!contacts.length && !entities.length) || !searched) return null;

  return (
    <div className={shell}>
      {onDismiss && (
        <div className="flex items-center justify-end border-b border-border bg-secondary/40 px-3 py-1">
          <button
            type="button"
            onClick={onDismiss}
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            Neither — start fresh
          </button>
        </div>
      )}
      <div className="max-h-72 overflow-y-auto">
        {contacts.length > 0 && (
          <>
            <p className={GROUP_CLS}>People · {contacts.length}</p>
            <ul>
              {contacts.map((c) => {
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
                    <button type="button" onClick={() => onSelectContact(c)} className={ROW_CLS}>
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
          </>
        )}
        {entities.length > 0 && (
          <>
            <p className={GROUP_CLS}>Businesses &amp; entities · {entities.length}</p>
            <ul>
              {entities.map((e) => {
                const typeConfig = e.entity_type ? ENTITY_TYPE_CONFIG[e.entity_type as EntityType] : null;
                const detail = [
                  e.abn ? `ABN ${formatAbn(e.abn)}` : 'No ABN on file',
                  e.director_count ? `${e.director_count} director${e.director_count === 1 ? '' : 's'} on file` : null,
                  e.application_count
                    ? `${e.application_count} application${e.application_count === 1 ? '' : 's'}`
                    : null,
                ].filter(Boolean).join(' · ');
                return (
                  <li key={e.id} className="border-b border-border/50 last:border-b-0">
                    <button type="button" onClick={() => onSelectEntity(e)} className={ROW_CLS}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] leading-tight text-foreground">{e.name}</span>
                        <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground tabular-nums">
                          {detail}
                        </span>
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
          </>
        )}
      </div>
    </div>
  );
}
