import { Badge } from '../ui';
import {
  bucketClass,
  bucketColor,
  bucketLabel,
  fileTypeLabel,
  formatMoney,
  formatRepayment,
  lenderNames,
} from '../../lib/arrears';
import type { ArrearsRecord } from '../../types';

/**
 * The arrears book grid.
 *
 * The business's spec listed eleven fields; showing them as eleven equal
 * columns made every row an undifferentiated wall of text. They're paired
 * instead — party over company, asset over its contract/VIN, lender over loan
 * type — so a broker scans four things (who, what, how old, how much) and
 * reads the supporting detail only on the row that matters. Age drives a
 * colour stripe down the left edge, so triage happens before any reading.
 */
export default function ArrearsTable({
  records,
  onSelect,
  emptyMessage = 'No arrears records match these filters.',
}: {
  records: ArrearsRecord[];
  onSelect?: (record: ArrearsRecord) => void;
  emptyMessage?: string;
}) {
  if (records.length === 0) {
    return <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] text-left text-[13px]">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pl-4 pr-3 font-medium">Client / Entity</th>
            <th className="px-3 py-2 font-medium">Lender</th>
            <th className="px-3 py-2 font-medium">Asset</th>
            <th className="px-3 py-2 font-medium">Age</th>
            <th className="px-3 py-2 text-right font-medium">Arrears</th>
            <th className="px-3 py-2 text-right font-medium">Repayment</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr
              key={r.id}
              onClick={() => onSelect?.(r)}
              className={`border-b border-border/60 align-top ${
                onSelect ? 'cursor-pointer hover:bg-secondary/40' : ''
              } ${r.resolved ? 'opacity-60' : ''}`}
            >
              {/* Age stripe: the first thing the eye lands on. */}
              <td
                className="py-2.5 pl-4 pr-3"
                style={{ boxShadow: `inset 3px 0 0 0 ${bucketColor(r.bucket)}` }}
              >
                <p className="font-medium text-foreground">
                  {r.contact_name || r.organization_name || '—'}
                </p>
                {r.contact_name && r.organization_name && (
                  <p className="text-[12px] text-muted-foreground">{r.organization_name}</p>
                )}
              </td>
              <td className="px-3 py-2.5">
                <p className="text-foreground">{lenderNames(r) || '—'}</p>
                <p className="text-[12px] text-muted-foreground">{fileTypeLabel(r.file_type)}</p>
              </td>
              <td className="max-w-[240px] px-3 py-2.5">
                <p className="truncate text-foreground" title={r.asset_details ?? undefined}>
                  {r.asset_details || '—'}
                </p>
                {(r.contract_number || r.vin) && (
                  <p className="truncate text-[12px] text-muted-foreground">
                    {[r.contract_number, r.vin].filter(Boolean).join(' · ')}
                  </p>
                )}
              </td>
              <td className="px-3 py-2.5">
                <Badge
                  type="custom"
                  value={r.bucket}
                  label={r.bucket === 'delinquent' ? `${r.days_in_arrears}d · Delinquent` : `${r.days_in_arrears}d`}
                  className={bucketClass(r.bucket)}
                />
              </td>
              <td className="px-3 py-2.5 text-right">
                <p className="font-semibold tabular-nums text-foreground">{formatMoney(r.arrears_amount)}</p>
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                {formatRepayment(r.repayment_amount, r.repayment_frequency)}
              </td>
              <td className="px-3 py-2.5">
                {/* Only the states worth acting on get a chip; "open, no proof
                    yet" is the norm and says nothing, so it stays quiet. */}
                <div className="flex flex-wrap gap-1">
                  {r.resolved && <Badge type="custom" value="resolved" label="Resolved" className="led-chip-success" />}
                  {r.proof_of_payment_received && (
                    <Badge type="custom" value="proof" label="Proof" className="led-chip-info" />
                  )}
                  {!r.resolved && !r.proof_of_payment_received && (
                    <span className="text-[12px] text-muted-foreground">Open</span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Plain, print-safe version of the same grid — no chips, no hover, no colours
 *  html2canvas can't parse. Keeps every field in its own column: a printed
 *  report is read across, not scanned. Rendered off-screen only when exporting. */
export function ArrearsPrintTable({ records }: { records: ArrearsRecord[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9px' }}>
      <thead>
        <tr style={{ borderBottom: '1px solid #333' }}>
          {['Entity', 'Client', 'Lender', 'Repayment', 'Arrears', 'Days', 'Bucket', 'Contract no.', 'VIN', 'Asset', 'Loan type', 'Resolved', 'Proof'].map((h) => (
            <th key={h} style={{ padding: '4px 5px', textAlign: 'left', color: '#111' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {records.map((r) => (
          <tr key={r.id} style={{ borderBottom: '1px solid #ddd' }}>
            <td style={{ padding: '4px 5px', color: '#111' }}>{r.organization_name || '—'}</td>
            <td style={{ padding: '4px 5px', color: '#111' }}>{r.contact_name || '—'}</td>
            <td style={{ padding: '4px 5px', color: '#111' }}>{lenderNames(r)}</td>
            <td style={{ padding: '4px 5px', color: '#111' }}>{formatRepayment(r.repayment_amount, r.repayment_frequency)}</td>
            <td style={{ padding: '4px 5px', color: '#111' }}>{formatMoney(r.arrears_amount)}</td>
            <td style={{ padding: '4px 5px', color: '#111' }}>{r.days_in_arrears}</td>
            <td style={{ padding: '4px 5px', color: '#111' }}>{bucketLabel(r.bucket)}</td>
            <td style={{ padding: '4px 5px', color: '#111' }}>{r.contract_number || '—'}</td>
            <td style={{ padding: '4px 5px', color: '#111' }}>{r.vin || '—'}</td>
            <td style={{ padding: '4px 5px', color: '#111' }}>{r.asset_details || '—'}</td>
            <td style={{ padding: '4px 5px', color: '#111' }}>{fileTypeLabel(r.file_type)}</td>
            <td style={{ padding: '4px 5px', color: '#111' }}>{r.resolved ? 'Yes' : 'No'}</td>
            <td style={{ padding: '4px 5px', color: '#111' }}>{r.proof_of_payment_received ? 'Yes' : 'No'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
