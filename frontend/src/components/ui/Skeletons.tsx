import Skeleton from './Skeleton';

/**
 * Shimmer rows for a data table. Drop inside <tbody>; pass one width per
 * column so the skeleton mirrors the real column layout.
 */
export function TableSkeleton({
  rows = 6,
  widths,
  cellClassName = 'py-3',
  rowClassName = 'border-b border-border/50',
}: {
  rows?: number;
  /** One entry per column — the shimmer width in px for that cell. */
  widths: number[];
  cellClassName?: string;
  rowClassName?: string;
}) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className={rowClassName}>
          {widths.map((w, c) => (
            <td key={c} className={cellClassName}>
              <Skeleton width={w} height={14} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Shimmer stack for card/row lists (messages, quote sheets, groups). */
export function ListSkeleton({ rows = 4, rowHeight = 64 }: { rows?: number; rowHeight?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} width="100%" height={rowHeight} className="rounded-lg" />
      ))}
    </div>
  );
}

/** Shimmer layout for a detail page: title bar, meta line, content blocks. */
export function DetailSkeleton({ blocks = 3 }: { blocks?: number }) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton width={260} height={24} />
        <Skeleton width={180} height={14} />
      </div>
      {Array.from({ length: blocks }, (_, i) => (
        <Skeleton key={i} width="100%" height={120} className="rounded-lg" />
      ))}
    </div>
  );
}
