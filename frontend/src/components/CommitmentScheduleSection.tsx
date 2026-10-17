import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useToast } from './Toast';
import { useConfirm } from '../hooks/useConfirm';
import { Button, Card, Input, Select } from './ui';
import { formatDate, getErrorMessage } from '../lib/utils';
import { saveBlob } from '../lib/arrears';
import { downloadElementPdf } from '../lib/pdfExport';
import { A4_PRINT_WIDTH_PX, PRINT_INSET } from '../lib/printPage';
import XpressPrintHeader from './print/XpressPrintHeader';
import type {
  CommitmentColumn,
  CommitmentHolderType,
  CommitmentRow,
  CommitmentSchedule,
  CommitmentTotals,
  RepaymentFrequency,
} from '../types';

type Format = 'xlsx' | 'pdf';
const TOTALLED = new Set(['amount', 'monthly_repayment', 'balloon']);
// One column choice and format for the desk, remembered across holders.
const COLUMNS_KEY = 'commitment-schedule-columns';
const FORMAT_KEY = 'commitment-schedule-format';
const SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const money = (n: number | null | undefined) =>
  n == null ? '' : `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function cellText(col: CommitmentColumn, row: CommitmentRow): string {
  const v = row[col.key as keyof CommitmentRow] as string | number | null;
  if (v == null || v === '') return '';
  switch (col.kind) {
    case 'money': return money(v as number);
    case 'percent': return `${(v as number).toFixed(2)}%`;
    case 'term': return `${v} months`;
    case 'date': return formatDate(v as string);
    default: return String(v);
  }
}

function readStored<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeStored(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private window — not remembered */ }
}

/** The business commitment schedule for one person or entity: loans we
 *  arranged under our own name, then commitments held elsewhere — same columns,
 *  and who arranged an outside loan is never shown. The desk picks the columns
 *  and downloads it as Excel or PDF. Mounted on the contact and entity pages. */
export default function CommitmentScheduleSection({ holderType, holderId }: {
  holderType: CommitmentHolderType;
  holderId: string;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<CommitmentSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [chosen, setChosen] = useState<string[] | null>(() => readStored<string[]>(COLUMNS_KEY));
  const [format, setFormat] = useState<Format>(() => readStored<Format>(FORMAT_KEY) === 'pdf' ? 'pdf' : 'xlsx');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [editing, setEditing] = useState<{ row: CommitmentRow | null; section: 'ours' | 'other' } | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const base = `/commitment-schedules/${holderType}/${holderId}`;
  const printId = `commitment-schedule-${holderId}`;

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<CommitmentSchedule>(base);
      setData(data);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to load the commitment schedule'), 'error');
    } finally {
      setLoading(false);
    }
  }, [base, toast]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pickerOpen]);

  const allColumns = useMemo(() => data?.columns ?? [], [data]);
  const visibleKeys = useMemo(() => {
    const known = new Set(allColumns.map((c) => c.key));
    const picked = chosen?.filter((k) => known.has(k));
    return picked?.length ? picked : allColumns.filter((c) => c.default).map((c) => c.key);
  }, [allColumns, chosen]);
  const visible = allColumns.filter((c) => visibleKeys.includes(c.key));

  const toggleColumn = (key: string) => {
    const next = visibleKeys.includes(key) ? visibleKeys.filter((k) => k !== key) : [...visibleKeys, key];
    if (!next.length) return;
    setChosen(next);
    writeStored(COLUMNS_KEY, next);
  };
  const resetColumns = () => {
    setChosen(null);
    try { localStorage.removeItem(COLUMNS_KEY); } catch { /* ignore */ }
  };
  const pickFormat = (f: Format) => { setFormat(f); writeStored(FORMAT_KEY, f); };

  const download = async () => {
    if (!data) return;
    setDownloading(true);
    const safeName = data.holder.name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'schedule';
    try {
      if (format === 'xlsx') {
        const { data: blob } = await api.get<Blob>(`${base}/xlsx`, {
          params: { columns: visibleKeys.join(',') },
          responseType: 'blob',
        });
        saveBlob(blob, `Commitment-Schedule-${safeName}.xlsx`);
      } else {
        await downloadElementPdf(printId, `Commitment-Schedule-${safeName}.pdf`, 'landscape');
      }
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to download the schedule'), 'error');
    } finally {
      setDownloading(false);
    }
  };

  const removeLine = async (row: CommitmentRow) => {
    if (!(await confirm({
      title: 'Remove this commitment?',
      message: `${row.lender_name} — ${money(row.amount)} comes off the schedule.`,
      confirmText: 'Remove',
      variant: 'danger',
    }))) return;
    try {
      const { data } = await api.delete<CommitmentSchedule>(`${base}/lines/${row.id}`);
      setData(data);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to remove the commitment'), 'error');
    }
  };

  const lineCount = data?.sections.reduce((n, s) => n + s.rows.length, 0) ?? 0;

  return (
    <section id="commitment-schedule" className="scroll-mt-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-semibold">
              Business commitment schedule <span className="text-sm font-normal text-muted-foreground">({lineCount})</span>
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Loans we arranged, then commitments held elsewhere. Who arranged an outside loan never prints.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative" ref={pickerRef}>
              <Button variant="secondary" size="sm" onClick={() => setPickerOpen((o) => !o)} aria-expanded={pickerOpen}>
                Columns ({visible.length})
              </Button>
              {pickerOpen && (
                <div className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-border bg-background p-3 shadow-lg">
                  {([['Loan details', true], ['PPSR & tax', false]] as const).map(([group, isDefault]) => (
                    <div key={group} className="mb-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">{group}</div>
                      {allColumns.filter((c) => c.default === isDefault).map((c) => (
                        <label key={c.key} className="flex items-center gap-2 py-0.5 text-[13px] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={visibleKeys.includes(c.key)}
                            onChange={() => toggleColumn(c.key)}
                            className="h-3.5 w-3.5 accent-[var(--led-ink)]"
                          />
                          {c.label}
                        </label>
                      ))}
                    </div>
                  ))}
                  <button type="button" onClick={resetColumns} className="text-[12px] text-muted-foreground hover:text-foreground underline">
                    Reset to default
                  </button>
                </div>
              )}
            </div>
            <div className="inline-flex rounded-lg border border-border p-0.5" role="radiogroup" aria-label="Download format">
              {(['xlsx', 'pdf'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={format === f}
                  onClick={() => pickFormat(f)}
                  className={`rounded-md px-2.5 py-1 text-[12px] font-medium ${format === f ? 'bg-[var(--led-ink)] text-[var(--led-surface)]' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {f === 'xlsx' ? 'Excel' : 'PDF'}
                </button>
              ))}
            </div>
            <Button size="sm" onClick={download} loading={downloading} disabled={!data}>Download</Button>
          </div>
        </div>

        {loading || !data ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            {data.sections.map((section) => (
              <div key={section.key} className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[14px] font-semibold">{section.title}</h4>
                  {section.key === 'other' && (
                    <Button variant="secondary" size="sm" onClick={() => setEditing({ row: null, section: 'other' })}>+ Add commitment</Button>
                  )}
                </div>
                {!section.rows.length ? (
                  <p className="py-3 text-sm text-muted-foreground">
                    {section.key === 'ours' ? 'No settled loans with us yet.' : 'None recorded.'}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground">
                          {visible.map((c) => (
                            <th key={c.key} className={`pb-2 pr-3 font-medium whitespace-nowrap ${c.kind === 'money' ? 'text-right' : ''}`}>{c.label}</th>
                          ))}
                          <th className="pb-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {section.rows.map((row) => (
                          <tr key={row.id} className="border-b border-border/50 align-top">
                            {visible.map((c) => (
                              <td key={c.key} className={`py-2 pr-3 ${c.kind === 'money' ? 'text-right tabular-nums whitespace-nowrap' : ''} ${c.kind === 'multiline' ? 'whitespace-pre-line min-w-[160px]' : ''} ${c.kind === 'term' || c.kind === 'date' ? 'whitespace-nowrap' : ''}`}>
                                {c.key === 'lender_name' && row.application_id ? (
                                  <Link to={`/admin/applications/${row.application_id}`} className="hover:underline">{row.lender_name}</Link>
                                ) : cellText(c, row) || <span className="text-muted-foreground">—</span>}
                              </td>
                            ))}
                            <td className="py-2 whitespace-nowrap text-right">
                              {row.missing.length > 0 && (
                                <span className="mr-2 rounded bg-[var(--led-warning-tint)] px-1.5 py-0.5 text-[11px] text-[var(--led-warning)]" title={`Missing: ${row.missing.join(', ')}`}>
                                  Missing {row.missing.length}
                                </span>
                              )}
                              <Button variant="ghost" size="sm" onClick={() => setEditing({ row, section: section.key })}>Edit</Button>
                              {section.key === 'other' && (
                                <Button variant="ghost" size="sm" onClick={() => removeLine(row)}>Remove</Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot><TotalsRow label="Subtotal" totals={section.totals} visible={visible} trailing /></tfoot>
                    </table>
                  </div>
                )}
              </div>
            ))}
            <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-secondary/50 px-4 py-3 text-sm">
              <span className="font-semibold">Total</span>
              <span>Financed <strong className="tabular-nums">{money(data.totals.amount)}</strong></span>
              <span>Monthly <strong className="tabular-nums">{money(data.totals.monthly_repayment)}</strong></span>
              <span>Annual <strong className="tabular-nums">{money(data.totals.annual_repayment)}</strong></span>
              <span>Balloons <strong className="tabular-nums">{money(data.totals.balloon)}</strong></span>
            </div>
            <PrintableSchedule id={printId} data={data} visible={visible} />
          </>
        )}
      </Card>
      {editing && (
        <CommitmentLineModal
          base={base}
          row={editing.row}
          isOurs={editing.section === 'ours'}
          onClose={() => setEditing(null)}
          onSaved={(next) => { setData(next); setEditing(null); }}
        />
      )}
    </section>
  );
}

