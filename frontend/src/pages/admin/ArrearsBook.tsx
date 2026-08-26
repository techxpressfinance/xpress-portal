import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { Button, GlassCard, Input, PageHeader, Select } from '../../components/ui';
import { ListSkeleton } from '../../components/ui/Skeletons';
import ArrearsTable, { ArrearsPrintTable } from '../../components/arrears/ArrearsTable';
import ArrearsDetailPanel from '../../components/arrears/ArrearsDetailPanel';
import ArrearsRecordModal from '../../components/arrears/ArrearsRecordModal';
import ArrearsReportModal from '../../components/arrears/ArrearsReportModal';
import { downloadElementPdf } from '../../lib/pdfExport';
import ArrearsPrintHeader from '../../components/arrears/ArrearsPrintHeader';
import { A4_PRINT_WIDTH_PX, PRINT_INSET } from '../../lib/printPage';
import { getErrorMessage } from '../../lib/utils';
import { ARREARS_BUCKETS, ARREARS_FILE_TYPES, formatMoney } from '../../lib/arrears';
import type { ArrearsBucket, ArrearsFileType, ArrearsRecord, ArrearsSummary } from '../../types';

const PER_PAGE = 25;

type ResolvedFilter = '' | 'true' | 'false';

export default function ArrearsBook() {
  const { toast } = useToast();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [bucket, setBucket] = useState<ArrearsBucket | ''>('');
  const [fileType, setFileType] = useState<ArrearsFileType | ''>('');
  const [resolved, setResolved] = useState<ResolvedFilter>('');
  const [page, setPage] = useState(1);

  const [records, setRecords] = useState<ArrearsRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<ArrearsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ArrearsRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [printRows, setPrintRows] = useState<ArrearsRecord[]>([]);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  /** Query params shared by the list, summary, and report endpoints so the PDF
   *  always contains exactly what's on screen. */
  const filters = useMemo(() => {
    const params: Record<string, string> = {};
    if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
    if (bucket) params.bucket = bucket;
    if (fileType) params.file_type = fileType;
    if (resolved) params.resolved = resolved;
    return params;
  }, [debouncedSearch, bucket, fileType, resolved]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        api.get<{ items: ArrearsRecord[]; total: number }>('/arrears', {
          params: { ...filters, page, per_page: PER_PAGE },
        }),
        // The triage strip must show every bucket's total, so it deliberately
        // ignores the bucket filter itself — otherwise clicking a bucket would
        // zero out the others and you could never see your way back.
        api.get<ArrearsSummary>('/arrears/summary', {
          params: { ...filters, bucket: undefined, months: 1 },
        }),
      ]);
      setRecords(list.data.items);
      setTotal(list.data.total);
      setSummary(sum.data);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to load arrears book'), 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, page, toast]);

  useEffect(() => { load(); }, [load]);

  const applyUpdate = (updated: ArrearsRecord) => {
    setRecords((rows) => rows.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
    load();
  };

  const exportPdf = async () => {
    setExporting(true);
    try {
      const { data } = await api.get<ArrearsRecord[]>('/arrears/report', { params: filters });
      if (data.length === 0) {
        toast('Nothing to export with these filters', 'error');
        return;
      }
      setPrintRows(data);
      // Let React paint the off-screen print table before html2pdf reads it.
      await new Promise((resolve) => setTimeout(resolve, 50));
      await downloadElementPdf('arrears-report', 'arrears-book.pdf', 'landscape');
    } catch (err) {
      toast(getErrorMessage(err, 'PDF export failed'), 'error');
    } finally {
      setPrintRows([]);
      setExporting(false);
    }
  };

  const bucketCounts = useMemo(() => {
    const map = new Map(summary?.buckets.map((b) => [b.bucket, b]) ?? []);
    return ARREARS_BUCKETS.map((b) => ({ ...b, ...(map.get(b.value) ?? { count: 0, total_arrears: 0 }) }));
  }, [summary]);

  const filtered = Boolean(search || bucket || fileType || resolved);
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <PageHeader
        title="Arrears Book"
        subtitle="One row per contract in arrears — day counts recalculate every day from the “in arrears since” date"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setReporting(true)}>Custom report</Button>
            <Button variant="secondary" onClick={exportPdf} loading={exporting}>Download PDF</Button>
            <Button onClick={() => setCreating(true)}>Add contract</Button>
          </div>
        }
      />

      {/* Triage strip: the whole book's shape in one line, and the fastest way
          to answer "who is worst?" — click an age band to filter to it. */}
      <GlassCard className="p-4">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <p className="text-[22px] font-semibold tabular-nums text-foreground">
            {formatMoney(summary?.total_arrears ?? 0)}
          </p>
          <p className="text-[13px] text-muted-foreground">
            across {summary?.unresolved_count ?? 0} open contract
            {summary?.unresolved_count === 1 ? '' : 's'}
            {summary?.resolved_count ? ` · ${summary.resolved_count} resolved` : ''}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => { setBucket(''); setPage(1); }}
            className={`rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
              bucket === ''
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
            }`}
          >
            All {summary ? summary.total_count : ''}
          </button>
          {bucketCounts.map((b) => (
            <button
              key={b.value}
              type="button"
              onClick={() => { setBucket(bucket === b.value ? '' : b.value); setPage(1); }}
              // Empty bands stay visible but recede — the shape of the book is
              // information, and a band that vanishes makes the strip jump.
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                bucket === b.value
                  ? 'border-primary bg-primary/10 text-foreground'
                  : b.count === 0
                    ? 'border-border/60 text-muted-foreground/60 hover:border-primary/40'
                    : 'border-border text-foreground hover:border-primary/40'
              }`}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: b.color }} />
              {b.short}
              <span className="tabular-nums text-muted-foreground">{b.count}</span>
            </button>
          ))}
        </div>
      </GlassCard>

      <GlassCard className="space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <Input
              label="Search"
              placeholder="Client, entity, lender, contract no., VIN, asset…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="w-[180px]">
            <Select label="Loan type" value={fileType} onChange={(e) => { setFileType(e.target.value as ArrearsFileType | ''); setPage(1); }}>
              <option value="">All loan types</option>
              {ARREARS_FILE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </Select>
          </div>
          <div className="w-[150px]">
            <Select label="Status" value={resolved} onChange={(e) => { setResolved(e.target.value as ResolvedFilter); setPage(1); }}>
              <option value="">All</option>
              <option value="false">Open</option>
              <option value="true">Resolved</option>
            </Select>
          </div>
          {/* Only offered once there's something to clear. */}
          {filtered && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { setSearch(''); setBucket(''); setFileType(''); setResolved(''); setPage(1); }}
            >
              Clear filters
            </Button>
          )}
        </div>

        {loading ? (
          <ListSkeleton rows={5} rowHeight={48} />
        ) : (
          <ArrearsTable
            records={records}
            onSelect={(r) => setSelectedId(r.id)}
            emptyMessage={
              filtered
                ? 'No contracts match these filters.'
                : 'Nothing in the arrears book yet — “Add contract” to start one.'
            }
          />
        )}

        {!loading && total > 0 && (
          <div className="flex items-center justify-between pt-1">
            <p className="text-[12px] text-muted-foreground">
              {total} contract{total === 1 ? '' : 's'}
              {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ''}
            </p>
            {totalPages > 1 && (
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            )}
          </div>
        )}
      </GlassCard>

      {/* Off-screen print source for the PDF export. */}
      {printRows.length > 0 && (
        <div style={{ position: 'fixed', left: -10000, top: 0, width: 1100 }} aria-hidden>
          <div id="arrears-report" style={{ background: '#fff', paddingBottom: 16, width: A4_PRINT_WIDTH_PX.landscape, overflow: 'hidden', fontFamily: 'Helvetica, Arial, sans-serif' }}>
            <ArrearsPrintHeader
              eyebrow="Collections · Arrears Book"
              title="Arrears Book"
              subtitle={`As at ${new Date().toLocaleDateString('en-AU')} · ${printRows.length} contract${printRows.length === 1 ? '' : 's'}`}
            />
            {/* The inset sits below the full-bleed masthead. */}
            <div style={{ padding: `0 ${PRINT_INSET}px` }}>
              <ArrearsPrintTable records={printRows} />
            </div>
          </div>
        </div>
      )}

      {selectedId && (
        <ArrearsDetailPanel
          recordId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={applyUpdate}
          onEdit={(r) => { setSelectedId(null); setEditing(r); }}
        />
      )}

      {(creating || editing) && (
        <ArrearsRecordModal
          record={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); load(); }}
        />
      )}

      {reporting && <ArrearsReportModal onClose={() => setReporting(false)} />}
    </div>
  );
}
