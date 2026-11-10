import { useState } from 'react';
import { formatDate } from '../../lib/utils';
import { CATEGORY_STYLE, formatLedgerMoney, formatMonth, PERIOD_ONLY_COLUMNS, reportItems, type ReportItem, type TotalLevel } from '../../lib/ledger';
import type { LedgerColumn, LedgerDealRow, LedgerReport, LedgerTotals } from '../../types';

function cellText(row: LedgerDealRow, col: LedgerColumn): string {
  if (PERIOD_ONLY_COLUMNS.has(col.key)) return '';
  const value = (row as unknown as Record<string, unknown>)[col.key];
  if (col.kind === 'money') return formatLedgerMoney(value as number | null | undefined);
  if (col.kind === 'date') return value ? formatDate(value as string) : '—';
  if (col.kind === 'bool') return value ? 'Yes' : 'No';
  return (value as string | null | undefined) || '—';
}

function totalText(totals: LedgerTotals | undefined, col: LedgerColumn, level: TotalLevel): string {
  if (!totals || col.kind !== 'money') return '';
  // The bonus received and final profit belong to a whole month, not a half.
  if (level === 'half' && PERIOD_ONLY_COLUMNS.has(col.key)) return '';
  const v = totals[col.key];
  return v == null ? '' : formatLedgerMoney(v);
}

const LEVEL_CLASS: Record<TotalLevel, string> = {
  half: 'bg-[var(--led-surface-2)]/40 font-medium',
  month: 'bg-[var(--led-surface-2)] font-semibold',
  quarter: 'bg-[var(--led-surface-2)] font-semibold border-t-2 border-[var(--led-ink-2)]/30',
  year: 'bg-[var(--led-surface-2)] font-bold border-t-2 border-[var(--led-ink-2)]/50',
};
const LEVEL_PRINT: Record<TotalLevel, string> = { half: '#F4F6F9', month: '#E3E7EE', quarter: '#CDD5E1', year: '#B7C2D3' };

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
        className="led-btn led-btn-ghost led-btn-sm font-normal"
        onClick={() => { setText(value == null ? '' : String(value)); setEditing(true); }}
      >
        Volume bonus received: {value == null ? 'not entered' : `${formatLedgerMoney(value)} inc GST`} · Edit
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
      <button type="button" className="led-btn led-btn-sm" onClick={save} disabled={saving}>Save</button>
      <button type="button" className="led-btn led-btn-ghost led-btn-sm" onClick={() => setEditing(false)}>Cancel</button>
    </span>
  );
}

/** The deals the desk's spreadsheet way: each month split into 1st–15th and
 *  after the 15th with a total under each, the month total with the volume
 *  bonus received and final profit, then FY quarter and year totals. The
 *  customer cell carries its colour coding; clawbacks are red. */
export default function LedgerDealsTable({ rows, report, columns, onEdit, onSaveVbReceived }: {
  rows: LedgerDealRow[];
  report: LedgerReport;
  columns: LedgerColumn[];
  onEdit?: (row: LedgerDealRow) => void;
  onSaveVbReceived?: (month: string, value: number | null) => Promise<void>;
}) {
  const labelIndex = Math.max(0, columns.findIndex((c) => c.kind !== 'money'));
  const span = columns.length + (onEdit ? 1 : 0);

  const totalsRow = (key: string, label: string, t: LedgerTotals | undefined, level: TotalLevel) => (
    <tr key={key} className={LEVEL_CLASS[level]}>
      {columns.map((c, i) => (
        <td key={c.key} className={`px-2.5 py-1.5 text-[12px] whitespace-nowrap ${c.kind === 'money' ? 'text-right tabular-nums' : ''}`}>
          {i === labelIndex ? label : totalText(t, c, level)}
        </td>
      ))}
      {onEdit && <td />}
    </tr>
  );

  const render = (item: ReportItem) => {
    switch (item.type) {
      case 'month':
        return (
          <tr key={item.key}>
            <td colSpan={span} className="px-2.5 pt-4 pb-1 text-[13px] font-semibold text-foreground">
              <span className="mr-3">{formatMonth(item.month.month)}</span>
              {item.month.vb_share != null && (
                <span className="mr-3 text-[11.5px] font-normal text-muted-foreground">
                  Month settled {formatLedgerMoney(item.month.vb_month_volume ?? 0)} · volume bonus share {item.month.vb_share}%
                </span>
              )}
              {onSaveVbReceived && (
                <VbReceivedControl month={item.month.month} value={item.month.totals.vb_received_inc_gst} onSave={onSaveVbReceived} />
              )}
            </td>
          </tr>
        );
      case 'half':
        return (
          <tr key={item.key}>
            <td colSpan={span} className="px-2.5 pt-2 pb-0.5 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--led-ink-2)]">{item.label}</td>
          </tr>
        );
      case 'row': {
        const row = item.row;
        return (
          <tr key={item.key} className={`border-t border-border hover:bg-[var(--led-surface-2)]/50 ${row.is_clawback ? 'text-[var(--led-danger)]' : 'text-foreground'}`}>
            {columns.map((c) => {
              const tint = c.key === 'customer_name' && row.category ? CATEGORY_STYLE[row.category].className : '';
              const pre = row.prefilled?.includes(c.key);
              return (
                <td
                  key={c.key}
                  className={`px-2.5 py-1.5 align-top ${c.kind === 'money' ? 'text-right tabular-nums whitespace-nowrap' : ''} ${c.key === 'payment_notes' ? 'min-w-[200px] max-w-[320px]' : ''} ${tint}`}
                  title={pre ? (c.key === 'volume_bonus' ? 'Estimated — not entered yet' : 'From the application — not entered yet') : undefined}
                >
                  <span className={pre ? 'italic opacity-70' : ''}>{cellText(row, c)}</span>
                </td>
              );
            })}
            {onEdit && (
              <td className="px-2 py-1 text-right">
                <button type="button" onClick={() => onEdit(row)} className="led-btn led-btn-ghost led-btn-sm">Edit</button>
              </td>
            )}
          </tr>
        );
      }
      case 'total':
        return totalsRow(item.key, item.label, item.totals, item.level);
    }
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="min-w-full border-collapse text-[12.5px]">
        <thead className="sticky top-0 z-10 bg-[var(--led-surface-2)]">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`px-2.5 py-2 text-[11.5px] font-semibold text-[var(--led-ink-2)] border-b border-border ${c.kind === 'money' ? 'text-right' : 'text-left'}`}>
                {c.label}
              </th>
            ))}
            {onEdit && <th className="border-b border-border" />}
          </tr>
        </thead>
        <tbody>{reportItems(rows, report).map(render)}</tbody>
      </table>
    </div>
  );
}

/** The same table for the PDF: plain inline styles html2pdf renders reliably. */
export function LedgerDealsPrintTable({ rows, report, columns }: {
  rows: LedgerDealRow[];
  report: LedgerReport;
  columns: LedgerColumn[];
}) {
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
        {reportItems(rows, report).map((item) => {
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

