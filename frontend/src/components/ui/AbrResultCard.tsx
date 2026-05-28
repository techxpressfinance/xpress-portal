import type { AbrRecord } from '../../types';

export default function AbrResultCard({
  record,
  loading,
  onApply,
}: {
  record: AbrRecord | null;
  loading?: boolean;
  onApply?: (record: AbrRecord) => void;
}) {
  if (loading) {
    return (
      <div className="mt-1.5 rounded-lg bg-secondary/60 px-3 py-2 text-[12px] text-muted-foreground">
        Looking up ABN with the Australian Business Register…
      </div>
    );
  }
  if (!record) return null;
  const active = (record.status || '').toLowerCase() === 'active';
  return (
    <div className="mt-1.5 rounded-lg border border-info/30 bg-info/10 px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-info truncate">{record.name || record.abn}</p>
          <p className="mt-0.5 text-[11px] text-info/80">
            {record.entity_type || 'Entity'}
            {record.status ? ` · ${record.status}` : ''}
            {record.state ? ` · ${record.state}` : ''}
            {record.gst_registered ? ' · GST registered' : ''}
          </p>
          {record.trading_names.length > 0 && (
            <p className="mt-0.5 text-[11px] text-info/80 truncate">
              Trading as: {record.trading_names.slice(0, 3).join(', ')}
            </p>
          )}
        </div>
        {onApply && active && (
          <button
            type="button"
            onClick={() => onApply(record)}
            className="shrink-0 text-[12px] font-medium text-info underline hover:opacity-80"
          >
            Auto-fill
          </button>
        )}
      </div>
    </div>
  );
}
