import type { NotesHistory, NotesHistoryLoan } from '../types';
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
} from './notesHistory';
import { formatDate, formatDateTime } from './utils';

const NAVY = '0D1F3C';
const DANGER = 'B91C1C';
const DANGER_TINT = 'FEF2F2';
const MUTED = '64748B';
const RULE = 'E2E8F0';

/**
 * The notes history as an editable Word file — the same content, order and
 * summary as the PDF (both read lib/notesHistory). `docx` is loaded on demand
 * so it stays out of the main bundle.
 */
export async function downloadNotesHistoryDocx(
  history: NotesHistory,
  loans: NotesHistoryLoan[],
  sections: HistorySection[],
  layout: HistoryLayout,
  filename: string,
): Promise<void> {
  const {
    AlignmentType, BorderStyle, Document, Footer, HeadingLevel, Packer, PageNumber, Paragraph,
    ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
  } = await import('docx');

  const summary = declineSummary(loans);
  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];

  const para = (text: string, opts: { bold?: boolean; color?: string; size?: number; italics?: boolean; after?: number; before?: number } = {}) =>
    new Paragraph({
      spacing: { after: opts.after ?? 60, before: opts.before ?? 0 },
      children: [new TextRun({ text, bold: opts.bold, color: opts.color, size: opts.size, italics: opts.italics })],
    });

  // Multi-line note text: one run per line, joined by breaks.
  const bodyPara = (text: string) =>
    new Paragraph({
      spacing: { after: 60 },
      indent: { left: 240 },
      children: text.split('\n').map((line, i) => new TextRun({ text: line, break: i === 0 ? 0 : 1, size: 21 })),
    });

  const heading = (text: string, color = NAVY, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_2) =>
    new Paragraph({ heading: level, spacing: { before: 280, after: 100 }, children: [new TextRun({ text, color, bold: true })] });

  const entryParas = (entry: HistoryEntry) => [
    ...(entry.title ? [new Paragraph({ spacing: { before: 120, after: 0 }, indent: { left: 240 }, children: [new TextRun({ text: entry.title, bold: true, size: 22 })] })] : []),
    new Paragraph({ spacing: { before: entry.title ? 0 : 120, after: 40 }, indent: { left: 240 }, children: [new TextRun({ text: entry.meta, color: MUTED, size: 18 })] }),
    ...entry.body.map(bodyPara),
  ];

  const none = () => new Paragraph({ indent: { left: 240 }, spacing: { after: 60 }, children: [new TextRun({ text: 'None recorded', italics: true, color: MUTED, size: 20 })] });

  const tableCell = (text: string, opts: { bold?: boolean; color?: string; fill?: string; header?: boolean } = {}) =>
    new TableCell({
      shading: opts.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.fill } : undefined,
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
      children: text.split('\n').map((line) =>
        new Paragraph({ children: [new TextRun({ text: line, bold: opts.bold || opts.header, color: opts.header ? 'FFFFFF' : opts.color, size: 18 })] }),
      ),
    });

  // Title block
  children.push(
    new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'CLIENT FILE · NOTES HISTORY', bold: true, color: 'C8962E', size: 18 })] }),
    new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 80 }, children: [new TextRun({ text: `${history.subject.name} — Notes history`, color: NAVY, bold: true })] }),
    para(
      `${loans.length} loan${loans.length === 1 ? '' : 's'} · ${layout === 'by_loan' ? 'Loan by loan' : 'Grouped by note type'} · Prepared by ${history.generated_by} ${formatDateTime(history.generated_at)} · Internal — not for the client`,
      { color: MUTED, size: 18, after: 200 },
    ),
  );

  // Summary
  children.push(heading('Summary'));
  const outcomeLine = summary.outcomes.map((o) => `${o.count} ${o.label.toLowerCase()}`).join(' · ');
  children.push(para(
    `${loans.length} loan${loans.length === 1 ? '' : 's'}${outcomeLine ? ` — ${outcomeLine}` : ''}${summary.declineNotes ? ` · ${summary.declineNotes} decline note${summary.declineNotes === 1 ? '' : 's'}` : ''}`,
    { after: 120 },
  ));

  const headers = ['Opened', 'Loan', 'Amount', 'Lenders', 'Outcome', 'Decline reasons'];
  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h) => tableCell(h, { header: true, fill: NAVY })) }),
      ...loans.map((loan) => {
        const declined = DECLINED_STATUSES.has(loan.status);
        const fill = declined ? DANGER_TINT : undefined;
        return new TableRow({
          cantSplit: true,
          children: [
            tableCell(formatDate(loan.created_at), { fill }),
            tableCell(`${loan.ref}\n${loanTitle(loan)}`, { fill }),
            tableCell(money(loan.amount), { fill }),
            tableCell(lendersSubmitted(loan).join(', ') || '—', { fill }),
            tableCell(loanOutcome(loan), { fill, bold: true, color: declined ? DANGER : undefined }),
            tableCell(declineReasonsFor(loan).join(', ') || '—', { fill }),
          ],
        });
      }),
    ],
  }));

  children.push(heading('Decline pattern', NAVY, HeadingLevel.HEADING_3));
  children.push(para('By reason', { bold: true, color: MUTED, size: 18 }));
  if (summary.byReason.length) summary.byReason.forEach((r) => children.push(para(`${r.label} ×${r.count}`, { size: 20, after: 20 })));
  else children.push(para('No decline notes on these loans', { color: MUTED, size: 20 }));
  children.push(para('Declined by lender', { bold: true, color: MUTED, size: 18, before: 100 }));
  if (summary.byLender.length) summary.byLender.forEach((r) => children.push(para(`${r.label} ×${r.count}`, { size: 20, after: 20 })));
  else children.push(para('No lender declines recorded', { color: MUTED, size: 20 }));

  if (history.hidden_count > 0) {
    children.push(para(
      `${history.hidden_count} other loan${history.hidden_count === 1 ? ' is' : 's are'} handled by other brokers and not included.`,
      { color: MUTED, size: 18, italics: true, before: 120 },
    ));
  }

  // Detail
  if (layout === 'by_loan') {
    loans.forEach((loan) => {
      const declined = DECLINED_STATUSES.has(loan.status);
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        pageBreakBefore: true,
        spacing: { after: 60 },
        children: [
          new TextRun({ text: `${loan.ref} · ${loanTitle(loan)} · ${money(loan.amount)}`, color: NAVY, bold: true }),
          new TextRun({ text: `   ${loanOutcome(loan)}`, color: declined ? DANGER : MUTED, bold: true }),
        ],
      }));
      const facts = [
        `Borrower: ${loanBorrower(loan)}`,
        loan.roles.length ? `Role: ${loan.roles.join('; ')}` : '',
        loan.brokers.length ? `Broker: ${loan.brokers.join(', ')}` : '',
        `Opened ${formatDate(loan.created_at)}`,
        loan.settled_at ? `Settled ${formatDate(loan.settled_at)}` : '',
        loan.approval_lender_name ? `Approved by ${loan.approval_lender_name}` : '',
      ].filter(Boolean).join(' · ');
      children.push(para(facts, { color: MUTED, size: 18, after: 120 }));
      sections.forEach((section) => {
        children.push(new Paragraph({
          spacing: { before: 200, after: 40 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 2 } },
          children: [new TextRun({ text: sectionLabel(section).toUpperCase(), bold: true, size: 18, color: section === 'decline' ? DANGER : MUTED })],
        }));
        const entries = sectionEntries(loan, section);
        if (entries.length) entries.forEach((e) => children.push(...entryParas(e)));
        else children.push(none());
      });
    });
  } else {
    sections.forEach((section, i) => {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: i === 0,
        spacing: { before: 320, after: 100 },
        children: [new TextRun({ text: `${sectionLabel(section)} — all loans`, color: section === 'decline' ? DANGER : NAVY, bold: true })],
      }));
      const empty: string[] = [];
      loans.forEach((loan) => {
        const entries = sectionEntries(loan, section);
        if (!entries.length) {
          empty.push(loan.ref);
          return;
        }
        children.push(para(loanHeadline(loan), { bold: true, color: DECLINED_STATUSES.has(loan.status) ? DANGER : undefined, before: 160 }));
        entries.forEach((e) => children.push(...entryParas(e)));
      });
      if (empty.length) children.push(para(`None recorded on ${empty.join(', ')}`, { italics: true, color: MUTED, size: 20, before: 120 }));
    });
  }

  const doc = new Document({
    creator: history.generated_by,
    title: `${history.subject.name} — Notes history`,
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: `${history.subject.name} — Notes history · Internal · Page `, color: MUTED, size: 16 }),
              new TextRun({ children: [PageNumber.CURRENT], color: MUTED, size: 16 }),
            ],
          })],
        }),
      },
      children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
