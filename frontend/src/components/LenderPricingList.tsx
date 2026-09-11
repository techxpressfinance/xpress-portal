import { ClipboardDocumentListIcon, PlusIcon } from '@heroicons/react/24/outline';
import { Button, Card } from './ui';
import type { QuoteSheet } from '../types';
import { formatDate } from '../lib/utils';
import { DIRECT_DEBIT_CYCLE_LABELS, parseLenderPricingInputs } from '../lib/lenderPricing';

interface LenderPricingRowProps {
  sheet: QuoteSheet;
  /** Label the row as lender pricing — for lists that mix it with quote sheets. */
  showBadge?: boolean;
  pdfLoading?: boolean;
  onView: () => void;
  onEdit: () => void;
  onPdf: () => void;
  onDelete: () => void;
}

/** One lender pricing sheet in a list: version, title, term/cycle and actions. */
export function LenderPricingRow({ sheet, showBadge, pdfLoading, onView, onEdit, onPdf, onDelete }: LenderPricingRowProps) {
  const params = parseLenderPricingInputs(sheet);
  const meta = [
    params.term_months != null ? `${params.term_months} months` : null,
    `${DIRECT_DEBIT_CYCLE_LABELS[params.direct_debit_cycle]} direct debit`,
    formatDate(sheet.created_at),
    sheet.created_by_name ? `by ${sheet.created_by_name}` : null,
  ].filter(Boolean).join(' · ');
  const btn = 'rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors';
  return (
    <div className="rounded-xl border border-border/60 bg-secondary/20 p-4 hover:bg-secondary/40 transition-colors">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[13px] font-bold text-foreground">v{sheet.version}</span>
        {sheet.title && (
          <span className="text-[13px] font-medium text-foreground truncate">{sheet.title}</span>
        )}
        {showBadge && (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">Lender Pricing</span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground mt-1 mb-3">{meta}</p>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onView} className={`${btn} bg-secondary text-foreground hover:bg-secondary/80`}>
          View
        </button>
        <button onClick={onEdit} className={`${btn} bg-secondary text-foreground hover:bg-secondary/80`}>
          Edit
        </button>
        <button
          onClick={onPdf}
          disabled={pdfLoading}
          className={`${btn} bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-60`}
        >
          {pdfLoading ? 'Preparing…' : 'PDF'}
        </button>
        <button onClick={onDelete} className={`${btn} bg-destructive/10 text-destructive hover:bg-destructive/20`}>
          Delete
        </button>
      </div>
    </div>
  );
}

interface LenderPricingListProps {
  sheets: QuoteSheet[];
  pdfSheetId?: string | null;
  onCreate: () => void;
  onView: (sheet: QuoteSheet) => void;
  onEdit: (sheet: QuoteSheet) => void;
  onPdf: (sheet: QuoteSheet) => void;
  onDelete: (sheet: QuoteSheet) => void;
}

/** The Lender Pricing section — the deal as the lender approved it. Internal
 *  only: the API never returns these sheets to clients. */
export default function LenderPricingList({ sheets, pdfSheetId, onCreate, onView, onEdit, onPdf, onDelete }: LenderPricingListProps) {
  return (
    <Card>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Lender Pricing</h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">Internal — never shown to the client</p>
        </div>
        <Button size="sm" onClick={onCreate}>
          <span className="flex items-center gap-1.5">
            <PlusIcon className="h-3.5 w-3.5" strokeWidth={2} />
            Create Lender Pricing
          </span>
        </Button>
      </div>

      {sheets.length === 0 ? (
        <div className="rounded-xl bg-secondary/50 p-8 text-center">
          <ClipboardDocumentListIcon className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-[14px] font-medium text-muted-foreground">No lender pricing yet</p>
          <p className="text-[12px] text-muted-foreground mt-1">Record the term, direct debit cycle and structure the lender approved</p>
        </div>
      ) : (
        <div className="space-y-3">
          {[...sheets].sort((a, b) => b.version - a.version).map(sheet => (
            <LenderPricingRow
              key={sheet.id}
              sheet={sheet}
              pdfLoading={pdfSheetId === sheet.id}
              onView={() => onView(sheet)}
              onEdit={() => onEdit(sheet)}
              onPdf={() => onPdf(sheet)}
              onDelete={() => onDelete(sheet)}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
