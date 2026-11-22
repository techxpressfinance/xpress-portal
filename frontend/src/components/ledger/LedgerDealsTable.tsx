import { useState } from 'react';
import { formatDate } from '../../lib/utils';
import {
  CATEGORY_STYLE, collapseRepeatedTotals, extraPaymentStatusText, formatLedgerMoney, formatMonth, PERIOD_ONLY_COLUMNS,
  reportItems, screenLabel, type GstView, type ReportItem, type TotalLevel,
} from '../../lib/ledger';
import type { LedgerColumn, LedgerDealRow, LedgerExtraPayment, LedgerReport, LedgerTotals } from '../../types';

function cellText(row: LedgerDealRow, col: LedgerColumn): string {
  if (PERIOD_ONLY_COLUMNS.has(col.key)) return '';
  const value = (row as unknown as Record<string, unknown>)[col.key];
  if (col.kind === 'money') return formatLedgerMoney(value as number | null | undefined);
  if (col.kind === 'date') return value ? formatDate(value as string) : '—';
  if (col.kind === 'bool') return value ? 'Yes' : 'No';
  return (value as string | null | undefined) || '—';
}

/** An extra payment's cell under a deal column: its date where the deal has
 *  its settled date, who was paid under referrer / staff, the amount under
 *  the extra-payment columns, the payment details under theirs. */
function paymentCellText(p: LedgerExtraPayment, col: LedgerColumn): string {
  const money = (n: number) => formatLedgerMoney(n);
  switch (col.key) {
    case 'settled_on': return formatDate(p.payment_date);
    case 'entity_name': return p.deal_name ? `For ${p.deal_name}` : 'Not linked to a deal';
    case 'deal_status': return 'Extra payment';
    case 'referrer_name': return p.payee_kind === 'staff' ? '' : p.payee_name || 'Unnamed';
    case 'staff_name': return p.payee_kind === 'staff' ? p.payee_name || 'Unnamed' : '';
    case 'extra_payments_ex_gst': return money(p.amount_ex_gst);
    case 'extra_payments_gst': return money(p.gst_amount);
    case 'extra_payments_inc_gst': return money(p.amount_inc_gst);
    case 'payment_status_label': return extraPaymentStatusText(p);
    case 'paid_on': return p.paid_on ? formatDate(p.paid_on) : '';
    case 'payment_method': return p.payment_method || '';
    case 'payment_reference': return p.payment_reference || '';
    case 'payment_notes': return [p.description, p.notes].filter(Boolean).join(' — ');
    default: return '';
  }
}

/** The one-line description of an extra payment, for the customer column. */
const paymentTitle = (p: LedgerExtraPayment) => `${p.payee_name || 'Unnamed'} · ${p.category_label}`;

/** Where that description goes: the customer column, else the first text
 *  column that isn't the date. */
function paymentTitleIndex(columns: LedgerColumn[]): number {
  const name = columns.findIndex((c) => c.key === 'customer_name');
  if (name >= 0) return name;
  return Math.max(0, columns.findIndex((c) => c.kind !== 'money' && c.kind !== 'date'));
}

function totalText(totals: LedgerTotals | undefined, col: LedgerColumn, level: TotalLevel): string {
  if (!totals) return '';
  if (col.key === 'count') return String(totals.count ?? 0);
  if (col.kind !== 'money') return '';
  // The bonus received and final profit belong to a whole month, not a half.
  if (level === 'half' && PERIOD_ONLY_COLUMNS.has(col.key)) return '';
  const v = totals[col.key];
  return v == null ? '' : formatLedgerMoney(v);
}

const LEVEL_CLASS: Record<TotalLevel, string> = {
  half: 'bg-[var(--led-surface-2)]/60 font-medium text-[var(--led-ink-2)]',
  month: 'bg-[var(--led-surface-2)] font-semibold',
  quarter: 'bg-[var(--led-surface-2)] font-semibold border-t border-[var(--led-line-2)]',
  half_year: 'bg-[var(--led-surface-2)] font-semibold border-t border-[var(--led-line-2)]',
  year: 'bg-[var(--led-accent-tint)] font-bold border-t-2 border-[var(--led-line-strong)]',
};
const LEVEL_PRINT: Record<TotalLevel, string> = { half: '#F4F6F9', month: '#E3E7EE', quarter: '#CDD5E1', half_year: '#C2CCDA', year: '#B7C2D3' };

