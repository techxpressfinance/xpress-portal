import {
  EVENT_LABELS,
  attemptMethodLabel,
  bucketLabel,
  fileTypeLabel,
  formatMoney,
  formatRepayment,
  formatStamp,
  isEmailAttachment,
  isImageAttachment,
  lenderNames,
} from '../../lib/arrears';
import type { ArrearsRecordDetail } from '../../types';
import type { ArrearsPrintImages } from './printImages';
import XpressPrintHeader from '../print/XpressPrintHeader';
import { A4_PRINT_WIDTH_PX, PRINT_INSET } from '../../lib/printPage';

/** Print-safe detail view of one or more arrears records — contract facts plus
 *  every contact attempt (with its evidence), the record-level attachments, and
 *  the full event timeline. Rendered off-screen and captured by html2pdf, so all
 *  styling is inline (html2canvas can't parse Tailwind's modern color values). */

const label: React.CSSProperties = { fontSize: 9, color: '#555', textTransform: 'uppercase', letterSpacing: 0.4 };
const value: React.CSSProperties = { fontSize: 11, color: '#111', fontWeight: 600 };

/** A screenshot printed at readable size. The wrapper carries
 *  `break-inside-avoid` — html2pdf's `avoid` selector only holds on block
 *  wrappers, and a snip sliced across two pages is useless as evidence. */
function Snip({ src, caption }: { src: string; caption: string }) {
  return (
    <div className="break-inside-avoid" style={{ margin: '6px 0 10px' }}>
      <img
        src={src}
        alt={caption}
        style={{
          display: 'block',
          maxWidth: '100%',
          maxHeight: 430,
          border: '1px solid #ddd',
          borderRadius: 3,
        }}
      />
      <div style={{ fontSize: 8.5, color: '#777', marginTop: 3 }}>{caption}</div>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={label}>{k}</div>
      <div style={{ ...value, whiteSpace: 'pre-wrap' }}>{v || '—'}</div>
    </div>
  );
}

function SectionHeading({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <h3 style={{ fontSize: 11, fontWeight: 700, color: '#111', margin: '14px 0 6px', borderBottom: '1px solid #ddd', paddingBottom: 3 }}>
      {children}
      {count !== undefined && count > 0 ? <span style={{ fontWeight: 400, color: '#666' }}> ({count})</span> : null}
    </h3>
  );
}

