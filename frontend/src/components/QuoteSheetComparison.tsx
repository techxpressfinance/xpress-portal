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
  return `${Number(v).toFixed(2)}%`;
};

// Newton-Raphson RATE solver — mirrors Excel RATE()
function rateNR(nper: number, pmt: number, pv: number, fv = 0, type: 0 | 1 = 0, guess = 0.01): number {
  let r = guess;
  for (let i = 0; i < 300; i++) {
    const f = Math.pow(1 + r, nper);
    const df = nper * Math.pow(1 + r, nper - 1);
    const yr = type === 0
      ? pv * f + pmt * (f - 1) / r + fv
      : pv * f + pmt * (1 + r) * (f - 1) / r + fv;
    const yr_d = type === 0
      ? pv * df + pmt * (r * df - (f - 1)) / (r * r)
      : pv * df + pmt * ((1 + r) * (r * df - (f - 1)) / (r * r) + (f - 1) / r);
    const rNew = r - yr / yr_d;
    if (Math.abs(rNew - r) < 1e-10) return rNew;
    r = rNew;
  }
  return r;
}

// Compute All Up Interest Rate from stored option fields (advance + chattel only; exact for chattel, approx for others)
function computeAllUpRate(opt: QuoteOption, paymentType: string): number | null {
  if (paymentType !== 'advance') return null;
  const months = opt.loan_term_months ?? 0;
  const loanAmount = opt.loan_amount ?? 0;
  const brokerage = opt.brokerage ?? 0;
  const monthlyFee = opt.monthly_account_fee ?? 0;
  const balloon = opt.balloon_residual ?? 0;
  const netRental = (opt.repayment_monthly ?? 0) - monthlyFee;
  const financedSubTotal = loanAmount - brokerage;
  if (months <= 0 || financedSubTotal <= 0 || netRental <= 0) return null;
  try {
    const rate = rateNR(months, netRental, -financedSubTotal, balloon, 1) * 12;
    return Math.round(rate * 10000) / 100; // stored as % with 2dp
  } catch {
    return null;
  }
}

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
function TermBlock({ group, isClientView, assetDescription, paymentType }: { group: TermGroup; isClientView: boolean; assetDescription: string; paymentType: string }) {
  const { termYears, noBalloon, withBalloon } = group;
  const hasTwo = noBalloon && withBalloon;

  const renderColumn = (opt: QuoteOption | null) => {
    if (!opt) return null;
    const balloonPct = opt.lender_name.match(/(\d+)%\s*Balloon/);
    const balloonLabel = balloonPct ? `Balloon ${balloonPct[1]}%` : 'Balloon';

    // Client sees: asset price - deposit + fees (no brokerage commission)
    const clientLoanAmount = (opt.purchase_price ?? 0) - (opt.deposit ?? 0) + (opt.establishment_fee ?? 0) + (opt.application_fee ?? 0);
    const allUpRate = opt.client_interest_rate ?? computeAllUpRate(opt, paymentType);

    return (
      <div className="flex-1 w-full min-w-0">
        <div className="space-y-0">
          <Row label={`${assetDescription} price`} value={fmtCurrency(opt.purchase_price)} />
          <Row label="Deposit" value={fmtCurrency(opt.deposit)} />
          <Row
            label="Amount to be Financed"
            value={isClientView ? fmtCurrency(clientLoanAmount) : fmtCurrency(opt.loan_amount)}
          />
          <Row label="Term (years)" value={String(termYears)} />
          <Row
            label={(opt.balloon_residual ?? 0) > 0 ? balloonLabel : 'Balloon'}
            value={fmtCurrency(opt.balloon_residual ?? 0)}
          />
          <Row label="Repayments (month)" value={fmtCurrency(opt.repayment_monthly)} bold />
          {!isClientView && (
            <Row label="Rate of Interest" value={fmtPercent(opt.interest_rate)} />
          )}
          {allUpRate != null && (
            <Row label="All Up Interest Rate" value={fmtPercent(allUpRate)} />
          )}
          <Row label="Weekly Equivalent" value={fmtCurrency(opt.repayment_weekly)} />
          {!isClientView && (
            <Row label="Total Interest (over term)" value={fmtCurrency(opt.total_interest)} />
          )}
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
function PdfTermTable({ group, isClientView, assetDescription, paymentType }: { group: TermGroup; isClientView: boolean; assetDescription: string; paymentType: string }) {
  const { termYears, noBalloon, withBalloon } = group;
  const hasTwo = noBalloon && withBalloon;

  const renderRows = (opt: QuoteOption) => {
    const balloonPct = opt.lender_name.match(/(\d+)%\s*Balloon/);
    const balloonLabel = balloonPct ? `Balloon ${balloonPct[1]}%` : 'Balloon';

    // Client sees: asset price - deposit + fees (no brokerage commission)
    const clientLoanAmount = (opt.purchase_price ?? 0) - (opt.deposit ?? 0) + (opt.establishment_fee ?? 0) + (opt.application_fee ?? 0);
    const allUpRate = opt.client_interest_rate ?? computeAllUpRate(opt, paymentType);

    const rows: { label: string; value: string; highlight?: boolean }[] = [
      { label: `${assetDescription} price`, value: fmtCurrency(opt.purchase_price) },
      { label: 'Deposit', value: fmtCurrency(opt.deposit) },
      { label: 'Amount to be Financed', value: isClientView ? fmtCurrency(clientLoanAmount) : fmtCurrency(opt.loan_amount) },
      { label: 'Term (in years)', value: String(termYears) },
      { label: (opt.balloon_residual ?? 0) > 0 ? balloonLabel : 'Balloon', value: fmtCurrency(opt.balloon_residual ?? 0) },
      { label: 'Repayments per month', value: fmtCurrency(opt.repayment_monthly), highlight: true },
    ];

    if (!isClientView) {
      rows.push({ label: 'Rate of Interest', value: fmtPercent(opt.interest_rate) });
    }

    if (allUpRate != null) {
      rows.push({ label: 'All Up Interest Rate', value: fmtPercent(allUpRate) });
    }

    rows.push({ label: 'Weekly Equivalent', value: fmtCurrency(opt.repayment_weekly) });

    if (!isClientView) {
      rows.push({ label: 'Total Interest paid over the term', value: fmtCurrency(opt.total_interest) });
    }

    return rows;
  };

  const renderCol = (opt: QuoteOption, subtitle?: string) => (
    <div style={{ flex: '1 1 0', minWidth: 0, borderRight: subtitle === 'No Balloon' && hasTwo ? '1px solid #e2e8f0' : undefined }}>
      {subtitle && (
        <div style={{ padding: '6px 14px', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', fontSize: '10px', fontWeight: 700, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase' as const }}>
          {subtitle}
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11.5px' }}>
        <tbody>
          {renderRows(opt).map((row, i) => (
            <tr key={i} style={{ background: row.highlight ? '#eff6ff' : i % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
              <td style={{ padding: '7px 14px', color: row.highlight ? '#1e40af' : '#4b5563', fontWeight: row.highlight ? 600 : 400, borderBottom: '1px solid #e9edf2', width: '58%' }}>
                {row.label}
              </td>
              <td style={{ padding: '7px 14px', textAlign: 'right', color: row.highlight ? '#1d4ed8' : '#111827', fontWeight: row.highlight ? 800 : 600, borderBottom: '1px solid #e9edf2', whiteSpace: 'nowrap', fontSize: row.highlight ? '13px' : '11.5px' }}>
                {row.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      {/* Term header */}
      <div style={{ background: 'linear-gradient(135deg, #1e40af, #2563eb)', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: '#ffffff', fontSize: '13px', fontWeight: 700, letterSpacing: '0.02em' }}>{termYears} Year Term</span>
        {hasTwo && <span style={{ color: '#bfdbfe', fontSize: '10px', fontWeight: 500 }}>No Balloon &amp; With Balloon</span>}
      </div>
      {/* Columns */}
      <div style={{ display: 'flex' }}>
        {hasTwo ? (
          <>
            {noBalloon && renderCol(noBalloon, 'No Balloon')}
            {withBalloon && renderCol(withBalloon, 'With Balloon')}
          </>
        ) : (
          renderCol((noBalloon || withBalloon)!)
        )}
      </div>
    </div>
  );
}

// Parse input_parameters to get fee details, asset description, and selected terms
function parseInputParams(quoteSheet: QuoteSheet) {
  if (!quoteSheet.input_parameters) return null;
  try {
    const params = JSON.parse(quoteSheet.input_parameters);
    return {
      assetDescription: (params.asset_description || params.asset_type || 'Asset') as string,
      facilityType: (params.facility_type || 'chattel') as string,
      paymentType: (params.payment_type || 'advance') as string,
      establishmentFee: params.establishment_fee ?? null,
      ppsrFee: params.ppsr_fee ?? null,
      originationFee: params.origination_fee ?? null,
      brokeragePercent: params.brokerage_percent ?? null,
      interestRate: params.interest_rate ?? null,
      monthlyAccountFee: params.monthly_account_fee ?? 0,
      feesFinanced: params.fees_financed ?? true,
      selectedTerms: (params.selected_terms as number[] | undefined) ?? null,
      showInterestRate: (params.show_interest_rate as boolean | undefined) ?? false,
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
  const paymentType = parsedParams?.paymentType ?? 'advance';

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
    const whyItems = [
      'We specialise in end to end account management.',
      'We act as one point of contact for all your admin needs for the life of the loan — payout letters, updating account information and changing address on the loan contracts.',
      'We take the stress away at the end of the financial year. We are just a phone call away for any tax related information such as interest paid on the loan and outstanding balance on the contract.',
    ];

    return (
      <div id={`quote-sheet-${quoteSheet.id}`} style={{ background: '#ffffff', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#1a1a1a', padding: '32px' }}>

        {/* ── Header bar ──────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '20px', marginBottom: '24px', borderBottom: '2px solid #e2e8f0' }}>
          {/* Brand */}
          <img src="/xpress-light.svg" alt="Xpress Finance" style={{ height: '80px', objectFit: 'contain' }} />
          {/* Contact */}
          <div style={{ textAlign: 'right', fontSize: '11px', color: '#64748b', lineHeight: 1.8 }}>
            <div style={{ fontWeight: 600, color: '#374151' }}>727 Collins Street, Docklands VIC 3008</div>
            <div>Ph: (03) 8456 7996</div>
          </div>
        </div>

        {/* ── Document identity ───────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '28px' }}>
          <div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.3px', lineHeight: 1.4, marginBottom: '8px' }}>Quote Sheet</div>
            {assetDescription && assetDescription !== 'Asset' && (
              <div style={{ display: 'inline-block', background: '#eff6ff', color: '#1d4ed8', fontSize: '11px', fontWeight: 700, padding: '4px 12px', borderRadius: '20px', letterSpacing: '0.04em', textTransform: 'uppercase' as const }}>
                {assetDescription} Finance
              </div>
            )}
            {quoteSheet.title && (
              <div style={{ fontSize: '13px', color: '#64748b', marginTop: '6px' }}>{quoteSheet.title}</div>
            )}
          </div>
          {/* Meta box */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 16px', fontSize: '12px', color: '#374151', minWidth: '180px', textAlign: 'right' }}>
            {clientName && (
              <div style={{ marginBottom: '4px' }}>
                <span style={{ color: '#94a3b8', fontWeight: 500 }}>Prepared for </span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>{clientName}</span>
              </div>
            )}
            {applicationRef && (
              <div style={{ marginBottom: '4px' }}>
                <span style={{ color: '#94a3b8' }}>Ref: </span>
                <span style={{ fontWeight: 600 }}>{applicationRef}</span>
              </div>
            )}
            <div>
              <span style={{ color: '#94a3b8' }}>Date: </span>
              <span style={{ fontWeight: 600 }}>{new Date().toLocaleDateString('en-AU')}</span>
            </div>
          </div>
        </div>

        {/* ── Divider label ───────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.1em', textTransform: 'uppercase' as const, whiteSpace: 'nowrap' }}>Finance Scenarios</div>
          <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
        </div>

        {/* ── Term Tables ─────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {rows.map((row, ri) => (
            <div key={ri} style={{ display: 'flex', gap: '14px' }} className="break-inside-avoid">
              {row.map(group => (
                <div key={group.termYears} style={{ flex: '1 1 0', minWidth: 0 }}>
                  <PdfTermTable group={group} isClientView={isClientView} assetDescription={assetDescription} paymentType={paymentType} />
                </div>
              ))}
              {row.length === 1 && <div style={{ flex: '1 1 0', minWidth: 0 }} />}
            </div>
          ))}
        </div>

        {/* ── Non-Financed Fees ───────────────────────────────── */}
        {!feesFinanced && parsedParams && (
          <div style={{ marginTop: '20px', borderRadius: '10px', overflow: 'hidden', border: '1px solid #fde68a' }} className="break-inside-avoid">
            <div style={{ background: '#fffbeb', padding: '10px 16px', borderBottom: '1px solid #fde68a', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#d97706', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#92400e' }}>Fees Payable (Not Financed)</div>
                <div style={{ fontSize: '10px', color: '#a16207', marginTop: '1px' }}>These fees are charged separately and are not included in the loan amount.</div>
              </div>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11.5px' }}>
              <tbody>
                {parsedParams.establishmentFee != null && parsedParams.establishmentFee > 0 && (
                  <tr style={{ borderBottom: '1px solid #fef3c7', background: '#ffffff' }}>
                    <td style={{ padding: '8px 16px', color: '#374151' }}>Loan Establishment Fee</td>
                    <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 600, color: '#111827' }}>{fmtCurrency(parsedParams.establishmentFee)}</td>
                  </tr>
                )}
                {parsedParams.ppsrFee != null && parsedParams.ppsrFee > 0 && (
                  <tr style={{ borderBottom: '1px solid #fef3c7', background: '#f8fafc' }}>
                    <td style={{ padding: '8px 16px', color: '#374151' }}>PPSR</td>
                    <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 600, color: '#111827' }}>{fmtCurrency(parsedParams.ppsrFee)}</td>
                  </tr>
                )}
                {parsedParams.originationFee != null && parsedParams.originationFee > 0 && (
                  <tr style={{ borderBottom: '1px solid #fef3c7', background: '#ffffff' }}>
                    <td style={{ padding: '8px 16px', color: '#374151' }}>Origination Fee</td>
                    <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 600, color: '#111827' }}>{fmtCurrency(parsedParams.originationFee)}</td>
                  </tr>
                )}
                <tr style={{ background: '#fffbeb' }}>
                  <td style={{ padding: '9px 16px', fontWeight: 700, color: '#92400e' }}>Total Fees</td>
                  <td style={{ padding: '9px 16px', textAlign: 'right', fontWeight: 800, color: '#92400e' }}>
                    {fmtCurrency((parsedParams.establishmentFee ?? 0) + (parsedParams.ppsrFee ?? 0) + (parsedParams.originationFee ?? 0))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* ── Fee & Rate Summary (broker internal only) ────────── */}
        {parsedParams && !isClientView && (
          <div style={{ marginTop: '20px', borderRadius: '10px', overflow: 'hidden', border: '1px solid #bfdbfe' }} className="break-inside-avoid">
            <div style={{ background: '#eff6ff', padding: '10px 16px', borderBottom: '1px solid #bfdbfe' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#1e40af', letterSpacing: '0.05em', textTransform: 'uppercase' as const }}>Fee &amp; Rate Summary — Internal</div>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11.5px' }}>
              <tbody>
                {parsedParams.establishmentFee != null && (
                  <tr style={{ borderBottom: '1px solid #e0ecff', background: '#ffffff' }}>
                    <td style={{ padding: '7px 16px', color: '#4b5563' }}>Loan Establishment Fee</td>
                    <td style={{ padding: '7px 16px', textAlign: 'right', fontWeight: 600, color: '#111827' }}>{fmtCurrency(parsedParams.establishmentFee)}</td>
                  </tr>
                )}
                {parsedParams.ppsrFee != null && (
                  <tr style={{ borderBottom: '1px solid #e0ecff', background: '#f8fafc' }}>
                    <td style={{ padding: '7px 16px', color: '#4b5563' }}>PPSR</td>
                    <td style={{ padding: '7px 16px', textAlign: 'right', fontWeight: 600, color: '#111827' }}>{fmtCurrency(parsedParams.ppsrFee)}</td>
                  </tr>
                )}
                {parsedParams.originationFee != null && (
                  <tr style={{ borderBottom: '1px solid #e0ecff', background: '#ffffff' }}>
                    <td style={{ padding: '7px 16px', color: '#4b5563' }}>Origination Fee</td>
                    <td style={{ padding: '7px 16px', textAlign: 'right', fontWeight: 600, color: '#111827' }}>{fmtCurrency(parsedParams.originationFee)}</td>
                  </tr>
                )}
                {parsedParams.interestRate != null && (
                  <tr style={{ borderBottom: '1px solid #e0ecff', background: '#f8fafc' }}>
                    <td style={{ padding: '7px 16px', color: '#4b5563' }}>Lender's Rate</td>
                    <td style={{ padding: '7px 16px', textAlign: 'right', fontWeight: 600, color: '#111827' }}>{fmtPercent(parsedParams.interestRate)}</td>
                  </tr>
                )}
                {parsedParams.brokeragePercent != null && (
                  <tr style={{ borderBottom: '1px solid #e0ecff', background: '#ffffff' }}>
                    <td style={{ padding: '7px 16px', color: '#4b5563' }}>Brokerage %</td>
                    <td style={{ padding: '7px 16px', textAlign: 'right', fontWeight: 600, color: '#111827' }}>{Number(parsedParams.brokeragePercent).toFixed(2)}%</td>
                  </tr>
                )}
                {options[0]?.brokerage != null && (
                  <tr style={{ background: '#eff6ff' }}>
                    <td style={{ padding: '9px 16px', fontWeight: 700, color: '#1e40af' }}>Brokerage $</td>
                    <td style={{ padding: '9px 16px', textAlign: 'right', fontWeight: 800, color: '#1d4ed8' }}>{fmtCurrency(options[0].brokerage)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Why Choose Us ───────────────────────────────────── */}
        {isClientView && (
          <div style={{ marginTop: '32px' }} className="break-inside-avoid">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
              <div style={{ fontSize: '12px', fontWeight: 800, color: '#1d4ed8', letterSpacing: '0.08em', textTransform: 'uppercase' as const, whiteSpace: 'nowrap' }}>Why Choose Us</div>
              <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              {whyItems.map((text, i) => (
                <div key={i} style={{ flex: 1, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px', borderTop: '3px solid #2563eb' }}>
                  <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#2563eb', color: '#ffffff', fontSize: '12px', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '8px' }}>
                    {i + 1}
                  </div>
                  <div style={{ fontSize: '11px', color: '#374151', lineHeight: 1.65 }}>{text}</div>
                </div>
              ))}
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
              <TermBlock key={group.termYears} group={group} isClientView={isClientView} assetDescription={assetDescription} paymentType={paymentType} />
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
            <Row label="Brokerage %" value={`${Number(parsedParams.brokeragePercent).toFixed(2)}%`} />
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
