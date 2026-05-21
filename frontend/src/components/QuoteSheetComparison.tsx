import type { CSSProperties } from 'react';
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
function TermBlock({ group, isClientView, showInterestRate, assetDescription, paymentType }: { group: TermGroup; isClientView: boolean; showInterestRate: boolean; assetDescription: string; paymentType: string }) {
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
          {allUpRate != null && (!isClientView || showInterestRate) && (
            <Row label={isClientView ? 'Interest Rate' : 'All Up Interest Rate'} value={fmtPercent(allUpRate)} />
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
      repaymentRange: (params.repayment_range as number | undefined) ?? null,
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
  const showInterestRate = parsedParams?.showInterestRate ?? false;

  // Filter terms for client view / PDF if selected_terms is set
  const termGroups = (isClientView || isPdfExport) && selectedTerms
    ? allTermGroups.filter(g => selectedTerms.includes(g.termYears))
    : allTermGroups;

  // Split into rows of 2 for the grid
  const rows: TermGroup[][] = [];
  for (let i = 0; i < termGroups.length; i += 2) {
    rows.push(termGroups.slice(i, i + 2));
  }

  // ── PDF Export Layout (Design Language v1) ──────────────────────────
  if (isPdfExport) {
    // Design tokens — all hex, no oklch/oklab (html2canvas compat)
    const ink = '#0F1E3D';
    const ink2 = '#2A3956';
    const muted = '#6B7385';
    const hairline = '#E4DFD3';
    const hairline2 = '#EFEAE0';
    const paper = '#FBFAF6';
    const paper2 = '#F3EFE6';
    const accent = '#A8743A';
    const hilight = '#FDF5E6';
    const serif = "'Instrument Serif', Georgia, serif";
    const sans = "'Geist', ui-sans-serif, system-ui, sans-serif";
    const mono = "'Geist Mono', 'JetBrains Mono', ui-monospace, monospace";

    const first = options[0];
    const clientLoanAmt0 = (first.purchase_price ?? 0) - (first.deposit ?? 0)
      + (first.establishment_fee ?? 0) + (first.application_fee ?? 0);

    // Primary option per group: no-balloon preferred
    const prim = (g: TermGroup): QuoteOption => (g.noBalloon ?? g.withBalloon)!;

    // Client interest rate or computed all-up rate
    const rate = (opt: QuoteOption) => opt.client_interest_rate ?? computeAllUpRate(opt, paymentType);

    // Recommended column: use is_recommended flag if set on any option
    const recommendedYears: number | null = (() => {
      for (const g of termGroups) {
        if (prim(g).is_recommended) return g.termYears;
      }
      return null;
    })();

    const hasDualBalloon = termGroups.some(g => g.noBalloon && g.withBalloon);
    const hasAnyBalloon  = options.some(o => (o.balloon_residual ?? 0) > 0);

    // Featured group for breakdown strip: prefer 5yr, else first
    const featured = termGroups.find(g => g.termYears === 5) ?? termGroups[0];
    const featOpt = prim(featured);
    const featClientAmt = (featOpt.purchase_price ?? 0) - (featOpt.deposit ?? 0)
      + (featOpt.establishment_fee ?? 0) + (featOpt.application_fee ?? 0);

    // Split a currency amount into dollar string and cents string
    const splitAmt = (v: number | null): [string, string] => {
      if (v == null) return ['—', ''];
      const s = Math.abs(v).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const dot = s.lastIndexOf('.');
      return [`$${s.slice(0, dot)}`, s.slice(dot)];
    };

    // Repayment range delta (broker-configured ±$ shown to client)
    const rangeDelta = isClientView ? (parsedParams?.repaymentRange ?? null) : null;

    // Format a repayment for client view: range if delta set, else exact split
    const fmtRepaymentClient = (v: number | null): { lo: string; hi: string } | null => {
      if (v == null || rangeDelta == null) return null;
      const lo = Math.max(0, v - rangeDelta);
      const hi = v + rangeDelta;
      const fmt = (n: number) => `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      return { lo: fmt(lo), hi: fmt(hi) };
    };

    const today = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
    const colBg = (g: TermGroup): string => g.termYears === recommendedYears ? hilight : 'transparent';

    // Shared td styles for the comparison matrix
    const lbl: CSSProperties = {
      textAlign: 'left',
      fontFamily: mono,
      fontSize: '10px',
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      color: muted,
      padding: '9px 10px 9px 0',
      borderBottom: `1px solid ${hairline2}`,
      verticalAlign: 'baseline',
    };
    const val: CSSProperties = {
      textAlign: 'right',
      padding: '9px 10px',
      borderBottom: `1px solid ${hairline2}`,
      fontSize: '11.5px',
      color: ink,
      verticalAlign: 'baseline',
      fontVariantNumeric: 'tabular-nums',
    };
    const sublbl: CSSProperties = {
      textAlign: 'left',
      fontFamily: serif,
      fontStyle: 'italic',
      fontSize: '11px',
      color: muted,
      padding: '4px 0 4px 16px',
      borderBottom: 'none',
      verticalAlign: 'baseline',
    };
    const subval: CSSProperties = {
      textAlign: 'right',
      padding: '4px 10px',
      fontSize: '10.5px',
      color: muted,
      borderBottom: 'none',
      verticalAlign: 'baseline',
      fontVariantNumeric: 'tabular-nums',
    };

    return (
      <div id={`quote-sheet-${quoteSheet.id}`} style={{
        width: '794px',
        minHeight: '1123px',
        background: paper,
        padding: '56px 56px 80px',
        color: ink,
        fontFamily: sans,
        fontSize: '11.5px',
        lineHeight: '1.5',
        fontVariantNumeric: 'tabular-nums',
        position: 'relative',
        boxSizing: 'border-box',
      }}>

        {/* ── HEADER ──────────────────────────────────────────── */}
        <header style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          paddingBottom: '18px', borderBottom: `1px solid ${ink}`, marginBottom: '32px',
        }}>
          <img src="/xpress-light.svg" alt="Xpress Finance" style={{ height: '72px', objectFit: 'contain' }} />
          <div style={{
            display: 'grid', gridTemplateColumns: 'auto auto',
            columnGap: '20px', rowGap: '3px',
            fontFamily: mono, fontSize: '10px', color: muted,
            textAlign: 'right', letterSpacing: '0.02em',
          }}>
            {applicationRef && <>
              <span>Reference</span>
              <b style={{ color: ink, fontWeight: 500 }}>{applicationRef}</b>
            </>}
            <span>Issued</span>
            <b style={{ color: ink, fontWeight: 500 }}>{today}</b>
          </div>
        </header>

        {/* ── HERO ────────────────────────────────────────────── */}
        <div style={{
          marginBottom: '28px',
          display: 'grid',
          gridTemplateColumns: clientName ? '1fr auto' : '1fr',
          alignItems: 'end', gap: '24px',
        }}>
          <div>
            <div style={{
              fontFamily: mono, fontSize: '10px', letterSpacing: '0.16em',
              textTransform: 'uppercase', color: muted, marginBottom: '12px',
            }}>
              Indicative Finance Quote{assetDescription !== 'Asset' ? ` · ${assetDescription}` : ''}
            </div>
            <h1 style={{
              fontFamily: serif, fontWeight: 400, fontSize: '48px',
              lineHeight: 0.95, letterSpacing: '-0.02em', margin: 0, color: ink,
            }}>
              Finance <em style={{ fontStyle: 'italic' }}>Quote</em>
            </h1>
            {quoteSheet.title && (
              <div style={{ fontFamily: serif, fontStyle: 'italic', fontSize: '13px', color: ink2, marginTop: '8px' }}>
                {quoteSheet.title}
              </div>
            )}
          </div>
          {clientName && (
            <div style={{ textAlign: 'right', fontFamily: mono, fontSize: '10.5px', color: muted, letterSpacing: '0.02em' }}>
              <b style={{ display: 'block', fontFamily: sans, color: ink, fontWeight: 500, fontSize: '14px', letterSpacing: '0', marginBottom: '2px' }}>
                {clientName}
              </b>
              Prepared for
            </div>
          )}
        </div>

        {/* ── ASSET STRIP ─────────────────────────────────────── */}
        <div style={{
          marginBottom: '28px', padding: '14px 16px', background: paper2,
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px',
        }}>
          {([
            { label: 'Asset', value: assetDescription !== 'Asset' ? assetDescription : '—' },
            { label: 'Drive-away price', value: fmtCurrency(first.purchase_price) },
            { label: 'Deposit', value: fmtCurrency(first.deposit) },
            { label: 'Amount financed', value: isClientView ? fmtCurrency(clientLoanAmt0) : fmtCurrency(first.loan_amount) },
          ] as { label: string; value: string }[]).map(({ label, value }) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontFamily: mono, fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: muted }}>
                {label}
              </span>
              <span style={{ fontFamily: sans, fontSize: '13px', fontWeight: 500, color: ink, fontVariantNumeric: 'tabular-nums' }}>
                {value}
              </span>
            </div>
          ))}
        </div>

        {/* ── SECTION HEADING ─────────────────────────────────── */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          marginBottom: '14px', paddingBottom: '8px', borderBottom: `1px solid ${hairline}`,
        }}>
          <h3 style={{ fontFamily: serif, fontWeight: 400, fontStyle: 'italic', fontSize: '18px', margin: 0, color: ink }}>
            Scenarios <em style={{ fontStyle: 'italic' }}>at a glance</em>
          </h3>
          <span style={{ fontFamily: mono, fontSize: '10px', color: muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {termGroups.length} term{termGroups.length !== 1 ? 's' : ''} · AUD
          </span>
        </div>

        {/* ── COMPARISON MATRIX ───────────────────────────────── */}
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr>
              <th style={{ ...lbl, borderBottom: 'none', width: '130px' }}>&nbsp;</th>
              {termGroups.map(g => (
                <th key={g.termYears} style={{
                  textAlign: 'right', padding: '0 10px 4px',
                  fontFamily: sans, fontWeight: 500, fontSize: '12px', color: ink,
                  background: colBg(g), borderBottom: 'none',
                }}>
                  {g.termYears === recommendedYears && (
                    <span style={{ display: 'block', fontFamily: mono, fontSize: '8px', color: accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: '4px' }}>
                      Recommended
                    </span>
                  )}
                  {g.termYears} yr
                  <span style={{ display: 'block', fontFamily: mono, fontSize: '9.5px', color: muted, fontWeight: 400, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: '4px' }}>
                    {g.termMonths} months
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Hero row: monthly repayment */}
            <tr>
              <td style={{
                ...lbl,
                borderTop: `1px solid ${ink}`, borderBottom: `1px solid ${ink}`,
                padding: '18px 10px 18px 0',
                fontFamily: serif, fontStyle: 'italic', fontSize: '12px',
                textTransform: 'none', letterSpacing: '0', color: ink,
              }}>
                Monthly <em>repayment</em>
              </td>
              {termGroups.map(g => {
                const rng = fmtRepaymentClient(prim(g).repayment_monthly);
                const [dol, cts] = splitAmt(prim(g).repayment_monthly);
                return (
                  <td key={g.termYears} style={{
                    textAlign: 'right', padding: '18px 10px',
                    borderTop: `1px solid ${ink}`, borderBottom: `1px solid ${ink}`,
                    background: colBg(g), verticalAlign: 'baseline',
                  }}>
                    {rng ? (
                      <span style={{ fontFamily: sans, fontWeight: 500, fontSize: '18px', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                        {rng.lo} – {rng.hi}
                        <small style={{ display: 'block', fontFamily: mono, fontSize: '9px', fontWeight: 400, color: muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: '3px' }}>
                          per month
                        </small>
                      </span>
                    ) : (
                      <span style={{ fontFamily: sans, fontWeight: 500, fontSize: '24px', letterSpacing: '-0.02em', lineHeight: 1 }}>
                        {dol}<small style={{ fontSize: '11px', fontWeight: 400, color: muted, marginLeft: '1px' }}>{cts}</small>
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>

            {/* Sub-row: with-balloon repayment */}
            {hasDualBalloon && (
              <tr>
                <td style={sublbl}>↳ with balloon</td>
                {termGroups.map(g => {
                  const hasBoth = !!(g.noBalloon && g.withBalloon);
                  if (!hasBoth) return <td key={g.termYears} style={{ ...subval, background: colBg(g) }}>—</td>;
                  const rng = fmtRepaymentClient(g.withBalloon!.repayment_monthly);
                  const [dol, cts] = splitAmt(g.withBalloon!.repayment_monthly);
                  return (
                    <td key={g.termYears} style={{ ...subval, background: colBg(g) }}>
                      {rng
                        ? <>{rng.lo} – {rng.hi}</>
                        : <>{dol}<small style={{ fontSize: '9px', color: muted }}>{cts}</small></>}
                    </td>
                  );
                })}
              </tr>
            )}

            {/* Weekly equivalent */}
            <tr>
              <td style={lbl}>Weekly equivalent</td>
              {termGroups.map(g => (
                <td key={g.termYears} style={{ ...val, background: colBg(g) }}>
                  {fmtCurrency(prim(g).repayment_weekly)}
                </td>
              ))}
            </tr>
            {hasDualBalloon && (
              <tr>
                <td style={sublbl}>↳ with balloon</td>
                {termGroups.map(g => (
                  <td key={g.termYears} style={{ ...subval, background: colBg(g) }}>
                    {g.noBalloon && g.withBalloon ? fmtCurrency(g.withBalloon.repayment_weekly) : '—'}
                  </td>
                ))}
              </tr>
            )}

            {/* Interest rate */}
            {termGroups.some(g => rate(prim(g)) != null) && (!isClientView || showInterestRate) && (
              <>
                <tr>
                  <td style={lbl}>Interest rate</td>
                  {termGroups.map(g => (
                    <td key={g.termYears} style={{ ...val, background: colBg(g) }}>
                      {fmtPercent(rate(prim(g)))}
                    </td>
                  ))}
                </tr>
                {hasDualBalloon && (
                  <tr>
                    <td style={sublbl}>↳ with balloon</td>
                    {termGroups.map(g => (
                      <td key={g.termYears} style={{ ...subval, background: colBg(g) }}>
                        {g.noBalloon && g.withBalloon ? fmtPercent(rate(g.withBalloon)) : '—'}
                      </td>
                    ))}
                  </tr>
                )}
              </>
            )}

            {/* Balloon payment */}
            {hasAnyBalloon && (
              <>
                <tr>
                  <td style={lbl}>Balloon</td>
                  {termGroups.map(g => (
                    <td key={g.termYears} style={{ ...val, background: colBg(g) }}>
                      {fmtCurrency(prim(g).balloon_residual ?? 0)}
                    </td>
                  ))}
                </tr>
                {hasDualBalloon && (
                  <tr>
                    <td style={sublbl}>↳ with balloon</td>
                    {termGroups.map(g => (
                      <td key={g.termYears} style={{ ...subval, background: colBg(g) }}>
                        {g.noBalloon && g.withBalloon ? fmtCurrency(g.withBalloon.balloon_residual ?? 0) : '—'}
                      </td>
                    ))}
                  </tr>
                )}
              </>
            )}

            {/* Rate of interest — broker only */}
            {!isClientView && (
              <>
                <tr>
                  <td style={lbl}>Rate of interest</td>
                  {termGroups.map(g => (
                    <td key={g.termYears} style={{ ...val, background: colBg(g) }}>
                      {fmtPercent(prim(g).interest_rate)}
                    </td>
                  ))}
                </tr>
                {hasDualBalloon && (
                  <tr>
                    <td style={sublbl}>↳ with balloon</td>
                    {termGroups.map(g => (
                      <td key={g.termYears} style={{ ...subval, background: colBg(g) }}>
                        {g.noBalloon && g.withBalloon ? fmtPercent(g.withBalloon.interest_rate) : '—'}
                      </td>
                    ))}
                  </tr>
                )}
              </>
            )}

            {/* Total interest — broker only */}
            {!isClientView && (
              <>
                <tr>
                  <td style={{ ...lbl, fontFamily: sans, fontWeight: 500, color: ink2, textTransform: 'none', letterSpacing: '0', paddingTop: '14px' }}>
                    Total interest
                  </td>
                  {termGroups.map(g => (
                    <td key={g.termYears} style={{ ...val, fontFamily: sans, fontWeight: 500, color: ink2, paddingTop: '14px', background: colBg(g) }}>
                      {fmtCurrency(prim(g).total_interest)}
                    </td>
                  ))}
                </tr>
                {hasDualBalloon && (
                  <tr>
                    <td style={{ ...sublbl, paddingTop: '2px' }}>↳ with balloon</td>
                    {termGroups.map(g => (
                      <td key={g.termYears} style={{ ...subval, background: colBg(g) }}>
                        {g.noBalloon && g.withBalloon ? fmtCurrency(g.withBalloon.total_interest) : '—'}
                      </td>
                    ))}
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>

        {/* ── BREAKDOWN STRIP ─────────────────────────────────── */}
        <div style={{
          marginTop: '24px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '24px', padding: '18px 0',
          borderTop: `1px solid ${hairline}`, borderBottom: `1px solid ${hairline}`,
        }}>
          {([
            {
              label: isClientView ? 'Amount financed' : 'Principal financed',
              value: fmtCurrency(isClientView ? featClientAmt : featOpt.loan_amount),
              sub: `${featured.termYears} year term`,
            },
            isClientView
              ? (() => {
                  const rng = fmtRepaymentClient(featOpt.repayment_monthly);
                  return rng
                    ? { label: 'Monthly repayment', value: `${rng.lo} – ${rng.hi}`, sub: 'per month' }
                    : { label: 'Monthly repayment', value: fmtCurrency(featOpt.repayment_monthly), sub: 'per month' };
                })()
              : { label: 'Interest paid over term', value: fmtCurrency(featOpt.total_interest), sub: rate(featOpt) != null ? `Effective rate ${fmtPercent(rate(featOpt))} p.a.` : '' },
            (() => {
              const balloonOpt = featured.withBalloon ?? (featOpt.balloon_residual ? featOpt : null);
              const balloonAmt = balloonOpt?.balloon_residual ?? 0;
              return balloonAmt > 0
                ? { label: `Balloon at month ${balloonOpt?.loan_term_months ?? featured.termMonths}`, value: fmtCurrency(balloonAmt), sub: 'refinanceable' }
                : { label: 'Weekly equivalent', value: fmtCurrency(featOpt.repayment_weekly), sub: 'per week' };
            })(),
          ] as { label: string; value: string; sub: string }[]).map(({ label, value, sub }) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontFamily: mono, fontSize: '9.5px', letterSpacing: '0.12em', textTransform: 'uppercase', color: muted }}>
                {label}
              </span>
              <span style={{ fontFamily: sans, fontSize: '18px', fontWeight: 500, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em', color: ink }}>
                {value}
              </span>
              {sub && <span style={{ fontFamily: mono, fontSize: '10px', color: muted }}>{sub}</span>}
            </div>
          ))}
        </div>

        {/* ── NON-FINANCED FEES ───────────────────────────────── */}
        {!feesFinanced && parsedParams && (
          <div style={{ marginTop: '24px' }} className="break-inside-avoid">
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              marginBottom: '10px', paddingBottom: '8px', borderBottom: `1px solid ${hairline}`,
            }}>
              <h3 style={{ fontFamily: serif, fontWeight: 400, fontStyle: 'italic', fontSize: '16px', margin: 0, color: ink }}>
                Fees payable — <em>not financed</em>
              </h3>
              <span style={{ fontFamily: mono, fontSize: '10px', color: muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Charged separately
              </span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' as const }}>
              <colgroup><col style={{ width: '70%' }} /><col style={{ width: '30%' }} /></colgroup>
              <tbody>
                {parsedParams.establishmentFee != null && parsedParams.establishmentFee > 0 && (
                  <tr><td style={lbl}>Loan establishment fee</td><td style={val}>{fmtCurrency(parsedParams.establishmentFee)}</td></tr>
                )}
                {parsedParams.ppsrFee != null && parsedParams.ppsrFee > 0 && (
                  <tr><td style={lbl}>PPSR</td><td style={val}>{fmtCurrency(parsedParams.ppsrFee)}</td></tr>
                )}
                {parsedParams.originationFee != null && parsedParams.originationFee > 0 && (
                  <tr><td style={lbl}>Origination fee</td><td style={val}>{fmtCurrency(parsedParams.originationFee)}</td></tr>
                )}
                <tr>
                  <td style={{ ...lbl, fontFamily: sans, fontWeight: 500, color: ink, textTransform: 'none', letterSpacing: '0', borderBottom: 'none', paddingTop: '12px' }}>
                    Total fees
                  </td>
                  <td style={{ ...val, fontFamily: sans, fontWeight: 500, color: ink, borderBottom: 'none', paddingTop: '12px' }}>
                    {fmtCurrency((parsedParams.establishmentFee ?? 0) + (parsedParams.ppsrFee ?? 0) + (parsedParams.originationFee ?? 0))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* ── FEE & RATE SUMMARY — broker internal ────────────── */}
        {parsedParams && !isClientView && (
          <div style={{ marginTop: '24px' }} className="break-inside-avoid">
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              marginBottom: '10px', paddingBottom: '8px', borderBottom: `1px solid ${hairline}`,
            }}>
              <h3 style={{ fontFamily: serif, fontWeight: 400, fontStyle: 'italic', fontSize: '16px', margin: 0, color: ink }}>
                Fee &amp; rate summary
              </h3>
              <span style={{ fontFamily: mono, fontSize: '10px', color: muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Internal
              </span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' as const }}>
              <colgroup><col style={{ width: '70%' }} /><col style={{ width: '30%' }} /></colgroup>
              <tbody>
                {parsedParams.establishmentFee != null && (
                  <tr><td style={lbl}>Loan establishment fee</td><td style={val}>{fmtCurrency(parsedParams.establishmentFee)}</td></tr>
                )}
                {parsedParams.ppsrFee != null && (
                  <tr><td style={lbl}>PPSR</td><td style={val}>{fmtCurrency(parsedParams.ppsrFee)}</td></tr>
                )}
                {parsedParams.originationFee != null && (
                  <tr><td style={lbl}>Origination fee</td><td style={val}>{fmtCurrency(parsedParams.originationFee)}</td></tr>
                )}
                {parsedParams.interestRate != null && (
                  <tr><td style={lbl}>Lender's rate</td><td style={val}>{fmtPercent(parsedParams.interestRate)}</td></tr>
                )}
                {parsedParams.brokeragePercent != null && (
                  <tr><td style={lbl}>Brokerage %</td><td style={val}>{Number(parsedParams.brokeragePercent).toFixed(2)}%</td></tr>
                )}
                {options[0]?.brokerage != null && (
                  <tr>
                    <td style={{ ...lbl, fontFamily: sans, fontWeight: 500, color: ink, textTransform: 'none', letterSpacing: '0', borderBottom: 'none', paddingTop: '12px' }}>
                      Brokerage $
                    </td>
                    <td style={{ ...val, fontFamily: sans, fontWeight: 500, color: ink, borderBottom: 'none', paddingTop: '12px' }}>
                      {fmtCurrency(options[0].brokerage)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── FOOTER ──────────────────────────────────────────── */}
        <footer style={{
          marginTop: '40px', paddingTop: '14px',
          borderTop: `1px solid ${hairline}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
          fontFamily: mono, fontSize: '9.5px', letterSpacing: '0.04em', color: muted,
        }}>
          <p style={{ margin: 0, fontFamily: sans, fontStyle: 'italic', color: muted, fontSize: '10px', maxWidth: '56ch', lineHeight: 1.5 }}>
            This quote is indicative only and subject to full credit assessment and lender approval. Rates and fees may vary. Xpress Finance Group · ACL 000000 · 727 Collins St, Docklands VIC 3008 · (03) 8456 7996.
          </p>
          <span style={{ letterSpacing: '0.16em' }}>1 / 1</span>
        </footer>

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
              <TermBlock key={group.termYears} group={group} isClientView={isClientView} showInterestRate={showInterestRate} assetDescription={assetDescription} paymentType={paymentType} />
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
