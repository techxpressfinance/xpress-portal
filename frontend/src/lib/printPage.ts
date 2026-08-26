/**
 * Page geometry shared by the PDF exports and the print blocks they capture.
 *
 * Kept in its own leaf module so a print component can size itself without
 * importing the PDF engine.
 */

/**
 * Inner page width in CSS px for A4 at 96dpi with no side margins.
 *
 * html2pdf drops the source element into a container of exactly
 * `pageSize.inner.width` inside an `overflow: hidden` overlay, so a print block
 * wider than this doesn't scale down — it loses its right-hand edge. Every
 * print block passed to downloadElementPdf must use these widths.
 */
export const A4_PRINT_WIDTH_PX = { portrait: 794, landscape: 1122 } as const;

/** Side inset for print blocks, so a full-bleed masthead and the body below it
 *  share one left edge (~8.5mm on A4). */
export const PRINT_INSET = 32;
