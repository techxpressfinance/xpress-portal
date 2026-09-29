import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api/client';
import { useToast } from '../Toast';
import { Button } from '../ui';
import { downloadElementPdf } from '../../lib/pdfExport';
import { formatDate, getErrorMessage } from '../../lib/utils';
import {
  DECLINED_STATUSES,
  HISTORY_SECTIONS,
  historyFileBase,
  loanOutcome,
  loanTitle,
  money,
  type HistoryLayout,
  type HistorySection,
} from '../../lib/notesHistory';
import type { NotesHistory, NotesHistoryLoan } from '../../types';
import NotesHistoryDocument from './NotesHistoryDocument';

type Subject = { type: 'contact' | 'organization'; id: string };
type QuickPick = 'all' | 'declined' | 'settled' | 'none';

const PRINT_ID = 'notes-history-print';

function noteCounts(loan: NotesHistoryLoan): string {
  const count = (c: string) => loan.notes.filter((n) => n.category === c && n.content.trim()).length;
  const bits = [
    [count('decline'), 'decline'],
    [loan.submissions.length, 'lender'],
    [count('compliance'), 'compliance'],
    [count('learning'), 'learning'],
    [count('scratchpad'), 'scratchpad'],
  ] as const;
  return bits.filter(([n]) => n > 0).map(([n, label]) => (label === 'scratchpad' ? 'sticky notes' : `${n} ${label}`)).join(' · ') || 'No notes';
}

/**
 * Pick which of a client's (or company's) loans and which kinds of notes to
 * take away, see the document as it will print, then download it as PDF or
 * Word. Every download is recorded in the activity log.
 */
