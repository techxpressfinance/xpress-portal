import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { Button, GlassCard, PageHeader } from '../../components/ui';
import { SERVICE_REQUEST_TYPES } from '../../lib/constants';
import { formatDate } from '../../lib/utils';
import type { ServiceRequest, ServiceRequestStatus, User } from '../../types';

const ACTIVE_STATUSES: ServiceRequestStatus[] = ['pending', 'in_progress'];
const DONE_STATUSES: ServiceRequestStatus[] = ['resolved', 'closed'];

const STATUS_LABEL: Record<ServiceRequestStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

const STATUS_COLOR: Record<ServiceRequestStatus, string> = {
  pending: 'text-amber-600 bg-amber-50 border-amber-200',
  in_progress: 'text-blue-600 bg-blue-50 border-blue-200',
  resolved: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  closed: 'text-muted-foreground bg-secondary border-border',
};

export default function AdminServiceRequests() {
  const { toast } = useToast();
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'active' | 'completed'>('active');
  const [toggling, setToggling] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [brokers, setBrokers] = useState<User[]>([]);
  const [completedCollapsed, setCompletedCollapsed] = useState(false);
  const [editingReq, setEditingReq] = useState<ServiceRequest | null>(null);
  const [editType, setEditType] = useState('');
  const [editCustom, setEditCustom] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editBrokerNotes, setEditBrokerNotes] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    api.get('/service-requests?per_page=100')
      .then(({ data }) => setRequests(data.items))
      .catch(() => toast('Failed to load service requests', 'error'))
      .finally(() => setLoading(false));

    api.get('/users?role=broker&per_page=100')
      .then(({ data }) => setBrokers(data.items || data))
      .catch(() => {});
  }, []);

  const toggleComplete = async (req: ServiceRequest) => {
    if (toggling) return;
    setToggling(req.id);
    const newStatus: ServiceRequestStatus = DONE_STATUSES.includes(req.status) ? 'in_progress' : 'resolved';
    try {
      const { data } = await api.patch(`/service-requests/${req.id}`, { status: newStatus });
      setRequests((prev) => prev.map((r) => (r.id === req.id ? data : r)));
    } catch {
      toast('Failed to update', 'error');
    } finally {
      setToggling(null);
    }
  };

  const assignBroker = async (req: ServiceRequest, brokerId: string) => {
    setAssigningId(req.id);
    try {
      const { data } = await api.patch(`/service-requests/${req.id}`, { assigned_broker_id: brokerId });
      setRequests((prev) => prev.map((r) => (r.id === req.id ? data : r)));
    } catch {
      toast('Failed to assign', 'error');
    } finally {
      setAssigningId(null);
    }
  };

  const openEdit = (req: ServiceRequest) => {
    setEditType(req.request_type);
    setEditCustom(req.custom_request ?? '');
    setEditDesc(req.description ?? '');
    setEditBrokerNotes(req.broker_notes ?? '');
    setEditingReq(req);
  };

  const saveEdit = async () => {
    if (!editingReq) return;
    if (editType === 'Other' && !editCustom.trim()) {
      toast('Please describe the request', 'error');
      return;
    }
    setEditSaving(true);
    try {
      const { data } = await api.patch(`/service-requests/${editingReq.id}`, {
        request_type: editType,
        custom_request: editType === 'Other' ? editCustom.trim() : null,
        description: editDesc.trim() || null,
        broker_notes: editBrokerNotes.trim() || null,
      });
      setRequests((prev) => prev.map((r) => (r.id === editingReq.id ? data : r)));
      setEditingReq(null);
      toast('Service request updated', 'success');
    } catch {
      toast('Failed to update', 'error');
    } finally {
      setEditSaving(false);
    }
  };

  const active = requests.filter((r) => ACTIVE_STATUSES.includes(r.status));
  const completed = requests.filter((r) => DONE_STATUSES.includes(r.status));
  const displayed = tab === 'active' ? active : completed;

  const renderRow = (req: ServiceRequest) => {
    const isDone = DONE_STATUSES.includes(req.status);
    const label = req.request_type === 'Other' && req.custom_request ? req.custom_request : req.request_type;
    const isUnassigned = !req.assigned_broker_id;

    return (
      <div
        key={req.id}
        className={`flex items-start gap-3 px-4 py-3 transition-colors border-l-2 ${
          !isDone && isUnassigned
            ? 'border-amber-400 hover:bg-secondary/40'
            : isDone
            ? 'border-transparent opacity-60 hover:bg-secondary/30'
            : 'border-primary/50 hover:bg-secondary/40'
        }`}
      >
        {/* Circle toggle */}
        <button
          onClick={() => toggleComplete(req)}
          disabled={toggling === req.id}
          title={isDone ? 'Mark active' : 'Mark resolved'}
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
            isDone
              ? 'border-emerald-500 bg-emerald-500 text-white'
              : 'border-border hover:border-primary'
          }`}
        >
          {isDone && (
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          )}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[14px] font-semibold ${isDone ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
              {label}
            </span>
            {req.request_type === 'Other' && req.custom_request && (
              <span className="text-[12px] text-muted-foreground">({req.request_type})</span>
            )}
            <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${STATUS_COLOR[req.status]}`}>
              {STATUS_LABEL[req.status]}
            </span>
          </div>
          {req.client_name && (
            <p className="text-[13px] text-muted-foreground mt-0.5">
              <span className="font-medium text-foreground/80">{req.client_name}</span>
              {req.client_email && <span className="ml-1 text-muted-foreground/70">· {req.client_email}</span>}
            </p>
          )}
          {req.description && (
            <p className="text-[12px] text-muted-foreground mt-0.5 line-clamp-1">{req.description}</p>
          )}
          {req.broker_notes && (
            <p className="text-[12px] text-amber-700 dark:text-amber-400 mt-0.5 line-clamp-1">
              <span className="font-medium">Note:</span> {req.broker_notes}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground mt-0.5">{formatDate(req.created_at)}</p>
        </div>

        {/* Edit button (active requests only) */}
        {!isDone && (
          <button
            onClick={() => openEdit(req)}
            title="Edit request"
            className="shrink-0 rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
            </svg>
          </button>
        )}

        {/* Broker assignment */}
        <div className="shrink-0">
          {req.assigned_broker_name ? (
            <div className="flex items-center gap-1.5">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                {req.assigned_broker_name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <select
                value={req.assigned_broker_id ?? ''}
                onChange={(e) => assignBroker(req, e.target.value)}
                disabled={assigningId === req.id}
                className="text-[12px] bg-transparent text-muted-foreground border-none focus:outline-none focus:ring-0 cursor-pointer max-w-[100px] truncate"
              >
                <option value="">Unassign</option>
                {brokers.map((b) => (
                  <option key={b.id} value={b.id}>{b.full_name}</option>
                ))}
              </select>
            </div>
          ) : (
            <select
              value=""
              onChange={(e) => { if (e.target.value) assignBroker(req, e.target.value); }}
              disabled={assigningId === req.id}
              className="text-[12px] rounded-lg border border-dashed border-border bg-transparent px-2 py-0.5 text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 cursor-pointer"
            >
              <option value="">Assign broker</option>
              {brokers.map((b) => (
                <option key={b.id} value={b.id}>{b.full_name}</option>
              ))}
            </select>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Service Requests"
        subtitle="Client requests requiring attention"
      />

      {/* Tab pills */}
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
        <GlassCard padding="none">
          <div className="p-4 space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="h-14 rounded-xl shimmer" />)}
          </div>
        </GlassCard>
      ) : displayed.length === 0 ? (
        <GlassCard className="px-6 py-12 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <svg className="h-8 w-8 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </div>
          <p className="text-[14px] font-medium text-foreground">
            {tab === 'active' ? 'No active requests' : 'No completed requests'}
          </p>
          <p className="text-[13px] text-muted-foreground mt-1">
            {tab === 'active' ? 'All caught up!' : 'Resolved requests will appear here'}
          </p>
        </GlassCard>
      ) : tab === 'active' ? (
        <GlassCard padding="none">
          <div className="divide-y divide-border">
            {displayed.map(renderRow)}
          </div>
        </GlassCard>
      ) : (
        <GlassCard padding="none">
          <button
            onClick={() => setCompletedCollapsed((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>Completed ({completed.length})</span>
            <svg className={`h-4 w-4 transition-transform ${completedCollapsed ? '-rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
          {!completedCollapsed && (
            <div className="divide-y divide-border border-t border-border">
              {displayed.map(renderRow)}
            </div>
          )}
        </GlassCard>
      )}

      {editingReq && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setEditingReq(null)} />
          <div className="relative w-full max-w-md rounded-2xl bg-card border border-border shadow-xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[16px] font-semibold text-foreground">Edit Service Request</h2>
              <button onClick={() => setEditingReq(null)} className="rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-foreground mb-1.5">Request type</label>
                <select
                  value={editType}
                  onChange={(e) => setEditType(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {SERVICE_REQUEST_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              {editType === 'Other' && (
                <div>
                  <label className="block text-[13px] font-medium text-foreground mb-1.5">Describe the request <span className="text-destructive">*</span></label>
                  <input
                    type="text"
                    value={editCustom}
                    onChange={(e) => setEditCustom(e.target.value)}
                    placeholder="Briefly describe what is needed..."
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}

              <div>
                <label className="block text-[13px] font-medium text-foreground mb-1.5">Additional details <span className="text-muted-foreground font-normal">(optional)</span></label>
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={3}
                  placeholder="Any additional context..."
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>

              <div>
                <label className="block text-[13px] font-medium text-foreground mb-1.5">Broker notes <span className="text-muted-foreground font-normal">(internal)</span></label>
                <textarea
                  value={editBrokerNotes}
                  onChange={(e) => setEditBrokerNotes(e.target.value)}
                  rows={3}
                  placeholder="Internal notes visible only to brokers and admins..."
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <Button variant="secondary" className="flex-1" onClick={() => setEditingReq(null)}>Cancel</Button>
              <Button className="flex-1" onClick={saveEdit} loading={editSaving}>Save Changes</Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
