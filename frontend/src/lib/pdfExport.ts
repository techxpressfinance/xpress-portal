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
