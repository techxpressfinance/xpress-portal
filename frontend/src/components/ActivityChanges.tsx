import type { FieldChange } from '../lib/activityLog';

const EMPTY = '—';

/**
 * Before/after detail for an activity-log entry.
 *
 * Fields whose column is encrypted at rest come back without values — the log
 * records that they changed, not what they changed to.
 */
export default function ActivityChanges({ changes, fields }: { changes: FieldChange[]; fields: string[] }) {
  if (changes.length === 0 && fields.length === 0) return null;

  return (
    <div className="mt-1.5 space-y-1">
      {changes.map((change) => (
        <div key={change.field} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12.5px]">
          <span className="font-medium text-foreground">{change.field}</span>
          {change.redacted ? (
            <span className="text-muted-foreground italic">changed (value hidden)</span>
          ) : (
            <>
              <span className="text-muted-foreground line-through decoration-muted-foreground/40">
                {change.from ?? EMPTY}
              </span>
              <span className="text-muted-foreground">&rarr;</span>
              <span className="font-medium text-foreground">{change.to ?? EMPTY}</span>
            </>
          )}
        </div>
      ))}
      {/* Older entries recorded only which fields were touched. */}
      {fields.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {fields.map((field) => (
            <span key={field} className="rounded-md bg-secondary px-2 py-0.5 text-[12px] font-medium text-muted-foreground">
              {field}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
