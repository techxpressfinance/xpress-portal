import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { Button, Card } from '../../components/ui';
import { SERVICE_REQUEST_TYPES } from '../../lib/constants';
import { formatDate } from '../../lib/utils';
import type { ServiceRequest, ServiceRequestAttachment, ServiceRequestStatus } from '../../types';
import { CheckIcon, ClipboardDocumentListIcon, XMarkIcon } from '@heroicons/react/24/outline';

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetId = useRef<string | null>(null);

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

  const uploadAttachment = async (reqId: string, file: File) => {
    if (file.size > MAX_ATTACHMENT_SIZE) {
      toast('File size exceeds 10MB limit', 'error');
      return;
    }
    setUploadingId(reqId);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post(`/service-requests/${reqId}/attachments`, formData);
      setRequests((prev) => prev.map((r) => (r.id === reqId ? data : r)));
      setExpandedId(reqId);
    } catch {
      toast('Failed to upload attachment', 'error');
    } finally {
      setUploadingId(null);
    }
  };

  const triggerUpload = (reqId: string) => {
    uploadTargetId.current = reqId;
    fileInputRef.current?.click();
  };

  const downloadAttachment = async (reqId: string, attachment: ServiceRequestAttachment) => {
    let url: string | null = null;
    let a: HTMLAnchorElement | null = null;
    try {
      const { data } = await api.get(`/service-requests/${reqId}/attachments/${attachment.id}/download`, { responseType: 'blob' });
      url = URL.createObjectURL(data);
      a = document.createElement('a');
      a.href = url;
      a.download = attachment.original_filename;
      document.body.appendChild(a);
      a.click();
    } catch {
      toast('Failed to download attachment', 'error');
    } finally {
      if (a && a.parentNode) document.body.removeChild(a);
      if (url) URL.revokeObjectURL(url);
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
          <h1 className="text-[26px] sm:text-[34px] font-semibold tracking-[-0.05em] text-[var(--led-ink)]">Service Requests</h1>
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
                tab === value ? 'bg-[var(--led-accent-tint)] text-[var(--led-accent)]' : 'bg-[var(--led-line)] text-[var(--led-muted)]'
              }`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <Card padding="none">
          <div className="p-4 space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="h-12 rounded-xl shimmer" />)}
          </div>
        </Card>
      ) : displayed.length === 0 ? (
        <Card padding="none">
          <div className="px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--led-surface-2)]">
              <ClipboardDocumentListIcon className="h-8 w-8 text-[var(--led-muted)]" />
            </div>
            <p className="text-[14px] font-medium text-[var(--led-ink)] mb-1">
              {tab === 'active' ? 'No active requests' : 'No completed requests'}
            </p>
            <p className="text-[13px] text-[var(--led-muted)] mb-5">
              {tab === 'active' ? 'Submit a request and your broker will be notified' : 'Resolved requests will appear here'}
            </p>
            {tab === 'active' && <Button onClick={openModal}>New Request</Button>}
          </div>
        </Card>
      ) : (
        <Card padding="none">
          <div className="divide-y divide-[var(--led-line)]">
            {displayed.map((req) => {
              const isDone = DONE_STATUSES.includes(req.status);
              const label = req.request_type === 'Other' && req.custom_request ? req.custom_request : req.request_type;
              const attachments = req.attachments ?? [];
              return (
                <div
                  key={req.id}
                  className={`px-6 py-5 transition-colors ${isDone ? 'opacity-60' : ''} ${dragOverId === req.id ? 'bg-[var(--led-accent)]/5' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setDragOverId(req.id); }}
                  onDragLeave={() => setDragOverId((cur) => (cur === req.id ? null : cur))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverId(null);
                    const file = e.dataTransfer.files?.[0];
                    if (file) uploadAttachment(req.id, file);
                  }}
                >
                  <div className="flex items-start gap-4">
                    {isDone ? (
                      <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-[var(--led-success)]" strokeWidth={2.5} />
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
                      {(req.assigned_brokers?.length ?? 0) > 0 && (
                        <p className="text-[12px] text-[var(--led-muted)] mt-0.5">Assigned to {req.assigned_brokers.map((b) => b.full_name).join(', ')}</p>
                      )}
                      {req.description && (
                        <p className="text-[12px] text-[var(--led-muted)] mt-0.5 line-clamp-2">{req.description}</p>
                      )}
                      <p className="text-[11px] text-[var(--led-muted)] mt-0.5">{formatDate(req.created_at)}</p>
                    </div>
                    <button
                      type="button"
                      title="Attach a file"
                      onClick={() => (attachments.length > 0 ? setExpandedId((cur) => (cur === req.id ? null : req.id)) : triggerUpload(req.id))}
                      disabled={uploadingId === req.id}
                      className="shrink-0 flex items-center gap-1 rounded-lg px-2 py-1 text-[var(--led-muted)] hover:text-[var(--led-ink)] hover:bg-[var(--led-surface-2)] transition-colors"
                    >
                      {uploadingId === req.id ? (
                        <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739 10.682 20.432a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.5L8.552 18.448a1.5 1.5 0 0 1-2.121-2.121L16.5 6.75" />
                        </svg>
                      )}
                      {attachments.length > 0 && (
                        <span className="text-[11px] font-semibold tabular-nums">{attachments.length}</span>
                      )}
                    </button>
                  </div>

                  {expandedId === req.id && attachments.length > 0 && (
                    <div className="mt-3 ml-9 space-y-1.5">
                      {attachments.map((a) => (
                        <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--led-surface-2)]/60 px-3 py-1.5">
                          <button type="button" onClick={() => downloadAttachment(req.id, a)} className="min-w-0 truncate text-[12px] text-[var(--led-ink)] hover:underline text-left">
                            {a.original_filename}
                          </button>
                          <span className="shrink-0 text-[11px] text-[var(--led-muted)]">{formatDate(a.uploaded_at)}</span>
                        </div>
                      ))}
                      <button type="button" onClick={() => triggerUpload(req.id)} className="text-[12px] text-[var(--led-accent)] hover:underline">
                        + Attach another file
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const reqId = uploadTargetId.current;
          if (file && reqId) uploadAttachment(reqId, file);
          e.target.value = '';
        }}
      />

      {showModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative w-full max-w-md rounded-2xl border border-[var(--led-line)] bg-[var(--led-surface)] shadow-xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[16px] font-semibold text-[var(--led-ink)]">New Service Request</h2>
              <button onClick={() => setShowModal(false)} className="rounded-lg p-1 text-[var(--led-muted)] hover:text-[var(--led-ink)] hover:bg-[var(--led-surface-2)] transition-colors">
                <XMarkIcon className="h-5 w-5" />
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
