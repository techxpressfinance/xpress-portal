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

const MODERN_COLOR_RE = /(oklch|oklab|lab\(|lch\(|color-mix|color\()/i;

const PDF_VAR_FALLBACKS: Record<string, string> = {
  '--led-bg': '#ffffff',
  '--led-bg-2': '#f1f5f9',
  '--led-surface': '#ffffff',
  '--led-surface-2': '#f8fafc',
  '--led-ink': '#0f172a',
  '--led-ink-2': '#334155',
  '--led-muted': '#64748b',
  '--led-muted-2': '#64748b',
  '--led-line': '#e2e8f0',
  '--led-line-2': '#cbd5e1',
  '--led-line-strong': '#94a3b8',
  '--led-accent': '#1e3a5f',
  '--led-accent-hover': '#162a47',
  '--led-accent-tint': '#eff6ff',
  '--led-accent-tint-2': '#dbeafe',
  '--led-accent-ink': '#ffffff',
  '--led-success': '#15803d',
  '--led-success-tint': '#dcfce7',
  '--led-warning': '#a16207',
  '--led-warning-tint': '#fef9c3',
  '--led-danger': '#dc2626',
  '--led-danger-tint': '#fee2e2',
  '--led-info': '#2563eb',
  '--led-info-tint': '#dbeafe',
  '--led-violet': '#7c3aed',
  '--led-violet-tint': '#ede9fe',
  '--led-neutral-tint': '#f1f5f9',
  '--led-shadow-sm': '0 1px 2px rgba(0,0,0,0.06)',
  '--led-shadow-md': '0 2px 4px rgba(0,0,0,0.05), 0 8px 20px rgba(0,0,0,0.06)',
  '--led-shadow-lg': '0 4px 8px rgba(0,0,0,0.06), 0 18px 40px rgba(0,0,0,0.12)',
  '--background': '#ffffff',
  '--foreground': '#0f172a',
  '--card': '#ffffff',
  '--card-foreground': '#0f172a',
  '--muted': '#f1f5f9',
  '--muted-foreground': '#64748b',
  '--border': '#e2e8f0',
  '--input': '#e2e8f0',
  '--ring': '#1e3a5f',
  '--primary': '#1e3a5f',
  '--primary-foreground': '#ffffff',
  '--secondary': '#f1f5f9',
  '--secondary-foreground': '#0f172a',
  '--destructive': '#dc2626',
  '--destructive-foreground': '#ffffff',
  '--success': '#15803d',
  '--success-foreground': '#ffffff',
  '--chart-1': '#2563eb',
  '--chart-2': '#0891b2',
  '--chart-3': '#c026d3',
  '--chart-4': '#ca8a04',
  '--chart-5': '#7c3aed',
};

function installGlobalFallback(): HTMLStyleElement {
  const style = document.createElement('style');
  style.setAttribute('data-pdf-global-fallback', '');
  const vars = Object.entries(PDF_VAR_FALLBACKS).map(([k, v]) => `${k}: ${v} !important;`).join('');
  style.textContent = `:root, .ledger-theme, .pdf-sanitize, .pdf-sanitize * { ${vars} scrollbar-color: auto !important; }`;
  document.head.appendChild(style);
  return style;
}

function sanitizeTree(root: HTMLElement, win: Window): void {
  const elements = [root, ...Array.from(root.querySelectorAll('*'))] as HTMLElement[];
  elements.forEach((element) => {
    const computed = win.getComputedStyle(element);
    const propsToOverride: { name: string; isShadow: boolean }[] = [];
    for (let i = 0; i < computed.length; i++) {
      const propName = computed[i];
      const val = computed.getPropertyValue(propName);
      if (val && MODERN_COLOR_RE.test(val)) {
        propsToOverride.push({ name: propName, isShadow: propName.includes('shadow') });
      }
    }
    const boxShadow = computed.getPropertyValue('box-shadow');
    if (boxShadow && MODERN_COLOR_RE.test(boxShadow) && !propsToOverride.some((p) => p.name === 'box-shadow')) {
      propsToOverride.push({ name: 'box-shadow', isShadow: true });
    }
    propsToOverride.forEach(({ name, isShadow }) => {
      element.style.setProperty(name, isShadow ? 'none' : 'rgba(0, 0, 0, 0)', 'important');
    });
    for (const [vk, vv] of Object.entries(PDF_VAR_FALLBACKS)) {
      const cv = computed.getPropertyValue(vk);
      if (cv && MODERN_COLOR_RE.test(cv)) element.style.setProperty(vk, vv, 'important');
    }
  });
}

function stripModernColors(root: HTMLElement): void {
  const fallbackStyle = document.createElement('style');
  fallbackStyle.setAttribute('data-pdf-sanitize', '');
  fallbackStyle.textContent = `.pdf-sanitize, .pdf-sanitize * { scrollbar-color: auto !important; }`;
  root.classList.add('pdf-sanitize');
  root.appendChild(fallbackStyle);
  Object.entries(PDF_VAR_FALLBACKS).forEach(([k, v]) => root.style.setProperty(k, v, 'important'));
  sanitizeTree(root, window);
}

function html2canvasOpts(win: Window) {
  return {
    scale: 2,
    useCORS: true,
    logging: false,
    onclone: (clonedDoc: Document) => {
      const cw = clonedDoc.defaultView ?? win;
      const root = clonedDoc.body as unknown as HTMLElement;
      if (root) {
        const global = clonedDoc.createElement('style');
        const vars = Object.entries(PDF_VAR_FALLBACKS).map(([k, v]) => `${k}: ${v} !important;`).join('');
        global.textContent = `:root, .ledger-theme { ${vars} }`;
        clonedDoc.head.appendChild(global);
        sanitizeTree(root, cw);
        clonedDoc.querySelectorAll('*').forEach((el) => {
          const hEl = el as HTMLElement;
          const cs = cw.getComputedStyle(hEl);
          if (cs && MODERN_COLOR_RE.test(cs.getPropertyValue('box-shadow'))) hEl.style.setProperty('box-shadow', 'none', 'important');
        });
      }
    },
  };
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
 * html2canvas paints whatever an `<img>` holds at capture time, so one that
 * hasn't decoded yet comes out blank. Wait for them all — a broken image is
 * skipped rather than blocking the export.
 */
async function waitForImages(root: HTMLElement): Promise<void> {
  await Promise.all(
    Array.from(root.querySelectorAll('img')).map(async (img) => {
      if (img.complete && img.naturalWidth > 0) return;
      try {
        await img.decode();
      } catch {
        /* nothing to paint for this one */
      }
    }),
  );
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

  await waitForImages(el);
  const globalFallback = installGlobalFallback();
  const clone = el.cloneNode(true) as HTMLElement;
  (el.parentElement ?? document.body).appendChild(clone);
  try {
    stripModernColors(clone);
    await pdfWorker()
      .set({
        margin: [0, 0, 22, 0],
        filename,
        pagebreak: { mode: ['css', 'legacy'], avoid: '.break-inside-avoid' },
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: html2canvasOpts(window),
        jsPDF: { unit: 'mm', format: 'a4', orientation },
      })
      .from(clone)
      .toPdf()
      .get('pdf')
      .then((pdf) => paintXpressFooter(pdf as PdfDoc))
      .save();
  } catch (err) {
    console.error('PDF export failed:', err);
    throw err;
  } finally {
    globalFallback.remove();
    if (clone.parentElement) clone.parentElement.removeChild(clone);
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

  const globalFallback = installGlobalFallback();
  try {
    const clone = el.cloneNode(true) as HTMLElement;
    if (el.parentElement) {
      el.parentElement.appendChild(clone);
    } else {
      document.body.appendChild(clone);
    }

    await waitForImages(el);
    stripModernColors(clone);

    try {
      await pdfWorker()
        .set({
          margin: effectiveMargin,
          filename,
          pagebreak: { mode: ['css', 'legacy'], avoid: '.break-inside-avoid' },
          image: { type: 'jpeg', quality: 1.0 },
          html2canvas: html2canvasOpts(window),
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
      if (clone.parentElement) clone.parentElement.removeChild(clone);
    }
  } catch (err) {
    console.error('PDF export failed:', err);
    throw err;
  } finally {
    globalFallback.remove();
  }
}
