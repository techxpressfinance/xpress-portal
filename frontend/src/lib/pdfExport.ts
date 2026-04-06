/**
 * Download a quote sheet as a landscape A4 PDF.
 * Captures the DOM element by its ID and renders it at 2x scale for crisp output.
 *
 * Uses dynamic import to avoid Rollup bundling issues with html2pdf.js (UMD library).
 */
export async function downloadQuoteSheetPdf(elementId: string, filename: string): Promise<void> {
  const el = document.getElementById(elementId);
  if (!el) {
    console.error(`PDF export: element #${elementId} not found`);
    return;
  }

  // Dynamic import — html2pdf.js is a UMD/browser lib that Rollup can't statically resolve
  const html2pdf = (await import('html2pdf.js')).default;

  await html2pdf()
    .set({
      margin: [10, 10, 10, 10],
      filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
    })
    .from(el)
    .save();
}
