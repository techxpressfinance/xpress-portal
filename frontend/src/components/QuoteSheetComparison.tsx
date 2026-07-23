import type { CSSProperties, ReactNode } from 'react';
import type { QuoteSheet, QuoteOption } from '../types';

interface QuoteSheetComparisonProps {
  quoteSheet: QuoteSheet;
  showBrokerNotes?: boolean;
  isClientView?: boolean;
  isPdfExport?: boolean;
  clientName?: string;
  applicationRef?: string;
}

// Currency with the decimal part rendered smaller than the whole dollars.
// em-based so it scales with the surrounding cell's font size.
function Money({ v }: { v: number | null }) {
  if (v === null || v === undefined) return <>—</>;
  const s = v.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dot = s.lastIndexOf('.');
  return (
    <>
      {`$${s.slice(0, dot)}`}
      <span style={{ fontSize: '0.75em', fontWeight: 400 }}>{s.slice(dot)}</span>
    </>
  );
}

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

// Per-term highlight accents — each term's figures are coloured, cycling
// through orange, blue, green, purple, red.
const TERM_ACCENTS = [
  { accent: '#ea580c' }, // orange
  { accent: '#2563eb' }, // blue
  { accent: '#16a34a' }, // green
  { accent: '#9333ea' }, // purple
  { accent: '#dc2626' }, // red
];

