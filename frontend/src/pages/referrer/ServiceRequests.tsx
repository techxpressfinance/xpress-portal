import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { Button, Card, PageHeader } from '../../components/ui';
import { SERVICE_REQUEST_TYPES } from '../../lib/constants';
import { formatDate } from '../../lib/utils';
import type { ServiceRequest, ServiceRequestAttachment, ServiceRequestStatus } from '../../types';
import { CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

const DONE_STATUSES: ServiceRequestStatus[] = ['resolved', 'closed'];

const STATUS_COLOR: Record<ServiceRequestStatus, string> = {
  pending: 'text-amber-600 bg-amber-50 border-amber-200',
  in_progress: 'text-blue-600 bg-blue-50 border-blue-200',
  resolved: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  closed: 'text-muted-foreground bg-secondary border-border',
};

const STATUS_LABEL: Record<ServiceRequestStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

export default function ReferrerServiceRequests() {
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

  const renderRow = (req: ServiceRequest) => {
    const isDone = DONE_STATUSES.includes(req.status);
    const label = req.request_type === 'Other' && req.custom_request ? req.custom_request : req.request_type;
    const attachments = req.attachments ?? [];

    return (
      <div
        key={req.id}
        className={`px-4 py-3 border-l-2 transition-colors ${isDone ? 'border-transparent opacity-70' : 'border-primary/40'} ${dragOverId === req.id ? 'bg-primary/5' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOverId(req.id); }}
        onDragLeave={() => setDragOverId((cur) => (cur === req.id ? null : cur))}
        onDrop={(e) => {
          e.preventDefault();
          setDragOverId(null);
          const file = e.dataTransfer.files?.[0];
          if (file) uploadAttachment(req.id, file);
        }}
      >
        <div className="flex items-start gap-3">
          {isDone ? (
            <CheckIcon className="mt-1 h-5 w-5 shrink-0 text-emerald-500" strokeWidth={2.5} />
          ) : (
            <svg className="mt-1 h-5 w-5 shrink-0 text-primary/50" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
            </svg>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[14px] font-semibold ${isDone ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                {label}
              </span>
              <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${STATUS_COLOR[req.status]}`}>
                {STATUS_LABEL[req.status]}
              </span>
            </div>
            {(req.assigned_brokers?.length ?? 0) > 0 && (
              <p className="text-[12px] text-muted-foreground mt-0.5">Assigned to {req.assigned_brokers.map((b) => b.full_name).join(', ')}</p>
            )}
            {req.description && (
              <p className="text-[12px] text-muted-foreground mt-0.5 line-clamp-2">{req.description}</p>
            )}
            <p className="text-[11px] text-muted-foreground mt-0.5">{formatDate(req.created_at)}</p>
          </div>
          <button
            type="button"
            title="Attach a file"
            onClick={() => (attachments.length > 0 ? setExpandedId((cur) => (cur === req.id ? null : req.id)) : triggerUpload(req.id))}
            disabled={uploadingId === req.id}
            className="shrink-0 flex items-center gap-1 rounded-lg px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
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
          <div className="mt-2 ml-8 space-y-1.5">
            {attachments.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-secondary/60 px-3 py-1.5">
                <button type="button" onClick={() => downloadAttachment(req.id, a)} className="min-w-0 truncate text-[12px] text-foreground hover:underline text-left">
                  {a.original_filename}
                </button>
                <span className="shrink-0 text-[11px] text-muted-foreground">{formatDate(a.uploaded_at)}</span>
              </div>
            ))}
            <button type="button" onClick={() => triggerUpload(req.id)} className="text-[12px] text-primary hover:underline">
              + Attach another file
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Service Requests"
        subtitle="Raise a request and your broker will follow up"
        action={<Button onClick={openModal}>+ New Request</Button>}
      />

      <div className="flex gap-1 mb-4 p-1 bg-secondary rounded-xl w-fit">
        {([['active', 'Active', active.length], ['completed', 'Completed', completed.length]] as const).map(([value, label, count]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors flex items-center gap-1.5 ${
              tab === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
            {count > 0 && (
              <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-semibold ${
                tab === value ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
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
        <Card className="px-6 py-12 text-center">
          <p className="text-[14px] font-medium text-foreground">
            {tab === 'active' ? 'No active requests' : 'No completed requests'}
          </p>
          <p className="text-[13px] text-muted-foreground mt-1 mb-4">
            {tab === 'active' ? 'Submit a request and your broker will be notified' : 'Resolved requests will appear here'}
          </p>
          {tab === 'active' && <Button onClick={openModal}>New Request</Button>}
        </Card>
      ) : (
        <Card padding="none">
          <div className="divide-y divide-border">
            {displayed.map(renderRow)}
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
          <div className="relative w-full max-w-md rounded-2xl bg-card border border-border shadow-xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[16px] font-semibold text-foreground">New Service Request</h2>
              <button onClick={() => setShowModal(false)} className="rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                <XMarkIcon className="h-5 w-5" />
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
                  {SERVICE_REQUEST_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
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
                  placeholder="Any additional context..."
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
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
