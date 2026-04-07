import html2pdf from 'html2pdf.js';

/**
 * Download a quote sheet as a landscape A4 PDF.
 * Captures the DOM element by its ID and renders it at 2x scale for crisp output.
 */
export async function downloadQuoteSheetPdf(elementId: string, filename: string): Promise<void> {
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
          margin: [0, 0, 0, 0], // Margins handled by padding on the clone now
          filename,
          pagebreak: { mode: 'css', avoid: '.break-inside-avoid' },
          image: { type: 'jpeg', quality: 1.0 },
          html2canvas: { scale: 2, useCORS: true, logging: false },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        })
        .from(clone)
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
