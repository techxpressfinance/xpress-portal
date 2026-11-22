import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDate } from '../lib/utils';
import type { ReferrerChange, ReferrerRef } from '../types';

const SOURCE_STYLE: Record<ReferrerChange['source'], { label: string; className: string }> = {
  created: { label: 'At creation', className: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300' },
  changed: { label: 'Changed', className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300' },
  backfill: { label: 'Carried over', className: 'bg-muted text-muted-foreground' },
};

const who = (r: ReferrerRef | null) =>
  r ? `${r.full_name || 'Unnamed referrer'}${r.organization_name ? ` (${r.organization_name})` : ''}` : 'No referrer';

/** The referrer credit trail, newest first: when, which application, from
 *  whom to whom, who changed it and why. On the contact and entity pages,
 *  pass `applicationLabel` so each step names its loan. */
export default function ReferrerHistory({ history, applicationLabel, emptyText = 'No referrer has been credited yet.', initialCount = 6 }: {
  history: ReferrerChange[];
  applicationLabel?: (applicationId: string) => string | null;
  emptyText?: string;
  /** Steps shown before "Show all". */
  initialCount?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  if (history.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  const shown = showAll ? history : history.slice(0, initialCount);
  return (
    <div>
    <ol className="relative space-y-3 border-l border-border pl-4">
      {shown.map((h) => {
        const style = SOURCE_STYLE[h.source] ?? SOURCE_STYLE.changed;
        const label = applicationLabel?.(h.application_id);
        return (
          <li key={h.id} className="relative">
            <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary/70" aria-hidden />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="tabular-nums text-muted-foreground">{formatDate(h.created_at)}</span>
              <span className={`rounded px-1.5 py-px text-[11px] font-medium ${style.className}`} title={h.source === 'backfill' ? h.note ?? h.source_label : h.source_label}>
                {style.label}
              </span>
              {label && (
                <Link to={`/admin/applications/${h.application_id}`} className="text-primary hover:underline">
                  {label}
                </Link>
              )}
            </div>
            <p className="mt-0.5 text-sm text-foreground">
              {h.source === 'changed' ? (
                <>
                  <span className="text-muted-foreground line-through decoration-muted-foreground/50">{who(h.from_referrer)}</span>
                  <span className="mx-1.5 text-muted-foreground" aria-label="changed to">→</span>
                  <span className="font-medium">{who(h.to_referrer)}</span>
                </>
              ) : (
                <>Credited to <span className="font-medium">{who(h.to_referrer)}</span></>
              )}
              {h.changed_by_name && <span className="text-muted-foreground"> · by {h.changed_by_name}</span>}
            </p>
            {h.note && h.source !== 'backfill' && <p className="mt-0.5 text-[13px] italic text-muted-foreground">&ldquo;{h.note}&rdquo;</p>}
          </li>
        );
      })}
    </ol>
    {history.length > initialCount && (
      <button type="button" className="mt-3 text-sm font-medium text-primary hover:underline" onClick={() => setShowAll((v) => !v)}>
        {showAll ? 'Show fewer' : `Show all ${history.length}`}
      </button>
    )}
    </div>
  );
}