// ── On-screen term block ────────────────────────────────────────────
function TermBlock({ group, accent, isClientView, showInterestRate, showTotalInterest, showWeekly, assetDescription, paymentType }: { group: TermGroup; accent: string; isClientView: boolean; showInterestRate: boolean; showTotalInterest: boolean; showWeekly: boolean; assetDescription: string; paymentType: string }) {
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
          <Row label={`${assetDescription} price`} value={<Money v={opt.purchase_price} />} color={accent} />
          <Row label="Deposit" value={<Money v={opt.deposit} />} color={accent} />
          <Row
            label="Amount to be Financed"
            value={<Money v={isClientView ? clientLoanAmount : opt.loan_amount} />}
            color={accent}
          />
          <Row label="Term (years)" value={String(termYears)} color={accent} />
          <Row
            label={(opt.balloon_residual ?? 0) > 0 ? balloonLabel : 'Balloon'}
            value={<Money v={opt.balloon_residual ?? 0} />}
            color={accent}
          />
          <Row label="Repayments (month)" value={<Money v={opt.repayment_monthly} />} bold color={accent} />
          {!isClientView && (
            <Row label="Rate of Interest" value={fmtPercent(opt.interest_rate)} color={accent} />
          )}
          {allUpRate != null && (!isClientView || showInterestRate) && (
            <Row label={isClientView ? 'Interest Rate' : 'All Up Interest Rate'} value={fmtPercent(allUpRate)} color={accent} />
          )}
          {showWeekly && (
            <Row label="Weekly Equivalent" value={<Money v={opt.repayment_weekly} />} color={accent} />
          )}
          {(!isClientView || showTotalInterest) && (
            <Row label="Total Interest (over term)" value={<Money v={opt.total_interest} />} bold color={accent} />
          )}

        </div>
      </div>
    );
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card">
      <div className="bg-muted/40 px-4 py-2 border-b border-border">
        <h4 className="text-sm font-semibold text-foreground">{termYears} Year Term</h4>
      </div>
      <div className={`grid ${hasTwo ? 'grid-cols-1 divide-y sm:grid-cols-2 sm:divide-y-0 sm:divide-x divide-border' : 'grid-cols-1'}`}>
        {noBalloon && (
          <div className="p-4">
            {hasTwo && <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3 pb-2 border-b border-border">No Balloon</p>}
            {renderColumn(noBalloon)}
          </div>
        )}
        {withBalloon && (
          <div className="p-4 bg-muted/20">
            {hasTwo && <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3 pb-2 border-b border-border">With Balloon</p>}
            {renderColumn(withBalloon)}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, bold, color }: { label: string; value: ReactNode; bold?: boolean; color?: string }) {
  return (
    <div className="flex w-full items-start justify-between py-1.5 border-b border-border/30 last:border-0">
      <div className={`text-[12px] leading-tight w-[60%] pr-2 break-words ${bold ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>{label}</div>
      <div
        className={`text-[12.5px] tabular-nums whitespace-nowrap text-right w-[40%] pl-2 ${bold ? 'font-semibold' : 'font-medium'} ${color ? '' : 'text-foreground'}`}
        style={color ? { color } : undefined}
      >{value}</div>
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
      showTotalInterest: (params.show_total_interest as boolean | undefined) ?? true,
      showWeekly: (params.show_weekly as boolean | undefined) ?? true,
      repaymentRange: (params.repayment_range as number | undefined) ?? null,
      showPreferredOption: (params.show_preferred_option as boolean | undefined) ?? false,
      preferredTerm: (params.preferred_term as number | undefined) ?? null,
      preferredBalloon: (params.preferred_balloon as boolean | undefined) ?? false,
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
  const showTotalInterest = parsedParams?.showTotalInterest ?? true;
  const showWeekly = parsedParams?.showWeekly ?? true;
  const showPreferredOption = parsedParams?.showPreferredOption ?? false;
  const preferredTerm = parsedParams?.preferredTerm ?? null;
  const preferredBalloon = parsedParams?.preferredBalloon ?? false;

  // Filter terms for client view / PDF if selected_terms is set
  const termGroups = (isClientView || isPdfExport) && selectedTerms
    ? allTermGroups.filter(g => selectedTerms.includes(g.termYears))
    : allTermGroups;

  // Split into rows of 2 for the grid
  const rows: TermGroup[][] = [];
  for (let i = 0; i < termGroups.length; i += 2) {
    rows.push(termGroups.slice(i, i + 2));
  }

  // ── PDF Export Layout (Professional Finance Styling) ────────────────
  if (isPdfExport) {
    // Professional palette — all hex for html2canvas compat
    const ink = '#1a1a2e';
    const inkLight = '#3a3a4e';
    const muted = '#6b7280';
    const hairline = '#d1d5db';
    const hairlineLight = '#e5e7eb';
    const paper = '#ffffff';
    const subtleBg = '#f8f9fa';
    const gold = '#c8962e';      // brand gold
    const navy = '#0d1f3c';      // brand navy
    const sans = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
    // Instrument Serif (loaded app-wide via index.html) stands in for the
    // approved design's Spectral; Georgia is the html2canvas-safe fallback.
    const serif = "'Instrument Serif', Georgia, 'Times New Roman', serif";

    const first = options[0];
    const clientLoanAmt0 = (first.purchase_price ?? 0) - (first.deposit ?? 0)
      + (first.establishment_fee ?? 0) + (first.application_fee ?? 0);

    // Primary option per group: no-balloon preferred
    const prim = (g: TermGroup): QuoteOption => (g.noBalloon ?? g.withBalloon)!;

    // Client interest rate or computed all-up rate
    const rate = (opt: QuoteOption) => opt.client_interest_rate ?? computeAllUpRate(opt, paymentType);

    // Recommended column: use is_recommended flag if set on any option
    // Preferred option (broker-selected term + balloon choice). Only surfaced
    // when the toggle is on and the chosen term is among the shown terms.
    const preferredGroup = showPreferredOption && preferredTerm != null
      ? termGroups.find(g => g.termYears === preferredTerm) ?? null
      : null;
    const preferredOpt: QuoteOption | null = preferredGroup
      ? (preferredBalloon
          ? (preferredGroup.withBalloon ?? preferredGroup.noBalloon)
          : (preferredGroup.noBalloon ?? preferredGroup.withBalloon))
      : null;

    // The preferred term takes precedence over any is_recommended flag.
    const recommendedYears: number | null = (() => {
      if (preferredGroup) return preferredGroup.termYears;
      for (const g of termGroups) {
        if (prim(g).is_recommended) return g.termYears;
      }
      return null;
    })();

    // Repayment range delta (broker-configured ±$ shown to client)
    const rangeDelta = isClientView ? (parsedParams?.repaymentRange ?? null) : null;

    // Repayment range for client view when a delta is set, else null (exact amount shown)
    const fmtRepaymentClient = (v: number | null): { lo: number; hi: number } | null => {
      if (v == null || rangeDelta == null) return null;
      return { lo: Math.max(0, v - rangeDelta), hi: v + rangeDelta };
    };

    // Long-form date for the hero ("23 June 2026")
    const quoteDate = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
    // Scenario count must match the terms actually shown (client/PDF views can
    // filter to the broker-selected terms) — not the sheet's full option list.
    const shownOptionCount = termGroups.reduce(
      (n, g) => n + (g.noBalloon ? 1 : 0) + (g.withBalloon ? 1 : 0), 0,
    );
    // Hero summary strip cells (CLIENT shown only when a recipient name exists)
    const summaryCells: { label: string; value: ReactNode; gold?: boolean; wide?: boolean }[] = [
      ...(clientName ? [{ label: 'Client', value: clientName, wide: true }] : []),
      { label: 'Asset', value: assetDescription !== 'Asset' ? assetDescription : '—', wide: true },
      { label: 'Drive-away price', value: <Money v={first.purchase_price} /> },
      { label: 'Deposit', value: <Money v={first.deposit} /> },
      { label: 'Amount financed', value: <Money v={isClientView ? clientLoanAmt0 : first.loan_amount} />, gold: true },
      { label: 'Scenarios', value: `${shownOptionCount} Option${shownOptionCount !== 1 ? 's' : ''}` },
    ];

    // Shared table cell styles
    const lbl: CSSProperties = {
      textAlign: 'left',
      fontFamily: sans,
      fontSize: '10px',
      fontWeight: 500,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      color: muted,
      padding: '8px 12px',
      borderBottom: `1px solid ${hairlineLight}`,
      verticalAlign: 'middle',
    };
    const val: CSSProperties = {
      textAlign: 'right',
      padding: '8px 12px',
      borderBottom: `1px solid ${hairlineLight}`,
      fontSize: '11px',
      color: ink,
      verticalAlign: 'middle',
      fontVariantNumeric: 'tabular-nums',
    };
    // Term-block cell styles (Excel-style side-by-side tables)
    const blkLbl: CSSProperties = {
      textAlign: 'left',
      fontFamily: sans,
      fontSize: '9.5px',
      fontWeight: 500,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      color: muted,
      padding: '7px 10px',
      borderBottom: `1px solid ${hairlineLight}`,
      verticalAlign: 'middle',
    };
    const blkVal: CSSProperties = {
      textAlign: 'right',
      padding: '7px 10px',
      borderBottom: `1px solid ${hairlineLight}`,
      fontSize: '10.5px',
      fontWeight: 500,
      color: ink,
      verticalAlign: 'middle',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap' as const,
    };

    // 794px = 210mm at 96dpi. The PDF export adds 10mm top/bottom page margins,
    // so the printable page height is ~1047px — minHeight must stay below that
    // or a one-page sheet spills onto a blank second page.
    return (
      <div id={`quote-sheet-${quoteSheet.id}`} style={{
        width: '794px',
        minHeight: '1040px',
        background: paper,
        padding: '12px 56px 26px',
        color: ink,
        fontFamily: sans,
        fontSize: '11px',
        lineHeight: '1.45',
        fontVariantNumeric: 'tabular-nums',
        position: 'relative',
        boxSizing: 'border-box',
      }}>

        {/* ── HERO ──────────────────────────────────────────────
            Full-bleed banner (approved design): a navy brand strip over a
            white title block. Negative margins cancel the page's 12px top /
            56px side padding so both bands reach the paper edges; inner
            padding re-aligns content to the body's 56px column. */}
        <div style={{ margin: '-12px -56px 22px' }}>

          {/* Navy brand strip — a subtle light dot grid (repeated inline-SVG) over
              the navy. SVG data URIs are used (not CSS gradients) because html2canvas
              renders them reliably. */}
          <div style={{
            backgroundColor: navy,
            backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Ccircle cx='2' cy='2' r='1.1' fill='%23ffffff' fill-opacity='0.14'/%3E%3C/svg%3E\")",
            backgroundRepeat: 'repeat',
            backgroundSize: '16px 16px',
            padding: '26px 56px 30px',
            color: '#ffffff',
          }}>

            {/* micro meta row — client / ref, divided by a thin gold rule */}
            {(clientName || applicationRef) && (
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                paddingBottom: '16px', borderBottom: '1px solid rgba(200,150,46,0.32)',
              }}>
                <span style={{ fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.26em', textTransform: 'uppercase', color: gold, fontFamily: sans }}>
                  {clientName ? `Prepared For · ${clientName}` : ''}
                </span>
                <span style={{ fontSize: '10px', fontWeight: 500, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.62)', fontFamily: sans }}>
                  {applicationRef ? `Ref · ${applicationRef}` : ''}
                </span>
              </div>
            )}

            {/* main brand row — wordmark (left) / quote date (right) */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '32px', marginTop: (clientName || applicationRef) ? '24px' : 0 }}>

              {/* wordmark: gold bar + company / tagline */}
              <div style={{ display: 'flex', alignItems: 'stretch', gap: '16px' }}>
                <div style={{ width: '4px', background: gold, borderRadius: '2px', flex: 'none' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ fontSize: '32px', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#ffffff', lineHeight: 0.95, fontFamily: sans }}>
                    Xpress Finance
                  </div>
                  <div style={{ fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.3em', textTransform: 'uppercase', color: gold, fontFamily: sans }}>
                    Powering Ambition · Funding Growth
                  </div>
                </div>
              </div>

              {/* quote date */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', textAlign: 'right', flex: 'none', paddingTop: '2px' }}>
                <span style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.22em', textTransform: 'uppercase', color: gold, fontFamily: sans }}>
                  Quote Date
                </span>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#ffffff', fontFamily: sans }}>
                  {quoteDate}
                </span>
              </div>
            </div>

            {/* abn line */}
            <div style={{ marginTop: '18px', fontSize: '9.5px', fontWeight: 500, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', fontFamily: sans }}>
              ABN 616 500 599 39
            </div>
          </div>

          {/* White title block — eyebrow / title / asset line */}
          <div style={{ background: paper, padding: '22px 56px 20px', borderBottom: `2px solid ${navy}` }}>

            {/* eyebrow: gold diamond + status label */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
              <span style={{ width: '7px', height: '7px', background: gold, transform: 'rotate(45deg)', flex: 'none', display: 'inline-block' }} />
              <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.28em', textTransform: 'uppercase', color: gold, fontFamily: sans }}>
                Indicative Finance Quote
              </span>
            </div>

            {/* title — asset appended inline so it reads on one line */}
            <h1 style={{ margin: '7px 0 0', fontFamily: sans, fontWeight: 700, fontSize: '22px', lineHeight: 1.1, letterSpacing: '-0.01em', color: navy }}>
              Finance Scenarios{assetDescription !== 'Asset' ? ` — ${assetDescription}` : ''}
            </h1>
          </div>
        </div>

        {/* ── SUMMARY STRIP ─────────────────────────────────────
            Sits on white below the navy hero (v3 reference): muted
            labels, ink values, amount-financed in brand blue. Lives in
            the page's normal flow so it aligns with the body content. */}
        <div style={{
          margin: '0 0 24px',
          borderTop: `1px solid ${hairlineLight}`,
          borderBottom: `1px solid ${hairlineLight}`,
          padding: '14px 0',
          display: 'grid',
          gridTemplateColumns: summaryCells.map(c => (c.wide ? '1.3fr' : '1fr')).join(' '),
        }}>
          {summaryCells.map((c, i) => (
            <div key={c.label} style={{
              padding: i === 0 ? '0 16px 0 0' : '0 16px',
              borderLeft: i === 0 ? 'none' : `1px solid ${hairlineLight}`,
            }}>
              {/* Reserve exactly two lines (fixed px, not em) for every label so
                  single- and two-line labels keep their values on one baseline. */}
              <div style={{ fontSize: '8.5px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: muted, lineHeight: '11px', height: '22px' }}>
                {c.label}
              </div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: c.gold ? '#2a5d9e' : ink, marginTop: '4px', lineHeight: 1.25, fontVariantNumeric: 'tabular-nums' }}>
                {c.value}
              </div>
            </div>
          ))}
        </div>

        {/* ── COMPARISON MATRIX ───────────────────────────────── */}
        <div style={{ marginBottom: '8px' }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: '10px',
          }}>
            <h2 style={{ fontFamily: sans, fontWeight: 700, fontSize: '13px', margin: 0, color: ink }}>
              Scenarios at a glance
            </h2>
          </div>
        </div>

        {/* Each row of term cards is a block-level wrapper: html2pdf's page-break
            avoidance inserts a spacer before the element, which only works in
            normal flow — never put break-inside-avoid on grid children. */}
        {rows.map((row, ri) => (
          <div
            key={ri}
            className="break-inside-avoid"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '14px',
              alignItems: 'start',
              // Spacing is split: margin (collapses at a page top) plus padding (does
              // not). The padding is the ONLY gap that survives the page slice, so it
              // doubles as the breathing room above a row pushed to the next page —
              // keep it generous so page 2+ doesn't start flush against the top edge.
              // Margin handles the extra mid-page separation between rows.
              marginTop: ri > 0 ? '4px' : 0,
              paddingTop: '18px',
            }}
          >
          {row.map(g => {
            const cols: { key: string; head: string | null; opt: QuoteOption }[] = [];
            if (g.noBalloon) cols.push({ key: 'nb', head: g.withBalloon ? 'No Balloon' : null, opt: g.noBalloon });
            if (g.withBalloon) {
              const m = g.withBalloon.lender_name.match(/(\d+)%\s*Balloon/i);
              cols.push({ key: 'wb', head: g.noBalloon ? (m ? `${m[1]}% Balloon` : 'With Balloon') : null, opt: g.withBalloon });
            }
            const dual = cols.length === 2;
            const recommended = g.termYears === recommendedYears;
            const { accent } = TERM_ACCENTS[termGroups.indexOf(g) % TERM_ACCENTS.length];
            const clientAmt = (o: QuoteOption) =>
              (o.purchase_price ?? 0) - (o.deposit ?? 0) + (o.establishment_fee ?? 0) + (o.application_fee ?? 0);
            const showRateRow = (!isClientView || showInterestRate) && cols.some(c => rate(c.opt) != null);

            const renderMonthly = (o: QuoteOption): ReactNode => {
              const rng = fmtRepaymentClient(o.repayment_monthly);
              // A range ("lo – hi") is too wide for a dual-column cell. Keep each
              // amount unbreakable but allow the pair to wrap to two lines so it
              // never overflows into the neighbouring column.
              if (rng) return (
                <>
                  <span style={{ whiteSpace: 'nowrap' }}><Money v={rng.lo} /> –</span>{' '}
                  <span style={{ whiteSpace: 'nowrap' }}><Money v={rng.hi} /></span>
                </>
              );
              return <Money v={o.repayment_monthly} />;
            };

            const tableRows: { label: string; bold?: boolean; wrap?: boolean; render: (o: QuoteOption) => ReactNode }[] = [
              { label: `${assetDescription} price`, render: o => <Money v={o.purchase_price} /> },
              { label: 'Deposit', render: o => <Money v={o.deposit} /> },
              { label: 'Amount financed', render: o => <Money v={isClientView ? clientAmt(o) : o.loan_amount} /> },
              { label: 'Balloon', render: o => <Money v={o.balloon_residual ?? 0} /> },
              { label: 'Monthly repayment', bold: true, wrap: true, render: renderMonthly },
              ...(showWeekly
                ? [{ label: 'Weekly equivalent', render: (o: QuoteOption) => <Money v={o.repayment_weekly} /> }]
                : []),
              ...(!isClientView
                ? [{ label: 'Rate of interest', render: (o: QuoteOption) => fmtPercent(o.interest_rate) }]
                : []),
              ...(showRateRow
                ? [{
                    label: isClientView ? 'Interest rate' : 'All-up interest rate',
                    render: (o: QuoteOption) => fmtPercent(rate(o)),
                  }]
                : []),
              ...((!isClientView || showTotalInterest)
                ? [{ label: 'Total interest', bold: true, render: (o: QuoteOption) => <Money v={o.total_interest} /> }]
                : []),
            ];

            return (
              <div
                key={g.termYears}
                style={{
                  border: `1px solid ${hairline}`,
                  background: recommended ? subtleBg : paper,
                  boxSizing: 'border-box',
                }}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  padding: '9px 10px',
                  background: navy,
                }}>
                  <span style={{ fontFamily: sans, fontWeight: 700, fontSize: '12px', color: '#ffffff' }}>
                    {g.termYears} Year Term
                    <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.6)', fontWeight: 400, marginLeft: '6px' }}>
                      {g.termMonths} months
                    </span>
                  </span>
                  {recommended && (
                    <span style={{ fontSize: '8px', color: gold, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      Recommended
                    </span>
                  )}
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontVariantNumeric: 'tabular-nums' }}>
                  <colgroup>
                    <col style={{ width: dual ? '34%' : '50%' }} />
                    {cols.map(c => <col key={c.key} />)}
                  </colgroup>
                  {dual && (
                    <thead>
                      <tr>
                        <th style={{ borderBottom: `1px solid ${hairlineLight}` }} />
                        {cols.map(c => (
                          <th key={c.key} style={{
                            textAlign: 'right',
                            padding: '6px 10px',
                            fontFamily: sans,
                            fontSize: '8.5px',
                            fontWeight: 600,
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            color: muted,
                            borderBottom: `1px solid ${hairlineLight}`,
                            verticalAlign: 'bottom',
                          }}>
                            {c.head}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {tableRows.map((r, ri) => {
                      const last = ri === tableRows.length - 1;
                      const boldStyle: CSSProperties = r.bold
                        ? { fontWeight: 600, color: ink, textTransform: 'none', letterSpacing: '0', fontSize: '10.5px' }
                        : {};
                      return (
                        <tr key={r.label}>
                          <td style={{ ...blkLbl, ...boldStyle, ...(last ? { borderBottom: 'none' } : {}) }}>
                            {r.label}
                          </td>
                          {cols.map(c => (
                            <td key={c.key} style={{
                              ...blkVal,
                              color: accent,
                              ...(r.bold ? { fontWeight: 700 } : {}),
                              ...(r.wrap ? { whiteSpace: 'normal' as const } : {}),
                              ...(last ? { borderBottom: 'none' } : {}),
                            }}>
                              {r.render(c.opt)}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
          </div>
        ))}

        {/* ── PREFERRED OPTION CALLOUT ────────────────────────── */}
        {preferredOpt && preferredGroup && (() => {
          const o = preferredOpt;
          const balloonAmt = o.balloon_residual ?? 0;
          const m = o.lender_name.match(/(\d+)%\s*Balloon/i);
          const balloonLabel = balloonAmt > 0 ? (m ? `${m[1]}% Balloon` : 'With Balloon') : 'No Balloon';
          const amtFin = isClientView
            ? (o.purchase_price ?? 0) - (o.deposit ?? 0) + (o.establishment_fee ?? 0) + (o.application_fee ?? 0)
            : o.loan_amount;
          const rng = fmtRepaymentClient(o.repayment_monthly);
          const monthly: ReactNode = rng
            ? <><Money v={rng.lo} /> – <Money v={rng.hi} /></>
            : <Money v={o.repayment_monthly} />;
          // Third metric: balloon if present, else weekly (when shown), else
          // fall back to total interest so the callout keeps three columns.
          const thirdMetric = balloonAmt > 0
            ? { label: `Balloon at Month ${o.loan_term_months ?? preferredGroup.termMonths}`, value: <Money v={balloonAmt} /> }
            : showWeekly
              ? { label: 'Weekly Equivalent', value: <Money v={o.repayment_weekly} /> }
              : { label: 'Total Interest', value: <Money v={o.total_interest} /> };
          const metrics: { label: string; value: ReactNode }[] = [
            { label: 'Monthly Repayment', value: monthly },
            { label: isClientView ? 'Amount Financed' : 'Principal Financed', value: <Money v={amtFin} /> },
            thirdMetric,
          ];
          return (
            <div className="break-inside-avoid" style={{
              marginTop: '16px',
              background: navy,
              borderRadius: '8px',
              padding: '16px 18px',
              color: '#ffffff',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                <span style={{ width: '9px', height: '9px', background: gold, transform: 'rotate(45deg)', display: 'inline-block', flex: 'none' }} />
                <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: gold, fontFamily: sans }}>
                  Recommended For You
                </span>
              </div>
              <div style={{ marginTop: '6px', fontSize: '18px', fontWeight: 700, fontFamily: serif, color: '#ffffff' }}>
                {preferredGroup.termYears} Year Term · {balloonLabel}
              </div>
              <div style={{ marginTop: '14px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                {metrics.map((mt, i) => (
                  <div key={mt.label} style={{
                    borderLeft: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.14)',
                    paddingLeft: i === 0 ? 0 : '16px',
                  }}>
                    <div style={{ fontSize: '8.5px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)' }}>
                      {mt.label}
                    </div>
                    <div style={{ fontSize: '18px', fontWeight: 700, marginTop: '4px', color: i === 0 ? gold : '#ffffff', fontVariantNumeric: 'tabular-nums' }}>
                      {mt.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* ── NON-FINANCED FEES ───────────────────────────────── */}
        {!feesFinanced && parsedParams && (
          <div style={{ marginTop: '16px' }} className="break-inside-avoid">
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: '10px',
            }}>
              <h3 style={{ fontFamily: sans, fontWeight: 700, fontSize: '13px', margin: 0, color: ink }}>
                Fees payable — not financed
              </h3>
              <span style={{ fontSize: '10px', color: muted, fontWeight: 500 }}>
                Charged separately
              </span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' as const }}>
              <colgroup><col style={{ width: '70%' }} /><col style={{ width: '30%' }} /></colgroup>
              <tbody>
                {parsedParams.establishmentFee != null && parsedParams.establishmentFee > 0 && (
                  <tr><td style={lbl}>Loan establishment fee</td><td style={val}><Money v={parsedParams.establishmentFee} /></td></tr>
                )}
                {parsedParams.ppsrFee != null && parsedParams.ppsrFee > 0 && (
                  <tr><td style={lbl}>PPSR</td><td style={val}><Money v={parsedParams.ppsrFee} /></td></tr>
                )}
                {parsedParams.originationFee != null && parsedParams.originationFee > 0 && (
                  <tr><td style={lbl}>Origination fee</td><td style={val}><Money v={parsedParams.originationFee} /></td></tr>
                )}
                <tr>
                  <td style={{ ...lbl, fontWeight: 600, color: ink, textTransform: 'none', letterSpacing: '0', borderBottom: 'none', paddingTop: '10px' }}>
                    Total fees
                  </td>
                  <td style={{ ...val, fontWeight: 600, color: ink, borderBottom: 'none', paddingTop: '10px' }}>
                    <Money v={(parsedParams.establishmentFee ?? 0) + (parsedParams.ppsrFee ?? 0) + (parsedParams.originationFee ?? 0)} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* ── FEE & RATE SUMMARY — broker internal ────────────── */}
        {parsedParams && !isClientView && (
          <div style={{ marginTop: '16px' }} className="break-inside-avoid">
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: '10px',
            }}>
              <h3 style={{ fontFamily: sans, fontWeight: 700, fontSize: '13px', margin: 0, color: ink }}>
                Fee &amp; rate summary
              </h3>
              <span style={{ fontSize: '10px', color: muted, fontWeight: 500 }}>
                Internal
              </span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' as const }}>
              <colgroup><col style={{ width: '70%' }} /><col style={{ width: '30%' }} /></colgroup>
              <tbody>
                {parsedParams.establishmentFee != null && (
                  <tr><td style={lbl}>Loan establishment fee</td><td style={val}><Money v={parsedParams.establishmentFee} /></td></tr>
                )}
                {parsedParams.ppsrFee != null && (
                  <tr><td style={lbl}>PPSR</td><td style={val}><Money v={parsedParams.ppsrFee} /></td></tr>
                )}
                {parsedParams.originationFee != null && (
                  <tr><td style={lbl}>Origination fee</td><td style={val}><Money v={parsedParams.originationFee} /></td></tr>
                )}
                {parsedParams.interestRate != null && (
                  <tr><td style={lbl}>Lender's rate</td><td style={val}>{fmtPercent(parsedParams.interestRate)}</td></tr>
                )}
                {parsedParams.brokeragePercent != null && (
                  <tr><td style={lbl}>Brokerage %</td><td style={val}>{Number(parsedParams.brokeragePercent).toFixed(2)}%</td></tr>
                )}
                {options[0]?.brokerage != null && (
                  <tr>
                    <td style={{ ...lbl, fontWeight: 600, color: ink, textTransform: 'none', letterSpacing: '0', borderBottom: 'none', paddingTop: '10px' }}>
                      Brokerage $
                    </td>
                    <td style={{ ...val, fontWeight: 600, color: ink, borderBottom: 'none', paddingTop: '10px' }}>
                      <Money v={options[0].brokerage} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── WHY CHOOSE XPRESS ───────────────────────────────── */}
        <div className="break-inside-avoid" style={{
          marginTop: '18px',
          padding: '13px 18px',
          background: subtleBg,
          border: `1px solid ${hairlineLight}`,
          borderRadius: '8px',
        }}>
          {/* Header: gold dot + navy title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: gold, flex: 'none', display: 'inline-block' }} />
            <h3 style={{ fontFamily: sans, fontWeight: 700, fontSize: '13px', margin: 0, color: navy }}>
              Why Choose Xpress Finance
            </h3>
          </div>
          <div style={{ borderTop: `1px solid ${hairlineLight}`, margin: '9px 0 11px' }} />

          {/* Two-column benefit grid: gold diamond + bold lead + detail */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '28px', rowGap: '9px' }}>
            {([
              ['End-to-end management', 'we manage your finance from application to payout, so you never have to chase the bank.'],
              ['One point of contact', 'no juggling multiple people. One call, one team, full accountability.'],
              ['Tax-time ready', 'fast, simple documentation on demand. No surprises at EOFY.'],
              ['Limited client capacity', 'we take on a selective number of clients to maintain this standard of service.'],
            ] as [string, string][]).map(([lead, rest]) => (
              <div key={lead} style={{ display: 'flex', gap: '8px', fontSize: '10.5px', lineHeight: 1.5, color: inkLight }}>
                <span style={{ color: gold, fontWeight: 700, flex: 'none' }}>✦</span>
                <span><strong style={{ color: ink, fontWeight: 700 }}>{lead}</strong> — {rest}</span>
              </div>
            ))}
          </div>

          <div style={{ borderTop: `1px solid ${hairlineLight}`, margin: '11px 0 10px' }} />

          {/* CTA */}
          <p style={{ margin: 0, fontStyle: 'italic', fontWeight: 600, fontSize: '10.5px', color: ink }}>
            Act now and secure your spot — limited availability. enquiries@xpressfinance.com.au
          </p>
        </div>

        {/* ── CONTACT STRIP ───────────────────────────────────────
            Mirrors the term-row pattern above: the avoid wrapper carries the
            paddingTop, which is the only spacing that survives html2pdf's page
            slice. So when the strip is pushed to a fresh page it keeps breathing
            room at the top and the box's border never lands on the slice
            boundary (which had orphaned a hairline on the previous page). The
            border lives on the inner box, below the surviving padding. */}
        <div className="break-inside-avoid" style={{ marginTop: '4px', paddingTop: '18px' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1.6fr 1fr 1.4fr',
            border: `1px solid ${hairlineLight}`,
            borderRadius: '8px',
            overflow: 'hidden',
          }}>
            {([
              ['Office', 'Tower 4, Level 17, 727 Collins St, Docklands VIC 3008'],
              ['Phone', '(03) 8456 7996'],
              ['Email', 'enquiries@xpressfinance.com.au'],
            ] as [string, string][]).map(([label, value], i) => (
              <div key={label} style={{ padding: '12px 16px', borderLeft: i === 0 ? 'none' : `1px solid ${hairlineLight}` }}>
                <div style={{ fontSize: '8.5px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: gold }}>{label}</div>
                <div style={{ fontSize: '10px', color: ink, marginTop: '4px', lineHeight: 1.4 }}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── DISCLAIMER ──────────────────────────────────────────
            Plain end-of-document paragraph. The navy footer band is drawn on
            every page by the PDF exporter (see lib/pdfExport.ts), so it is no
            longer rendered inline here. */}
        <div className="break-inside-avoid" style={{
          marginTop: '16px',
          paddingTop: '12px',
          borderTop: `1px solid ${hairlineLight}`,
        }}>
          <div style={{ fontSize: '8px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: muted, marginBottom: '6px' }}>
            Important information
          </div>
          <p style={{ margin: 0, fontSize: '8.5px', lineHeight: 1.6, color: muted }}>
            This quote is indicative only and subject to full credit assessment and lender approval. Rates, fees and charges may vary based on individual circumstances and final lender approval. This document does not constitute a credit contract or formal offer of finance. Always consider whether this product is appropriate for your financial situation.
          </p>
        </div>

      </div>
    );
  }

  // ── On-screen Layout ────────────────────────────────────────────────
  return (
    <div id={`quote-sheet-${quoteSheet.id}`} className="bg-card rounded-lg border border-border space-y-5 p-3 sm:p-5">

      {quoteSheet.title && (
        <h3 className="text-lg font-bold text-foreground tracking-tight">{quoteSheet.title}</h3>
      )}

      {/* Term scenario grid */}
      <div className="space-y-5">
        {rows.map((row, ri) => (
          <div key={ri} className="grid grid-cols-1 lg:grid-cols-2 gap-5 break-inside-avoid">
            {row.map(group => {
              const { accent } = TERM_ACCENTS[termGroups.indexOf(group) % TERM_ACCENTS.length];
              return (
                <TermBlock key={group.termYears} group={group} accent={accent} isClientView={isClientView} showInterestRate={showInterestRate} showTotalInterest={showTotalInterest} showWeekly={showWeekly} assetDescription={assetDescription} paymentType={paymentType} />
              );
            })}
          </div>
        ))}
      </div>

      {/* Non-financed fees notice (on-screen, client view) */}
      {!feesFinanced && isClientView && parsedParams && (
        <div className="border border-warning/30 bg-warning/5 rounded-lg p-4 space-y-2 break-inside-avoid mt-4">
          <p className="text-[12px] font-semibold text-warning uppercase tracking-wide mb-2">Fees Payable (Not Financed)</p>
          <p className="text-[11px] text-muted-foreground mb-3">These fees are charged separately and are not included in the loan amount.</p>
          {parsedParams.establishmentFee != null && parsedParams.establishmentFee > 0 && (
            <Row label="Loan Establishment Fee" value={<Money v={parsedParams.establishmentFee} />} />
          )}
          {parsedParams.ppsrFee != null && parsedParams.ppsrFee > 0 && (
            <Row label="PPSR" value={<Money v={parsedParams.ppsrFee} />} />
          )}
          {parsedParams.originationFee != null && parsedParams.originationFee > 0 && (
            <Row label="Origination Fee" value={<Money v={parsedParams.originationFee} />} />
          )}
          <Row label="Total Fees" value={<Money v={(parsedParams.establishmentFee ?? 0) + (parsedParams.ppsrFee ?? 0) + (parsedParams.originationFee ?? 0)} />} bold />
        </div>
      )}

      {/* Fee summary (broker view only) */}
      {parsedParams && !isClientView && (
        <div className="border border-border bg-muted/30 rounded-lg p-4 space-y-2 break-inside-avoid mt-4">
          <p className="text-[12px] font-semibold text-foreground uppercase tracking-wide mb-3">
            Fee Summary
            {!feesFinanced && <span className="ml-2 text-warning">(Fees Not Financed)</span>}
          </p>
          {parsedParams.establishmentFee != null && (
            <Row label="Loan Establishment Fee" value={<Money v={parsedParams.establishmentFee} />} />
          )}
          {parsedParams.ppsrFee != null && (
            <Row label="PPSR" value={<Money v={parsedParams.ppsrFee} />} />
          )}
          {parsedParams.originationFee != null && (
            <Row label="Origination Fee" value={<Money v={parsedParams.originationFee} />} />
          )}
          {parsedParams.interestRate != null && (
            <Row label="Lender's Rate" value={fmtPercent(parsedParams.interestRate)} />
          )}
          {parsedParams.brokeragePercent != null && (
            <Row label="Brokerage %" value={`${Number(parsedParams.brokeragePercent).toFixed(2)}%`} />
          )}
          {options[0]?.brokerage != null && (
            <Row label="Brokerage $" value={<Money v={options[0].brokerage} />} bold />
          )}
        </div>
      )}

      {showBrokerNotes && quoteSheet.broker_notes && (
        <div className="p-3 bg-muted/40 rounded-lg border border-border">
          <p className="text-xs font-medium text-muted-foreground mb-1">Broker Notes (internal)</p>
          <p className="text-sm text-foreground">{quoteSheet.broker_notes}</p>
        </div>
      )}
    </div>
  );
}
