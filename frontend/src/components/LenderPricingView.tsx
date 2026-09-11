import type { QuoteSheet } from '../types';
import {
  DIRECT_DEBIT_CYCLE_LABELS,
  FACILITY_LABELS,
  computeLenderPricing,
  fmtCurrency,
  lenderPricingAlerts,
  parseLenderPricingInputs,
  repaymentFor,
} from '../lib/lenderPricing';

const money = (n: number | null) => (n == null ? '—' : fmtCurrency(n));

/** Read-only lender pricing — staff only, never shown to the client. */
export default function LenderPricingView({ sheet }: { sheet: QuoteSheet }) {
  const inputs = parseLenderPricingInputs(sheet);
  const d = computeLenderPricing(inputs);
  const alerts = lenderPricingAlerts(inputs);
  const cycle = DIRECT_DEBIT_CYCLE_LABELS[inputs.direct_debit_cycle];
  const options = [...sheet.options].sort((a, b) => a.sort_order - b.sort_order);
  const answer = inputs.lender_accepts_shortfall === 'yes'
    ? 'Yes'
    : inputs.lender_accepts_shortfall === 'no' ? 'No' : 'Not answered';

  const summary: [string, string][] = [
    ['Asset', inputs.asset_description || '—'],
    ['Facility', `${FACILITY_LABELS[inputs.facility_type]} · ${inputs.payment_type === 'advance' ? 'Advance' : 'Arrears'}`],
    ['Asset price', fmtCurrency(inputs.asset_price)],
    ['Deposit', fmtCurrency(d.deposit)],
    ['Trade-in', fmtCurrency(inputs.trade_in_amount)],
    ['Payout figure', fmtCurrency(inputs.payout_amount)],
    ['Amount borrowed', fmtCurrency(d.amountBorrowed)],
    ['Amount financed', fmtCurrency(d.amountFinanced)],
    ['Term', inputs.term_months != null ? `${inputs.term_months} months` : '—'],
    ['Direct debit cycle', cycle],
    ['Lender rate', `${inputs.interest_rate.toFixed(2)}%`],
    ['Brokerage', fmtCurrency(d.brokerage)],
  ];

  const th = 'py-2 px-3 text-muted-foreground font-semibold uppercase tracking-wide text-[10px]';

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3">
        {summary.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</dt>
            <dd className="mt-0.5 text-[13px] font-medium text-foreground tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {alerts.length > 0 && (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 space-y-1.5">
          {alerts.map(msg => (
            <div key={msg} className="flex gap-2 text-[12.5px] text-foreground">
              <span aria-hidden className="text-danger">▲</span>
              <span>{msg}</span>
            </div>
          ))}
          <div className="pt-2 mt-1 border-t border-danger/20 text-[12.5px] text-foreground">
            <span className="font-semibold">Lender OK to accept the shortfall and negative equity:</span> {answer}
            {inputs.lender_accepts_shortfall === 'yes' && inputs.lender_acceptance_notes.trim() && (
              <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{inputs.lender_acceptance_notes}</p>
            )}
          </div>
        </div>
      )}

      {options.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className={`${th} text-left`}>Structure</th>
                <th className={`${th} text-right`}>Balloon</th>
                <th className={`${th} text-right`}>{cycle} Repayment</th>
                <th className={`${th} text-right`}>Total Repayments</th>
                <th className={`${th} text-right`}>Total Interest</th>
                <th className={`${th} text-right`}>All Up Rate</th>
              </tr>
            </thead>
            <tbody>
              {options.map(o => {
                const balloon = o.balloon_residual ?? 0;
                const pct = o.lender_name.match(/([\d.]+)%\s*Balloon/i);
                return (
                  <tr key={o.id} className="border-b border-border/40 last:border-0">
                    <td className="py-2 px-3 font-semibold">
                      {balloon > 0 ? `With Balloon${pct ? ` (${pct[1]}%)` : ''}` : 'No Balloon'}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">{balloon > 0 ? money(balloon) : '—'}</td>
                    <td className="py-2 px-3 text-right font-bold tabular-nums">{money(repaymentFor(inputs.direct_debit_cycle, o))}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{money(o.total_repayments)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{money(o.total_interest)}</td>
                    <td className="py-2 px-3 text-right font-bold tabular-nums text-primary">
                      {o.client_interest_rate != null ? `${o.client_interest_rate.toFixed(2)}%` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {sheet.broker_notes && (
        <div className="p-3 bg-muted/40 rounded-lg border border-border">
          <p className="text-xs font-medium text-muted-foreground mb-1">Broker Notes (internal)</p>
          <p className="text-sm text-foreground">{sheet.broker_notes}</p>
        </div>
      )}
    </div>
  );
}
