import { useEffect, useState } from 'react';
import api from '../../api/client';
import { GlassCard, PageHeader, Select, Button } from '../../components/ui';
import { ACTION_ICON_CONFIG, ACTION_LABELS } from '../../lib/constants';
import type { ActivityLog } from '../../types';


export default function ActivityLogs() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const perPage = 20;

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('per_page', String(perPage));
    if (actionFilter) params.set('action', actionFilter);

    api
      .get(`/activity-logs?${params}`)
      .then(({ data }) => {
        setLogs(data.items);
        setTotal(data.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, actionFilter]);

  const totalPages = Math.ceil(total / perPage);

  return (
    <div>
      <PageHeader title="Activity Log" subtitle="Track all actions across the platform" />

      {/* Filters */}
      <GlassCard className="mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <Select
            label="Action Type"
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          >
            <option value="">All Actions</option>
            <option value="created">Created</option>
            <option value="status_changed">Status Changed</option>
            <option value="broker_assigned">Broker Assigned</option>
            <option value="document_verified">Document Verified</option>
          </Select>
          <div className="self-end pb-1">
            <span className="rounded-full bg-secondary px-3 py-1.5 text-[12px] font-medium text-foreground">
              {total} entries
            </span>
          </div>
        </div>
      </GlassCard>

      {/* Log Entries */}
      <GlassCard padding="none">
        {loading ? (
          <div className="p-6">
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-xl shimmer" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-40 rounded-lg shimmer" />
                    <div className="h-3 w-56 rounded-lg shimmer" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : logs.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
              <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
            </div>
            <p className="text-[14px] text-muted-foreground font-medium">No activity logs found</p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-border">
              {logs.map((log) => {
                let details: Record<string, string> = {};
                try {
                  if (log.details) details = JSON.parse(log.details);
                } catch {}

                let description = '';
                if (log.action === 'status_changed' && details.from && details.to) {
                  description = `${details.from} \u2192 ${details.to}`;
                } else if (log.action === 'broker_assigned' && details.broker_name) {
                  description = `Assigned to ${details.broker_name}`;
                } else if (log.action === 'document_verified' && details.filename) {
                  description = `${details.filename} (${details.doc_type || ''})`;
                } else if (log.action === 'created' && details.loan_type) {
                  description = `${details.loan_type} loan - $${Number(details.amount || 0).toLocaleString()}`;
                }

                const actionConfig = ACTION_ICON_CONFIG[log.action];

                return (
                  <div key={log.id} className="flex items-start gap-4 px-6 py-4 transition-colors hover:bg-secondary/50" style={{ transitionTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}>
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${actionConfig?.bg || 'bg-secondary text-muted-foreground'}`}>
                      {actionConfig?.icon || (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[14px] font-semibold text-foreground">
                          {ACTION_LABELS[log.action] || log.action}
                        </span>
                        {log.user_name && (
                          <span className="text-[13px] text-muted-foreground">
                            by <span className="font-medium text-foreground">{log.user_name}</span>
                          </span>
                        )}
                      </div>
                      {description && (
                        <p className="text-[13px] text-muted-foreground">{description}</p>
                      )}
                      <p className="text-[12px] text-muted-foreground mt-1">
                        {log.entity_type} &middot; {log.entity_id.slice(0, 8)}...
                      </p>
                    </div>
                    <span className="text-[12px] text-muted-foreground whitespace-nowrap pt-1">
                      {new Date(log.created_at).toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-6 py-4">
                <span className="text-[13px] text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                    Previous
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </GlassCard>
    </div>
  );
}
