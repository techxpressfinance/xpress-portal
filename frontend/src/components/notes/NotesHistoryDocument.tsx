import type { CSSProperties } from 'react';
import XpressPrintHeader from '../print/XpressPrintHeader';
import { A4_PRINT_WIDTH_PX, PRINT_INSET } from '../../lib/printPage';
import { formatDate, formatDateTime } from '../../lib/utils';
import {
  DECLINED_STATUSES,
  declineReasonsFor,
  declineSummary,
  lendersSubmitted,
  loanBorrower,
  loanHeadline,
  loanOutcome,
  loanTitle,
  money,
  sectionEntries,
  sectionLabel,
  type HistoryEntry,
  type HistoryLayout,
  type HistorySection,
} from '../../lib/notesHistory';
import type { NotesHistory, NotesHistoryLoan } from '../../types';

// Print palette — literal colours, not theme tokens: html2canvas can't read the
// app's oklch variables, and the document must look the same in dark mode.
const INK = '#0f172a';
const INK_2 = '#475569';
const MUTED = '#64748b';
const RULE = '#e2e8f0';
const NAVY = '#0d1f3c';
const DANGER = '#b91c1c';
const DANGER_TINT = '#fef2f2';
const PANEL = '#f8fafc';
const SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const h2: CSSProperties = { fontSize: 15, fontWeight: 700, color: NAVY, margin: '0 0 8px', letterSpacing: 0.2 };
const eyebrow: CSSProperties = { fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 6px' };
const cell: CSSProperties = { padding: '6px 8px', borderBottom: `1px solid ${RULE}`, verticalAlign: 'top', textAlign: 'left' };

/** Kept whole across a page break. paddingTop (not margin) survives the slice — see pdf-export notes. */
const avoid: CSSProperties = { paddingTop: 10 };

function Entry({ entry }: { entry: HistoryEntry }) {
  return (
    <div className="break-inside-avoid" style={avoid}>
      <div style={{ borderLeft: `3px solid ${RULE}`, paddingLeft: 10 }}>
        {entry.title && <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: INK }}>{entry.title}</p>}
        <p style={{ margin: '1px 0 3px', fontSize: 10.5, color: MUTED }}>{entry.meta}</p>
        {entry.body.map((b, i) => (
          <p key={i} style={{ margin: '0 0 3px', fontSize: 12, lineHeight: 1.5, color: INK, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{b}</p>
        ))}
      </div>
    </div>
  );
}

function None() {
  return <p style={{ margin: '4px 0 0', fontSize: 11.5, fontStyle: 'italic', color: MUTED }}>None recorded</p>;
}

function LoanHeader({ loan }: { loan: NotesHistoryLoan }) {
  const declined = DECLINED_STATUSES.has(loan.status);
  const facts = [
    `Borrower: ${loanBorrower(loan)}`,
    loan.roles.length ? `Role: ${loan.roles.join('; ')}` : '',
    loan.brokers.length ? `Broker: ${loan.brokers.join(', ')}` : '',
    `Opened ${formatDate(loan.created_at)}`,
    loan.settled_at ? `Settled ${formatDate(loan.settled_at)}` : '',
    loan.approval_lender_name ? `Approved by ${loan.approval_lender_name}` : '',
  ].filter(Boolean);
  return (
    <div className="break-inside-avoid" style={{ paddingTop: 18 }}>
      <div style={{ background: declined ? DANGER_TINT : PANEL, border: `1px solid ${declined ? '#fecaca' : RULE}`, borderRadius: 6, padding: '8px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: INK }}>
            {loan.ref} · {loanTitle(loan)} · {money(loan.amount)}
          </p>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: declined ? DANGER : INK_2, whiteSpace: 'nowrap' }}>{loanOutcome(loan)}</p>
        </div>
        <p style={{ margin: '3px 0 0', fontSize: 10.5, color: INK_2, lineHeight: 1.5 }}>{facts.join(' · ')}</p>
      </div>
    </div>
  );
}

function Tally({ title, rows, empty }: { title: string; rows: { label: string; count: number }[]; empty: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <p style={eyebrow}>{title}</p>
      {rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 11.5, color: MUTED }}>{empty}</p>
      ) : (
        rows.map((r) => (
          <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: INK, padding: '2px 0', borderBottom: `1px dashed ${RULE}` }}>
            <span>{r.label}</span>
            <span style={{ fontWeight: 700 }}>×{r.count}</span>
          </div>
        ))
      )}
    </div>
  );
}

/**
 * The client notes-history document. The page 1 summary answers "what happened
 * with this client before, and why" at a glance; the detail follows either loan
 * by loan or grouped by kind of note across every loan.
 */
