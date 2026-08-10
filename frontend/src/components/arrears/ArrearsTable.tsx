import { Badge } from '../ui';
import { bucketClass, bucketLabel, fileTypeLabel, formatMoney, formatRepayment } from '../../lib/arrears';
import type { ArrearsRecord } from '../../types';

const YesNo = ({ value }: { value: boolean }) => (
  <Badge
    type="custom"
    value={value ? 'yes' : 'no'}
    label={value ? 'Yes' : 'No'}
    className={value ? 'led-chip-success' : ''}
  />
);

/**
 * The arrears book grid. Column order follows the business's spec: company,
 * client, lender, repayment, days, contract number, asset, file type, resolved,
 * proof of payment.
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
    return <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1080px] text-left text-[13px]">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">Company</th>
            <th className="px-3 py-2 font-medium">Client</th>
            <th className="px-3 py-2 font-medium">Lender</th>
            <th className="px-3 py-2 font-medium text-right">Repayment</th>
            <th className="px-3 py-2 font-medium text-right">Arrears</th>
            <th className="px-3 py-2 font-medium">Days</th>
            <th className="px-3 py-2 font-medium">Contract no.</th>
            <th className="px-3 py-2 font-medium">Asset</th>
            <th className="px-3 py-2 font-medium">File type</th>
            <th className="px-3 py-2 font-medium">Resolved</th>
            <th className="px-3 py-2 font-medium">Proof</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr
              key={r.id}
              onClick={() => onSelect?.(r)}
              className={`border-b border-border/60 ${onSelect ? 'cursor-pointer hover:bg-secondary/40' : ''}`}
            >
              <td className="px-3 py-2 text-foreground">{r.organization_name || '—'}</td>
              <td className="px-3 py-2 text-foreground">{r.contact_name || '—'}</td>
              <td className="px-3 py-2 text-foreground">{r.lender_name}</td>
              <td className="px-3 py-2 text-right tabular-nums text-foreground">
                {formatRepayment(r.repayment_amount, r.repayment_frequency)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-foreground">{formatMoney(r.arrears_amount)}</td>
              <td className="px-3 py-2">
                <Badge
                  type="custom"
                  value={r.bucket}
                  label={r.bucket === 'delinquent' ? `${r.days_in_arrears}d · Delinquent` : `${r.days_in_arrears}d`}
                  className={bucketClass(r.bucket)}
                />
              </td>
              <td className="px-3 py-2 text-foreground">{r.contract_number || '—'}</td>
              <td className="max-w-[220px] truncate px-3 py-2 text-foreground" title={r.asset_details ?? undefined}>
                {r.asset_details || '—'}
              </td>
              <td className="px-3 py-2 text-foreground">{fileTypeLabel(r.file_type)}</td>
              <td className="px-3 py-2"><YesNo value={r.resolved} /></td>
              <td className="px-3 py-2"><YesNo value={r.proof_of_payment_received} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Plain, print-safe version of the same grid — no chips, no hover, no colours
 *  html2canvas can't parse. Rendered off-screen only when exporting. */
export function ArrearsPrintTable({ records }: { records: ArrearsRecord[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9px' }}>
      <thead>
        <tr style={{ borderBottom: '1px solid #333' }}>
          {['Company', 'Client', 'Lender', 'Repayment', 'Arrears', 'Days', 'Bucket', 'Contract no.', 'Asset', 'File type', 'Resolved', 'Proof'].map((h) => (
            <th key={h} style={{ padding: '4px 5px', textAlign: 'left', color: '#111' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {records.map((r) => (
          <tr key={r.id} style={{ borderBottom: '1px solid #ddd' }}>
            <td style={{ padding: '4px 5px', color: '#111' }}>{r.organization_name || '—'}</td>
            <td style={{ padding: '4px 5px', color: '#111' }}>{r.contact_name || '—'}</td>
            <td style={{ padding: '4px 5px', color: '#111' }}>{r.lender_name}</td>
            <td style={{ padding: '4px 5px', color: '#111' }}>{formatRepayment(r.repayment_amount, r.repayment_frequency)}</td>
            <td style={{ padding: '4px 5px', color: '#111' }}>{formatMoney(r.arrears_amount)}</td>
            <td style={{ padding: '4px 5px', color: '#111' }}>{r.days_in_arrears}</td>
            <td style={{ padding: '4px 5px', color: '#111' }}>{bucketLabel(r.bucket)}</td>
            <td style={{ padding: '4px 5px', color: '#111' }}>{r.contract_number || '—'}</td>
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
