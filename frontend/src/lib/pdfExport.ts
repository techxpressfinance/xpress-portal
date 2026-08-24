import html2pdf from 'html2pdf.js';

/**
 * html2pdf.js ships its own `declare module` (node_modules/html2pdf.js/type.d.ts)
 * which wins over src/types/html2pdf.d.ts — and its options type omits
 * `pagebreak`, a real option both exports here depend on. Resolve the worker
 * through this structural type so call sites stay checked without `any`.
 */
type PdfWorker = {
  set(options: Record<string, unknown>): PdfWorker;
  from(element: HTMLElement): PdfWorker;
  toPdf(): PdfWorker;
  get(key: string): PdfWorker;
  then(onFulfilled: (value: unknown) => void): PdfWorker;
  save(): Promise<void>;
};

/** The module ships both a CJS default and a callable namespace depending on
 *  the bundler — accept either. */
function pdfWorker(): PdfWorker {
  const factory =
    typeof html2pdf === 'function'
      ? html2pdf
      : (html2pdf as unknown as { default: unknown }).default;
  return (factory as () => PdfWorker)();
}

/**
 * html2canvas (used by html2pdf) crashes on modern CSS colors like oklab/oklch,
 * which Tailwind 4 emits throughout. Neutralise them on the clone before the
 * PDF engine parses it.
 */
function stripModernColors(root: HTMLElement): void {
  const elements = [root, ...Array.from(root.querySelectorAll('*'))] as HTMLElement[];
  elements.forEach((element) => {
    const computed = window.getComputedStyle(element);
    const propsToOverride: { name: string; isShadow: boolean }[] = [];
    for (let i = 0; i < computed.length; i++) {
      const propName = computed[i];
      const val = computed.getPropertyValue(propName);
      if (val && (val.includes('oklab') || val.includes('oklch'))) {
        propsToOverride.push({ name: propName, isShadow: propName.includes('shadow') });
      }
    }
    propsToOverride.forEach(({ name, isShadow }) => {
      element.style.setProperty(name, isShadow ? 'none' : 'rgba(0, 0, 0, 0)', 'important');
    });
  });
}

/**
 * Paint the Xpress Finance footer band onto every page of a jsPDF instance.
 * html2pdf flattens the DOM into one sliced image, so a per-page band can't
 * live in the DOM — it's painted after layout, and callers reserve a ~22mm
 * bottom margin so it never overlaps content.
 */
interface PdfDoc {
  internal: { getNumberOfPages(): number; pageSize: { getWidth(): number; getHeight(): number } };
  setPage(page: number): void;
  setFillColor(r: number, g: number, b: number): void;
  rect(x: number, y: number, w: number, h: number, style: string): void;
  setFont(font: string, style: string): void;
  setFontSize(size: number): void;
  setTextColor(r: number, g: number, b: number): void;
  text(text: string, x: number, y: number, opts?: { align?: string }): void;
  setDrawColor(r: number, g: number, b: number): void;
  setLineWidth(w: number): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
}

function paintXpressFooter(pdf: PdfDoc): void {
  const totalPages = pdf.internal.getNumberOfPages();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const sideMargin = 14; // mm
  const bandH = 20;      // mm — keep in sync with the reserved bottom margin
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    const top = pageHeight - bandH;
    // Full-bleed navy band (#0d1f3c)
    pdf.setFillColor(13, 31, 60);
    pdf.rect(0, top, pageWidth, bandH, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(255, 255, 255);
    pdf.text('Xpress Finance Pty Ltd', sideMargin, top + 6);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.5);
    pdf.setTextColor(150, 162, 184);
    pdf.text('ABN 616 500 599 39 · ACN 650 059 939', sideMargin, top + 9.8);
    pdf.text('Australian Credit Licence 389328', sideMargin, top + 12.8);
    pdf.text(`Page ${i} of ${totalPages}`, pageWidth - sideMargin, top + 6, { align: 'right' });
    // Divider + gold tagline (#c8962e), centred
    pdf.setDrawColor(54, 68, 92);
    pdf.setLineWidth(0.2);
    pdf.line(sideMargin, top + 15, pageWidth - sideMargin, top + 15);
    pdf.setFontSize(6.2);
    pdf.setTextColor(200, 150, 46);
    pdf.text(
      'XPRESS FINANCE PTY LTD · XPRESSFINANCE.COM.AU · POWERING AMBITION, FUNDING GROWTH',
      pageWidth / 2,
      top + 18,
      { align: 'center' },
    );
  }
}

/**
 * Render an arbitrary DOM element to an A4 PDF. Used by report exports (e.g.
 * the arrears book), where the printable markup is a plain table rather than
 * the styled quote sheet below. Every page carries the Xpress footer band.
 */
