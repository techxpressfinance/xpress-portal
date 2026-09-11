import { useState } from 'react';
import LenderPricingPdf from '../components/LenderPricingPdf';
import { useToast } from '../components/Toast';
import { downloadElementPdf } from '../lib/pdfExport';
import type { QuoteSheet } from '../types';

const ELEMENT_ID = 'lender-pricing-pdf';

interface PdfContext {
  clientName?: string;
  applicationRef?: string;
}

/**
 * Download a lender pricing sheet as a PDF. `downloadPdf` mounts the print
 * block off-screen, captures it and unmounts it again — render `pdfNode`
 * anywhere on the page so the block has somewhere to mount.
 */
export function useLenderPricingPdf() {
  const { toast } = useToast();
  const [job, setJob] = useState<{ sheet: QuoteSheet; context: PdfContext } | null>(null);

  const downloadPdf = async (sheet: QuoteSheet, context: PdfContext = {}) => {
    setJob({ sheet, context });
    // Let React mount the print block before html2pdf reads it.
    await new Promise(r => setTimeout(r, 300));
    try {
      await downloadElementPdf(ELEMENT_ID, `lender-pricing-v${sheet.version}.pdf`, 'portrait');
    } catch {
      toast('Failed to generate PDF', 'error');
    } finally {
      setJob(null);
    }
  };

  const pdfNode = job ? (
    <div style={{ position: 'fixed', left: '-9999px', top: 0 }}>
      <LenderPricingPdf
        sheet={job.sheet}
        elementId={ELEMENT_ID}
        clientName={job.context.clientName}
        applicationRef={job.context.applicationRef}
      />
    </div>
  ) : null;

  return { downloadPdf, pdfSheetId: job?.sheet.id ?? null, pdfNode };
}
