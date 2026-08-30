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

/**
 * Shimmer stand-in for a chart. Draws bars of varying height so the
 * placeholder occupies the same shape as the chart that replaces it,
 * rather than collapsing to a line of centred "Loading..." text.
 */
export function ChartSkeleton({ height = 300, bars = 8 }: { height?: number; bars?: number }) {
  // Fixed ratios, not random, so the shape does not reshuffle between renders.
  const ratios = [0.72, 0.44, 0.9, 0.58, 0.34, 0.81, 0.5, 0.66, 0.4, 0.85];
  return (
    <div className="flex items-end gap-2 sm:gap-3 px-2 pb-2" style={{ height }} aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => (
        <Skeleton
          key={i}
          width="100%"
          height={`${Math.round(ratios[i % ratios.length] * 100)}%`}
          className="!rounded-b-none"
        />
      ))}
    </div>
  );
}
