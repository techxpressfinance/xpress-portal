import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { Card, PageHeader, Select, Button } from '../../components/ui';
import { ACTION_ICON_CONFIG, ACTION_LABELS } from '../../lib/constants';
import { activityEntityLink, describeActivity } from '../../lib/activityLog';
import ActivityChanges from '../../components/ActivityChanges';
import { formatDateTime } from '../../lib/utils';
import type { ActivityLog, User } from '../../types';
import { ClockIcon } from '@heroicons/react/24/outline';


export default function ActivityLogs() {
  const { toast } = useToast();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [brokerFilter, setBrokerFilter] = useState('');
  const [referrerFilter, setReferrerFilter] = useState('');
  const [dateRangeFilter, setDateRangeFilter] = useState('');
  const [clientsList, setClientsList] = useState<{ id: string; full_name: string }[]>([]);
  const [brokersList, setBrokersList] = useState<{ id: string; full_name: string }[]>([]);
  const [referrersList, setReferrersList] = useState<{ id: string; full_name: string }[]>([]);
  const perPage = 20;

  // Fetch users for the filter dropdowns
  useEffect(() => {
    api.get('/users').then(({ data }) => {
      const users = data as User[];
      setClientsList(users.filter((u) => u.role === 'client').map((u) => ({ id: u.id, full_name: u.full_name })));
      setBrokersList(users.filter((u) => u.role === 'broker' || u.role === 'admin').map((u) => ({ id: u.id, full_name: u.full_name })));
      setReferrersList(users.filter((u) => u.role === 'referrer').map((u) => ({ id: u.id, full_name: u.full_name })));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('per_page', String(perPage));
    if (actionFilter) params.set('action', actionFilter);
    const activeUserFilter = clientFilter || brokerFilter || referrerFilter;
    if (activeUserFilter) params.set('user_id', activeUserFilter);
    if (dateRangeFilter) params.set('date_range', dateRangeFilter);

    api
      .get(`/activity-logs?${params}`)
      .then(({ data }) => {
        setLogs(data.items);
        setTotal(data.total);
      })
      .catch(() => toast('Failed to load activity logs', 'error'))
      .finally(() => setLoading(false));
  }, [page, actionFilter, clientFilter, brokerFilter, referrerFilter, dateRangeFilter]);

  const totalPages = Math.ceil(total / perPage);

  return (
    <div>
      <PageHeader title="Activity Log" subtitle="Track all actions across the platform" />

      {/* Filters */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <Select
            label="Action Type"
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          >
            <option value="">All Actions</option>
            <option value="created">Created</option>
            <option value="submitted">Submitted</option>
            <option value="updated">Updated</option>
            <option value="lead_submitted">Lead Submitted</option>
            <option value="client_referred">Client Referred</option>
            <option value="status_changed">Status Changed</option>
            <option value="broker_assigned">Broker Assigned</option>
            <option value="broker_unassigned">Broker Removed</option>
            <option value="document_verified">Document Verified</option>
            <option value="broker_completed">Broker Completed</option>
          </Select>
          <Select
            label="Client"
            value={clientFilter}
            onChange={(e) => { setClientFilter(e.target.value); setBrokerFilter(''); setReferrerFilter(''); setPage(1); }}
          >
            <option value="">All Clients</option>
            {clientsList.map((u) => (
              <option key={u.id} value={u.id}>{u.full_name}</option>
            ))}
          </Select>
          <Select
            label="Broker"
            value={brokerFilter}
            onChange={(e) => { setBrokerFilter(e.target.value); setClientFilter(''); setReferrerFilter(''); setPage(1); }}
          >
            <option value="">All Brokers</option>
            {brokersList.map((u) => (
              <option key={u.id} value={u.id}>{u.full_name}</option>
            ))}
          </Select>
          <Select
            label="Referrer"
            value={referrerFilter}
            onChange={(e) => { setReferrerFilter(e.target.value); setClientFilter(''); setBrokerFilter(''); setPage(1); }}
          >
            <option value="">All Referrers</option>
            {referrersList.map((u) => (
              <option key={u.id} value={u.id}>{u.full_name}</option>
            ))}
          </Select>
          <Select
            label="Period"
            value={dateRangeFilter}
            onChange={(e) => { setDateRangeFilter(e.target.value); setPage(1); }}
          >
            <option value="">All Time</option>
            <option value="this_month">This Month</option>
            <option value="last_month">Last Month</option>
            <option value="this_quarter">This Quarter</option>
            <option value="last_quarter">Last Quarter</option>
            <option value="this_year">This Year</option>
          </Select>
          <div className="self-end pb-1 flex items-center gap-3">
            {(actionFilter || clientFilter || brokerFilter || referrerFilter || dateRangeFilter) && (
              <button
                onClick={() => { setActionFilter(''); setClientFilter(''); setBrokerFilter(''); setReferrerFilter(''); setDateRangeFilter(''); setPage(1); }}
                className="text-[12px] font-medium text-muted-foreground hover:text-destructive transition-colors"
              >
                Clear all
              </button>
            )}
            <span className="rounded-full bg-secondary px-3 py-1.5 text-[12px] font-medium text-foreground">
              {total} entries
            </span>
          </div>
        </div>
      </Card>

      {/* Log Entries */}
      <Card padding="none">
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
              <ClockIcon className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-[14px] text-muted-foreground font-medium">No activity logs found</p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-border">
              {logs.map((log) => {
                const { summary, changes, fields } = describeActivity(log);
                const actionConfig = ACTION_ICON_CONFIG[log.action];
                const entityLink = activityEntityLink(log);

                return (
                  <div key={log.id} className="flex items-start gap-4 px-6 py-4 transition-colors hover:bg-secondary/50" style={{ transitionTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}>
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${actionConfig?.bg || 'bg-secondary text-muted-foreground'}`}>
                      {actionConfig?.icon || (
                        <ClockIcon className="h-4 w-4" strokeWidth={2} />
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
                      {summary && (
                        <p className="text-[13px] text-muted-foreground">{summary}</p>
                      )}
                      <ActivityChanges changes={changes} fields={fields} />
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-[12px] text-muted-foreground">
                          {log.entity_type} &middot; {log.entity_id.slice(0, 8)}...
                        </p>
                        {entityLink && (
                          <Link
                            to={entityLink.to}
                            className="text-[12px] font-medium text-[#0071e3] hover:underline"
                          >
                            {entityLink.label} &rarr;
                          </Link>
                        )}
                      </div>
                    </div>
                    <span className="text-[12px] text-muted-foreground whitespace-nowrap pt-1">
                      {formatDateTime(log.created_at)}
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
      </Card>
    </div>
  );
}
