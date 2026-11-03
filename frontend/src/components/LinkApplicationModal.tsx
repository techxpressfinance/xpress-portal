import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../api/client';
import { Button } from './ui';
import { useToast } from './Toast';
import { getErrorMessage } from '../lib/utils';
import { LOAN_TYPE_LABELS, STATUS_LABEL } from '../lib/constants';
import { applicantDisplayName } from '../lib/applicantName';
import type { LoanApplication, PaginatedResponse, QuoteSheet } from '../types';

const appRef = (id: string) => `APP-${id.replace(/-/g, '').slice(-6).toUpperCase()}`;

/**
 * Attach a standalone quote or lender pricing sheet to a live application on
 * the board (settled, declined and not-proceeding deals aren't offered). The
 * sheet leaves the standalone list and becomes the application's next version.
 */
export default function LinkApplicationModal({ sheet, onClose, onLinked }: {
  sheet: QuoteSheet;
  onClose: () => void;
  onLinked: (sheet: QuoteSheet, app: LoanApplication) => void;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [apps, setApps] = useState<LoanApplication[] | null>(null);
  const [chosen, setChosen] = useState<LoanApplication | null>(null);
  const [linking, setLinking] = useState(false);
  const kind = sheet.sheet_type === 'lender_pricing' ? 'lender pricing' : 'quote';

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      api.get<PaginatedResponse<LoanApplication>>('/applications', {
        params: { closed: false, per_page: 25, ...(search.trim() ? { search: search.trim() } : {}) },
      })
        .then(({ data }) => { if (!cancelled) setApps(data.items); })
        .catch((err) => { if (!cancelled) { setApps([]); toast(getErrorMessage(err, 'Failed to load applications'), 'error'); } });
    }, search ? 250 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search, toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !linking) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, linking]);

  const link = async () => {
    if (!chosen) return;
    setLinking(true);
    try {
      const { data } = await api.post<QuoteSheet>(`/quote-sheets/${sheet.id}/link-application`, { application_id: chosen.id });
      onLinked(data, chosen);
    } catch (err) {
      toast(getErrorMessage(err, `Failed to link the ${kind}`), 'error');
    } finally {
      setLinking(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 flex items-end sm:items-center justify-center sm:p-4" style={{ zIndex: 'var(--z-modal)' }}>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !linking && onClose()} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-app-title"
        className="relative flex w-full max-w-[560px] max-h-[85vh] flex-col rounded-t-[10px] sm:rounded-[10px] bg-background border border-border p-6 shadow-xl"
        style={{ animation: 'fadeInUp 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
      >
        <h3 id="link-app-title" className="text-[17px] font-semibold text-foreground">Link {kind} to an application</h3>
        <p className="text-[12.5px] text-muted-foreground mt-0.5 mb-4">
          {sheet.title ? `“${sheet.title}” ` : `v${sheet.version} `}moves onto the application as its next version and leaves this list.
          Only live applications on the board are listed.
        </p>
        <input
          autoFocus
          type="search"
          placeholder="Search by applicant, entity or email…"
          className="led-input w-full"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setChosen(null); }}
        />
        <div className="mt-3 min-h-[120px] flex-1 overflow-y-auto overscroll-contain rounded-lg border border-border" role="listbox" aria-label="Live applications">
          {apps === null ? (
            <p className="p-4 text-center text-sm text-muted-foreground">Loading…</p>
          ) : apps.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">No live applications match.</p>
          ) : apps.map((a) => {
            const selected = chosen?.id === a.id;
            return (
              <button
                key={a.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => setChosen(a)}
                className={`flex w-full items-center justify-between gap-3 border-b border-border/50 px-3 py-2.5 text-left last:border-b-0 ${selected ? 'bg-primary/10' : 'hover:bg-secondary/60'}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-foreground">{applicantDisplayName(a, '—')}</span>
                  <span className="block text-[11.5px] text-muted-foreground">
                    {appRef(a.id)} · {LOAN_TYPE_LABELS[a.loan_type] || a.loan_type.replace(/_/g, ' ')}
                    {a.amount != null ? ` · $${Number(a.amount).toLocaleString('en-AU')}` : ''}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {STATUS_LABEL[a.status] ?? a.status}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={linking}>Cancel</Button>
          <Button type="button" onClick={link} loading={linking} disabled={!chosen || linking}>
            {chosen ? `Link to ${appRef(chosen.id)}` : 'Choose an application'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