function AttemptEvidence({
  attachments,
  images,
}: {
  attachments: { id: string; kind: string; original_filename: string; email_subject: string | null; email_from: string | null; email_sent_at: string | null }[];
  images: ArrearsPrintImages;
}) {
  if (attachments.length === 0) return null;
  return (
    <div style={{ marginTop: 2 }}>
      {attachments.map((a) => (
        <div key={a.id} style={{ paddingLeft: 10 }}>
          <div style={{ fontSize: 9.5, color: '#444' }}>
            {isEmailAttachment(a)
              ? `Email: ${a.email_subject || a.original_filename}${a.email_from ? ` — from ${a.email_from}` : ''}${a.email_sent_at ? ` (${formatStamp(a.email_sent_at)})` : ''}`
              : `${a.kind === 'screenshot' ? 'Snip' : 'File'}: ${a.original_filename}`}
          </div>
          {/* The snip prints under the line that names it, so the reader sees
              the evidence beside the attempt it came from. */}
          {images[a.id] && <Snip src={images[a.id]} caption={a.original_filename} />}
          {!images[a.id] && isImageAttachment(a.original_filename) && (
            <div style={{ fontSize: 8.5, color: '#b91c1c' }}>
              Image could not be included in this export — download it from the record.
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function RecordBlock({ record, images }: { record: ArrearsRecordDetail; images: ArrearsPrintImages }) {
  const name = record.contact_name || record.organization_name || 'Arrears record';
  const sub = record.contact_name && record.organization_name ? record.organization_name : null;

  return (
    <div>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: '#111', margin: 0 }}>{name}</h2>
      {sub && <p style={{ fontSize: 10, color: '#555', margin: '0 0 6px' }}>{sub}</p>}

      <div style={{ display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: '#111' }}>{formatMoney(record.arrears_amount)}</span>
        <span style={{ fontSize: 11, color: '#333' }}>{record.days_in_arrears} days · {bucketLabel(record.bucket)}</span>
        <span style={{ fontSize: 10, color: '#555' }}>in arrears since {new Date(`${record.in_arrears_since}T00:00:00`).toLocaleDateString('en-AU')}</span>
        {record.resolved && <span style={{ fontSize: 9, color: '#15803d', fontWeight: 700 }}>RESOLVED</span>}
        {record.proof_of_payment_received && <span style={{ fontSize: 9, color: '#1d4ed8', fontWeight: 700 }}>PROOF RECEIVED</span>}
        {record.delinquent && <span style={{ fontSize: 9, color: '#b91c1c', fontWeight: 700 }}>DELINQUENT</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', columnGap: 16, rowGap: 2 }}>
        <Fact k="Lenders" v={lenderNames(record)} />
        <Fact k="Loan type" v={fileTypeLabel(record.file_type)} />
        <Fact k="Contract number" v={record.contract_number ?? '—'} />
        <Fact k="VIN" v={record.vin ?? '—'} />
        <Fact k="Repayment" v={formatRepayment(record.repayment_amount, record.repayment_frequency)} />
        <Fact k="Asset" v={record.asset_details ?? '—'} />
      </div>
      {record.delinquent_reason && (
        <p style={{ fontSize: 10, color: '#b91c1c', margin: '8px 0 0' }}>Delinquent: {record.delinquent_reason}</p>
      )}
      {record.notes && (
        <p style={{ fontSize: 10, color: '#333', margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{record.notes}</p>
      )}

      <SectionHeading count={record.attempts.length}>Contact attempts</SectionHeading>
      {record.attempts.length === 0 ? (
        <p style={{ fontSize: 10, color: '#666', margin: 0 }}>No contact attempts logged.</p>
      ) : (
        record.attempts.map((a) => (
          <div key={a.id} style={{ padding: '6px 0', borderBottom: '1px solid #eee' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#111' }}>
              {attemptMethodLabel(a.method)} — {formatStamp(a.attempted_at)}
            </div>
            {a.note && <div style={{ fontSize: 10, color: '#333', marginTop: 2, whiteSpace: 'pre-wrap' }}>{a.note}</div>}
            <AttemptEvidence attachments={a.attachments} images={images} />
            <div style={{ fontSize: 8.5, color: '#999', marginTop: 2 }}>
              Logged {formatStamp(a.created_at)}{a.created_by_name ? ` by ${a.created_by_name}` : ''}
            </div>
          </div>
        ))
      )}

      <SectionHeading count={record.attachments.length}>Attachments &amp; emails</SectionHeading>
      {record.attachments.length === 0 ? (
        <p style={{ fontSize: 10, color: '#666', margin: 0 }}>None.</p>
      ) : (
        record.attachments.map((a) => (
          <div key={a.id} style={{ padding: '2px 0' }}>
            <div style={{ fontSize: 10, color: '#333' }}>
              {isEmailAttachment(a)
                ? `Email: ${a.email_subject || a.original_filename}${a.email_from ? ` — from ${a.email_from}` : ''}${a.email_sent_at ? ` (${formatStamp(a.email_sent_at)})` : ''}`
                : `${a.kind === 'screenshot' ? 'Snip' : 'File'}: ${a.original_filename}`}
              <span style={{ color: '#999' }}> · added {formatStamp(a.uploaded_at)}{a.uploaded_by_name ? ` by ${a.uploaded_by_name}` : ''}</span>
            </div>
            {images[a.id] && (
              <Snip
                src={images[a.id]}
                caption={`${a.original_filename} · added ${formatStamp(a.uploaded_at)}${a.uploaded_by_name ? ` by ${a.uploaded_by_name}` : ''}`}
              />
            )}
            {/* An image we couldn't fetch is called out rather than silently
                missing — the PDF is used as evidence, so a gap has to be visible. */}
            {!images[a.id] && isImageAttachment(a.original_filename) && (
              <div style={{ fontSize: 8.5, color: '#b91c1c', paddingLeft: 10 }}>
                Image could not be included in this export — download it from the record.
              </div>
            )}
          </div>
        ))
      )}

      <SectionHeading count={record.events.length}>History</SectionHeading>
      {record.events.map((e) => (
        <div key={e.id} style={{ fontSize: 10, color: '#333', padding: '3px 0', borderLeft: '2px solid #ddd', paddingLeft: 8, marginBottom: 4 }}>
          {e.detail || EVENT_LABELS[e.event_type] || e.event_type}
          <div style={{ fontSize: 8.5, color: '#999' }}>{formatStamp(e.created_at)}{e.created_by_name ? ` · ${e.created_by_name}` : ''}</div>
        </div>
      ))}
    </div>
  );
}

export default function ArrearsRecordPrint({
  records,
  images = {},
  subject,
}: {
  records: ArrearsRecordDetail[];
  /** Screenshots inlined as data URLs, keyed by attachment id — see
   *  loadArrearsPrintImages. Absent ones simply don't print. */
  images?: ArrearsPrintImages;
  /** Who the export is about, for the masthead. A party-level export knows the
   *  client or company it was run from; without it the first record's party is
   *  used, which is the same thing for a single-record export. */
  subject?: string;
}) {
  // One masthead for the document, then the records. A party-level export
  // covers several contracts, so the title says which it is.
  const party = subject || records[0]?.contact_name || records[0]?.organization_name || null;
  const title = records.length === 1 ? 'Arrears Record' : 'Arrears Book';
  const subtitle = records.length === 1
    ? [party, lenderNames(records[0]), records[0].vin ? `VIN ${records[0].vin}` : null]
        .filter(Boolean).join(' · ')
    : `${records.length} contracts${party ? ` · ${party}` : ''}`;

  return (
    // overflow:hidden keeps scrollWidth equal to the element's own width —
    // html2canvas sizes its canvas from the former, and any overflow there
    // shifts the capture and crops the right-hand edge off the PDF.
    <div
      style={{
        background: '#fff',
        color: '#111',
        // Exactly the PDF's inner page width — html2pdf crops anything wider
        // rather than scaling it down.
        width: A4_PRINT_WIDTH_PX.portrait,
        paddingBottom: 16,
        overflow: 'hidden',
        fontFamily: 'Helvetica, Arial, sans-serif',
      }}
    >
      <XpressPrintHeader eyebrow="Collections · Arrears File" title={title} subtitle={subtitle} />
      {/* The inset sits here, below the full-bleed masthead. */}
      <div style={{ padding: `0 ${PRINT_INSET}px` }}>
        {records.map((record, i) => (
          <div key={record.id} style={i > 0 ? { pageBreakBefore: 'always', paddingTop: 16 } : undefined}>
            <RecordBlock record={record} images={images} />
          </div>
        ))}
      </div>
    </div>
  );
}
