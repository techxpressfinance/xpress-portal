import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { Button, GlassCard } from '../../components/ui';
import { SERVICE_REQUEST_TYPES } from '../../lib/constants';
import { formatDate } from '../../lib/utils';
import type { ServiceRequest, ServiceRequestStatus } from '../../types';

const DONE_STATUSES: ServiceRequestStatus[] = ['resolved', 'closed'];

const STATUS_CHIP: Record<ServiceRequestStatus, string> = {
  pending: 'led-chip-warning',
  in_progress: 'led-chip-info',
  resolved: 'led-chip-success',
  closed: '',
};

const STATUS_LABEL: Record<ServiceRequestStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

export default function ClientServiceRequests() {
  const { toast } = useToast();
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'active' | 'completed'>('active');
  const [showModal, setShowModal] = useState(false);
  const [requestType, setRequestType] = useState('Status Update');
  const [customRequest, setCustomRequest] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get('/service-requests?per_page=100')
      .then(({ data }) => setRequests(data.items))
      .catch(() => toast('Failed to load service requests', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const openModal = () => {
    setRequestType('Status Update');
    setCustomRequest('');
    setDescription('');
    setShowModal(true);
  };

  const handleSubmit = async () => {
    if (requestType === 'Other' && !customRequest.trim()) {
      toast('Please describe your request', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post('/service-requests', {
        request_type: requestType,
        custom_request: requestType === 'Other' ? customRequest.trim() : null,
        description: description.trim() || null,
      });
      setRequests((prev) => [data, ...prev]);
      setShowModal(false);
      toast('Service request submitted', 'success');
    } catch {
      toast('Failed to submit request', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const active = requests.filter((r) => !DONE_STATUSES.includes(r.status));
  const completed = requests.filter((r) => DONE_STATUSES.includes(r.status));
  const displayed = tab === 'active' ? active : completed;

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col pb-8">
      <div className="mb-8 mt-2 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="led-chip led-chip-accent">Service Requests</span>
          </div>
          <h1 className="text-[34px] font-semibold tracking-[-0.05em] text-[var(--led-ink)]">Service Requests</h1>
          <p className="text-[14px] leading-6 text-[var(--led-muted)]">Raise a request and your broker will follow up</p>
        </div>
        <Button size="lg" onClick={openModal}>+ New Request</Button>
      </div>

      <div className="flex gap-1 mb-6 p-1 bg-[var(--led-surface-2)] rounded-xl w-fit">
        {([['active', 'Active', active.length], ['completed', 'Completed', completed.length]] as const).map(([value, label, count]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors flex items-center gap-1.5 ${
              tab === value ? 'bg-[var(--led-surface)] text-[var(--led-ink)] shadow-sm' : 'text-[var(--led-muted)] hover:text-[var(--led-ink)]'
            }`}
          >
            {label}
            {count > 0 && (
              <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-semibold ${
                tab === value ? 'bg-[var(--led-accent-tint)] text-[var(--led-accent-ink)]' : 'bg-[var(--led-line)] text-[var(--led-muted)]'
              }`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <GlassCard padding="none">
          <div className="p-4 space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="h-12 rounded-xl shimmer" />)}
          </div>
        </GlassCard>
      ) : displayed.length === 0 ? (
        <GlassCard padding="none">
          <div className="px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--led-surface-2)]">
              <svg className="h-8 w-8 text-[var(--led-muted)]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
              </svg>
            </div>
            <p className="text-[14px] font-medium text-[var(--led-ink)] mb-1">
              {tab === 'active' ? 'No active requests' : 'No completed requests'}
            </p>
            <p className="text-[13px] text-[var(--led-muted)] mb-5">
              {tab === 'active' ? 'Submit a request and your broker will be notified' : 'Resolved requests will appear here'}
            </p>
            {tab === 'active' && <Button onClick={openModal}>New Request</Button>}
          </div>
        </GlassCard>
      ) : (
        <GlassCard padding="none">
          <div className="divide-y divide-[var(--led-line)]">
            {displayed.map((req) => {
              const isDone = DONE_STATUSES.includes(req.status);
              const label = req.request_type === 'Other' && req.custom_request ? req.custom_request : req.request_type;
              return (
                <div key={req.id} className={`flex items-start gap-4 px-6 py-5 ${isDone ? 'opacity-60' : ''}`}>
                  {isDone ? (
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-[var(--led-success)]" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  ) : (
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-[var(--led-accent)]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
                    </svg>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[14px] font-semibold ${isDone ? 'line-through text-[var(--led-muted)]' : 'text-[var(--led-ink)]'}`}>
                        {label}
                      </span>
                      <span className={`led-chip ${STATUS_CHIP[req.status]}`}>
                        {STATUS_LABEL[req.status]}
                      </span>
                    </div>
                    {req.assigned_broker_name && (
                      <p className="text-[12px] text-[var(--led-muted)] mt-0.5">Assigned to {req.assigned_broker_name}</p>
                    )}
                    {req.description && (
                      <p className="text-[12px] text-[var(--led-muted)] mt-0.5 line-clamp-2">{req.description}</p>
                    )}
                    <p className="text-[11px] text-[var(--led-muted)] mt-0.5">{formatDate(req.created_at)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}

      {showModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative w-full max-w-md rounded-2xl border border-[var(--led-line)] bg-[var(--led-surface)] shadow-xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[16px] font-semibold text-[var(--led-ink)]">New Service Request</h2>
              <button onClick={() => setShowModal(false)} className="rounded-lg p-1 text-[var(--led-muted)] hover:text-[var(--led-ink)] hover:bg-[var(--led-surface-2)] transition-colors">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-[var(--led-ink)] mb-1.5">Request type</label>
                <select
                  value={requestType}
                  onChange={(e) => setRequestType(e.target.value)}
                  className="w-full rounded-xl border border-[var(--led-line)] bg-[var(--led-surface-2)] px-4 py-2.5 text-[14px] text-[var(--led-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--led-accent)]/30 transition-all"
                >
                  {SERVICE_REQUEST_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              {requestType === 'Other' && (
                <div>
                  <label className="block text-[13px] font-medium text-[var(--led-ink)] mb-1.5">Describe your request <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={customRequest}
                    onChange={(e) => setCustomRequest(e.target.value)}
                    placeholder="Briefly describe what you need..."
                    className="w-full rounded-xl border border-[var(--led-line)] bg-[var(--led-surface-2)] px-4 py-2.5 text-[14px] text-[var(--led-ink)] placeholder:text-[var(--led-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--led-accent)]/30 transition-all"
                  />
                </div>
              )}

              <div>
                <label className="block text-[13px] font-medium text-[var(--led-ink)] mb-1.5">Additional details <span className="text-[var(--led-muted)] font-normal">(optional)</span></label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="Any additional context..."
                  className="w-full rounded-xl border border-[var(--led-line)] bg-[var(--led-surface-2)] px-4 py-2.5 text-[14px] text-[var(--led-ink)] placeholder:text-[var(--led-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--led-accent)]/30 transition-all resize-none"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <Button variant="secondary" className="flex-1" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button className="flex-1" onClick={handleSubmit} loading={submitting}>Submit Request</Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
