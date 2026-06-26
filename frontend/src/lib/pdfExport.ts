import html2pdf from 'html2pdf.js';

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
  // When true, paint the navy Xpress Finance band onto every page. The caller is
  // responsible for reserving enough bottom margin (≥20mm) so it clears content.
  footerBand = false,
): Promise<void> {
  const el = document.getElementById(elementId);
  if (!el) {
    console.error(`PDF export: element #${elementId} not found`);
    return;
  }

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
      const pdfGenerator = typeof html2pdf === 'function' ? html2pdf : (html2pdf as any).default;
      
      
      await pdfGenerator()
        .set({
          margin,
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
        // Draw the navy footer band onto every page. html2pdf flattens the DOM
        // into one sliced image, so a per-page band can't live in the DOM — we
        // paint it on the jsPDF instance after layout. The bottom page margin
        // (see callers) is sized to reserve room for this 20mm band so it never
        // overlaps content.
        .get('pdf')
        .then((pdf: any) => {
          if (!footerBand) return;
          const totalPages = pdf.internal.getNumberOfPages();
          const pageWidth = pdf.internal.pageSize.getWidth();
          const pageHeight = pdf.internal.pageSize.getHeight();
          const sideMargin = 14; // mm — matches the sheet's 56px side padding
          const bandH = 20;      // mm — keep in sync with the bottom page margin
          for (let i = 1; i <= totalPages; i++) {
            pdf.setPage(i);
            const top = pageHeight - bandH;
            // Full-bleed navy band (#0d1f3c)
            pdf.setFillColor(13, 31, 60);
            pdf.rect(0, top, pageWidth, bandH, 'F');
            // Company block (left)
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(8.5);
            pdf.setTextColor(255, 255, 255);
            pdf.text('Xpress Finance Pty Ltd', sideMargin, top + 6);
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(6.5);
            pdf.setTextColor(150, 162, 184);
            pdf.text('ABN 616 500 599 39 · ACN 650 059 939', sideMargin, top + 9.8);
            pdf.text('Australian Credit Licence 389328', sideMargin, top + 12.8);
            // Page number (right)
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