function TotalsRow({ label, totals, visible, trailing = false }: {
  label: string;
  totals: CommitmentTotals;
  visible: CommitmentColumn[];
  trailing?: boolean;
}) {
  const labelAt = visible.findIndex((c) => !TOTALLED.has(c.key));
  return (
    <tr className="font-semibold">
      {visible.map((c, i) => (
        <td key={c.key} className={`pt-2 pr-3 ${c.kind === 'money' ? 'text-right tabular-nums whitespace-nowrap' : ''}`}>
          {TOTALLED.has(c.key) ? money(totals[c.key as keyof CommitmentTotals]) : i === labelAt ? label : ''}
        </td>
      ))}
      {trailing && <td />}
    </tr>
  );
}

/** Off-screen A4 landscape layout that the PDF is drawn from — the chosen
 *  columns only, nothing the desk uses internally. */
function PrintableSchedule({ id, data, visible }: { id: string; data: CommitmentSchedule; visible: CommitmentColumn[] }) {
  const th: React.CSSProperties = { background: '#0d1f3c', color: '#fff', padding: '5px 6px', textAlign: 'left', fontWeight: 600, fontSize: 9 };
  const td: React.CSSProperties = { borderBottom: '1px solid #d9dde5', padding: '4px 6px', fontSize: 9, verticalAlign: 'top', whiteSpace: 'pre-line', wordBreak: 'break-word' };
  const labelAt = visible.findIndex((c) => !TOTALLED.has(c.key));
  const totalsCells = (totals: CommitmentTotals, label: string) => visible.map((c, i) => (
    <td key={c.key} style={{ ...td, fontWeight: 700, textAlign: c.kind === 'money' ? 'right' : 'left', borderBottom: 'none' }}>
      {TOTALLED.has(c.key) ? money(totals[c.key as keyof CommitmentTotals]) : i === labelAt ? label : ''}
    </td>
  ));
  return (
    <div style={{ position: 'absolute', left: -10000, top: 0 }} aria-hidden>
      <div id={id} style={{ width: A4_PRINT_WIDTH_PX.landscape, overflow: 'hidden', background: '#fff', color: '#111827', fontFamily: SANS, fontSize: 10, lineHeight: 1.35 }}>
        <XpressPrintHeader
          eyebrow="Business commitment schedule"
          title={data.holder.name}
          subtitle={data.holder.abn ? `ABN ${data.holder.abn}` : undefined}
        />
        <div style={{ padding: `0 ${PRINT_INSET}px 16px` }}>
          {data.sections.map((section) => (
            <div key={section.key} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, margin: '4px 0 6px', color: '#0d1f3c' }}>{section.title}</div>
              {!section.rows.length ? (
                <div style={{ fontSize: 9, color: '#6b7280', fontStyle: 'italic' }}>None recorded.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>{visible.map((c) => <th key={c.key} style={{ ...th, textAlign: c.kind === 'money' ? 'right' : 'left' }}>{c.label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {section.rows.map((row) => (
                      <tr key={row.id}>
                        {visible.map((c) => (
                          <td key={c.key} style={{ ...td, textAlign: c.kind === 'money' ? 'right' : 'left' }}>{cellText(c, row)}</td>
                        ))}
                      </tr>
                    ))}
                    <tr>{totalsCells(section.totals, 'Subtotal')}</tr>
                  </tbody>
                </table>
              )}
            </div>
          ))}
          <table className="break-inside-avoid" style={{ width: '100%', borderCollapse: 'collapse', background: '#eef1f6' }}>
            <tbody>
              <tr>
                <td style={{ padding: '6px 8px', fontWeight: 700, fontSize: 10 }}>TOTAL</td>
                <td style={{ padding: '6px 8px', fontSize: 10 }}>Amount financed <strong>{money(data.totals.amount)}</strong></td>
                <td style={{ padding: '6px 8px', fontSize: 10 }}>Monthly repayments <strong>{money(data.totals.monthly_repayment)}</strong></td>
                <td style={{ padding: '6px 8px', fontSize: 10 }}>Annual repayments <strong>{money(data.totals.annual_repayment)}</strong></td>
                <td style={{ padding: '6px 8px', fontSize: 10 }}>Balloons <strong>{money(data.totals.balloon)}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

type FormState = Record<string, string>;

const FIELD_GROUPS: { title: string; fields: { key: string; label: string; type?: 'number' | 'date' | 'textarea' }[] }[] = [
  { title: 'Loan', fields: [
    { key: 'lender_name', label: 'Lender' },
    { key: 'amount', label: 'Amount financed ($)', type: 'number' },
    { key: 'start_date', label: 'Settled date', type: 'date' },
    { key: 'term_months', label: 'Term (months)', type: 'number' },
    { key: 'end_date', label: 'End date', type: 'date' },
    { key: 'balloon', label: 'Balloon ($)', type: 'number' },
    { key: 'interest_rate', label: 'Rate (% p.a.)', type: 'number' },
  ] },
  { title: 'Asset', fields: [
    { key: 'asset_description', label: 'Asset details (one per line)', type: 'textarea' },
    { key: 'vin', label: 'VIN (one per line)', type: 'textarea' },
  ] },
  { title: 'PPSR & tax', fields: [
    { key: 'ppsr_charge_number', label: 'PPSR charge no.' },
    { key: 'ppsr_change_number', label: 'PPSR change no.' },
    { key: 'ppsr_organisation_identifier', label: 'Organisation identifier' },
    { key: 'asset_price_ex_gst', label: 'Asset price ex GST ($)', type: 'number' },
    { key: 'gst_claimed', label: 'GST claimed ($)', type: 'number' },
    { key: 'tax_invoice_date', label: 'Tax invoice date', type: 'date' },
  ] },
];
const NUMERIC = new Set(['amount', 'term_months', 'balloon', 'interest_rate', 'asset_price_ex_gst', 'gst_claimed', 'repayment_amount']);
const LABEL = 'block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1';

function initialForm(row: CommitmentRow | null): FormState {
  const s = (v: unknown) => (v == null ? '' : String(v));
  if (!row) return { repayment_frequency: 'monthly' };
  return {
    lender_name: s(row.lender_name), amount: s(row.amount), start_date: s(row.settled_date),
    term_months: s(row.term_months), end_date: s(row.end_date), balloon: s(row.balloon),
    interest_rate: s(row.interest_rate), asset_description: s(row.asset_description), vin: s(row.vin),
    ppsr_charge_number: s(row.ppsr_charge_number), ppsr_change_number: s(row.ppsr_change_number),
    ppsr_organisation_identifier: s(row.ppsr_organisation_identifier), asset_price_ex_gst: s(row.asset_price_ex_gst),
    gst_claimed: s(row.gst_claimed), tax_invoice_date: s(row.tax_invoice_date),
    repayment_amount: s(row.edit.repayment_amount), repayment_frequency: row.edit.repayment_frequency || 'monthly',
    other_broker_name: s(row.edit.other_broker_name), notes: s(row.edit.notes),
  };
}

function CommitmentLineModal({ base, row, isOurs, onClose, onSaved }: {
  base: string;
  row: CommitmentRow | null;
  isOurs: boolean;
  onClose: () => void;
  onSaved: (schedule: CommitmentSchedule) => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(() => initialForm(row));
  const [saving, setSaving] = useState(false);
  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.lender_name?.trim() || !form.amount) {
      toast('Lender and amount are required', 'error');
      return;
    }
    // Blank clears a field; numbers go as numbers.
    const body: Record<string, string | number | null> = {};
    for (const [k, v] of Object.entries(form)) {
      if (isOurs && k === 'other_broker_name') continue;
      body[k] = v.trim() === '' ? null : NUMERIC.has(k) ? Number(v) : v;
    }
    body.repayment_frequency = (form.repayment_frequency || 'monthly') as RepaymentFrequency;
    setSaving(true);
    try {
      const { data } = row
        ? await api.patch<CommitmentSchedule>(`${base}/lines/${row.id}`, body)
        : await api.post<CommitmentSchedule>(`${base}/lines`, body);
      onSaved(data);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to save'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 flex items-end sm:items-center justify-center sm:p-4" style={{ zIndex: 'var(--z-modal)' }}>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-[720px] max-h-[90vh] overflow-y-auto rounded-t-[10px] sm:rounded-[10px] bg-background border border-border p-6 shadow-xl"
        style={{ animation: 'fadeInUp 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
      >
        <h3 className="text-[17px] font-semibold text-foreground">
          {row ? (isOurs ? 'Loan we arranged' : 'Edit commitment') : 'Add commitment'}
        </h3>
        <p className="text-[12.5px] text-muted-foreground mt-0.5 mb-4">
          {isOurs
            ? 'Filled in from the settled deal — correct anything the lender\'s documents say differently.'
            : 'A loan held elsewhere. Who arranged it stays internal and never prints.'}
        </p>
        {FIELD_GROUPS.map((group) => (
          <fieldset key={group.title} className="mb-4">
            <legend className="text-[12px] font-semibold text-foreground mb-2">{group.title}</legend>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {group.fields.map((f) => (
                <div key={f.key} className={f.type === 'textarea' ? 'sm:col-span-3' : ''}>
                  <label className={LABEL} htmlFor={`cl-${f.key}`}>{f.label}</label>
                  {f.type === 'textarea' ? (
                    <textarea id={`cl-${f.key}`} className="led-input w-full min-h-[60px] resize-y text-sm" value={form[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} />
                  ) : (
                    <Input id={`cl-${f.key}`} type={f.type ?? 'text'} step={f.type === 'number' ? 'any' : undefined} min={f.type === 'number' ? 0 : undefined} value={form[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} />
                  )}
                </div>
              ))}
              {group.title === 'Loan' && (
                <div className="sm:col-span-2 grid grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL} htmlFor="cl-repayment">Repayment ($)</label>
                    <Input id="cl-repayment" type="number" step="any" min={0} value={form.repayment_amount ?? ''} onChange={(e) => set('repayment_amount', e.target.value)} />
                  </div>
                  <div>
                    <label className={LABEL} htmlFor="cl-frequency">Frequency</label>
                    <Select id="cl-frequency" value={form.repayment_frequency || 'monthly'} onChange={(e) => set('repayment_frequency', e.target.value)}>
                      <option value="monthly">Monthly</option>
                      <option value="fortnightly">Fortnightly</option>
                      <option value="weekly">Weekly</option>
                    </Select>
                  </div>
                </div>
              )}
            </div>
          </fieldset>
        ))}
        <fieldset className="mb-4">
          <legend className="text-[12px] font-semibold text-foreground mb-2">Internal</legend>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {!isOurs && (
              <div>
                <label className={LABEL} htmlFor="cl-broker">Arranged by (internal)</label>
                <Input id="cl-broker" value={form.other_broker_name ?? ''} onChange={(e) => set('other_broker_name', e.target.value)} />
              </div>
            )}
            <div className={isOurs ? 'sm:col-span-3' : 'sm:col-span-2'}>
              <label className={LABEL} htmlFor="cl-notes">Notes</label>
              <Input id="cl-notes" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
            </div>
          </div>
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" loading={saving}>Save</Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
