import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../hooks/useConfirm';
import { Button, Card, PageHeader } from '../../components/ui';
import { ListSkeleton } from '../../components/ui/Skeletons';
import NotFound from '../../components/NotFound';
import XpressPrintHeader from '../../components/print/XpressPrintHeader';
import LedgerDealsTable, { LedgerDealsPrintTable } from '../../components/ledger/LedgerDealsTable';
import LedgerDealEditor from '../../components/ledger/LedgerDealEditor';
import LedgerReferrersTab from '../../components/ledger/LedgerReferrersTab';
import LedgerSharingTab from '../../components/ledger/LedgerSharingTab';
import LedgerInvoiceModal from '../../components/ledger/LedgerInvoiceDocument';
import { downloadElementPdf } from '../../lib/pdfExport';
import { A4_PRINT_WIDTH_PX, PRINT_INSET } from '../../lib/printPage';
import { formatDate, getErrorMessage } from '../../lib/utils';
import {
  CATEGORY_STYLE,
  DEFAULT_LEDGER_COLUMNS,
  formatLedgerMoney,
  loadColumnPref,
  presetRange,
  RANGE_PRESETS,
  saveColumnPref,
  type RangePreset,
} from '../../lib/ledger';
import type {
  LedgerAccessInfo,
  LedgerCategory,
  LedgerColumn,
  LedgerDealRow,
  LedgerDealsResponse,
  LedgerInvoice,
  LedgerReferrerOption,
} from '../../types';

type Tab = 'deals' | 'referrers' | 'invoices' | 'sharing';

const TILES: { key: string; label: string }[] = [
  { key: 'finance_amount', label: 'Settled volume' },
  { key: 'brokerage', label: 'Brokerage (ex GST)' },
  { key: 'origination_fee', label: 'Origination fees (ex GST)' },
  { key: 'doc_fee', label: 'Doc fees (ex GST)' },
  { key: 'vir', label: 'VIR (ex GST)' },
  { key: 'income_ex_gst', label: 'Total income (ex GST)' },
  { key: 'referrer_comms_ex_gst', label: 'Referrer comms (ex GST)' },
  { key: 'net_profit', label: 'Net profit' },
];

/** The private commission ledger: settled deals with our income and what we
 *  share with referrers, for the owner and whoever they have let in. What a
 *  viewer may see is decided by the server — fields they can't see never
 *  arrive, so the page draws whatever columns it is given. */