export default function NotesHistoryDocument({
  history,
  loans,
  sections,
  layout,
  id,
}: {
  history: NotesHistory;
  loans: NotesHistoryLoan[];
  sections: HistorySection[];
  layout: HistoryLayout;
  id?: string;
}) {
  const summary = declineSummary(loans);
  const outcomeLine = summary.outcomes.map((o) => `${o.count} ${o.label.toLowerCase()}`).join(' · ');

  return (
    <div id={id} style={{ background: '#fff', width: A4_PRINT_WIDTH_PX.portrait, fontFamily: SANS, color: INK, paddingBottom: 24, overflow: 'hidden' }}>
      <XpressPrintHeader
        eyebrow="Client file · Notes history"
        title={`${history.subject.name} — Notes history`}
        subtitle={`${loans.length} loan${loans.length === 1 ? '' : 's'} · ${layout === 'by_loan' ? 'Loan by loan' : 'Grouped by note type'} · Prepared by ${history.generated_by} ${formatDateTime(history.generated_at)} · Internal — not for the client`}
      />
      <div style={{ padding: `0 ${PRINT_INSET}px` }}>
        {/* Summary */}
        <p style={h2}>Summary</p>
        <p style={{ margin: '0 0 10px', fontSize: 12.5, color: INK_2 }}>
          {loans.length} loan{loans.length === 1 ? '' : 's'}{outcomeLine ? ` — ${outcomeLine}` : ''}
          {summary.declineNotes ? ` · ${summary.declineNotes} decline note${summary.declineNotes === 1 ? '' : 's'}` : ''}
        </p>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ background: NAVY, color: '#fff' }}>
              {['Opened', 'Loan', 'Amount', 'Lenders', 'Outcome', 'Decline reasons'].map((h) => (
                <th key={h} style={{ ...cell, fontWeight: 700, borderBottom: 'none', fontSize: 10.5 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loans.map((loan) => {
              const declined = DECLINED_STATUSES.has(loan.status);
              return (
                <tr key={loan.id} style={{ background: declined ? DANGER_TINT : undefined }}>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>{formatDate(loan.created_at)}</td>
                  <td style={cell}><strong>{loan.ref}</strong><br />{loanTitle(loan)}</td>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>{money(loan.amount)}</td>
                  <td style={cell}>{lendersSubmitted(loan).join(', ') || '—'}</td>
                  <td style={{ ...cell, fontWeight: 700, color: declined ? DANGER : INK }}>{loanOutcome(loan)}</td>
                  <td style={cell}>{declineReasonsFor(loan).join(', ') || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="break-inside-avoid" style={{ paddingTop: 14 }}>
          <div style={{ border: `1px solid ${RULE}`, borderRadius: 6, padding: '10px 12px', background: PANEL }}>
            <p style={{ ...h2, fontSize: 13, marginBottom: 8 }}>Decline pattern</p>
            <div style={{ display: 'flex', gap: 24 }}>
              <Tally title="By reason" rows={summary.byReason} empty="No decline notes on these loans" />
              <Tally title="Declined by lender" rows={summary.byLender} empty="No lender declines recorded" />
            </div>
          </div>
        </div>

        {history.hidden_count > 0 && (
          <p style={{ margin: '10px 0 0', fontSize: 11, color: MUTED }}>
            {history.hidden_count} other loan{history.hidden_count === 1 ? ' is' : 's are'} handled by other brokers and not included.
          </p>
        )}

        {/* Detail */}
        {layout === 'by_loan'
          ? loans.map((loan) => (
            <div key={loan.id}>
              <LoanHeader loan={loan} />
              {sections.map((section) => {
                const entries = sectionEntries(loan, section);
                return (
                  <div key={section} style={{ paddingLeft: 4 }}>
                    <div className="break-inside-avoid" style={{ paddingTop: 10 }}>
                      <p style={{ ...eyebrow, margin: 0, color: section === 'decline' ? DANGER : MUTED }}>{sectionLabel(section)}</p>
                    </div>
                    {entries.length ? entries.map((e, i) => <Entry key={i} entry={e} />) : <None />}
                  </div>
                );
              })}
            </div>
          ))
          : sections.map((section) => {
            const withEntries = loans.map((loan) => ({ loan, entries: sectionEntries(loan, section) }));
            const empty = withEntries.filter((w) => w.entries.length === 0).map((w) => w.loan.ref);
            return (
              <div key={section}>
                <div className="break-inside-avoid" style={{ paddingTop: 22 }}>
                  <p style={{ ...h2, borderBottom: `2px solid ${section === 'decline' ? DANGER : NAVY}`, paddingBottom: 4, color: section === 'decline' ? DANGER : NAVY }}>
                    {sectionLabel(section)} — all loans
                  </p>
                </div>
                {withEntries.filter((w) => w.entries.length).map(({ loan, entries }) => (
                  <div key={loan.id}>
                    <div className="break-inside-avoid" style={{ paddingTop: 10 }}>
                      <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: DECLINED_STATUSES.has(loan.status) ? DANGER : INK }}>{loanHeadline(loan)}</p>
                    </div>
                    <div style={{ paddingLeft: 8 }}>
                      {entries.map((e, i) => <Entry key={i} entry={e} />)}
                    </div>
                  </div>
                ))}
                {empty.length > 0 && (
                  <p style={{ margin: '8px 0 0', fontSize: 11.5, fontStyle: 'italic', color: MUTED }}>
                    None recorded on {empty.join(', ')}
                  </p>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