export async function downloadElementPdf(
  elementId: string,
  filename: string,
  orientation: 'portrait' | 'landscape' = 'portrait',
): Promise<void> {
  const el = document.getElementById(elementId);
  if (!el) {
    console.error(`PDF export: element #${elementId} not found`);
    return;
  }

  const clone = el.cloneNode(true) as HTMLElement;
  (el.parentElement ?? document.body).appendChild(clone);
  try {
    stripModernColors(clone);
    await pdfWorker()
      .set({
        // Bottom margin reserves room for the painted footer band.
        margin: [10, 8, 22, 8],
        filename,
        // Only blocks explicitly marked .break-inside-avoid are protected — see
        // the note in downloadQuoteSheetPdf on why 'avoid-all' leaves blank gaps.
        pagebreak: { mode: ['css', 'legacy'], avoid: '.break-inside-avoid' },
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation },
      })
      .from(clone)
      .toPdf()
      .get('pdf')
      .then((pdf) => paintXpressFooter(pdf as PdfDoc))
      .save();
  } finally {
    (el.parentElement ?? document.body).removeChild(clone);
  }
}

/**
 * Download a quote sheet as a landscape A4 PDF.
 * Captures the DOM element by its ID and renders it at 2x scale for crisp output.
 */
export async function downloadQuoteSheetPdf(
  elementId: string,
  filename: string,
  // [top, left, bottom, right] page margins in mm. Vertical margins give multi-page
  // exports breathing room at page edges when content is pushed to the next page.
  margin: [number, number, number, number] = [0, 0, 0, 0],
  // When true, paint the navy Xpress Finance band onto every page. Defaults to
  // on so every PDF carries the branding; the bottom margin is bumped to clear it.
  footerBand = true,
): Promise<void> {
  const el = document.getElementById(elementId);
  if (!el) {
    console.error(`PDF export: element #${elementId} not found`);
    return;
  }

  // Reserve room for the painted footer band so it never overlaps content.
  const effectiveMargin: [number, number, number, number] = footerBand
    ? [margin[0], margin[1], Math.max(margin[2], 22), margin[3]]
    : margin;

  try {
    const clone = el.cloneNode(true) as HTMLElement;
    // Append the clone directly next to the original element inside its invisible wrapper!
    // This perfectly preserves all inherited CSS, bounds (794px), and viewport logic.
    if (el.parentElement) {
      el.parentElement.appendChild(clone);
    } else {
      document.body.appendChild(clone);
    }

    // html2canvas (used by html2pdf) crashes on modern CSS colors like oklab/oklch.
    // We sanitize the cloned DOM to replace any of these colors with a safe fallback
    // before the PDF engine parses it.
    const elements = [clone, ...Array.from(clone.querySelectorAll('*'))] as HTMLElement[];
    elements.forEach((element) => {
      const computed = window.getComputedStyle(element);
      const propsToOverride: { name: string; isShadow: boolean }[] = [];
      
      for (let i = 0; i < computed.length; i++) {
        const propName = computed[i];
        const val = computed.getPropertyValue(propName);
        if (val && (val.includes('oklab') || val.includes('oklch'))) {
          propsToOverride.push({ name: propName, isShadow: propName.includes('shadow') });
        }
      }
      
      propsToOverride.forEach(({ name, isShadow }) => {
        element.style.setProperty(name, isShadow ? 'none' : 'rgba(0, 0, 0, 0)', 'important');
      });
    });

    try {
      await pdfWorker()
        .set({
          margin: effectiveMargin,
          filename,
          // 'css' reads break-* properties; 'legacy' actively measures elements and
          // inserts a break before any that would straddle a page boundary, honouring
          // the `avoid` selector below. We intentionally DON'T use 'avoid-all': it
          // forces every element to stay whole, so any block that doesn't fit in the
          // space left on a page is pushed wholesale to the next one — leaving large
          // blank gaps. Instead we only protect the blocks explicitly marked with
          // `.break-inside-avoid` (term-card rows, callouts, footer), letting the rest
          // of the content flow naturally to fill each page.
          pagebreak: { mode: ['css', 'legacy'], avoid: '.break-inside-avoid' },
          image: { type: 'jpeg', quality: 1.0 },
          html2canvas: { scale: 2, useCORS: true, logging: false },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        })
        .from(clone)
        .toPdf()
        .get('pdf')
        .then((pdf) => {
          if (!footerBand) return;
          paintXpressFooter(pdf as PdfDoc);
        })
        .save();
    } finally {
      if (el.parentElement) {
        el.parentElement.removeChild(clone);
      } else {
        document.body.removeChild(clone);
      }
    }
  } catch (err) {
    console.error('PDF export failed:', err);
    throw err;
  }
}
