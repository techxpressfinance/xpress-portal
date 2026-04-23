import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { Badge, GlassCard, PageHeader } from '../../components/ui';
import { SERVICE_REQUEST_STATUS_BADGE } from '../../lib/constants';
import { formatDate } from '../../lib/utils';
import type { ServiceRequest, ServiceRequestStatus } from '../../types';

const STATUS_OPTIONS: { value: ServiceRequestStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

export default function AdminServiceRequests() {
  const { toast } = useToast();
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadRequests = (status?: string) => {
    setLoading(true);
    const params = new URLSearchParams({ per_page: '50' });
    if (status) params.set('status', status);
    api
      .get(`/service-requests?${params}`)
      .then(({ data }) => setRequests(data.items))
      .catch(() => toast('Failed to load service requests', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadRequests(statusFilter || undefined);
  }, [statusFilter]);

  const updateStatus = async (id: string, status: ServiceRequestStatus) => {
    setUpdatingId(id);
    try {
      const { data } = await api.patch(`/service-requests/${id}`, { status });
      setRequests((prev) => prev.map((r) => (r.id === id ? data : r)));
      toast('Status updated', 'success');
    } catch {
      toast('Failed to update status', 'error');
    } finally {
      setUpdatingId(null);
    }
  };

  const badge = (status: ServiceRequestStatus) =>
    SERVICE_REQUEST_STATUS_BADGE[status] ?? { label: status, className: '' };

  return (
    <div>
      <PageHeader
        title="Service Requests"
        subtitle="Client requests requiring your attention"
      />

      {/* Filter */}
      <div className="mb-5 flex items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <span className="text-[13px] text-muted-foreground">{requests.length} request{requests.length !== 1 ? 's' : ''}</span>
      </div>

      {loading ? (
        <GlassCard>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-xl shimmer" />
            ))}
          </div>
        </GlassCard>
      ) : requests.length === 0 ? (
        <GlassCard className="px-6 py-16 text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
            <svg className="h-10 w-10 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
            </svg>
          </div>
          <h3 className="text-[15px] font-semibold text-foreground mb-1">No service requests</h3>
          <p className="text-[14px] text-muted-foreground">Client requests will appear here</p>
        </GlassCard>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => {
            const b = badge(req.status);
            const displayLabel =
              req.request_type === 'Other' && req.custom_request
                ? req.custom_request
                : req.request_type;
            return (
              <GlassCard key={req.id} className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[14px] font-semibold text-foreground">{displayLabel}</p>
                      {req.request_type === 'Other' && req.custom_request && (
                        <span className="text-[12px] text-muted-foreground">({req.request_type})</span>
                      )}
                    </div>
                    {req.client_name && (
                      <p className="text-[13px] text-muted-foreground mt-0.5">
                        {req.client_name}
                        {req.client_email && <span className="ml-1 text-muted-foreground/70">· {req.client_email}</span>}
                      </p>
                    )}
                    {req.description && (
                      <p className="text-[13px] text-muted-foreground mt-1 line-clamp-2">{req.description}</p>
                    )}
                    <p className="text-[12px] text-muted-foreground mt-1">{formatDate(req.created_at)}</p>
                  </div>

                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Badge type="custom" value={b.label} className={b.className} />
                    <select
                      value={req.status}
                      disabled={updatingId === req.id}
                      onChange={(e) => updateStatus(req.id, e.target.value as ServiceRequestStatus)}
                      className="rounded-lg border border-border bg-background px-2 py-1 text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
