import type { QuoteSheet, QuoteOption } from '../types';

interface QuoteSheetComparisonProps {
  quoteSheet: QuoteSheet;
  showBrokerNotes?: boolean;
  isClientView?: boolean;
  isPdfExport?: boolean;
  clientName?: string;
  applicationRef?: string;
}

const fmtCurrency = (v: number | null) => {
  if (v === null || v === undefined) return '—';
  return `$${v.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtPercent = (v: number | null) => {
  if (v === null || v === undefined) return '—';
  return `${v}%`;
};

type TermGroup = {
  termYears: number;
  termMonths: number;
  noBalloon: QuoteOption | null;
  withBalloon: QuoteOption | null;
};

function groupByTerm(options: QuoteOption[]): TermGroup[] {
  const sorted = [...options].sort((a, b) => a.sort_order - b.sort_order);
  const termMap = new Map<number, TermGroup>();

  for (const opt of sorted) {
    const months = opt.loan_term_months ?? 0;
    const years = Math.round(months / 12);
    if (!termMap.has(years)) {
      termMap.set(years, { termYears: years, termMonths: months, noBalloon: null, withBalloon: null });
    }
    const group = termMap.get(years)!;
    const hasBalloon = (opt.balloon_residual ?? 0) > 0;
    if (hasBalloon) {
      group.withBalloon = opt;
    } else {
      group.noBalloon = opt;
    }
  }

  // Order: 5, 4, 3, 2, 7 (matching Excel)
  const displayOrder = [5, 4, 3, 2, 7];
  const result: TermGroup[] = [];
  for (const t of displayOrder) {
    if (termMap.has(t)) result.push(termMap.get(t)!);
  }
  // Add any remaining terms not in the default order
  for (const [t, group] of termMap) {
    if (!displayOrder.includes(t)) result.push(group);
  }

  return result;
}

function TermBlock({ group, isClientView, assetDescription }: { group: TermGroup; isClientView: boolean; assetDescription: string }) {
  const { termYears, noBalloon, withBalloon } = group;
  const hasTwo = noBalloon && withBalloon;

  const renderColumn = (opt: QuoteOption | null) => {
    if (!opt) return null;
    const balloonPct = opt.lender_name.match(/(\d+)%\s*Balloon/);
    const balloonLabel = balloonPct ? `Balloon ${balloonPct[1]}%` : 'Balloon';

    return (
      <div className="flex-1 w-full min-w-0">
        <div className="space-y-0">
          <Row label={`${assetDescription} price`} value={fmtCurrency(opt.purchase_price)} />
          <Row label="Deposit" value={fmtCurrency(opt.deposit)} />
          <Row label="Loan applied for" value={fmtCurrency(opt.loan_amount)} />
          <Row label="Term (years)" value={String(termYears)} />
          <Row
            label={(opt.balloon_residual ?? 0) > 0 ? balloonLabel : 'Balloon'}
            value={fmtCurrency(opt.balloon_residual ?? 0)}
          />
          <Row label="Repayments (month)" value={fmtCurrency(opt.repayment_monthly)} bold />
          {!isClientView && (
            <Row label="Rate of Interest" value={fmtPercent(opt.interest_rate)} />
          )}
          <Row label="Weekly Equivalent" value={fmtCurrency(opt.repayment_weekly)} />
          <Row label="Total Interest (over term)" value={fmtCurrency(opt.total_interest)} />
        </div>
      </div>
    );
  };

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="bg-muted/50 px-4 py-2.5 border-b border-border">
        <h4 className="text-sm font-semibold text-foreground">{termYears} Year Term</h4>
      </div>
      <div className={`grid ${hasTwo ? 'grid-cols-2 divide-x divide-border' : 'grid-cols-1'}`}>
        {noBalloon && (
          <div className="p-5">
            {hasTwo && <p className="text-[11px] font-bold text-primary uppercase tracking-wider mb-4 border-b border-border/50 pb-2">No Balloon</p>}
            {renderColumn(noBalloon)}
          </div>
        )}
        {withBalloon && (
          <div className="p-5 bg-secondary/5">
            {hasTwo && <p className="text-[11px] font-bold text-primary uppercase tracking-wider mb-4 border-b border-border/50 pb-2">With Balloon</p>}
            {renderColumn(withBalloon)}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex w-full items-start justify-between py-2 border-b border-border/40 last:border-0 group hover:bg-muted/20 rounded-md -mx-1 px-1 transition-colors">
      <div className={`text-[12px] leading-tight w-[60%] pr-2 break-words ${bold ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>{label}</div>
      <div className={`text-[12.5px] tabular-nums whitespace-nowrap text-right w-[40%] pl-2 ${bold ? 'font-bold text-primary' : 'font-medium text-foreground'}`}>{value}</div>
    </div>
  );
}