/** Management's short report: one line per total, the money columns only. */
function summaryColumns(columns: LedgerColumn[]): LedgerColumn[] {
  return [
    { key: 'period', label: 'Period', kind: 'text', scope: 'summary' },
    { key: 'count', label: 'Deals', kind: 'text', scope: 'summary' },
    ...columns.filter((c) => c.kind === 'money'),
  ];
}

/** Owner only: what the aggregator paid for the month, entered inc GST. */
function VbReceivedControl({ month, value, onSave }: { month: string; value: number | null | undefined; onSave: (month: string, value: number | null) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const t = text.replace(/[$,\s]/g, '');
    const n = t === '' ? null : Number(t);
    if (n !== null && Number.isNaN(n)) return;
    setSaving(true);
    try {
      await onSave(month, n);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };
  if (!editing) {
    return (
      <button
        type="button"
        className={`led-chip ${value == null ? '' : 'led-chip-success'} !font-medium hover:brightness-95`}
        onClick={() => { setText(value == null ? '' : String(value)); setEditing(true); }}
        title="Enter what the aggregator paid for this month"
      >
        {value == null ? 'Volume bonus received: not entered' : `Volume bonus received ${formatLedgerMoney(value)} inc GST`}
        <span className="underline underline-offset-2">Edit</span>
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 font-normal">
      <span className="text-[12px] text-muted-foreground">Volume bonus received (inc GST)</span>
      <input
        autoFocus
        className="led-input !h-7 w-32 text-[12.5px]"
        inputMode="decimal"
        value={text}
        placeholder="0.00"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
      />
      <button type="button" className="led-btn led-btn-primary led-btn-sm" onClick={save} disabled={saving}>Save</button>
      <button type="button" className="led-btn led-btn-ghost led-btn-sm" onClick={() => setEditing(false)}>Cancel</button>
    </span>
  );
}

/** Zero figures fade back so the ones with money in them stand out. */
const zeroClass = (text: string) => (text === '$0.00' || text === '-$0.00' ? 'text-muted-foreground/60' : '');

function HeaderRow({ columns, gstView }: { columns: LedgerColumn[]; gstView: GstView }) {
  return (
    <tr>
      {columns.map((c, i) => (
        <th
          key={c.key}
          title={c.label}
          className={`sticky top-0 z-10 bg-[var(--led-surface-2)] px-3 py-2.5 text-[11.5px] font-semibold text-[var(--led-ink-2)] whitespace-nowrap shadow-[inset_0_-1px_0_var(--led-line)] ${c.kind === 'money' ? 'text-right' : 'text-left'} ${i === 0 ? 'pl-4' : ''}`}
        >
          {c.key === 'period' || c.key === 'count' ? c.label : screenLabel(c, gstView)}
        </th>
      ))}
    </tr>
  );
}

/** One deal. The whole row opens the editor when the viewer may edit. */
function DealRow({ row, columns, onEdit }: { row: LedgerDealRow; columns: LedgerColumn[]; onEdit?: (row: LedgerDealRow) => void }) {
  return (
    <tr
      onClick={onEdit ? () => onEdit(row) : undefined}
      onKeyDown={onEdit ? (e) => { if (e.key === 'Enter') onEdit(row); } : undefined}
      tabIndex={onEdit ? 0 : undefined}
      title={onEdit ? 'Click to edit this deal' : undefined}
      className={`border-t border-border ${onEdit ? 'cursor-pointer hover:bg-[var(--led-accent-tint)]/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--led-accent)]' : ''} ${row.is_clawback ? 'text-[var(--led-danger)]' : 'text-foreground'}`}
    >
      {columns.map((c, i) => {
        const text = cellText(row, c);
        const pre = row.prefilled?.includes(c.key);
        const isName = c.key === 'customer_name';
        return (
          <td
            key={c.key}
            className={`px-3 py-2 align-top ${i === 0 ? 'pl-4' : ''} ${c.kind === 'money' ? `text-right tabular-nums whitespace-nowrap ${row.is_clawback ? '' : zeroClass(text)}` : ''} ${c.kind === 'date' ? 'whitespace-nowrap tabular-nums' : ''} ${isName ? 'font-medium min-w-[140px]' : ''} ${c.kind === 'text' && c.key !== 'payment_notes' ? 'whitespace-nowrap max-w-[220px] truncate' : ''} ${c.key === 'payment_notes' ? 'min-w-[200px] max-w-[320px] text-muted-foreground' : ''} ${text === '—' ? 'text-muted-foreground/60' : ''}`}
            title={pre ? (c.key === 'volume_bonus' ? 'Estimated — not entered yet' : 'From the application — not entered yet') : c.kind === 'text' && text.length > 24 ? text : undefined}
          >
            {isName && row.category && (
              <span
                className={`mr-2 inline-block h-2 w-2 rounded-full align-middle ${CATEGORY_STYLE[row.category].dot}`}
                title={CATEGORY_STYLE[row.category].label}
              />
            )}
            <span className={pre ? 'italic opacity-70' : ''}>{text}</span>
            {isName && row.is_clawback && <span className="ml-1.5 led-chip led-chip-danger !h-[18px] !px-1.5 !text-[10.5px]">Clawback</span>}
          </td>
        );
      })}
    </tr>
  );
}

/** An extra payment, in its month. Opens its editor when the viewer may edit. */
function PaymentRow({ payment: p, columns, onEdit }: { payment: LedgerExtraPayment; columns: LedgerColumn[]; onEdit?: (p: LedgerExtraPayment) => void }) {
  const titleIndex = paymentTitleIndex(columns);
  const showsAmount = columns.some((c) => c.key.startsWith('extra_payments_'));
  return (
    <tr
      onClick={onEdit ? () => onEdit(p) : undefined}
      onKeyDown={onEdit ? (e) => { if (e.key === 'Enter') onEdit(p); } : undefined}
      tabIndex={onEdit ? 0 : undefined}
      title={onEdit ? 'Click to edit this extra payment' : undefined}
      className={`border-t border-border bg-[var(--led-violet-tint)]/25 text-foreground ${onEdit ? 'cursor-pointer hover:bg-[var(--led-accent-tint)]/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--led-accent)]' : ''}`}
    >
      {columns.map((c, i) => {
        if (i === titleIndex) {
          return (
            <td key={c.key} className={`px-3 py-2 align-top min-w-[140px] ${i === 0 ? 'pl-4' : ''}`}>
              <span className="led-chip led-chip-violet !h-[18px] !px-1.5 !text-[10.5px] mr-1.5 align-middle">Extra payment</span>
              <span className="font-medium">{paymentTitle(p)}</span>
              {!showsAmount && <span className="ml-1.5 tabular-nums text-muted-foreground">{formatLedgerMoney(p.amount_ex_gst)} ex GST</span>}
            </td>
          );
        }
        const text = paymentCellText(p, c);
        return (
          <td
            key={c.key}
            className={`px-3 py-2 align-top ${i === 0 ? 'pl-4' : ''} ${c.kind === 'money' ? 'text-right tabular-nums whitespace-nowrap' : ''} ${c.kind === 'date' ? 'whitespace-nowrap tabular-nums' : ''} ${c.kind === 'text' && c.key !== 'payment_notes' ? 'whitespace-nowrap max-w-[220px] truncate' : ''} ${c.key === 'payment_notes' || c.key === 'entity_name' ? 'text-muted-foreground' : ''} ${c.key === 'payment_notes' ? 'min-w-[200px] max-w-[320px]' : ''}`}
            title={c.kind === 'text' && text.length > 24 ? text : undefined}
          >
            {text}
          </td>
        );
      })}
    </tr>
  );
}

function TotalRow({ label, totals, columns, level, labelIndex }: { label: string; totals: LedgerTotals | undefined; columns: LedgerColumn[]; level: TotalLevel; labelIndex: number }) {
  return (
    <tr className={LEVEL_CLASS[level]}>
      {columns.map((c, i) => {
        const text = i === labelIndex ? label : totalText(totals, c, level);
        return (
          <td key={c.key} className={`px-3 py-2 text-[12px] whitespace-nowrap ${i === 0 ? 'pl-4' : ''} ${c.kind === 'money' ? `text-right tabular-nums ${zeroClass(text)}` : ''}`}>
            {text}
          </td>
        );
      })}
    </tr>
  );
}

const TABLE_SHELL = 'led-card overflow-auto max-h-[calc(100vh-180px)] !p-0';

/** The deals the desk's spreadsheet way: each month split into 1st–15th and
 *  after the 15th with a total under each, the month total with the volume
 *  bonus received and final profit, then FY quarter and year totals. On
 *  screen, total lines that only repeat the one above are dropped. A dot
 *  before the customer gives the loan category; clawbacks are red. */
export default function LedgerDealsTable({ rows, report, payments = [], columns: picked, onEdit: onEditProp, onEditPayment, onSaveVbReceived, summary = false, gstView = 'ex' }: {
  rows: LedgerDealRow[];
  report: LedgerReport;
  /** Extra payments in the period — each a row in its month. */
  payments?: LedgerExtraPayment[];
  columns: LedgerColumn[];
  onEdit?: (row: LedgerDealRow) => void;
  onEditPayment?: (p: LedgerExtraPayment) => void;
  onSaveVbReceived?: (month: string, value: number | null) => Promise<void>;
  /** Totals only — no deals (management's short report). */
  summary?: boolean;
  gstView?: GstView;
}) {
  const columns = summary ? summaryColumns(picked) : picked;
  const onEdit = summary ? undefined : onEditProp;
  const labelIndex = Math.max(0, columns.findIndex((c) => c.kind !== 'money'));
  const span = columns.length;

  const render = (item: ReportItem) => {
    switch (item.type) {
      case 'month':
        return (
          <tr key={item.key} className="border-t border-[var(--led-line-2)]">
            <td colSpan={span} className="px-4 pt-5 pb-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="text-[14px] font-semibold text-foreground">{formatMonth(item.month.month)}</span>
                {item.month.vb_share != null && (
                  <span className="text-[12px] text-muted-foreground tabular-nums">
                    {formatLedgerMoney(item.month.vb_month_volume ?? 0)} settled · {item.month.vb_share}% volume bonus share
                  </span>
                )}
                {onSaveVbReceived && (
                  <VbReceivedControl month={item.month.month} value={item.month.totals.vb_received_inc_gst} onSave={onSaveVbReceived} />
                )}
              </div>
            </td>
          </tr>
        );
      case 'half':
        return (
          <tr key={item.key}>
            <td colSpan={span} className="px-4 pt-2 pb-1 led-label">{item.label}</td>
          </tr>
        );
      case 'row':
        return <DealRow key={item.key} row={item.row} columns={columns} onEdit={onEdit} />;
      case 'payment':
        return <PaymentRow key={item.key} payment={item.payment} columns={columns} onEdit={summary ? undefined : onEditPayment} />;
      case 'total':
        return <TotalRow key={item.key} label={item.label} totals={item.totals} columns={columns} level={item.level} labelIndex={labelIndex} />;
    }
  };

  return (
    <div className={TABLE_SHELL}>
      <table className="min-w-full border-separate border-spacing-0 text-[12.5px]">
        <thead><HeaderRow columns={columns} gstView={gstView} /></thead>
        <tbody>{collapseRepeatedTotals(reportItems(rows, report, summary, payments)).map(render)}</tbody>
      </table>
    </div>
  );
}

/** Deals past "Started" and not yet settled: what is coming, with figures the
 *  owner can enter early. In no settled total. */
export function LedgerPipelineTable({ rows, totals, columns, onEdit, gstView = 'ex' }: {
  rows: LedgerDealRow[];
  totals: LedgerTotals | undefined;
  columns: LedgerColumn[];
  onEdit?: (row: LedgerDealRow) => void;
  gstView?: GstView;
}) {
  const cols = [
    ...(columns.some((c) => c.key === 'deal_status') ? [] : [{ key: 'deal_status', label: 'Deal status', kind: 'text', scope: 'deals' } as LedgerColumn]),
    ...columns.filter((c) => !PERIOD_ONLY_COLUMNS.has(c.key) && c.key !== 'settled_on' && c.key !== 'paid_on'),
  ];
  const labelIndex = Math.max(0, cols.findIndex((c) => c.kind !== 'money'));
  return (
    <div className={TABLE_SHELL}>
      <table className="min-w-full border-separate border-spacing-0 text-[12.5px]">
        <thead><HeaderRow columns={cols} gstView={gstView} /></thead>
        <tbody>
          {rows.map((row) => <DealRow key={row.application_id} row={row} columns={cols} onEdit={onEdit} />)}
          <TotalRow label={`Total · ${rows.length} in the pipeline`} totals={totals} columns={cols} level="month" labelIndex={labelIndex} />
        </tbody>
      </table>
    </div>
  );
}

/** The same table for the PDF: plain inline styles html2pdf renders reliably. */
export function LedgerDealsPrintTable({ rows, report, payments = [], columns: picked, summary = false }: {
  rows: LedgerDealRow[];
  report: LedgerReport;
  payments?: LedgerExtraPayment[];
  columns: LedgerColumn[];
  summary?: boolean;
}) {
  const columns = summary ? summaryColumns(picked) : picked;
  const labelIndex = Math.max(0, columns.findIndex((c) => c.kind !== 'money'));
  const fontSize = columns.length > 16 ? '6.5px' : columns.length > 11 ? '7.5px' : '8.5px';
  const td = (c: LedgerColumn) => ({ padding: '3px 4px', textAlign: c.kind === 'money' ? 'right' as const : 'left' as const, color: '#111', verticalAlign: 'top' as const });
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize }}>
      <thead>
        <tr style={{ borderBottom: '1px solid #333' }}>
          {columns.map((c) => <th key={c.key} style={{ ...td(c), fontWeight: 700 }}>{c.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {reportItems(rows, report, summary, payments).map((item) => {
          switch (item.type) {
            case 'month':
              return <tr key={item.key}><td colSpan={columns.length} style={{ padding: '8px 4px 2px', fontWeight: 700, color: '#111' }}>{formatMonth(item.month.month)}</td></tr>;
            case 'half':
              return <tr key={item.key}><td colSpan={columns.length} style={{ padding: '4px 4px 1px', fontWeight: 600, color: '#444', textTransform: 'uppercase' }}>{item.label}</td></tr>;
            case 'row':
              return (
                <tr key={item.key} style={{ borderBottom: '1px solid #ddd', color: item.row.is_clawback ? '#C00000' : '#111' }}>
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      style={{
                        ...td(c),
                        color: item.row.is_clawback ? '#C00000' : '#111',
                        background: c.key === 'customer_name' && item.row.category ? CATEGORY_STYLE[item.row.category].print : undefined,
                      }}
                    >
                      {cellText(item.row, c)}
                    </td>
                  ))}
                </tr>
              );
            case 'payment': {
              const titleAt = paymentTitleIndex(columns);
              return (
                <tr key={item.key} style={{ borderBottom: '1px solid #ddd', background: '#F5F2FB' }}>
                  {columns.map((c, i) => (
                    <td key={c.key} style={td(c)}>
                      {i === titleAt ? `Extra payment · ${paymentTitle(item.payment)}` : paymentCellText(item.payment, c)}
                    </td>
                  ))}
                </tr>
              );
            }
            case 'total':
              return (
                <tr key={item.key} style={{ background: LEVEL_PRINT[item.level], fontWeight: item.level === 'half' ? 600 : 700 }}>
                  {columns.map((c, i) => <td key={c.key} style={td(c)}>{i === labelIndex ? item.label : totalText(item.totals, c, item.level)}</td>)}
                </tr>
              );
          }
        })}
      </tbody>
    </table>
  );
}

