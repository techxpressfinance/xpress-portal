import { useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { daysSince, formatDate } from '../lib/utils';
import type { ApplicationStagePosition } from '../types';

interface StageHistoryRow {
  id: string;
  from_stage_title: string | null;
  to_stage_title: string | null;
  actor_name: string | null;
  created_at: string;
  gate_responses: { label: string; confirmed?: boolean }[];
}

/**
 * Where the desk has this application on the board — "Application Started ›
 * Apps & Searches" — shown beside its status on the staff application page. The
 * status is what the client sees; the stage and its phase are how the desk
 * works it. Opens to every board it sits on and its stage history.
 *
 * Staff-only by construction: both endpoints are admin/broker. Key it on the
 * application's status so a status change re-reads the stage.
 */
export default function ApplicationStagePill({ applicationId }: { applicationId: string }) {
  const [stages, setStages] = useState<ApplicationStagePosition[]>([]);
  const [history, setHistory] = useState<StageHistoryRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<ApplicationStagePosition[]>(`/kanban/applications/${applicationId}/stages`)
      .then(({ data }) => { if (!cancelled) setStages(data); })
      .catch(() => { /* no board position is not worth an error on this page */ });
    return () => { cancelled = true; };
  }, [applicationId]);

  // The history is only fetched once someone opens the panel.
  useEffect(() => {
    if (!open || history) return;
    let cancelled = false;
    api.get<StageHistoryRow[]>(`/kanban/applications/${applicationId}/transitions`)
      .then(({ data }) => { if (!cancelled) setHistory(data); })
      .catch(() => { if (!cancelled) setHistory([]); });
    return () => { cancelled = true; };
  }, [open, history, applicationId]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!stages.length) return null;
  // The default board comes first from the API.
  const primary = stages[0];
  const days = primary.entered_at ? daysSince(primary.entered_at) : null;

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Where the desk has this on the board — the client only sees the status"
        className="inline-flex max-w-[22rem] items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-semibold text-foreground ring-1 ring-border transition-colors hover:bg-secondary/70"
      >
        {primary.phase && <span className="truncate text-muted-foreground">{primary.phase} ›</span>}
        <span className="truncate">{primary.stage_title}</span>
        {days !== null && <span className="shrink-0 font-normal text-muted-foreground">· {days}d</span>}
        {stages.length > 1 && <span className="shrink-0 font-normal text-muted-foreground">+{stages.length - 1}</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-80 rounded-xl border border-border bg-background p-3 text-left shadow-lg">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">On the board</div>
          <ul className="mb-3 space-y-1.5">
            {stages.map((s) => (
              <li key={s.board_id} className="text-[12px] leading-snug">
                <div className="font-medium text-foreground">
                  {s.phase ? <span className="text-muted-foreground">{s.phase} › </span> : null}
                  {s.stage_title}
                </div>
                <div className="text-muted-foreground">
                  {s.board_name}
                  {s.team ? ` · ${s.team}` : ''}
                  {s.entered_at ? ` · since ${formatDate(s.entered_at)}` : ''}
                </div>
              </li>
            ))}
          </ul>

          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Stage history</div>
          {history === null ? (
            <p className="text-[12px] text-muted-foreground">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">No moves recorded yet.</p>
          ) : (
            <ol className="max-h-56 space-y-1.5 overflow-y-auto">
              {history.map((t) => {
                const attested = t.gate_responses.filter((g) => g.confirmed).length;
                return (
                  <li key={t.id} className="text-[12px] leading-snug">
                    <div className="text-foreground">
                      {t.from_stage_title ? `${t.from_stage_title} → ` : ''}{t.to_stage_title}
                    </div>
                    <div className="text-muted-foreground">
                      {t.actor_name || 'Someone'} · {formatDate(t.created_at)}
                      {attested > 0 ? ` · ${attested} confirmed` : ''}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