export default function PrivateLedger() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [access, setAccess] = useState<LedgerAccessInfo | null>(null);
  const [tab, setTab] = useState<Tab>('deals');
  const [preset, setPreset] = useState<RangePreset>('this_month');
  const [range, setRange] = useState(() => presetRange('this_month'));
  const [data, setData] = useState<LedgerDealsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [referrers, setReferrers] = useState<LedgerReferrerOption[]>([]);
  const [editing, setEditing] = useState<LedgerDealRow | null>(null);
  const [columnKeys, setColumnKeys] = useState<string[]>(() => loadColumnPref() ?? DEFAULT_LEDGER_COLUMNS);
  const [pickingColumns, setPickingColumns] = useState(false);
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null);
  const [printing, setPrinting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [invoices, setInvoices] = useState<LedgerInvoice[]>([]);
  const [openInvoice, setOpenInvoice] = useState<LedgerInvoice | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<LedgerAccessInfo>('/ledger/access')
      .then(({ data }) => {
        setAccess(data);
        // Open on the first tab this viewer can actually use.
        const s = new Set(data.scopes ?? []);
        if (data.access && !data.is_owner && !s.has('deals') && !s.has('summary')) setTab('referrers');
      })
      .catch(() => setAccess({ access: false }));
  }, []);

  const scopes = useMemo(() => new Set(access?.scopes ?? []), [access]);
  const isOwner = Boolean(access?.is_owner);
  const can = (s: string) => isOwner || scopes.has(s as never);

  const params = useMemo(() => ({ date_from: range.from || undefined, date_to: range.to || undefined }), [range]);

  const load = useCallback(async () => {
    if (!access?.access || !(can('deals') || can('summary'))) return;
    setLoading(true);
    try {
      const { data } = await api.get<LedgerDealsResponse>('/ledger/deals', { params });
      setData(data);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to load the ledger'), 'error');
    } finally {
      setLoading(false);
    }
  }, [access, params]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load, refreshKey]);

  useEffect(() => {
    if (!isOwner) return;
    api.get<LedgerReferrerOption[]>('/ledger/referrer-options').then(({ data }) => setReferrers(data)).catch(() => setReferrers([]));
  }, [isOwner]);

  useEffect(() => {
    if (tab !== 'invoices') return;
    api.get<LedgerInvoice[]>('/ledger/invoices')
      .then(({ data }) => setInvoices(data))
      .catch((err) => toast(getErrorMessage(err, 'Failed to load invoices'), 'error'));
  }, [tab, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close the column picker on an outside click.
  useEffect(() => {
    if (!pickingColumns) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickingColumns(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pickingColumns]);

  if (access === null) return <div className="p-6"><ListSkeleton /></div>;
  if (!access.access) return <NotFound />;

  const allColumns: LedgerColumn[] = access.columns ?? [];
  const columns = allColumns.filter((c) => columnKeys.includes(c.key));
  const shownColumns = columns.length ? columns : allColumns;

  const choosePreset = (p: RangePreset) => {
    setPreset(p);
    if (p !== 'custom') setRange(presetRange(p));
  };

  const toggleColumn = (key: string) => {
    const next = columnKeys.includes(key) ? columnKeys.filter((k) => k !== key) : [...columnKeys, key];
    setColumnKeys(next);
    saveColumnPref(next);
  };

  const exportXlsx = async () => {
    setExporting('xlsx');
    try {
      const res = await api.get('/ledger/export.xlsx', {
        params: { ...params, columns: shownColumns.map((c) => c.key).join(',') },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Settled deals ${range.from || 'start'} to ${range.to || 'today'}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(getErrorMessage(err, 'Excel download failed'), 'error');
    } finally {
      setExporting(null);
    }
  };

  const exportPdf = async () => {
    if (!data?.deals?.length) {
      toast('No deals in this period', 'error');
      return;
    }
    setExporting('pdf');
    setPrinting(true);
    try {
      // Let React paint the off-screen print table before html2pdf reads it.
      await new Promise((resolve) => setTimeout(resolve, 50));
      await downloadElementPdf('ledger-report', `Settled deals ${range.from || 'start'} to ${range.to || 'today'}.pdf`, 'landscape');
      api.post('/ledger/export-logged').catch(() => {});
    } catch (err) {
      toast(getErrorMessage(err, 'PDF download failed'), 'error');
    } finally {
      setPrinting(false);
      setExporting(null);
    }
  };

  const onSaved = (row: LedgerDealRow) => {
    setData((prev) => prev && prev.deals
      ? { ...prev, deals: prev.deals.map((d) => (d.application_id === row.application_id ? row : d)) }
      : prev);
    // Totals and the referrer roll-up are the server's sums — fetch them again.
    setRefreshKey((k) => k + 1);
  };

  const voidInvoice = async (inv: LedgerInvoice) => {
    const ok = await confirm({
      title: `Void invoice ${inv.number}?`,
      message: 'It is removed from the ledger. Its number is not reused, and deals already marked paid stay marked.',
      confirmText: 'Void',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/ledger/invoices/${inv.id}`);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to void'), 'error');
    }
  };

  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'deals', label: 'Settled deals', show: can('deals') || can('summary') },
    { key: 'referrers', label: 'Referrers', show: can('referrers') },
    { key: 'invoices', label: 'Invoices', show: can('invoices') && can('referrers') },
    { key: 'sharing', label: 'Sharing', show: isOwner },
  ];
  const totals = data?.totals;
  const periodText = range.from || range.to
    ? `${range.from ? formatDate(range.from) : 'the start'} – ${range.to ? formatDate(range.to) : 'today'}`
    : 'All time';

  return (
    <div className="p-6 max-w-[1500px] mx-auto space-y-5">
      <PageHeader
        title="Private Ledger"
        subtitle={isOwner ? 'Only you can see this — share it from the Sharing tab.' : 'Shared with you, view-only.'}
        action={
          tab !== 'sharing' && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="mb-1 block text-[11.5px] text-muted-foreground">Period</span>
                <select className="led-input !h-9 text-[13px]" value={preset} onChange={(e) => choosePreset(e.target.value as RangePreset)}>
                  {RANGE_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </label>
              {preset === 'custom' && (
                <>
                  <label className="block">
                    <span className="mb-1 block text-[11.5px] text-muted-foreground">From</span>
                    <input type="date" className="led-input !h-9 text-[13px]" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11.5px] text-muted-foreground">To</span>
                    <input type="date" className="led-input !h-9 text-[13px]" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
                  </label>
                </>
              )}
            </div>
          )
        }
      />

      <div className="flex gap-1 border-b border-border" role="tablist">
        {tabs.filter((t) => t.show).map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-[13px] font-medium border-b-2 -mb-px ${tab === t.key ? 'border-[var(--led-ink)] text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'deals' && (
        <>
          {totals && (
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              <Card padding="sm">
                <p className="text-[11.5px] text-muted-foreground">Settled deals</p>
                <p className="text-[20px] font-semibold tabular-nums text-foreground">{totals.count}</p>
                <p className="text-[11px] text-muted-foreground">{periodText}</p>
              </Card>
              {TILES.filter((t) => totals[t.key] != null).map((t) => (
                <Card key={t.key} padding="sm">
                  <p className="text-[11.5px] text-muted-foreground">{t.label}</p>
                  <p className={`text-[20px] font-semibold tabular-nums ${(totals[t.key] ?? 0) < 0 ? 'text-[var(--led-danger)]' : 'text-foreground'}`}>
                    {formatLedgerMoney(totals[t.key])}
                  </p>
                </Card>
              ))}
            </div>
          )}

          {can('deals') && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-1.5 text-[11.5px]">
                  {(Object.keys(CATEGORY_STYLE) as LedgerCategory[]).map((k) => (
                    <span key={k} className={`rounded px-2 py-0.5 ${CATEGORY_STYLE[k].className}`}>{CATEGORY_STYLE[k].label}</span>
                  ))}
                  <span className="rounded px-2 py-0.5 text-[var(--led-danger)] border border-border">Clawback</span>
                  {isOwner && <span className="rounded px-2 py-0.5 italic text-muted-foreground border border-border">Italic = from the application, not entered</span>}
                </div>
                <div className="ml-auto flex flex-wrap gap-2">
                  <div className="relative" ref={pickerRef}>
                    <Button variant="secondary" size="sm" onClick={() => setPickingColumns((v) => !v)}>Columns ({shownColumns.length})</Button>
                    {pickingColumns && (
                      <div className="absolute right-0 z-20 mt-1 w-72 max-h-[60vh] overflow-y-auto rounded-md border border-border bg-background p-2 shadow-lg">
                        <div className="flex justify-between px-1 pb-1.5 text-[11.5px]">
                          <button type="button" className="text-[var(--led-accent)]" onClick={() => { const all = allColumns.map((c) => c.key); setColumnKeys(all); saveColumnPref(all); }}>All</button>
                          <button type="button" className="text-[var(--led-accent)]" onClick={() => { setColumnKeys(DEFAULT_LEDGER_COLUMNS); saveColumnPref(DEFAULT_LEDGER_COLUMNS); }}>Default</button>
                        </div>
                        {allColumns.map((c) => (
                          <label key={c.key} className="flex items-center gap-2 rounded px-1 py-1 text-[12.5px] hover:bg-[var(--led-surface-2)]">
                            <input type="checkbox" checked={columnKeys.includes(c.key)} onChange={() => toggleColumn(c.key)} />
                            {c.label}
                          </label>
                        ))}
                        <p className="px-1 pt-1.5 text-[11px] text-muted-foreground">Downloads use the same columns.</p>
                      </div>
                    )}
                  </div>
                  {can('export') && (
                    <>
                      <Button variant="secondary" size="sm" onClick={exportXlsx} loading={exporting === 'xlsx'}>Excel</Button>
                      <Button variant="secondary" size="sm" onClick={exportPdf} loading={exporting === 'pdf'}>PDF</Button>
                    </>
                  )}
                </div>
              </div>

              {loading && !data ? (
                <ListSkeleton />
              ) : !data?.deals?.length ? (
                <Card><p className="text-[13px] text-muted-foreground">No deals settled in this period.</p></Card>
              ) : (
                <LedgerDealsTable
                  rows={data.deals}
                  months={data.months ?? []}
                  totals={data.totals}
                  columns={shownColumns}
                  onEdit={isOwner ? setEditing : undefined}
                />
              )}
            </>
          )}
        </>
      )}

      {tab === 'referrers' && (
        <LedgerReferrersTab
          range={range}
          isOwner={isOwner}
          canInvoice={can('invoices')}
          onEditDeal={isOwner ? setEditing : undefined}
          refreshKey={refreshKey}
        />
      )}

      {tab === 'invoices' && (
        <Card padding="none">
          {invoices.length === 0 ? (
            <p className="px-4 py-6 text-[13px] text-muted-foreground">No invoices yet. Create one from a referrer on the Referrers tab.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-[12.5px]">
                <thead className="bg-[var(--led-surface-2)] text-[11.5px] text-[var(--led-ink-2)]">
                  <tr>
                    <th className="px-3 py-2 text-left">Number</th>
                    <th className="px-3 py-2 text-left">Referrer</th>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Period</th>
                    <th className="px-3 py-2 text-right">Deals</th>
                    <th className="px-3 py-2 text-right">Total inc GST</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{inv.number}</td>
                      <td className="px-3 py-2">{inv.supplier.name}</td>
                      <td className="px-3 py-2">{formatDate(inv.issue_date)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{inv.period_label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{inv.deal_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatLedgerMoney(inv.total_inc_gst)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button type="button" className="led-btn led-btn-ghost led-btn-sm" onClick={() => setOpenInvoice(inv)}>Open</button>
                        {isOwner && <button type="button" className="led-btn led-btn-ghost led-btn-sm" onClick={() => voidInvoice(inv)}>Void</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'sharing' && isOwner && <LedgerSharingTab scopeLabels={access.scope_labels ?? {}} />}

      {editing && (
        <LedgerDealEditor deal={editing} referrers={referrers} onClose={() => setEditing(null)} onSaved={onSaved} />
      )}
      {openInvoice && (
        <LedgerInvoiceModal invoice={openInvoice} isOwner={isOwner} onClose={() => setOpenInvoice(null)} onPaid={() => setRefreshKey((k) => k + 1)} />
      )}

      {/* Off-screen print source for the PDF download. */}
      {printing && data?.deals && (
        <div style={{ position: 'fixed', left: -10000, top: 0 }} aria-hidden>
          <div id="ledger-report" style={{ background: '#fff', paddingBottom: 16, width: A4_PRINT_WIDTH_PX.landscape, overflow: 'hidden', fontFamily: 'Helvetica, Arial, sans-serif' }}>
            <XpressPrintHeader eyebrow="Private Ledger" title="Settled deals" subtitle={`${periodText} · ${data.deals.length} deal${data.deals.length === 1 ? '' : 's'}`} />
            <div style={{ padding: `0 ${PRINT_INSET}px` }}>
              <LedgerDealsPrintTable rows={data.deals} months={data.months ?? []} totals={data.totals} columns={shownColumns} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
