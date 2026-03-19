import type { ReactNode } from 'react';

interface Column<T> {
  key: string;
  header: string;
  render: (item: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  skeletonRows?: number;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
  keyExtractor: (item: T) => string;
}

export default function DataTable<T>({
  columns,
  data,
  loading = false,
  skeletonRows = 5,
  emptyMessage = 'No data found',
  emptyIcon,
  keyExtractor,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className="rounded-2xl bg-card shadow-[0_0_0_1px_var(--border),0_1px_3px_0_rgba(0,0,0,0.04),0_2px_8px_0_rgba(0,0,0,0.02)] overflow-hidden" style={{ padding: 0 }}>
        <table className="w-full text-left text-[14px]">
          <thead>
            <tr className="border-b border-border">
              {columns.map((col) => (
                <th key={col.key} className="px-6 py-4">
                  <div className="h-3 w-16 rounded shimmer" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {Array.from({ length: skeletonRows }).map((_, i) => (
              <tr key={i}>
                {columns.map((col) => (
                  <td key={col.key} className="px-6 py-4">
                    <div className="h-4 w-20 rounded shimmer" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-2xl bg-card shadow-[0_0_0_1px_var(--border),0_1px_3px_0_rgba(0,0,0,0.04),0_2px_8px_0_rgba(0,0,0,0.02)] px-6 py-16 text-center">
        {emptyIcon && (
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
            {emptyIcon}
          </div>
        )}
        <p className="text-[15px] text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-card shadow-[0_0_0_1px_var(--border),0_1px_3px_0_rgba(0,0,0,0.04),0_2px_8px_0_rgba(0,0,0,0.02)] overflow-hidden" style={{ padding: 0 }}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[14px]">
          <thead>
            <tr className="border-b border-border">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-6 py-3.5 text-[12px] font-medium text-muted-foreground ${col.className || ''}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.map((item) => (
              <tr key={keyExtractor(item)} className="transition-colors hover:bg-secondary/50">
                {columns.map((col) => (
                  <td key={col.key} className={`px-6 py-3.5 ${col.className || ''}`}>
                    {col.render(item)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
