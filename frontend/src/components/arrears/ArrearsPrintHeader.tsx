import { PRINT_INSET } from '../../lib/printPage';

// Brand tokens — same values the quote sheet uses, so the two exports read as
// one family. Keep in sync with QuoteSheetComparison and the painted footer
// band in lib/pdfExport.ts.
const NAVY = '#0d1f3c';
const GOLD = '#c8962e';
const SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";



/**
 * Xpress masthead, matching the quote sheet: navy brand strip over a white
 * title block. Prints once at the top of the document — the per-page navy band
 * at the foot is painted onto the PDF afterwards by paintXpressFooter.
 *
 * The dot grid is a repeated inline-SVG data URI rather than a CSS gradient,
 * which is what html2canvas renders reliably.
 */
export default function ArrearsPrintHeader({
  title,
  subtitle,
  eyebrow = 'Collections · Arrears File',
}: {
  title: string;
  subtitle?: string;
  /** The small gold label above the title — names what kind of export it is. */
  eyebrow?: string;
}) {
  const exported = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  return (
    // No negative margins: html2canvas captures the print element's own box, so
    // anything pulled outside it — the right-hand "Exported" block especially —
    // is cropped out of the PDF. The masthead is full width and the page's side
    // padding lives on the body block below it instead.
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          backgroundColor: NAVY,
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Ccircle cx='2' cy='2' r='1.1' fill='%23ffffff' fill-opacity='0.14'/%3E%3C/svg%3E\")",
          backgroundRepeat: 'repeat',
          backgroundSize: '16px 16px',
          padding: `20px ${PRINT_INSET}px 22px`,
          color: '#ffffff',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24 }}>
          {/* wordmark: gold bar + company / tagline */}
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 12, minWidth: 0 }}>
            <div style={{ width: 4, background: GOLD, borderRadius: 2, flex: 'none' }} />
            <div>
              <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', lineHeight: 0.95, fontFamily: SANS }}>
                Xpress Finance
              </div>
              <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.3em', textTransform: 'uppercase', color: GOLD, fontFamily: SANS, marginTop: 7 }}>
                Powering Ambition · Funding Growth
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right', flex: 'none', whiteSpace: 'nowrap' }}>
            <div style={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.22em', textTransform: 'uppercase', color: GOLD, fontFamily: SANS }}>
              Exported
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, fontFamily: SANS, marginTop: 4 }}>{exported}</div>
          </div>
        </div>
        <div style={{ marginTop: 14, fontSize: 8.5, fontWeight: 500, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', fontFamily: SANS }}>
          ABN 616 500 599 39 · Australian Credit Licence 389328
        </div>
      </div>

      {/* White title block — eyebrow / title / who it covers */}
      <div style={{ background: '#ffffff', padding: `14px ${PRINT_INSET}px 13px`, borderBottom: `2px solid ${NAVY}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 6, height: 6, background: GOLD, transform: 'rotate(45deg)', flex: 'none', display: 'inline-block' }} />
          <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.28em', textTransform: 'uppercase', color: GOLD, fontFamily: SANS }}>
            {eyebrow}
          </span>
        </div>
        <h1 style={{ margin: '6px 0 0', fontFamily: SANS, fontWeight: 700, fontSize: 18, lineHeight: 1.1, letterSpacing: '-0.01em', color: NAVY }}>
          {title}
        </h1>
        {subtitle && (
          <p style={{ margin: '4px 0 0', fontSize: 10, color: '#555', fontFamily: SANS }}>{subtitle}</p>
        )}
      </div>
    </div>
  );
}
