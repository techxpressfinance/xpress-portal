import { Fragment } from 'react';
import { formatDate } from '../../lib/utils';
import { CATEGORY_STYLE, formatLedgerMoney, formatMonth } from '../../lib/ledger';
import type { LedgerColumn, LedgerDealRow, LedgerTotals } from '../../types';

type Months = { month: string; totals: LedgerTotals }[];

function cellText(row: LedgerDealRow, col: LedgerColumn): string {
  const value = (row as unknown as Record<string, unknown>)[col.key];
  if (col.kind === 'money') return formatLedgerMoney(value as number | null | undefined);
  if (col.kind === 'date') return value ? formatDate(value as string) : '—';
  if (col.kind === 'bool') return value ? 'Yes' : 'No';
  return (value as string | null | undefined) || '—';
}

function totalText(totals: LedgerTotals | undefined, col: LedgerColumn): string {
  if (!totals || col.kind !== 'money') return '';
  const v = totals[col.key];
  return v == null ? '' : formatLedgerMoney(v);
}

function group(rows: LedgerDealRow[]): Map<string, LedgerDealRow[]> {
  const out = new Map<string, LedgerDealRow[]>();
  for (const r of rows) out.set(r.month, [...(out.get(r.month) ?? []), r]);
  return out;
}

/** The deals, a month at a time with a subtotal under each, as the desk's
 *  spreadsheet lays them out. The customer cell carries its colour coding;
 *  clawbacks are red. */
export default function LedgerDealsTable({ rows, months, totals, columns, onEdit }: {
  rows: LedgerDealRow[];
  months: Months;
  totals?: LedgerTotals;
  columns: LedgerColumn[];
  onEdit?: (row: LedgerDealRow) => void;
}) {
  const byMonth = group(rows);
  const monthTotals = new Map(months.map((m) => [m.month, m.totals]));
  const monthKeys = [...byMonth.keys()].sort();
  const labelIndex = Math.max(0, columns.findIndex((c) => c.kind !== 'money'));
  const span = columns.length + (onEdit ? 1 : 0);

  const totalsRow = (label: string, t: LedgerTotals | undefined, strong = false) => (
    <tr className={strong ? 'bg-[var(--led-surface-2)] font-semibold' : 'bg-[var(--led-surface-2)]/60 font-medium'}>
      {columns.map((c, i) => (
        <td key={c.key} className={`px-2.5 py-1.5 text-[12px] whitespace-nowrap ${c.kind === 'money' ? 'text-right tabular-nums' : ''}`}>
          {i === labelIndex ? label : totalText(t, c)}
        </td>
      ))}
      {onEdit && <td />}
    </tr>
  );

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
        <tbody>
          {monthKeys.map((m) => (
            <Fragment key={m}>
              <tr>
                <td colSpan={span} className="px-2.5 pt-3 pb-1 text-[12.5px] font-semibold text-foreground">{formatMonth(m)}</td>
              </tr>
              {byMonth.get(m)!.map((row) => (
                <tr key={row.application_id} className={`border-t border-border hover:bg-[var(--led-surface-2)]/50 ${row.is_clawback ? 'text-[var(--led-danger)]' : 'text-foreground'}`}>
                  {columns.map((c) => {
                    const tint = c.key === 'customer_name' && row.category ? CATEGORY_STYLE[row.category].className : '';
                    const pre = row.prefilled?.includes(c.key);
                    return (
                      <td
                        key={c.key}
                        className={`px-2.5 py-1.5 align-top ${c.kind === 'money' ? 'text-right tabular-nums whitespace-nowrap' : ''} ${c.key === 'payment_notes' ? 'min-w-[200px] max-w-[320px]' : ''} ${tint}`}
                        title={pre ? 'From the application — not entered yet' : undefined}
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
              ))}
              {monthTotals.has(m) && totalsRow(`Total ${formatMonth(m)}`, monthTotals.get(m))}
            </Fragment>
          ))}
          {totals && totalsRow(`TOTAL · ${totals.count} deal${totals.count === 1 ? '' : 's'}`, totals, true)}
        </tbody>
      </table>
    </div>
  );
}

/** The same table for the PDF: plain inline styles html2pdf renders reliably. */
export function LedgerDealsPrintTable({ rows, months, totals, columns }: {
  rows: LedgerDealRow[];
  months: Months;
  totals?: LedgerTotals;
  columns: LedgerColumn[];
}) {
  const byMonth = group(rows);
  const monthTotals = new Map(months.map((m) => [m.month, m.totals]));
  const labelIndex = Math.max(0, columns.findIndex((c) => c.kind !== 'money'));
  const fontSize = columns.length > 16 ? '6.5px' : columns.length > 11 ? '7.5px' : '8.5px';
  const td = (c: LedgerColumn) => ({ padding: '3px 4px', textAlign: c.kind === 'money' ? 'right' as const : 'left' as const, color: '#111', verticalAlign: 'top' as const });
  const totalsRow = (label: string, t: LedgerTotals | undefined, strong = false) => (
    <tr style={{ background: strong ? '#E3E7EE' : '#F1F3F7', fontWeight: strong ? 700 : 600 }}>
      {columns.map((c, i) => <td key={c.key} style={td(c)}>{i === labelIndex ? label : totalText(t, c)}</td>)}
    </tr>
  );
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize }}>
      <thead>
        <tr style={{ borderBottom: '1px solid #333' }}>
          {columns.map((c) => <th key={c.key} style={{ ...td(c), fontWeight: 700 }}>{c.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {[...byMonth.keys()].sort().map((m) => (
          <Fragment key={m}>
            <tr><td colSpan={columns.length} style={{ padding: '8px 4px 2px', fontWeight: 700, color: '#111' }}>{formatMonth(m)}</td></tr>
            {byMonth.get(m)!.map((row) => (
              <tr key={row.application_id} style={{ borderBottom: '1px solid #ddd', color: row.is_clawback ? '#C00000' : '#111' }}>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    style={{
                      ...td(c),
                      color: row.is_clawback ? '#C00000' : '#111',
                      background: c.key === 'customer_name' && row.category ? CATEGORY_STYLE[row.category].print : undefined,
                    }}
                  >
                    {cellText(row, c)}
                  </td>
                ))}
              </tr>
            ))}
            {monthTotals.has(m) && totalsRow(`Total ${formatMonth(m)}`, monthTotals.get(m))}
          </Fragment>
        ))}
        {totals && totalsRow(`TOTAL · ${totals.count} deals`, totals, true)}
      </tbody>
    </table>
  );
}
