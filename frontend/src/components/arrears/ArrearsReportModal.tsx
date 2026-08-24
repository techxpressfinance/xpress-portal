import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api/client';
import { useToast } from '../Toast';
import { Button, Select } from '../ui';
import DatePicker from '../ui/DatePicker';
import { downloadElementPdf } from '../../lib/pdfExport';
import { getErrorMessage } from '../../lib/utils';
import {
  ARREARS_FILE_TYPES,
  downloadArrearsCsv,
  fileTypeLabel,
  formatMoney,
} from '../../lib/arrears';
import type { ArrearsFileType, ArrearsRecord, Lender } from '../../types';
import EntityPicker from './EntityPicker';
import ArrearsTable, { ArrearsPrintTable } from './ArrearsTable';

type ResolvedFilter = '' | 'true' | 'false';
type Picked = { id: string; label: string };

/**
 * Custom-query report builder: pull the book for one client and/or one lender
 * (plus loan type, status, and an in-arrears date window), preview the match,
 * then take it away as a PDF report or a CSV. The /arrears/report endpoint
 * already carries these filters — and lender matching covers secondary
 * lenders on co-financed contracts.
 */
export default function ArrearsReportModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [lenderBook, setLenderBook] = useState<Lender[]>([]);
  const [client, setClient] = useState<Picked | null>(null);
  const [lenderId, setLenderId] = useState('');
  const [fileType, setFileType] = useState<ArrearsFileType | ''>('');
  const [resolved, setResolved] = useState<ResolvedFilter>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [results, setResults] = useState<ArrearsRecord[] | null>(null);
  const [running, setRunning] = useState(false);
  const [downloading, setDownloading] = useState<'pdf' | 'csv' | null>(null);
  const [printRows, setPrintRows] = useState<ArrearsRecord[]>([]);

  useEffect(() => {
    api.get<Lender[]>('/lenders').then(({ data }) => setLenderBook(data)).catch(() => setLenderBook([]));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !running && !downloading) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, downloading, onClose]);

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (client) p.contact_id = client.id;
    if (lenderId) p.lender_id = lenderId;
    if (fileType) p.file_type = fileType;
    if (resolved) p.resolved = resolved;
    if (dateFrom) p.date_from = dateFrom;
    if (dateTo) p.date_to = dateTo;
    return p;
  }, [client, lenderId, fileType, resolved, dateFrom, dateTo]);

  const lenderName = lenderBook.find((l) => l.id === lenderId)?.name ?? '';
  const hasCriteria = Boolean(client || lenderId || fileType || resolved || dateFrom || dateTo);

  /** Human-readable description of the query — the PDF header and filenames. */
  const describe = () => {
    const bits = [
      client ? `Client: ${client.label}` : '',
      lenderName ? `Lender: ${lenderName}` : '',
      fileType ? `Loan type: ${fileTypeLabel(fileType)}` : '',
      resolved === 'true' ? 'Resolved only' : resolved === 'false' ? 'Unresolved only' : '',
      dateFrom || dateTo ? `In arrears since ${dateFrom || '…'} → ${dateTo || '…'}` : '',
    ].filter(Boolean);
    return bits.join(' · ') || 'Whole book';
  };

  const baseName = `arrears-${[client?.label, lenderName].filter(Boolean).join('-').replace(/[^\w-]+/g, '_') || 'report'}`;

  const run = async (): Promise<ArrearsRecord[] | null> => {
    setRunning(true);
    try {
      const { data } = await api.get<ArrearsRecord[]>('/arrears/report', { params });
      setResults(data);
      return data;
    } catch (err) {
      toast(getErrorMessage(err, 'Query failed'), 'error');
      return null;
    } finally {
      setRunning(false);
    }
  };

  const downloadPdf = async () => {
    const rows = results ?? await run();
    if (!rows || rows.length === 0) {
      toast('No contracts match this query', 'error');
      return;
    }
    setDownloading('pdf');
    try {
      setPrintRows(rows);
      // Let React paint the off-screen print table before html2pdf reads it.
      await new Promise((resolve) => setTimeout(resolve, 50));
      await downloadElementPdf('arrears-custom-report', `${baseName}.pdf`, 'landscape');
    } catch (err) {
      toast(getErrorMessage(err, 'PDF export failed'), 'error');
    } finally {
      setPrintRows([]);
      setDownloading(null);
    }
  };

  const downloadCsv = async () => {
    const rows = results ?? await run();
    if (!rows || rows.length === 0) {
      toast('No contracts match this query', 'error');
      return;
    }
    downloadArrearsCsv(rows, baseName);
  };

  const totalArrears = (results ?? []).reduce((sum, r) => sum + Number(r.arrears_amount || 0), 0);

  // Portals mount into document.body, outside the .ledger-theme host that
  // declares every --led-* variable, so led-btn / led-input / led-chip render
  // with no background, border, or colour unless the theme is re-declared here.
  return createPortal(
    <div className="ledger-theme fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !running && !downloading && onClose()} />
      <div className="relative flex max-h-[90vh] w-full max-w-[760px] flex-col rounded-2xl border border-border bg-background shadow-xl">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-[17px] font-semibold text-foreground">Custom report</h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Pull the book for a client or a lender — preview it, then download as PDF or CSV.
          </p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <EntityPicker
              kind="contact"
              label="Client"
              value={client?.id ?? null}
              valueLabel={client?.label ?? null}
              onChange={(p) => { setClient(p); setResults(null); }}
            />
            <Select label="Lender" value={lenderId} onChange={(e) => { setLenderId(e.target.value); setResults(null); }}>
              <option value="">Any lender</option>
              {lenderBook.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Loan type"
              value={fileType}
              onChange={(e) => { setFileType(e.target.value as ArrearsFileType | ''); setResults(null); }}
            >
              <option value="">All loan types</option>
              {ARREARS_FILE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </Select>
            <Select
              label="Resolved"
              value={resolved}
              onChange={(e) => { setResolved(e.target.value as ResolvedFilter); setResults(null); }}
            >
              <option value="">Any</option>
              <option value="false">No</option>
              <option value="true">Yes</option>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <DatePicker label="In arrears from" value={dateFrom} clearable onChange={(v) => { setDateFrom(v); setResults(null); }} />
            <DatePicker label="In arrears to" value={dateTo} clearable onChange={(v) => { setDateTo(v); setResults(null); }} />
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={run} loading={running} disabled={!hasCriteria}>Run query</Button>
            {results === null && (
              <p className="text-[12px] text-muted-foreground">Pick at least one criterion.</p>
            )}
          </div>

          {results !== null && results.length > 0 && (
            <>
              {/* The answer, stated plainly, before the grid of rows behind it. */}
              <div className="rounded-lg border border-border bg-card px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <p className="text-[20px] font-semibold tabular-nums text-foreground">
                    {formatMoney(totalArrears)}
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    across {results.length} contract{results.length === 1 ? '' : 's'}
                  </p>
                </div>
                <p className="mt-0.5 text-[12px] text-muted-foreground">{describe()}</p>
              </div>
              <div className="overflow-x-auto rounded-lg border border-border">
                {/* Preview only — the downloads always carry the full result set. */}
                <ArrearsTable records={results.slice(0, 50)} emptyMessage="No contracts match." />
              </div>
              {results.length > 50 && (
                <p className="text-[12px] text-muted-foreground">
                  Showing the first 50 — the PDF and CSV include all {results.length}.
                </p>
              )}
            </>
          )}
          {results !== null && results.length === 0 && (
            <p className="rounded-lg bg-secondary/50 px-3 py-2 text-[13px] text-muted-foreground">
              No contracts match this query.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <Button variant="secondary" onClick={onClose} disabled={running || Boolean(downloading)}>Close</Button>
          <Button variant="secondary" onClick={downloadCsv} disabled={!results?.length || Boolean(downloading) || running}>
            Download CSV
          </Button>
          <Button onClick={downloadPdf} loading={downloading === 'pdf'} disabled={!results?.length || running}>
            Download PDF
          </Button>
        </div>
      </div>

      {/* Off-screen print source for this report. */}
      {printRows.length > 0 && (
        <div style={{ position: 'fixed', left: -10000, top: 0, width: 1100 }} aria-hidden>
          <div id="arrears-custom-report" style={{ background: '#fff', padding: 16, width: 1100 }}>
            <h1 style={{ fontSize: 16, fontWeight: 700, color: '#111', margin: 0 }}>Arrears Book — Custom Report</h1>
            <p style={{ fontSize: 10, color: '#444', margin: '2px 0 10px' }}>
              {describe()} · As at {new Date().toLocaleDateString('en-AU')}
              {` · ${printRows.length} contract${printRows.length === 1 ? '' : 's'}`}
            </p>
            <ArrearsPrintTable records={printRows} />
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
