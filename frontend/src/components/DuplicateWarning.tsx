import { AlertTriangle, ExternalLink } from 'lucide-react';
import type { DuplicateMatchView } from '../hooks/useDuplicateCheck';

export function DuplicateWarning({ matches }: { matches: DuplicateMatchView[] }) {
  if (matches.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 space-y-1.5">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        {matches.length === 1 ? 'A similar record already exists' : `${matches.length} similar records already exist`}
      </p>
      <ul className="space-y-1">
        {matches.map(m => (
          <li key={m.id} className="flex flex-wrap items-center gap-x-2 text-[12px] text-amber-800 dark:text-amber-300">
            <a
              href={m.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:opacity-80"
            >
              {m.title}
              <ExternalLink className="h-3 w-3" />
            </a>
            {m.detail && <span className="opacity-80">{m.detail}</span>}
            <span className="opacity-70">(matches {m.matchedOn.join(', ')})</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80">
        You can still create a new record, or open the existing one instead.
      </p>
    </div>
  );
}
