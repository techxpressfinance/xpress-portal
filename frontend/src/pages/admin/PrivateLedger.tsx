import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../hooks/useConfirm';
import { Button, Card, PageHeader } from '../../components/ui';
import { ListSkeleton } from '../../components/ui/Skeletons';
import NotFound from '../../components/NotFound';
import XpressPrintHeader from '../../components/print/XpressPrintHeader';
import LedgerDealsTable, { LedgerDealsPrintTable, LedgerPipelineTable } from '../../components/ledger/LedgerDealsTable';
import LedgerDealEditor from '../../components/ledger/LedgerDealEditor';
import LedgerReferrersTab from '../../components/ledger/LedgerReferrersTab';
import LedgerSharingTab from '../../components/ledger/LedgerSharingTab';
import LedgerInvoiceModal from '../../components/ledger/LedgerInvoiceDocument';
import LedgerNewDealModal from '../../components/ledger/LedgerNewDealModal';
import LedgerReceiptsTab from '../../components/ledger/LedgerReceiptsTab';
import LedgerSummaryCards from '../../components/ledger/LedgerSummaryCards';
import LedgerMenu from '../../components/ledger/LedgerMenu';
import { LedgerPaymentModal } from '../../components/ledger/LedgerExtraPayments';
import { downloadElementPdf } from '../../lib/pdfExport';
import { A4_PRINT_WIDTH_PX, PRINT_INSET } from '../../lib/printPage';
import { formatDate, getErrorMessage } from '../../lib/utils';
import {
  applyGstView,
  CATEGORY_STYLE,
  DEFAULT_LEDGER_COLUMNS,
  figureLabel,
  formatLedgerMoney,
  GST_VIEW_LABEL,
  loadColumnPref,
  loadViewPref,
  pickableColumns,
  presetRange,
  presetReportName,
  RANGE_PRESETS,
  REPORT_PRESETS,
  saveColumnPref,
  saveViewPref,
  type GstView,
  type RangePreset,
  type ReportLayout,
  type ViewPref,
} from '../../lib/ledger';
import type {
  LedgerAccessInfo,
  LedgerBroker,
  LedgerCategory,
  LedgerColumn,
  LedgerDealRow,
  LedgerDealsResponse,
  LedgerExtraPayment,
  LedgerInvoice,
  LedgerPayee,
  LedgerReport,
} from '../../types';

