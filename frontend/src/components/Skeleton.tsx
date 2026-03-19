export function SkeletonCard() {
  return (
    <div className="rounded-2xl bg-card shadow-[0_0_0_1px_var(--border),0_1px_3px_0_rgba(0,0,0,0.04)] p-5">
      <div className="h-3 w-20 rounded-lg shimmer mb-3" />
      <div className="h-7 w-14 rounded-lg shimmer mb-2" />
      <div className="h-3 w-16 rounded-lg shimmer" />
    </div>
  );
}

export function SkeletonRow() {
  return (
    <tr>
      <td className="px-6 py-3.5"><div className="h-4 w-20 rounded-lg shimmer" /></td>
      <td className="px-6 py-3.5"><div className="h-4 w-16 rounded-lg shimmer" /></td>
      <td className="px-6 py-3.5"><div className="h-4 w-14 rounded-lg shimmer" /></td>
      <td className="px-6 py-3.5"><div className="h-4 w-24 rounded-lg shimmer" /></td>
      <td className="px-6 py-3.5"><div className="h-4 w-10 rounded-lg shimmer" /></td>
    </tr>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-2xl bg-card shadow-[0_0_0_1px_var(--border),0_1px_3px_0_rgba(0,0,0,0.04)] overflow-hidden" style={{ padding: 0 }}>
      <table className="w-full text-left text-[14px]">
        <thead>
          <tr className="border-b border-border">
            {[1, 2, 3, 4, 5].map((i) => (
              <th key={i} className="px-6 py-3.5">
                <div className="h-3 w-16 rounded-lg shimmer" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {Array.from({ length: rows }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SkeletonDetail() {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-card shadow-[0_0_0_1px_var(--border),0_1px_3px_0_rgba(0,0,0,0.04)] p-6">
        <div className="h-5 w-40 rounded-lg shimmer mb-5" />
        <div className="grid gap-4 sm:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl bg-secondary p-4">
              <div className="h-3 w-16 rounded-lg shimmer mb-2" />
              <div className="h-5 w-24 rounded-lg shimmer" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
