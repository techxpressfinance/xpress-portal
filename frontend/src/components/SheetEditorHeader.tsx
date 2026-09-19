import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import SheetTypeTag from './SheetTypeTag';
import type { QuoteSheetType } from '../types';

interface Props {
  type: QuoteSheetType;
  /** Version of the sheet being edited; absent when creating a new one. */
  version?: number;
  onBack: () => void;
}

/**
 * Header for the quote sheet and lender pricing editors.
 *
 * Both forms are long enough that the only way out — the Cancel button — sits
 * well below the fold, so the way back gets its own anchored row at the top,
 * next to the tag that says which of the two you are in.
 */
export default function SheetEditorHeader({ type, version, onBack }: Props) {
  const noun = type === 'lender_pricing' ? 'Lender Pricing' : 'Quote Sheet';
  return (
    <div className="flex items-center gap-3 border-b border-border/60 pb-4">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        title="Back — discards unsaved changes"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <ArrowLeftIcon className="h-5 w-5" strokeWidth={2} />
      </button>
      <h3 className="text-[15px] font-semibold text-foreground">
        {version != null ? `Edit ${noun} v${version}` : `New ${noun}`}
      </h3>
      <SheetTypeTag type={type} />
    </div>
  );
}
