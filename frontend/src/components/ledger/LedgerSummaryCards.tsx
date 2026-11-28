import { formatLedgerMoney } from '../../lib/ledger';
import type { LedgerTotals } from '../../types';

type Line = { key: string; label: string; sign?: '+' | '−'; note?: string };

/** The four figures that matter, each with the lines that make it up beneath
 *  it, so the period reads left to right as a statement:
 *  volume → income → net profit (after comms) → final profit (after extra
 *  payments and the volume bonus). Figures the viewer can't see never arrive,
 *  so a card or line without a value is left out. */
const CARDS: { key: string; title: string; caption?: string; lines: Line[] }[] = [
  {
    key: 'income_ex_gst',
    title: 'Total income',
    lines: [
      { key: 'brokerage', label: 'Brokerage' },
      { key: 'origination_fee', label: 'Origination fees' },
      { key: 'doc_fee', label: 'Doc fees' },
      { key: 'vir', label: 'Vehicle inspection (VIR)' },
    ],
  },
  {
    key: 'net_profit',
    title: 'Net profit',
    lines: [
      { key: 'referrer_comms_ex_gst', label: 'Referrer comms', sign: '−' },
      { key: 'staff_comms_ex_gst', label: 'Staff comms', sign: '−' },
    ],
  },
  {
    key: 'final_profit',
    title: 'Final profit',
    caption: 'before expenses',
    lines: [
      { key: 'extra_payments_ex_gst', label: 'Extra payments', sign: '−' },
      { key: 'vb_received_ex_gst', label: 'Volume bonus received', sign: '+' },
      { key: 'volume_bonus', label: 'Possible volume bonus', note: 'estimate, not counted' },
    ],
  },
];

const money = (n: number | undefined) => formatLedgerMoney(n ?? 0);

/** "− $50.00" for money taken off; a clawed-back (negative) deduction adds. */
function signed(v: number, sign?: '+' | '−'): string {
  if (!sign || v === 0) return money(v);
  const effect = sign === '−' ? -v : v;
  return `${effect < 0 ? '−' : '+'} ${money(Math.abs(v))}`;
}

export default function LedgerSummaryCards({ totals, periodText }: { totals: LedgerTotals; periodText: string }) {
  const cards = CARDS.filter((c) => totals[c.key] != null);
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
      <div className="led-card p-4">
        <p className="led-label">Settled</p>
        <p className="mt-1 text-[22px] font-semibold tabular-nums tracking-tight text-foreground">
          {totals.finance_amount != null ? money(totals.finance_amount) : totals.count}
        </p>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          {totals.count} deal{totals.count === 1 ? '' : 's'}
          {(totals.clawbacks ?? 0) > 0 && <span className="text-[var(--led-danger)]"> · {totals.clawbacks} clawback{totals.clawbacks === 1 ? '' : 's'}</span>}
          {' '}· {periodText}
        </p>
      </div>
      {cards.map((c) => {
        const value = totals[c.key] ?? 0;
        const lines = c.lines.filter((l) => totals[l.key] != null);
        return (
          <div key={c.key} className="led-card p-4">
            <p className="led-label">{c.title} <span className="normal-case tracking-normal font-normal">· ex GST</span></p>
            <p className={`mt-1 text-[22px] font-semibold tabular-nums tracking-tight ${value < 0 ? 'text-[var(--led-danger)]' : 'text-foreground'}`}>
              {money(value)}
            </p>
            {c.caption && <p className="text-[12px] text-muted-foreground">{c.caption}</p>}
            {lines.length > 0 && (
              <dl className="mt-2.5 space-y-1 border-t border-border pt-2.5 text-[12px]">
                {lines.map((l) => {
                  const v = totals[l.key] ?? 0;
                  return (
                    <div key={l.key} className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">
                        {l.label}
                        {l.note && <span className="text-[11px] italic"> ({l.note})</span>}
                      </dt>
                      <dd className={`tabular-nums ${v === 0 ? 'text-muted-foreground/70' : 'text-[var(--led-ink-2)]'}`}>
                        {signed(v, l.sign)}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            )}
          </div>
        );
      })}
    </div>
  );
}