// Parse input_parameters to get fee details and asset description (broker view only)
function parseFeeDetails(quoteSheet: QuoteSheet) {
  if (!quoteSheet.input_parameters) return null;
  try {
    const params = JSON.parse(quoteSheet.input_parameters);
    return {
      assetDescription: (params.asset_description || params.asset_type || 'Asset') as string,
      establishmentFee: params.establishment_fee ?? null,
      ppsrFee: params.ppsr_fee ?? null,
      originationFee: params.origination_fee ?? null,
      brokeragePercent: params.brokerage_percent ?? null,
      interestRate: params.interest_rate ?? null,
    };
  } catch {
    return null;
  }
}

export default function QuoteSheetComparison({
  quoteSheet,
  showBrokerNotes = false,
  isClientView = false,
  isPdfExport = false,
  clientName,
  applicationRef
}: QuoteSheetComparisonProps) {
  const options = quoteSheet.options;

  if (options.length === 0) {
    return <p className="text-sm text-muted-foreground">No scenarios generated yet.</p>;
  }

  const termGroups = groupByTerm(options);
  const feeDetails = parseFeeDetails(quoteSheet);
  const assetDescription = feeDetails?.assetDescription || 'Asset';

  // Split into rows of 2 for the grid
  const rows: TermGroup[][] = [];
  for (let i = 0; i < termGroups.length; i += 2) {
    rows.push(termGroups.slice(i, i + 2));
  }

  return (
    <div id={`quote-sheet-${quoteSheet.id}`} className="bg-card rounded-xl space-y-6">

      {/* PDF Generation Branded Header */}
      {isPdfExport && (
        <div className="border-b-2 border-primary pb-6 mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-extrabold text-foreground tracking-tight">Xpress Finance</h1>
            <p className="text-sm font-medium text-muted-foreground mt-1">123 Business Road, Sydney NSW 2000</p>
            <p className="text-sm font-medium text-muted-foreground">Ph: (02) 9876 5432</p>
          </div>
          <div className="text-right">
            <h2 className="text-xl font-bold text-foreground">Quote Sheet</h2>
            {assetDescription && assetDescription !== 'Asset' && (
              <p className="text-sm font-semibold text-primary mt-0.5">{assetDescription} Finance</p>
            )}
            {applicationRef && <p className="text-sm font-medium text-muted-foreground mt-1">Ref: {applicationRef}</p>}
            {clientName && <p className="text-sm font-medium text-muted-foreground">Client: {clientName}</p>}
            <p className="text-sm font-medium text-muted-foreground">Date: {new Date().toLocaleDateString('en-AU')}</p>
          </div>
        </div>
      )}

      {quoteSheet.title && !isPdfExport && (
        <h3 className="text-xl font-bold text-foreground tracking-tight">{quoteSheet.title}</h3>
      )}

      {isPdfExport && quoteSheet.title && (
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-foreground border-l-4 border-primary pl-3">{quoteSheet.title}</h3>
        </div>
      )}

      {/* Term scenario grid */}
      <div className="space-y-6">
        {rows.map((row, ri) => (
          <div key={ri} className={`grid grid-cols-1 ${!isPdfExport ? 'lg:grid-cols-2' : ''} gap-6 break-inside-avoid`}>
            {row.map(group => (
              <TermBlock key={group.termYears} group={group} isClientView={isClientView} assetDescription={assetDescription} />
            ))}
          </div>
        ))}
      </div>

      {/* Fee summary (broker view only) */}
      {feeDetails && !isClientView && (
        <div className="border border-border/60 bg-secondary/10 rounded-xl p-5 space-y-2 break-inside-avoid mt-6">
          <p className="text-[12px] font-bold text-primary uppercase tracking-wider mb-3">Fee Summary</p>
          {feeDetails.establishmentFee != null && (
            <Row label="Loan Establishment Fee" value={fmtCurrency(feeDetails.establishmentFee)} />
          )}
          {feeDetails.ppsrFee != null && (
            <Row label="PPSR" value={fmtCurrency(feeDetails.ppsrFee)} />
          )}
          {feeDetails.originationFee != null && (
            <Row label="Origination Fee" value={fmtCurrency(feeDetails.originationFee)} />
          )}
          {feeDetails.interestRate != null && (
            <Row label="Lender's Rate" value={fmtPercent(feeDetails.interestRate)} />
          )}
          {feeDetails.brokeragePercent != null && (
            <Row label="Brokerage %" value={`${feeDetails.brokeragePercent}%`} />
          )}
          {/* Compute brokerage $ from first option */}
          {options[0]?.brokerage != null && (
            <Row label="Brokerage $" value={fmtCurrency(options[0].brokerage)} bold />
          )}
        </div>
      )}

      {showBrokerNotes && quoteSheet.broker_notes && (
        <div className="p-3 bg-muted/50 rounded-lg">
          <p className="text-xs font-medium text-muted-foreground mb-1">Broker Notes (internal)</p>
          <p className="text-sm">{quoteSheet.broker_notes}</p>
        </div>
      )}
    </div>
  );
}
