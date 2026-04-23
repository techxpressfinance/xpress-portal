import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { Badge, Button, GlassCard, PageHeader } from '../../components/ui';
import { SERVICE_REQUEST_STATUS_BADGE, SERVICE_REQUEST_TYPES } from '../../lib/constants';
import { formatDate } from '../../lib/utils';
import type { ServiceRequest } from '../../types';

export default function ClientServiceRequests() {
  const { toast } = useToast();
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [requestType, setRequestType] = useState('Status Update');
  const [customRequest, setCustomRequest] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .get('/service-requests')
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

  const badge = (status: ServiceRequest['status']) =>
    SERVICE_REQUEST_STATUS_BADGE[status] ?? { label: status, className: '' };

  return (
    <div>
      <PageHeader
        title="Service Requests"
        subtitle="Raise a request and your broker will follow up"
        action={<Button onClick={openModal}>+ New Request</Button>}
      />

      {loading ? (
        <GlassCard>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-xl shimmer" />
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
          <h3 className="text-[15px] font-semibold text-foreground mb-1">No requests yet</h3>
          <p className="text-[14px] text-muted-foreground mb-5">Submit a service request and your broker will be notified</p>
          <Button onClick={openModal}>New Request</Button>
        </GlassCard>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => {
            const b = badge(req.status);
            const label = req.request_type === 'Other' && req.custom_request ? req.custom_request : req.request_type;
            return (
              <GlassCard key={req.id} className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-foreground truncate">{label}</p>
                    {req.request_type === 'Other' && req.custom_request && (
                      <p className="text-[13px] text-muted-foreground">Type: {req.request_type}</p>
                    )}
                    {req.description && (
                      <p className="text-[13px] text-muted-foreground mt-1 line-clamp-2">{req.description}</p>
                    )}
                    <p className="text-[12px] text-muted-foreground mt-1">{formatDate(req.created_at)}</p>
                  </div>
                  <Badge type="custom" value={b.label} className={b.className} />
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}

      {/* New request modal */}
      {showModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative w-full max-w-md rounded-2xl bg-card border border-border shadow-xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[16px] font-semibold text-foreground">New Service Request</h2>
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-foreground mb-1.5">Request type</label>
                <select
                  value={requestType}
                  onChange={(e) => setRequestType(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {SERVICE_REQUEST_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              {requestType === 'Other' && (
                <div>
                  <label className="block text-[13px] font-medium text-foreground mb-1.5">Describe your request <span className="text-destructive">*</span></label>
                  <input
                    type="text"
                    value={customRequest}
                    onChange={(e) => setCustomRequest(e.target.value)}
                    placeholder="Briefly describe what you need..."
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}

              <div>
                <label className="block text-[13px] font-medium text-foreground mb-1.5">Additional details <span className="text-muted-foreground font-normal">(optional)</span></label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="Any additional context or details..."
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <Button variant="secondary" className="flex-1" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={handleSubmit} disabled={submitting}>
                {submitting ? 'Submitting...' : 'Submit Request'}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