export default function NotesHistoryModal({
  subject,
  initialLoanId,
  onClose,
}: {
  subject: Subject;
  /** The loan the modal was opened from — listed first in the picker. */
  initialLoanId?: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [history, setHistory] = useState<NotesHistory | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sections, setSections] = useState<Set<HistorySection>>(
    () => new Set(HISTORY_SECTIONS.filter((s) => s.defaultOn).map((s) => s.key)),
  );
  const [layout, setLayout] = useState<HistoryLayout>('by_loan');
  const [downloading, setDownloading] = useState<'pdf' | 'docx' | null>(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    api.get<NotesHistory>(`/notes-history/${subject.type}/${subject.id}`)
      .then(({ data }) => {
        setHistory(data);
        setSelected(new Set(data.loans.map((l) => l.id)));
      })
      .catch((err) => setLoadError(getErrorMessage(err, 'Failed to load the notes history')));
  }, [subject.type, subject.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !downloading) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [downloading, onClose]);

  const allLoans = useMemo(() => {
    if (!history) return [];
    const loans = [...history.loans];
    const i = loans.findIndex((l) => l.id === initialLoanId);
    if (i > 0) loans.unshift(...loans.splice(i, 1));
    return loans;
  }, [history, initialLoanId]);

  // The document keeps newest-first order regardless of how the picker lists them.
  const chosenLoans = useMemo(() => (history?.loans ?? []).filter((l) => selected.has(l.id)), [history, selected]);
  const chosenSections = HISTORY_SECTIONS.map((s) => s.key).filter((k) => sections.has(k));

  const quickPick = (pick: QuickPick) => {
    if (!history) return;
    const ids = history.loans
      .filter((l) =>
        pick === 'all' ? true
          : pick === 'declined' ? DECLINED_STATUSES.has(l.status)
          : pick === 'settled' ? l.status === 'settled'
          : false)
      .map((l) => l.id);
    setSelected(new Set(ids));
  };

  const toggleLoan = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleSection = (key: HistorySection) =>
    setSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const canDownload = Boolean(history && chosenLoans.length && chosenSections.length);

  const logExport = (format: 'pdf' | 'docx') =>
    api.post(`/notes-history/${subject.type}/${subject.id}/exported`, {
      format,
      layout,
      application_ids: chosenLoans.map((l) => l.id),
      sections: chosenSections,
    }).catch(() => { /* the audit entry is best-effort; the file is already made */ });

  const download = async (format: 'pdf' | 'docx') => {
    if (!history || !canDownload) return;
    setDownloading(format);
    const base = historyFileBase(history);
    try {
      if (format === 'pdf') {
        setPrinting(true);
        // Let React paint the off-screen print copy before html2pdf reads it.
        await new Promise((resolve) => setTimeout(resolve, 60));
        await downloadElementPdf(PRINT_ID, `${base}.pdf`, 'portrait');
      } else {
        const { downloadNotesHistoryDocx } = await import('../../lib/notesHistoryDocx');
        await downloadNotesHistoryDocx(history, chosenLoans, chosenSections, layout, `${base}.docx`);
      }
      void logExport(format);
    } catch (err) {
      toast(getErrorMessage(err, 'Export failed'), 'error');
    } finally {
      setPrinting(false);
      setDownloading(null);
    }
  };

  const declinedCount = history?.loans.filter((l) => DECLINED_STATUSES.has(l.status)).length ?? 0;
  const settledCount = history?.loans.filter((l) => l.status === 'settled').length ?? 0;

  return createPortal(
    <div className="ledger-theme fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !downloading && onClose()} />
      <div className="relative flex h-[92vh] w-full max-w-[1180px] flex-col rounded-2xl border border-border bg-background shadow-xl">
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <h3 className="text-[17px] font-semibold text-foreground">
            Notes history{history ? ` — ${history.subject.name}` : ''}
          </h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Choose the loans and notes to include, check the preview, then download. Page 1 summarises every loan's outcome and the decline pattern.
          </p>
        </div>

        {loadError ? (
          <p className="m-6 rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive">{loadError}</p>
        ) : !history ? (
          <p className="m-6 text-[13px] text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            {/* Controls */}
            <div className="flex min-h-0 flex-col gap-5 overflow-y-auto border-b border-border px-5 py-4 md:w-[360px] md:shrink-0 md:border-b-0 md:border-r">
              <section>
                <div className="mb-2 flex items-baseline justify-between">
                  <p className="text-[13px] font-semibold text-foreground">Loans</p>
                  <p className="text-[12px] text-muted-foreground">{selected.size} of {history.loans.length}</p>
                </div>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {([
                    ['all', `All (${history.loans.length})`],
                    ['declined', `Declined / not proceeding (${declinedCount})`],
                    ['settled', `Settled (${settledCount})`],
                    ['none', 'None'],
                  ] as [QuickPick, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => quickPick(key)}
                      className="rounded-full border border-border px-2.5 py-1 text-[12px] font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {history.loans.length === 0 ? (
                  <p className="rounded-lg bg-secondary/50 px-3 py-2 text-[13px] text-muted-foreground">No loans on file.</p>
                ) : (
                  <div className="space-y-1">
                    {allLoans.map((loan) => {
                      const declined = DECLINED_STATUSES.has(loan.status);
                      return (
                        <label
                          key={loan.id}
                          className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-2.5 py-2 transition-colors ${selected.has(loan.id) ? 'border-primary/30 bg-primary/5' : 'border-transparent hover:bg-secondary/50'}`}
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(loan.id)}
                            onChange={() => toggleLoan(loan.id)}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--led-accent,#2563eb)]"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-[13px] font-semibold text-foreground">
                                {loanTitle(loan)} · {money(loan.amount)}
                              </span>
                              <span className={`shrink-0 text-[11px] font-semibold ${declined ? 'text-destructive' : 'text-muted-foreground'}`}>{loanOutcome(loan)}</span>
                            </span>
                            <span className="block text-[11.5px] text-muted-foreground">
                              {loan.ref} · {formatDate(loan.created_at)}{loan.id === initialLoanId ? ' · this loan' : ''}
                            </span>
                            {loan.roles.length > 0 && !(loan.roles.length === 1 && loan.roles[0] === 'Main applicant') && (
                              <span className="block truncate text-[11.5px] text-muted-foreground" title={loan.roles.join('; ')}>{loan.roles.join('; ')}</span>
                            )}
                            <span className="block text-[11.5px] text-muted-foreground/80">{noteCounts(loan)}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
                {history.hidden_count > 0 && (
                  <p className="mt-2 rounded-lg bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
                    {history.hidden_count} other loan{history.hidden_count === 1 ? ' is' : 's are'} handled by other brokers and not included.
                  </p>
                )}
              </section>

              <section>
                <p className="mb-2 text-[13px] font-semibold text-foreground">Include</p>
                <div className="space-y-1.5">
                  {HISTORY_SECTIONS.map((s) => (
                    <label key={s.key} className="flex cursor-pointer items-center gap-2.5 text-[13px] text-foreground">
                      <input
                        type="checkbox"
                        checked={sections.has(s.key)}
                        onChange={() => toggleSection(s.key)}
                        className="h-4 w-4 accent-[var(--led-accent,#2563eb)]"
                      />
                      {s.label}
                    </label>
                  ))}
                </div>
              </section>

              <section>
                <p className="mb-2 text-[13px] font-semibold text-foreground">Layout</p>
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-secondary/50 p-1">
                  {([['by_loan', 'By loan'], ['by_type', 'By note type']] as [HistoryLayout, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setLayout(key)}
                      className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${layout === key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[12px] text-muted-foreground">
                  {layout === 'by_loan'
                    ? 'Each loan in full, newest first — read one deal at a time.'
                    : 'Every decline note together, then every compliance note, and so on — spot the pattern across deals.'}
                </p>
              </section>
            </div>

            {/* Preview */}
            <div className="min-h-[240px] flex-1 overflow-auto bg-secondary/40 p-4">
              {canDownload ? (
                <div className="mx-auto w-fit shadow-md" style={{ zoom: 0.72 }}>
                  <NotesHistoryDocument history={history} loans={chosenLoans} sections={chosenSections} layout={layout} />
                </div>
              ) : (
                <p className="mt-10 text-center text-[13px] text-muted-foreground">
                  Pick at least one loan and one kind of note to preview.
                </p>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-3 border-t border-border px-5 py-4 sm:px-6">
          <Button variant="secondary" onClick={onClose} disabled={Boolean(downloading)}>Close</Button>
          <Button variant="secondary" onClick={() => download('docx')} loading={downloading === 'docx'} disabled={!canDownload || Boolean(downloading)}>
            Download Word
          </Button>
          <Button onClick={() => download('pdf')} loading={downloading === 'pdf'} disabled={!canDownload || Boolean(downloading)}>
            Download PDF
          </Button>
        </div>
      </div>

      {/* Off-screen, unscaled print copy for the PDF. */}
      {printing && history && (
        <div style={{ position: 'fixed', left: -10000, top: 0 }} aria-hidden>
          <NotesHistoryDocument id={PRINT_ID} history={history} loans={chosenLoans} sections={chosenSections} layout={layout} />
        </div>
      )}
    </div>,
    document.body,
  );
}
