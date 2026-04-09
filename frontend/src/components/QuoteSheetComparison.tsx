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

// ── On-screen term block (unchanged card style) ──────────────────────
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

// ── PDF table-based term block ───────────────────────────────────────
function PdfTermTable({ group, isClientView, assetDescription }: { group: TermGroup; isClientView: boolean; assetDescription: string }) {
  const { termYears, noBalloon, withBalloon } = group;
  const hasTwo = noBalloon && withBalloon;

  const renderRows = (opt: QuoteOption) => {
    const balloonPct = opt.lender_name.match(/(\d+)%\s*Balloon/);
    const balloonLabel = balloonPct ? `Balloon ${balloonPct[1]}%` : 'Balloon';

    const rows: { label: string; value: string; bold?: boolean }[] = [
      { label: `${assetDescription} price`, value: fmtCurrency(opt.purchase_price) },
      { label: 'Deposit', value: fmtCurrency(opt.deposit) },
      { label: 'Loan applied for', value: fmtCurrency(opt.loan_amount) },
      { label: 'Term (in years)', value: String(termYears) },
      { label: (opt.balloon_residual ?? 0) > 0 ? balloonLabel : 'Balloon', value: fmtCurrency(opt.balloon_residual ?? 0) },
      { label: 'Repayments per month', value: fmtCurrency(opt.repayment_monthly), bold: true },
    ];

    if (!isClientView) {
      rows.push({ label: 'Rate of Interest', value: fmtPercent(opt.interest_rate) });
    }

    rows.push(
      { label: 'Weekly Equivalent', value: fmtCurrency(opt.repayment_weekly) },
      { label: 'Total Interest paid over the term', value: fmtCurrency(opt.total_interest) },
    );

    return rows;
  };

  const renderTable = (opt: QuoteOption, subtitle?: string) => (
    <div style={{ flex: '1 1 0', minWidth: 0 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead>
          <tr>
            <th
              colSpan={2}
              style={{
                padding: '10px 12px',
                textAlign: 'center',
                fontSize: '15px',
                fontWeight: 700,
                color: '#1a1a1a',
                borderBottom: '2px solid #e5e7eb',
              }}
            >
              {termYears} Year Term
              {subtitle && <span style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#6b7280', marginTop: '2px' }}>{subtitle}</span>}
            </th>
          </tr>
        </thead>
        <tbody>
          {renderRows(opt).map((row, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={{ padding: '8px 12px', color: '#374151', fontWeight: row.bold ? 600 : 400 }}>{row.label}</td>
              <td style={{
                padding: '8px 12px',
                textAlign: 'right',
                fontWeight: row.bold ? 700 : 600,
                color: row.bold ? '#2563eb' : '#1a1a1a',
                whiteSpace: 'nowrap',
              }}>
                {row.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (hasTwo) {
    return (
      <div style={{ display: 'flex', gap: '16px' }}>
        {noBalloon && renderTable(noBalloon, 'No Balloon')}
        {withBalloon && renderTable(withBalloon, 'With Balloon')}
      </div>
    );
  }

  const opt = noBalloon || withBalloon;
  if (!opt) return null;
  return renderTable(opt);
}

// Parse input_parameters to get fee details, asset description, and selected terms
function parseInputParams(quoteSheet: QuoteSheet) {
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
      feesFinanced: params.fees_financed ?? true,
      selectedTerms: (params.selected_terms as number[] | undefined) ?? null,
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

  const allTermGroups = groupByTerm(options);
  const parsedParams = parseInputParams(quoteSheet);
  const assetDescription = parsedParams?.assetDescription || 'Asset';
  const feesFinanced = parsedParams?.feesFinanced ?? true;
  const selectedTerms = parsedParams?.selectedTerms;

  // Filter terms for client view / PDF if selected_terms is set
  const termGroups = (isClientView || isPdfExport) && selectedTerms
    ? allTermGroups.filter(g => selectedTerms.includes(g.termYears))
    : allTermGroups;

  // Split into rows of 2 for the grid
  const rows: TermGroup[][] = [];
  for (let i = 0; i < termGroups.length; i += 2) {
    rows.push(termGroups.slice(i, i + 2));
  }

  // ── PDF Export Layout ────────────────────────────────────────────────
  if (isPdfExport) {
    return (
      <div id={`quote-sheet-${quoteSheet.id}`} style={{ background: '#ffffff', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#1a1a1a' }}>

        {/* ── Branded Header ──────────────────────────────────── */}
        <div style={{ textAlign: 'center', paddingBottom: '20px', borderBottom: '3px solid #2563eb', marginBottom: '24px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <div style={{
              width: '44px',
              height: '44px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              fontSize: '22px',
              fontWeight: 800,
            }}>
              X
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#1a1a1a', letterSpacing: '-0.5px', lineHeight: 1.1 }}>
                XPRESS <span style={{ color: '#2563eb' }}>FINANCE</span>
              </div>
            </div>
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '6px' }}>
            123 Business Road, Sydney NSW 2000 &nbsp;|&nbsp; Ph: (02) 9876 5432
          </div>
        </div>

        {/* ── Document Info ───────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px', fontSize: '13px' }}>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', marginBottom: '4px' }}>Quote Sheet</div>
            {assetDescription && assetDescription !== 'Asset' && (
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#2563eb' }}>{assetDescription} Finance</div>
            )}
            {quoteSheet.title && (
              <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>{quoteSheet.title}</div>
            )}
          </div>
          <div style={{ textAlign: 'right', color: '#374151' }}>
            {clientName && <div><span style={{ color: '#6b7280' }}>Client:</span> <strong>{clientName}</strong></div>}
            {applicationRef && <div><span style={{ color: '#6b7280' }}>Ref:</span> {applicationRef}</div>}
            <div><span style={{ color: '#6b7280' }}>Date:</span> {new Date().toLocaleDateString('en-AU')}</div>
          </div>
        </div>

        {/* ── Term Tables ─────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {rows.map((row, ri) => (
            <div key={ri} style={{ display: 'flex', gap: '16px' }} className="break-inside-avoid">
              {row.map(group => (
                <div key={group.termYears} style={{ flex: '1 1 0', minWidth: 0, border: '1px solid #d1d5db', borderRadius: '8px', overflow: 'hidden' }}>
                  <PdfTermTable group={group} isClientView={isClientView} assetDescription={assetDescription} />
                </div>
              ))}
              {/* If odd number, add empty spacer to keep layout balanced */}
              {row.length === 1 && <div style={{ flex: '1 1 0', minWidth: 0 }} />}
            </div>
          ))}
        </div>

        {/* ── Non-Financed Fees Section ───────────────────────── */}
        {!feesFinanced && parsedParams && (
          <div style={{ marginTop: '24px', border: '1px solid #d1d5db', borderRadius: '8px', overflow: 'hidden' }} className="break-inside-avoid">
            <div style={{ background: '#fef3c7', padding: '10px 16px', borderBottom: '1px solid #d1d5db' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#92400e' }}>Fees Payable (Not Financed)</div>
              <div style={{ fontSize: '11px', color: '#a16207', marginTop: '2px' }}>These fees are charged separately and are not included in the loan amount.</div>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <tbody>
                {parsedParams.establishmentFee != null && parsedParams.establishmentFee > 0 && (
                  <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '8px 16px', color: '#374151' }}>Loan Establishment Fee</td>
                    <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 600 }}>{fmtCurrency(parsedParams.establishmentFee)}</td>
                  </tr>
                )}
                {parsedParams.ppsrFee != null && parsedParams.ppsrFee > 0 && (
                  <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '8px 16px', color: '#374151' }}>PPSR</td>
                    <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 600 }}>{fmtCurrency(parsedParams.ppsrFee)}</td>
                  </tr>
                )}
                {parsedParams.originationFee != null && parsedParams.originationFee > 0 && (
                  <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '8px 16px', color: '#374151' }}>Origination Fee</td>
                    <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 600 }}>{fmtCurrency(parsedParams.originationFee)}</td>
                  </tr>
                )}
                <tr style={{ background: '#f9fafb' }}>
                  <td style={{ padding: '8px 16px', fontWeight: 700, color: '#1a1a1a' }}>Total Fees</td>
                  <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 700, color: '#2563eb' }}>
                    {fmtCurrency((parsedParams.establishmentFee ?? 0) + (parsedParams.ppsrFee ?? 0) + (parsedParams.originationFee ?? 0))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* ── Fee Summary (broker internal PDF only) ──────────── */}
        {parsedParams && !isClientView && (
          <div style={{ marginTop: '24px', border: '1px solid #d1d5db', borderRadius: '8px', overflow: 'hidden' }} className="break-inside-avoid">
            <div style={{ background: '#f0f9ff', padding: '10px 16px', borderBottom: '1px solid #d1d5db' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#1e40af' }}>Fee &amp; Rate Summary (Internal)</div>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <tbody>
                {parsedParams.establishmentFee != null && (
                  <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '8px 16px', color: '#374151' }}>Loan Establishment Fee</td>
                    <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 600 }}>{fmtCurrency(parsedParams.establishmentFee)}</td>
                  </tr>
                )}
                {parsedParams.ppsrFee != null && (
                  <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '8px 16px', color: '#374151' }}>PPSR</td>
                    <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 600 }}>{fmtCurrency(parsedParams.ppsrFee)}</td>
                  </tr>
                )}
                {parsedParams.originationFee != null && (
                  <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '8px 16px', color: '#374151' }}>Origination Fee</td>
                    <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 600 }}>{fmtCurrency(parsedParams.originationFee)}</td>
                  </tr>
                )}
                {parsedParams.interestRate != null && (
                  <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '8px 16px', color: '#374151' }}>Lender's Rate</td>
                    <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 600 }}>{fmtPercent(parsedParams.interestRate)}</td>
                  </tr>
                )}
                {parsedParams.brokeragePercent != null && (
                  <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '8px 16px', color: '#374151' }}>Brokerage %</td>
                    <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 600 }}>{parsedParams.brokeragePercent}%</td>
                  </tr>
                )}
                {options[0]?.brokerage != null && (
                  <tr style={{ background: '#f9fafb' }}>
                    <td style={{ padding: '8px 16px', fontWeight: 700, color: '#1a1a1a' }}>Brokerage $</td>
                    <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 700, color: '#2563eb' }}>{fmtCurrency(options[0].brokerage)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Why Choose Us Section ───────────────────────────── */}
        {isClientView && (
          <div style={{ marginTop: '32px', paddingTop: '20px', borderTop: '2px solid #2563eb' }} className="break-inside-avoid">
            <div style={{ fontSize: '18px', fontWeight: 800, color: '#2563eb', marginBottom: '14px' }}>WHY CHOOSE US?</div>
            <div style={{ fontSize: '13px', color: '#374151', lineHeight: 1.7 }}>
              <div style={{ marginBottom: '10px' }}>
                <strong>1)</strong> We specialise in end to end account management.
              </div>
              <div style={{ marginBottom: '10px' }}>
                <strong>2)</strong> We act as one point of contact for all your admin needs for the life of the loan. This includes payout letters, updating account information and changing address on the loan contracts.
              </div>
              <div>
                <strong>3)</strong> We take the stress away at the end of the financial year. We are just a phone call away for any tax related information such as interest paid on the loan and outstanding balance on the contract.
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── On-screen Layout (unchanged) ─────────────────────────────────────
  return (
    <div id={`quote-sheet-${quoteSheet.id}`} className="bg-card rounded-xl space-y-6">

      {quoteSheet.title && (
        <h3 className="text-xl font-bold text-foreground tracking-tight">{quoteSheet.title}</h3>
      )}

      {/* Term scenario grid */}
      <div className="space-y-6">
        {rows.map((row, ri) => (
          <div key={ri} className="grid grid-cols-1 lg:grid-cols-2 gap-6 break-inside-avoid">
            {row.map(group => (
              <TermBlock key={group.termYears} group={group} isClientView={isClientView} assetDescription={assetDescription} />
            ))}
          </div>
        ))}
      </div>

      {/* Non-financed fees notice (on-screen, client view) */}
      {!feesFinanced && isClientView && parsedParams && (
        <div className="border border-warning/30 bg-warning/5 rounded-xl p-5 space-y-2 break-inside-avoid mt-4">
          <p className="text-[12px] font-bold text-warning uppercase tracking-wider mb-2">Fees Payable (Not Financed)</p>
          <p className="text-[11px] text-muted-foreground mb-3">These fees are charged separately and are not included in the loan amount.</p>
          {parsedParams.establishmentFee != null && parsedParams.establishmentFee > 0 && (
            <Row label="Loan Establishment Fee" value={fmtCurrency(parsedParams.establishmentFee)} />
          )}
          {parsedParams.ppsrFee != null && parsedParams.ppsrFee > 0 && (
            <Row label="PPSR" value={fmtCurrency(parsedParams.ppsrFee)} />
          )}
          {parsedParams.originationFee != null && parsedParams.originationFee > 0 && (
            <Row label="Origination Fee" value={fmtCurrency(parsedParams.originationFee)} />
          )}
          <Row label="Total Fees" value={fmtCurrency((parsedParams.establishmentFee ?? 0) + (parsedParams.ppsrFee ?? 0) + (parsedParams.originationFee ?? 0))} bold />
        </div>
      )}

      {/* Fee summary (broker view only) */}
      {parsedParams && !isClientView && (
        <div className="border border-border/60 bg-secondary/10 rounded-xl p-5 space-y-2 break-inside-avoid mt-6">
          <p className="text-[12px] font-bold text-primary uppercase tracking-wider mb-3">
            Fee Summary
            {!feesFinanced && <span className="ml-2 text-warning">(Fees Not Financed)</span>}
          </p>
          {parsedParams.establishmentFee != null && (
            <Row label="Loan Establishment Fee" value={fmtCurrency(parsedParams.establishmentFee)} />
          )}
          {parsedParams.ppsrFee != null && (
            <Row label="PPSR" value={fmtCurrency(parsedParams.ppsrFee)} />
          )}
          {parsedParams.originationFee != null && (
            <Row label="Origination Fee" value={fmtCurrency(parsedParams.originationFee)} />
          )}
          {parsedParams.interestRate != null && (
            <Row label="Lender's Rate" value={fmtPercent(parsedParams.interestRate)} />
          )}
          {parsedParams.brokeragePercent != null && (
            <Row label="Brokerage %" value={`${parsedParams.brokeragePercent}%`} />
          )}
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
