import type { CSSProperties, ReactNode } from 'react';
import XpressPrintHeader from './print/XpressPrintHeader';
import { A4_PRINT_WIDTH_PX, PRINT_INSET } from '../lib/printPage';
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

// html2canvas can't read the app's oklch theme colours — every colour here is
// hex. Brand values match XpressPrintHeader and the quote sheet PDF.
const INK = '#1a1a2e';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';
const NAVY = '#0d1f3c';
const DANGER = '#dc2626';
const SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const money = (n: number | null) => (n == null ? '—' : fmtCurrency(n));

const cellLabel: CSSProperties = {
  textAlign: 'left', fontSize: 9, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
  color: MUTED, padding: '7px 10px', borderBottom: `1px solid ${LINE}`, verticalAlign: 'middle',
};
const cellValue: CSSProperties = {
  textAlign: 'right', fontSize: 11, fontWeight: 600, color: INK, padding: '7px 10px',
  borderBottom: `1px solid ${LINE}`, verticalAlign: 'middle', fontVariantNumeric: 'tabular-nums',
};

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 style={{ margin: '18px 0 8px', fontSize: 12, fontWeight: 700, color: NAVY, fontFamily: SANS }}>
      {children}
    </h2>
  );
}

/** Printable lender pricing — captured by useLenderPricingPdf. Internal only. */
export default function LenderPricingPdf({ sheet, elementId, clientName, applicationRef }: {
  sheet: QuoteSheet;
  elementId: string;
  clientName?: string;
  applicationRef?: string;
}) {
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
    ['Total fees', `${fmtCurrency(d.totalFees)}${inputs.fees_financed ? '' : ' (not financed)'}`],
    ['Brokerage', fmtCurrency(d.brokerage)],
    ['Amount financed', fmtCurrency(d.amountFinanced)],
    ['Term', inputs.term_months != null ? `${inputs.term_months} months` : '—'],
    ['Direct debit cycle', cycle],
    ['Lender rate', `${inputs.interest_rate.toFixed(2)}%`],
    ['Monthly account fee', fmtCurrency(inputs.monthly_account_fee)],
  ];
  // Two label/value pairs per table row.
  const summaryRows: [string, string][][] = [];
  for (let i = 0; i < summary.length; i += 2) summaryRows.push(summary.slice(i, i + 2));

  const subtitle = [
    clientName,
    applicationRef ? `Ref ${applicationRef}` : null,
    inputs.asset_description || null,
  ].filter(Boolean).join(' · ');

  const head: CSSProperties = { ...cellLabel, background: '#f4f5f7' };

  return (
    <div
      id={elementId}
      style={{
        width: A4_PRINT_WIDTH_PX.portrait, background: '#ffffff', overflow: 'hidden',
        paddingBottom: 16, fontFamily: SANS, color: INK,
      }}
    >
      <XpressPrintHeader
        eyebrow="Internal · Lender Pricing"
        title={sheet.title || `Lender Pricing v${sheet.version}`}
        subtitle={subtitle || undefined}
      />

      <div style={{ padding: `0 ${PRINT_INSET}px` }}>
        <div className="break-inside-avoid">
          <SectionTitle>Loan summary</SectionTitle>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '22%' }} /><col style={{ width: '28%' }} />
              <col style={{ width: '22%' }} /><col style={{ width: '28%' }} />
            </colgroup>
            <tbody>
              {summaryRows.map(row => (
                <tr key={row[0][0]}>
                  {row.map(([label, value]) => [
                    <td key={`${label}-l`} style={cellLabel}>{label}</td>,
                    <td key={`${label}-v`} style={{ ...cellValue, paddingRight: 18 }}>{value}</td>,
                  ])}
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ margin: '6px 0 0', fontSize: 9, color: MUTED }}>
            Amount borrowed = asset price − deposit − trade-in + payout figure.
          </p>
        </div>

        {alerts.length > 0 && (
          <div
            className="break-inside-avoid"
            style={{ marginTop: 14, border: `1px solid #f5c2c2`, background: '#fef2f2', borderRadius: 6, padding: '10px 12px' }}
          >
            {alerts.map(msg => (
              <div key={msg} style={{ display: 'flex', gap: 8, fontSize: 10.5, color: INK, marginBottom: 4 }}>
                <span style={{ color: DANGER }}>▲</span>
                <span>{msg}</span>
              </div>
            ))}
            <div style={{ borderTop: '1px solid #f5c2c2', marginTop: 6, paddingTop: 6, fontSize: 10.5 }}>
              <strong>Lender OK to accept the shortfall and negative equity:</strong> {answer}
              {inputs.lender_accepts_shortfall === 'yes' && inputs.lender_acceptance_notes.trim() && (
                <p style={{ margin: '4px 0 0', color: MUTED, whiteSpace: 'pre-wrap' }}>{inputs.lender_acceptance_notes}</p>
              )}
            </div>
          </div>
        )}

        {options.length > 0 && (
          <div className="break-inside-avoid">
            <SectionTitle>Repayments — {cycle.toLowerCase()} direct debit</SectionTitle>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={head}>Structure</th>
                  <th style={{ ...head, textAlign: 'right' }}>Balloon</th>
                  <th style={{ ...head, textAlign: 'right' }}>{cycle} repayment</th>
                  <th style={{ ...head, textAlign: 'right' }}>Total repayments</th>
                  <th style={{ ...head, textAlign: 'right' }}>Total interest</th>
                  <th style={{ ...head, textAlign: 'right' }}>All-up rate</th>
                </tr>
              </thead>
              <tbody>
                {options.map(o => {
                  const balloon = o.balloon_residual ?? 0;
                  const pct = o.lender_name.match(/([\d.]+)%\s*Balloon/i);
                  return (
                    <tr key={o.id}>
                      <td style={{ ...cellValue, textAlign: 'left' }}>
                        {balloon > 0 ? `With balloon${pct ? ` (${pct[1]}%)` : ''}` : 'No balloon'}
                      </td>
                      <td style={cellValue}>{balloon > 0 ? money(balloon) : '—'}</td>
                      <td style={{ ...cellValue, color: NAVY, fontWeight: 700 }}>{money(repaymentFor(inputs.direct_debit_cycle, o))}</td>
                      <td style={cellValue}>{money(o.total_repayments)}</td>
                      <td style={cellValue}>{money(o.total_interest)}</td>
                      <td style={cellValue}>{o.client_interest_rate != null ? `${o.client_interest_rate.toFixed(2)}%` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {sheet.broker_notes && (
          <div className="break-inside-avoid">
            <SectionTitle>Broker notes</SectionTitle>
            <p style={{ margin: 0, fontSize: 10.5, color: INK, whiteSpace: 'pre-wrap' }}>{sheet.broker_notes}</p>
          </div>
        )}

        <p className="break-inside-avoid" style={{ margin: '18px 0 0', paddingTop: 10, borderTop: `1px solid ${LINE}`, fontSize: 8.5, color: MUTED }}>
          Internal document — lender pricing as approved. Not for distribution to the client.
        </p>
      </div>
    </div>
  );
}