type Tab = 'deals' | 'referrers' | 'invoices' | 'receipts' | 'sharing';

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
  const [payees, setPayees] = useState<LedgerPayee[]>([]);
  const [brokers, setBrokers] = useState<LedgerBroker[]>([]);
  // Narrow the books to one team member's deals ('' = everyone's).
  const [brokerId, setBrokerId] = useState('');
  const [addingDeal, setAddingDeal] = useState(false);
  const [editing, setEditing] = useState<LedgerDealRow | null>(null);
  // An extra payment being added ('new') or changed, from the deals table.
  const [editingPayment, setEditingPayment] = useState<LedgerExtraPayment | 'new' | null>(null);
  const [columnKeys, setColumnKeys] = useState<string[]>(() => loadColumnPref() ?? DEFAULT_LEDGER_COLUMNS);
  const [view, setView] = useState<ViewPref>(loadViewPref);
  const updateView = (patch: Partial<ViewPref>) => setView((v) => { const next = { ...v, ...patch }; saveViewPref(next); return next; });
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null);
  const [printing, setPrinting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [invoices, setInvoices] = useState<LedgerInvoice[]>([]);
  const [openInvoice, setOpenInvoice] = useState<LedgerInvoice | null>(null);

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

  const params = useMemo(
    () => ({ date_from: range.from || undefined, date_to: range.to || undefined, broker_id: brokerId || undefined }),
    [range, brokerId],
  );

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

  const canReferrers = Boolean(access?.access && (isOwner || scopes.has('referrers' as never)));
  const loadPayees = useCallback(() => {
    if (!canReferrers) return;
    api.get<LedgerPayee[]>('/ledger/payees').then(({ data }) => setPayees(data)).catch(() => setPayees([]));
  }, [canReferrers]);
  useEffect(() => { loadPayees(); }, [loadPayees]);

  useEffect(() => {
    if (!access?.access) return;
    api.get<LedgerBroker[]>('/ledger/brokers').then(({ data }) => setBrokers(data)).catch(() => setBrokers([]));
  }, [access]);

  useEffect(() => {
    if (tab !== 'invoices') return;
    api.get<LedgerInvoice[]>('/ledger/invoices')
      .then(({ data }) => setInvoices(data))
      .catch((err) => toast(getErrorMessage(err, 'Failed to load invoices'), 'error'));
  }, [tab, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (access === null) return <div className="p-6"><ListSkeleton /></div>;
  if (!access.access) return <NotFound />;

  const allColumns: LedgerColumn[] = access.columns ?? [];
  const pickable = pickableColumns(allColumns);
  // The picked figures, each in the GST view chosen (ex / inc / all three).
  const viewed = applyGstView(allColumns, columnKeys, view.gst);
  const shownColumns = viewed.length ? viewed : applyGstView(allColumns, pickable.map((c) => c.key), view.gst);
  const summary = view.layout === 'summary';
  const reportName = presetReportName(preset);

  const applyPreset = (key: string) => {
    const p = REPORT_PRESETS.find((x) => x.key === key);
    if (!p) return;
    const keys = p.columns === 'all' ? pickable.map((c) => c.key) : p.columns;
    setColumnKeys(keys);
    saveColumnPref(keys);
    updateView({ layout: p.layout, gst: p.gst });
  };

  const choosePreset = (p: RangePreset) => {
    setPreset(p);
    if (p !== 'custom') setRange(presetRange(p));
  };

  const toggleColumn = (key: string) => {
    // A GST figure is one choice however many of its columns the view shows.
    const group = allColumns.find((c) => c.key === key)?.gst_group;
    const family = group ? allColumns.filter((c) => c.gst_group === group).map((c) => c.key) : [key];
    const on = columnKeys.some((k) => family.includes(k));
    const next = on ? columnKeys.filter((k) => !family.includes(k)) : [...columnKeys, key];
    setColumnKeys(next);
    saveColumnPref(next);
  };

  const exportXlsx = async () => {
    setExporting('xlsx');
    try {
      const res = await api.get('/ledger/export.xlsx', {
        params: {
          ...params,
          columns: shownColumns.map((c) => c.key).join(','),
          layout: view.layout,
          include_pipeline: view.showPipeline && !summary,
          title: `${reportName}${summary ? ' (summary)' : ''}${brokerName ? ` — ${brokerName}` : ''}`,
        },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${reportName}${summary ? ' summary' : ''} ${range.from || 'start'} to ${range.to || 'today'}${brokerName ? ` - ${brokerName}` : ''}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(getErrorMessage(err, 'Excel download failed'), 'error');
    } finally {
      setExporting(null);
    }
  };

  const exportPdf = async () => {
    if (!data?.deals?.length && !data?.extra_payments?.length) {
      toast('No deals in this period', 'error');
      return;
    }
    setExporting('pdf');
    setPrinting(true);
    try {
      // Let React paint the off-screen print table before html2pdf reads it.
      await new Promise((resolve) => setTimeout(resolve, 50));
      await downloadElementPdf('ledger-report', `${reportName}${summary ? ' summary' : ''} ${range.from || 'start'} to ${range.to || 'today'}.pdf`, 'landscape');
      api.post('/ledger/export-logged').catch(() => {});
    } catch (err) {
      toast(getErrorMessage(err, 'PDF download failed'), 'error');
    } finally {
      setPrinting(false);
      setExporting(null);
    }
  };

  const saveVbReceived = async (month: string, value: number | null) => {
    try {
      await api.put(`/ledger/months/${month}`, { vb_received_inc_gst: value });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to save'), 'error');
      throw err;
    }
  };

  const report: LedgerReport = {
    months: data?.months ?? [], quarters: data?.quarters ?? [], half_years: data?.half_years ?? [],
    years: data?.years ?? [], show: data?.show, totals: data?.totals,
  };
  const pipeline = data?.pipeline ?? [];
  // Deals an extra payment can be tied to: this period's, and the pipeline.
  const dealOptions = [...(data?.deals ?? []), ...pipeline].map((d) => ({
    key: d.application_id,
    label: [d.customer_name, d.entity_name && d.entity_name !== d.customer_name ? d.entity_name : null,
      d.is_pipeline ? '(pipeline)' : d.settled_on ? formatDate(d.settled_on) : null].filter(Boolean).join(' · '),
  }));

  const brokerName = brokers.find((b) => b.id === brokerId)?.full_name ?? '';

  const onDeleted = (key: string) => {
    setData((prev) => prev && prev.deals ? { ...prev, deals: prev.deals.filter((d) => d.application_id !== key) } : prev);
    setRefreshKey((k) => k + 1);
  };

  const onSaved = (row: LedgerDealRow) => {
    const swap = (list?: LedgerDealRow[]) => list?.map((d) => (d.application_id === row.application_id ? row : d));
    setData((prev) => prev ? { ...prev, deals: swap(prev.deals), pipeline: swap(prev.pipeline) } : prev);
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
    { key: 'referrers', label: 'Referrer & staff comms', show: can('referrers') },
    { key: 'invoices', label: 'Invoices', show: can('invoices') && can('referrers') },
    { key: 'receipts', label: 'Receipts', show: can('income') },
    { key: 'sharing', label: 'Sharing', show: isOwner },
  ];
  const totals = data?.totals;
  const periodText = range.from || range.to
    ? `${range.from ? formatDate(range.from) : 'the start'} – ${range.to ? formatDate(range.to) : 'today'}`
    : 'All time';

  const filterCls = 'led-input !h-8 !w-auto text-[12.5px]';
  const gstCaption = view.gst === 'ex' ? 'Amounts ex GST' : view.gst === 'inc' ? 'Amounts inc GST' : 'Ex GST, GST and inc GST side by side';

  return (
    <div className="p-6 max-w-[1500px] mx-auto space-y-5">
      <div className="[&>div]:!mb-0">
        <PageHeader
          title="Private Ledger"
          subtitle={isOwner ? 'Only you can see this — share it from the Sharing tab.' : 'Shared with you, view-only.'}
        />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-border">
        <div className="flex gap-1 -mb-px" role="tablist">
          {tabs.filter((t) => t.show).map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-2.5 text-[13px] font-medium border-b-2 ${tab === t.key ? 'border-[var(--led-ink)] text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab !== 'sharing' && (
          <div className="flex flex-wrap items-center gap-2 pb-2">
            <select className={filterCls} aria-label="Period" value={preset} onChange={(e) => choosePreset(e.target.value as RangePreset)}>
              {[...new Set(RANGE_PRESETS.map((p) => p.group))].map((g) => (
                <optgroup key={g} label={g === 'Other' ? 'Other periods' : `${g} report`}>
                  {RANGE_PRESETS.filter((p) => p.group === g).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </optgroup>
              ))}
            </select>
            {preset === 'custom' && (
              <>
                <input type="date" aria-label="From" className={filterCls} value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
                <span className="text-muted-foreground">–</span>
                <input type="date" aria-label="To" className={filterCls} value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
              </>
            )}
            {tab === 'deals' && brokers.length > 0 && (
              <select className={filterCls} aria-label="Whose deals" value={brokerId} onChange={(e) => setBrokerId(e.target.value)}>
                <option value="">Everyone&rsquo;s deals</option>
                {brokers.map((b) => <option key={b.id} value={b.id}>{b.full_name}</option>)}
              </select>
            )}
          </div>
        )}
      </div>

      {tab === 'deals' && (
        <>
          {totals && <LedgerSummaryCards totals={totals} periodText={periodText} />}

          {can('deals') && (
            <>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="led-segment" role="radiogroup" aria-label="Report layout">
                    {([['detailed', 'Every deal'], ['summary', 'Totals only']] as [ReportLayout, string][]).map(([v, label]) => (
                      <button
                        key={v}
                        type="button"
                        role="radio"
                        aria-checked={view.layout === v}
                        className={view.layout === v ? 'led-active' : ''}
                        onClick={() => updateView({ layout: v })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="led-segment" role="radiogroup" aria-label="GST">
                    {([['ex', 'Ex GST'], ['inc', 'Inc GST'], ['all', 'Ex + GST + inc']] as [GstView, string][]).map(([v, label]) => (
                      <button
                        key={v}
                        type="button"
                        role="radio"
                        aria-checked={view.gst === v}
                        title={GST_VIEW_LABEL[v]}
                        className={view.gst === v ? 'led-active' : ''}
                        onClick={() => updateView({ gst: v })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {!summary && pipeline.length > 0 && (
                    <label className="ml-1 inline-flex items-center gap-1.5 text-[12.5px] text-[var(--led-ink-2)]">
                      <input type="checkbox" checked={view.showPipeline} onChange={(e) => updateView({ showPipeline: e.target.checked })} />
                      Pipeline ({pipeline.length})
                    </label>
                  )}

                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <LedgerMenu label={`Columns · ${shownColumns.length}`}>
                      {(close) => (
                        <>
                          <p className="led-label px-1 pb-1">Quick setup</p>
                          <div className="space-y-0.5 pb-2 mb-2 border-b border-border">
                            {REPORT_PRESETS.map((p) => (
                              <button
                                key={p.key}
                                type="button"
                                className="block w-full rounded px-1.5 py-1 text-left hover:bg-[var(--led-surface-2)]"
                                onClick={() => { applyPreset(p.key); close(); }}
                              >
                                <span className="block text-[12.5px] font-medium text-foreground">{p.label}</span>
                                <span className="block text-[11.5px] text-muted-foreground">{p.hint}</span>
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center justify-between px-1 pb-1">
                            <span className="led-label">Columns</span>
                            <span className="flex gap-3 text-[11.5px]">
                              <button type="button" className="text-[var(--led-accent)] hover:underline" onClick={() => { const all = pickable.map((c) => c.key); setColumnKeys(all); saveColumnPref(all); }}>All</button>
                              <button type="button" className="text-[var(--led-accent)] hover:underline" onClick={() => { setColumnKeys(DEFAULT_LEDGER_COLUMNS); saveColumnPref(DEFAULT_LEDGER_COLUMNS); }}>Sheet layout</button>
                            </span>
                          </div>
                          {pickable.map((c) => (
                            <label key={c.key} className="flex items-center gap-2 rounded px-1 py-1 text-[12.5px] hover:bg-[var(--led-surface-2)]">
                              <input
                                type="checkbox"
                                checked={c.gst_group ? shownColumns.some((x) => x.gst_group === c.gst_group) : columnKeys.includes(c.key)}
                                onChange={() => toggleColumn(c.key)}
                              />
                              {figureLabel(c)}
                            </label>
                          ))}
                        </>
                      )}
                    </LedgerMenu>
                    {can('export') && (
                      <LedgerMenu label={exporting ? 'Preparing…' : 'Export'} width="w-64">
                        {(close) => (
                          <>
                            <button type="button" disabled={Boolean(exporting)} className="block w-full rounded px-1.5 py-1.5 text-left text-[12.5px] font-medium hover:bg-[var(--led-surface-2)]" onClick={() => { close(); exportXlsx(); }}>
                              Excel workbook
                            </button>
                            <button type="button" disabled={Boolean(exporting)} className="block w-full rounded px-1.5 py-1.5 text-left text-[12.5px] font-medium hover:bg-[var(--led-surface-2)]" onClick={() => { close(); exportPdf(); }}>
                              PDF (landscape)
                            </button>
                            <p className="mt-1 border-t border-border px-1.5 pt-2 text-[11.5px] text-muted-foreground">
                              Uses the period, layout, GST view and columns on screen.
                              {!summary && <> Excel also adds an extra-payments sheet{view.showPipeline ? ' and a pipeline sheet' : ''}.</>}
                            </p>
                          </>
                        )}
                      </LedgerMenu>
                    )}
                    {isOwner && <Button size="sm" variant="secondary" onClick={() => setEditingPayment('new')}>Add extra payment</Button>}
                    {isOwner && <Button size="sm" onClick={() => setAddingDeal(true)}>Add deal</Button>}
                  </div>
                </div>
              </div>

              {loading && !data ? (
                <ListSkeleton />
              ) : !report.months.length ? (
                <Card>
                  <p className="text-[13px] text-muted-foreground">
                    No deals settled in this period. A deal joins the report the day it settles, with its client and entity
                    {pipeline.length ? ' — deals already past Started are in the pipeline below.' : '.'}
                  </p>
                </Card>
              ) : (
                <div className="space-y-2">
                  <LedgerDealsTable
                    rows={data?.deals ?? []}
                    report={report}
                    payments={data?.extra_payments ?? []}
                    columns={shownColumns}
                    summary={summary}
                    gstView={view.gst}
                    onEdit={isOwner ? setEditing : undefined}
                    onEditPayment={isOwner ? setEditingPayment : undefined}
                    onSaveVbReceived={isOwner ? saveVbReceived : undefined}
                  />
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11.5px] text-muted-foreground">
                    <span>{gstCaption}</span>
                    {!summary && (
                      <>
                        {(Object.keys(CATEGORY_STYLE) as LedgerCategory[]).map((k) => (
                          <span key={k} className="inline-flex items-center gap-1.5">
                            <span className={`h-2 w-2 rounded-full ${CATEGORY_STYLE[k].dot}`} />
                            {CATEGORY_STYLE[k].label}
                          </span>
                        ))}
                        <span className="text-[var(--led-danger)]">Red = clawback</span>
                        {isOwner && <span className="italic">Italic = from the application, not entered</span>}
                        {(data?.extra_payments?.length ?? 0) > 0 && (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-sm bg-[var(--led-violet-tint)]" />
                            Extra payment — counts in the month it was paid
                          </span>
                        )}
                        {isOwner && <span>Click a deal or payment to edit it</span>}
                      </>
                    )}
                  </div>
                </div>
              )}

              {view.showPipeline && !summary && pipeline.length > 0 && (
                <section className="space-y-2 pt-2">
                  <div>
                    <h2 className="text-[14px] font-semibold text-foreground">
                      Pipeline <span className="font-normal text-muted-foreground">· asset finance past Started, not yet settled</span>
                    </h2>
                    <p className="text-[12px] text-muted-foreground">
                      Not in any total above — each deal joins the report in the month it settles. Figures come from lender
                      pricing until you enter your own.
                    </p>
                  </div>
                  <LedgerPipelineTable rows={pipeline} totals={data?.pipeline_totals} columns={shownColumns} gstView={view.gst} onEdit={isOwner ? setEditing : undefined} />
                </section>
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
          payees={payees}
          onPayeesChanged={() => { loadPayees(); setRefreshKey((k) => k + 1); }}
          dealOptions={dealOptions}
          onChanged={() => setRefreshKey((k) => k + 1)}
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

      {tab === 'receipts' && <LedgerReceiptsTab range={range} isOwner={isOwner} />}

      {tab === 'sharing' && isOwner && <LedgerSharingTab scopeLabels={access.scope_labels ?? {}} />}

      {editing && (
        <LedgerDealEditor
          deal={editing}
          payees={payees}
          brokers={brokers}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
          onDeleted={onDeleted}
        />
      )}
      {editingPayment && (
        <LedgerPaymentModal
          payment={editingPayment === 'new' ? null : editingPayment}
          payees={payees}
          dealOptions={dealOptions}
          onClose={() => setEditingPayment(null)}
          onSaved={() => setRefreshKey((k) => k + 1)}
        />
      )}
      {addingDeal && (
        <LedgerNewDealModal
          brokers={brokers}
          onClose={() => setAddingDeal(false)}
          onCreated={(row) => { setAddingDeal(false); setEditing(row); setRefreshKey((k) => k + 1); }}
        />
      )}
      {openInvoice && (
        <LedgerInvoiceModal invoice={openInvoice} isOwner={isOwner} onClose={() => setOpenInvoice(null)} onPaid={() => setRefreshKey((k) => k + 1)} />
      )}

      {/* Off-screen print source for the PDF download. */}
      {printing && data && (
        <div style={{ position: 'fixed', left: -10000, top: 0 }} aria-hidden>
          <div id="ledger-report" style={{ background: '#fff', paddingBottom: 16, width: A4_PRINT_WIDTH_PX.landscape, overflow: 'hidden', fontFamily: 'Helvetica, Arial, sans-serif' }}>
            <XpressPrintHeader
              eyebrow="Private Ledger"
              title={`${reportName}${summary ? ' — summary' : ''}${brokerName ? ` — ${brokerName}` : ''}`}
              subtitle={`${periodText} · ${data.deals?.length ?? 0} settled deal${data.deals?.length === 1 ? '' : 's'} · ${GST_VIEW_LABEL[view.gst]}`}
            />
            <div style={{ padding: `0 ${PRINT_INSET}px` }}>
              <LedgerDealsPrintTable rows={data.deals ?? []} report={report} payments={data.extra_payments ?? []} columns={shownColumns} summary={summary} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
