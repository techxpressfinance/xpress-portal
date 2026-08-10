import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { Button, GlassCard, Input, PageHeader, Select } from '../../components/ui';
import { ListSkeleton } from '../../components/ui/Skeletons';
import DatePicker from '../../components/ui/DatePicker';
import ArrearsTable, { ArrearsPrintTable } from '../../components/arrears/ArrearsTable';
import ArrearsDetailPanel from '../../components/arrears/ArrearsDetailPanel';
import ArrearsRecordModal from '../../components/arrears/ArrearsRecordModal';
import { downloadElementPdf } from '../../lib/pdfExport';
import { getErrorMessage } from '../../lib/utils';
import {
  ARREARS_BUCKETS,
  ARREARS_FILE_TYPES,
  formatMoney,
  formatMonth,
  recentMonths,
} from '../../lib/arrears';
import type {
  ArrearsBucket,
  ArrearsFileType,
  ArrearsRecord,
  ArrearsSummary,
} from '../../types';

const PER_PAGE = 25;
const MONTH_OPTIONS = recentMonths(24);
const currentMonth = MONTH_OPTIONS[0];

type ResolvedFilter = '' | 'true' | 'false';

export default function ArrearsBook() {
  const { toast } = useToast();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [month, setMonth] = useState<string>(currentMonth);
  const [bucket, setBucket] = useState<ArrearsBucket | ''>('');
  const [fileType, setFileType] = useState<ArrearsFileType | ''>('');
  const [resolved, setResolved] = useState<ResolvedFilter>('');
  const [proof, setProof] = useState<ResolvedFilter>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const [records, setRecords] = useState<ArrearsRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<ArrearsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ArrearsRecord | null>(null);
  const [creating, setCreating] = useState(false);
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
    if (month && month !== currentMonth) params.month = month;
    if (bucket) params.bucket = bucket;
    if (fileType) params.file_type = fileType;
    if (resolved) params.resolved = resolved;
    if (proof) params.proof_of_payment_received = proof;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    return params;
  }, [debouncedSearch, month, bucket, fileType, resolved, proof, dateFrom, dateTo]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        api.get<{ items: ArrearsRecord[]; total: number }>('/arrears', {
          params: { ...filters, page, per_page: PER_PAGE },
        }),
        // The bucket strip must show every bucket's total, so it deliberately
        // ignores the bucket filter itself.
        api.get<ArrearsSummary>('/arrears/summary', {
          params: { ...filters, bucket: undefined, months: 12 },
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
      const label = month === currentMonth ? 'current' : month;
      await downloadElementPdf('arrears-report', `arrears-book-${label}.pdf`, 'landscape');
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

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const historical = month !== currentMonth;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <PageHeader
        title="Arrears Book"
        subtitle="One row per contract in arrears — day counts recalculate every day from the “in arrears since” date"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={exportPdf} loading={exporting}>Download PDF</Button>
            <Button onClick={() => setCreating(true)}>Add contract</Button>
          </div>
        }
      />

      {/* Bucket strip — click to filter, click again to clear. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {bucketCounts.map((b) => (
          <button
            key={b.value}
            type="button"
            onClick={() => { setBucket(bucket === b.value ? '' : b.value); setPage(1); }}
            className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
              bucket === b.value
                ? 'border-primary bg-primary/5'
                : 'border-border bg-card hover:border-primary/40'
            }`}
          >
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{b.short}</p>
            <p className="mt-0.5 text-[20px] font-semibold tabular-nums text-foreground">{b.count}</p>
            <p className="text-[11px] tabular-nums text-muted-foreground">{formatMoney(b.total_arrears)}</p>
          </button>
        ))}
      </div>

      <GlassCard className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label="Search"
            placeholder="Client, company, lender, contract no., asset…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select label="Month" value={month} onChange={(e) => { setMonth(e.target.value); setPage(1); }}>
            {MONTH_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m === currentMonth ? `${formatMonth(m)} (live)` : formatMonth(m)}
              </option>
            ))}
          </Select>
          <Select label="File type" value={fileType} onChange={(e) => { setFileType(e.target.value as ArrearsFileType | ''); setPage(1); }}>
            <option value="">All file types</option>
            {ARREARS_FILE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Resolved" value={resolved} onChange={(e) => { setResolved(e.target.value as ResolvedFilter); setPage(1); }}>
              <option value="">Any</option>
              <option value="false">No</option>
              <option value="true">Yes</option>
            </Select>
            <Select label="Proof" value={proof} onChange={(e) => { setProof(e.target.value as ResolvedFilter); setPage(1); }}>
              <option value="">Any</option>
              <option value="false">No</option>
              <option value="true">Yes</option>
            </Select>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DatePicker
            label="In arrears from"
            value={dateFrom}
            clearable
            onChange={(v) => { setDateFrom(v); setPage(1); }}
          />
          <DatePicker
            label="In arrears to"
            value={dateTo}
            clearable
            onChange={(v) => { setDateTo(v); setPage(1); }}
          />
          <div className="flex items-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSearch(''); setMonth(currentMonth); setBucket(''); setFileType('');
                setResolved(''); setProof(''); setDateFrom(''); setDateTo(''); setPage(1);
              }}
            >
              Clear filters
            </Button>
          </div>
        </div>

        {historical && (
          <p className="rounded-lg bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
            Showing {formatMonth(month)} as it stood at month end — day counts and flags are the
            frozen values from that month, not today&rsquo;s.
          </p>
        )}

        {loading ? (
          <ListSkeleton rows={5} rowHeight={40} />
        ) : (
          <ArrearsTable records={records} onSelect={(r) => setSelectedId(r.id)} />
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-1">
            <p className="text-[12px] text-muted-foreground">
              {total} record{total === 1 ? '' : 's'} · page {page} of {totalPages}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </GlassCard>

      {/* Monthly trend — the book "organised on a monthly basis". */}
      {summary && summary.months.length > 0 && (
        <GlassCard className="p-4">
          <h3 className="mb-3 text-[13px] font-semibold text-foreground">Contracts in arrears by month</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Month</th>
                  {ARREARS_BUCKETS.map((b) => (
                    <th key={b.value} className="px-2 py-2 text-right font-medium">{b.short}</th>
                  ))}
                  <th className="px-2 py-2 text-right font-medium">Total</th>
                  <th className="px-2 py-2 text-right font-medium">In arrears</th>
                </tr>
              </thead>
              <tbody>
                {[...summary.months].reverse().map((m) => {
                  const byBucket = new Map(m.buckets.map((b) => [b.bucket, b.count]));
                  return (
                    <tr key={m.month} className="border-b border-border/60">
                      <td className="px-2 py-1.5 text-foreground">{formatMonth(m.month)}</td>
                      {ARREARS_BUCKETS.map((b) => (
                        <td key={b.value} className="px-2 py-1.5 text-right tabular-nums text-foreground">
                          {byBucket.get(b.value) || 0}
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-right font-medium tabular-nums text-foreground">{m.count}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-foreground">{formatMoney(m.total_arrears)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Completed months are read from month-end snapshots; the current month is live.
          </p>
        </GlassCard>
      )}

      {/* Off-screen print source for the PDF export. */}
      {printRows.length > 0 && (
        <div style={{ position: 'fixed', left: -10000, top: 0, width: 1100 }} aria-hidden>
          <div id="arrears-report" style={{ background: '#fff', padding: 16, width: 1100 }}>
            <h1 style={{ fontSize: 16, fontWeight: 700, color: '#111', margin: 0 }}>Arrears Book</h1>
            <p style={{ fontSize: 10, color: '#444', margin: '2px 0 10px' }}>
              {historical ? `${formatMonth(month)} (month end)` : `As at ${new Date().toLocaleDateString('en-AU')}`}
              {bucket ? ` · ${ARREARS_BUCKETS.find((b) => b.value === bucket)?.label}` : ''}
              {dateFrom || dateTo ? ` · in arrears since ${dateFrom || '…'} to ${dateTo || '…'}` : ''}
              {` · ${printRows.length} contract${printRows.length === 1 ? '' : 's'}`}
            </p>
            <ArrearsPrintTable records={printRows} />
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
    </div>
  );
}
