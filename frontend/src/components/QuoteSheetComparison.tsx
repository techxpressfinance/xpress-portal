import type { QuoteSheet } from '../types';

interface QuoteSheetComparisonProps {
  quoteSheet: QuoteSheet;
  showBrokerNotes?: boolean;
}

const fmt = (v: number | null, prefix = '$') => {
  if (v === null || v === undefined) return '—';
  if (prefix === '$') return `$${v.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (prefix === '%') return `${v}%`;
  return String(v);
};

const fmtTerm = (months: number | null) => {
  if (months === null || months === undefined) return '—';
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} months`;
  if (m === 0) return `${y} year${y > 1 ? 's' : ''}`;
  return `${y}y ${m}m`;
};

type RowDef = {
  label: string;
  key: string;
  format: '$' | '%' | 'term' | 'text';
};

const SECTIONS: { title: string; rows: RowDef[] }[] = [
  {
    title: 'Loan Details',
    rows: [
      { label: 'Lender', key: 'lender_name', format: 'text' },
      { label: 'Product', key: 'lender_product', format: 'text' },
      { label: 'Purchase Price', key: 'purchase_price', format: '$' },
      { label: 'Deposit', key: 'deposit', format: '$' },
      { label: 'Loan Amount', key: 'loan_amount', format: '$' },
      { label: 'Loan Term', key: 'loan_term_months', format: 'term' },
      { label: 'Balloon / Residual', key: 'balloon_residual', format: '$' },
    ],
  },
  {
    title: 'Rates',
    rows: [
      { label: 'Interest Rate', key: 'interest_rate', format: '%' },
      { label: 'Comparison Rate', key: 'comparison_rate', format: '%' },
    ],
  },
  {
    title: 'Fees',
    rows: [
      { label: 'Establishment Fee', key: 'establishment_fee', format: '$' },
      { label: 'Application Fee', key: 'application_fee', format: '$' },
      { label: 'Monthly Account Fee', key: 'monthly_account_fee', format: '$' },
      { label: 'Brokerage', key: 'brokerage', format: '$' },
    ],
  },
  {
    title: 'Repayments',
    rows: [
      { label: 'Monthly', key: 'repayment_monthly', format: '$' },
      { label: 'Fortnightly', key: 'repayment_fortnightly', format: '$' },
      { label: 'Weekly', key: 'repayment_weekly', format: '$' },
    ],
  },
  {
    title: 'Totals',
    rows: [
      { label: 'Total Repayments', key: 'total_repayments', format: '$' },
      { label: 'Total Interest', key: 'total_interest', format: '$' },
      { label: 'Total Fees', key: 'total_fees', format: '$' },
    ],
  },
  {
    title: 'Additional Info',
    rows: [
      { label: 'Features', key: 'features', format: 'text' },
      { label: 'Notes', key: 'notes', format: 'text' },
    ],
  },
];

function getValue(option: Record<string, unknown>, key: string, format: string): string {
  const val = option[key];
  if (val === null || val === undefined || val === '') return '—';
  if (format === '$') return fmt(val as number, '$');
  if (format === '%') return fmt(val as number, '%');
  if (format === 'term') return fmtTerm(val as number);
  return String(val);
}

export default function QuoteSheetComparison({ quoteSheet, showBrokerNotes = false }: QuoteSheetComparisonProps) {
  const options = [...quoteSheet.options].sort((a, b) => a.sort_order - b.sort_order);

  if (options.length === 0) {
    return <p className="text-sm text-muted-foreground">No lender options added yet.</p>;
  }

  // Filter out sections where all rows are empty across all options
  const visibleSections = SECTIONS.map(section => ({
    ...section,
    rows: section.rows.filter(row =>
      options.some(opt => {
        const val = (opt as unknown as Record<string, unknown>)[row.key];
        return val !== null && val !== undefined && val !== '';
      })
    ),
  })).filter(section => section.rows.length > 0);

  return (
    <div id={`quote-sheet-${quoteSheet.id}`} className="bg-card rounded-xl">
      {/* Header */}
      {quoteSheet.title && (
        <h3 className="text-lg font-semibold mb-4">{quoteSheet.title}</h3>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left py-2 px-3 text-muted-foreground font-medium min-w-[160px]" />
              {options.map(opt => (
                <th
                  key={opt.id}
                  className={`text-left py-2 px-3 min-w-[180px] font-semibold ${
                    opt.is_recommended
                      ? 'bg-success/5 border-t-2 border-success'
                      : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {opt.lender_name}
                    {opt.is_recommended && (
                      <span className="text-[10px] font-medium bg-success/10 text-success rounded-full px-2 py-0.5">
                        Recommended
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleSections.map(section => (
              <>
                <tr key={`section-${section.title}`}>
                  <td
                    colSpan={options.length + 1}
                    className="pt-4 pb-1 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border"
                  >
                    {section.title}
                  </td>
                </tr>
                {section.rows.map(row => (
                  <tr key={row.key} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="py-2.5 px-3 text-muted-foreground font-medium">{row.label}</td>
                    {options.map(opt => (
                      <td
                        key={opt.id}
                        className={`py-2.5 px-3 ${
                          opt.is_recommended ? 'bg-success/5' : ''
                        } ${
                          row.key === 'repayment_monthly' ? 'font-semibold text-foreground' : ''
                        }`}
                      >
                        {getValue(opt as unknown as Record<string, unknown>, row.key, row.format)}
                      </td>
                    ))}
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {showBrokerNotes && quoteSheet.broker_notes && (
        <div className="mt-4 p-3 bg-muted/50 rounded-lg">
          <p className="text-xs font-medium text-muted-foreground mb-1">Broker Notes (internal)</p>
          <p className="text-sm">{quoteSheet.broker_notes}</p>
        </div>
      )}
    </div>
  );
}
