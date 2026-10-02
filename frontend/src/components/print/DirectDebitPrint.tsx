import type { CSSProperties } from 'react';
import { A4_PRINT_WIDTH_PX } from '../../lib/printPage';
import type { DirectDebitStatement } from '../../lib/directDebit';
import { formatAbn } from '../../lib/acn';

/**
 * The Direct Debit First Payment Request, laid out as the lenders' own form:
 * the lender's letterhead, the amounts to be taken on the first debit, when it
 * comes out, and the client's sign-off. It is the lender's document, so it
 * carries no Xpress branding.
 *
 * Inline styles only — html2canvas can't read Tailwind's modern colours.
 */

const RED = '#e00000';
const PURPLE = '#7030a0';
const SERIF = "'Times New Roman', Times, Georgia, serif";
const SANS = 'Helvetica, Arial, sans-serif';

const cell: CSSProperties = { border: '1px solid #111', padding: '6px 8px', fontSize: 17, fontFamily: SANS, verticalAlign: 'middle' };
const money = (n: number) => n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface DirectDebitLender {
  name: string;
  abn: string | null;
  address: string | null;
  logo: string | null;
}

export default function DirectDebitPrint({
  statement,
  lender,
  clientName,
  signatoryName,
  today,
}: {
  statement: DirectDebitStatement;
  lender: DirectDebitLender;
  clientName: string;
  signatoryName: string;
  /** The date it is signed — printed under the signature. */
  today: string;
}) {
  const { rows, total, timing, structured, cycleUnit } = statement;

  return (
    <div style={{ width: A4_PRINT_WIDTH_PX.portrait, minHeight: 1000, background: '#fff', color: '#111', padding: '32px 64px 32px', boxSizing: 'border-box', overflow: 'hidden' }}>
      {/* Letterhead: the lender's logo, and its name/ABN/address top right. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, minHeight: 120 }}>
        <div style={{ flex: 'none', maxWidth: 260 }}>
          {lender.logo && (
            <img src={lender.logo} alt="" style={{ display: 'block', maxWidth: 220, maxHeight: 130, objectFit: 'contain' }} />
          )}
        </div>
        <div style={{ textAlign: 'right', fontFamily: SERIF, fontSize: 12, lineHeight: 1.35, paddingTop: 40, whiteSpace: 'pre-line' }}>
          {lender.name && <div>{lender.name}</div>}
          {lender.abn && <div>ABN {formatAbn(lender.abn)}</div>}
          {lender.address && <div>{lender.address}</div>}
        </div>
      </div>

      <h1 style={{ margin: '20px 0 0', fontFamily: SERIF, fontWeight: 700, fontSize: 40, color: RED, lineHeight: 1.1 }}>
        Direct Debit First Payment Request
      </h1>

      <p style={{ margin: '32px 0 0', fontFamily: SANS, fontSize: 21 }}>Client: {clientName}</p>

      <table style={{ marginTop: 36, borderCollapse: 'collapse', width: 600 }}>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td style={cell}>
                {row.label === '1st payment/rental' ? <>1<sup style={{ fontSize: 11 }}>st</sup> payment/rental</> : row.label}
                {row.note && <span style={{ fontSize: 14 }}> {row.note}</span>}
              </td>
              <td style={{ ...cell, width: 14, padding: '6px 2px', textAlign: 'center' }}>$</td>
              <td style={{ ...cell, width: 96, textAlign: 'right' }}>{row.amount != null && row.amount !== 0 ? money(row.amount) : ''}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...cell, color: RED }}>Total to be Debited</td>
            <td style={{ ...cell, width: 14, padding: '6px 2px', textAlign: 'center', color: RED }}>$</td>
            <td style={{ ...cell, width: 96, textAlign: 'right', color: RED }}>{money(total)}</td>
          </tr>
        </tbody>
      </table>

      {/* A structured contract sets out its runs of repayments here, under the
          first payment they start with. */}
      {structured.length > 0 && (
        <div style={{ marginTop: 22, width: 600 }}>
          <div style={{ fontFamily: SANS, fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Structured repayments</div>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {structured.map((r) => (
                <tr key={r.from}>
                  <td style={{ ...cell, fontSize: 14 }}>
                    {r.from === r.to ? `Payment ${r.from}` : `Payments ${r.from} – ${r.to}`}
                    <span style={{ color: '#555' }}> ({r.to - r.from + 1} {cycleUnit}ly payment{r.to === r.from ? '' : 's'})</span>
                  </td>
                  <td style={{ ...cell, fontSize: 14, width: 14, padding: '6px 2px', textAlign: 'center' }}>$</td>
                  <td style={{ ...cell, fontSize: 14, width: 96, textAlign: 'right' }}>{money(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ margin: '36px 0 0', fontFamily: SERIF, fontWeight: 700, fontSize: 21, color: PURPLE, lineHeight: 1.35 }}>
        {timing}
      </p>

      {/* The client's sign-off. */}
      <div style={{ marginTop: 48, fontFamily: SANS, fontSize: 15 }}>
        {[
          ['Name', signatoryName],
          ['Date', today],
          ['Signature', ''],
        ].map(([label, value]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginTop: label === 'Signature' ? 40 : 18 }}>
            <span style={{ width: 90, flex: 'none' }}>{label}:</span>
            <span style={{ flex: '0 0 340px', borderBottom: '1px solid #111', paddingBottom: 3, minHeight: 20 }}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
