import type { QuoteSheetType } from '../types';

/**
 * The tag that tells a quote sheet apart from lender pricing.
 *
 * Both are `QuoteSheet` rows and look alike at a glance, but one goes to the
 * client and one never leaves the desk — so every list, header and editor that
 * can show either uses this one chip rather than inventing its own wording.
 */
const SHEET_TYPE_TAG: Record<QuoteSheetType, { label: string; hint: string; className: string }> = {
  client_quote: {
    label: 'Quote',
    hint: 'Client-facing — the option comparison the client receives',
    className: 'bg-chart-2/10 text-chart-2',
  },
  lender_pricing: {
    label: 'Lender Pricing',
    hint: 'Internal — the deal as the lender approved it, never shown to the client',
    className: 'bg-primary/10 text-primary',
  },
};

export default function SheetTypeTag({ type, className = '' }: { type: QuoteSheetType; className?: string }) {
  const tag = SHEET_TYPE_TAG[type];
  return (
    <span
      title={tag.hint}
      className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${tag.className} ${className}`}
    >
      {tag.label}
    </span>
  );
}
