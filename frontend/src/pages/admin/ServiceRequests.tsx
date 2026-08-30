import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { Button, ConfirmDialog, Card, PageHeader } from '../../components/ui';
import { SERVICE_REQUEST_TYPES } from '../../lib/constants';
import { formatDate, formatDateTime, dateTimeLocalToUTC } from '../../lib/utils';
import { BrokerPicker, ClientPicker } from '../../components/ServiceRequestPickers';
import type { ServiceRequest, ServiceRequestStatus, User } from '../../types';
import { CheckCircleIcon, CheckIcon, ChevronDownIcon, ClockIcon, XMarkIcon } from '@heroicons/react/24/outline';

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
  const navigate = useNavigate();
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'active' | 'completed'>('active');
  const [toggling, setToggling] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  // Live visual order of active request ids while a drag is in progress (null when idle).
  const [orderIds, setOrderIds] = useState<string[] | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const prevRects = useRef(new Map<string, DOMRect>());
  const [brokers, setBrokers] = useState<User[]>([]);
  const [clients, setClients] = useState<User[]>([]);
  const [completedCollapsed, setCompletedCollapsed] = useState(false);
  const [confirmCompleteReq, setConfirmCompleteReq] = useState<ServiceRequest | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createClientId, setCreateClientId] = useState('');
  const [createType, setCreateType] = useState('Status Update');
  const [createCustom, setCreateCustom] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createBrokerIds, setCreateBrokerIds] = useState<string[]>([]);
  const [createUrgent, setCreateUrgent] = useState(false);
  const [createDueAt, setCreateDueAt] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.get('/service-requests?per_page=100')
      .then(({ data }) => setRequests(data.items))
      .catch(() => toast('Failed to load service requests', 'error'))
      .finally(() => setLoading(false));

    api.get('/users')
      .then(({ data }) => {
        const users: User[] = Array.isArray(data) ? data : (data.items ?? []);
        setBrokers(users.filter((u) => u.role === 'broker'));
        setClients(users.filter((u) => u.role === 'client'));
      })
      .catch(() => {});
  }, []);

  // FLIP: after any render that moves rows (live drag reorder), slide them from their
  // previous position to the new one so reordering animates instead of snapping.
  useLayoutEffect(() => {
    const nextRects = new Map<string, DOMRect>();
    rowRefs.current.forEach((node, id) => nextRects.set(id, node.getBoundingClientRect()));
    nextRects.forEach((newRect, id) => {
      const oldRect = prevRects.current.get(id);
      const node = rowRefs.current.get(id);
      if (!node || !oldRect) return;
      const dy = oldRect.top - newRect.top;
      if (Math.abs(dy) < 1) return;
      node.style.transition = 'none';
      node.style.transform = `translateY(${dy}px)`;
      requestAnimationFrame(() => {
        node.style.transition = 'transform 180ms ease';
        node.style.transform = '';
      });
    });
    prevRects.current = nextRects;
  });

  const openCreate = () => {
    setCreateClientId('');
    setCreateType('Status Update');
    setCreateCustom('');
    setCreateDesc('');
    setCreateBrokerIds([]);
    setCreateUrgent(false);
    setCreateDueAt('');
    setShowCreate(true);
  };

  const handleCreate = async () => {
    if (createType === 'Other' && !createCustom.trim()) {
      toast('Please describe the request', 'error');
      return;
    }
    setCreating(true);
    try {
      const { data } = await api.post('/service-requests', {
        request_type: createType,
        custom_request: createType === 'Other' ? createCustom.trim() : null,
        description: createDesc.trim() || null,
        client_id: createClientId || null,
        is_urgent: createUrgent,
        due_at: dateTimeLocalToUTC(createDueAt),
        assigned_broker_ids: createBrokerIds,
      });
      setRequests((prev) => [data, ...prev]);
      setShowCreate(false);
      toast('Service request created', 'success');
    } catch {
      toast('Failed to create request', 'error');
    } finally {
      setCreating(false);
    }
  };

  const toggleComplete = (req: ServiceRequest) => {
    if (toggling) return;
    if (DONE_STATUSES.includes(req.status)) {
      // Re-activating — no confirmation needed
      doStatusChange(req, 'in_progress');
    } else {
      setConfirmCompleteReq(req);
    }
  };

  const doStatusChange = async (req: ServiceRequest, newStatus: ServiceRequestStatus) => {
    setToggling(req.id);
    try {
      const { data } = await api.patch(`/service-requests/${req.id}`, { status: newStatus });
      setRequests((prev) => prev.map((r) => (r.id === req.id ? data : r)));
    } catch {
      toast('Failed to update', 'error');
    } finally {
      setToggling(null);
    }
  };

  const assignBrokers = async (req: ServiceRequest, brokerIds: string[]) => {
    setAssigningId(req.id);
    try {
      const { data } = await api.patch(`/service-requests/${req.id}`, { assigned_broker_ids: brokerIds });
      setRequests((prev) => prev.map((r) => (r.id === req.id ? data : r)));
    } catch {
      toast('Failed to assign', 'error');
    } finally {
      setAssigningId(null);
    }
  };

  const openDetail = (req: ServiceRequest) => navigate(`/admin/service-requests/${req.id}`);

  // Active list honors the user's manual drag order; unplaced requests sit on top, newest first.
  const orderActive = (list: ServiceRequest[]) => {
    const placed = list.filter((r) => r.sort_position != null).sort((a, b) => a.sort_position! - b.sort_position!);
    const unplaced = list
      .filter((r) => r.sort_position == null)
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    return [...unplaced, ...placed];
  };

  const activeBase = orderActive(requests.filter((r) => ACTIVE_STATUSES.includes(r.status)));
  // While dragging, apply the live order; append any rows not yet placed in it.
  const active = orderIds
    ? (() => {
        const byId = new Map(activeBase.map((r) => [r.id, r]));
        const ordered = orderIds.map((id) => byId.get(id)).filter((r): r is ServiceRequest => !!r);
        const extra = activeBase.filter((r) => !orderIds.includes(r.id));
        return [...ordered, ...extra];
      })()
    : activeBase;
  const completed = requests.filter((r) => DONE_STATUSES.includes(r.status));
  const displayed = tab === 'active' ? active : completed;

  const persistOrder = async (ids: string[]) => {
    const pos = new Map(ids.map((id, i) => [id, i] as const));
    setRequests((prev) => prev.map((r) => (pos.has(r.id) ? { ...r, sort_position: pos.get(r.id)! } : r)));
    try {
      await api.put('/service-requests/order', { ordered_ids: ids });
    } catch {
      toast('Failed to save order', 'error');
    }
  };

  const startDrag = (id: string, e: React.DragEvent) => {
    setDragId(id);
    setOrderIds(active.map((r) => r.id));
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    // Use the whole row as the drag ghost (not just the small handle).
    const node = rowRefs.current.get(id);
    if (node) {
      const rect = node.getBoundingClientRect();
      e.dataTransfer.setDragImage(node, e.clientX - rect.left, e.clientY - rect.top);
    }
  };

  // Reorder live as the dragged row passes over another (drives the FLIP animation).
  const dragOverRow = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    setOrderIds((prev) => {
      const list = prev ?? active.map((r) => r.id);
      const from = list.indexOf(dragId);
      const to = list.indexOf(targetId);
      if (from === -1 || to === -1 || from === to) return prev;
      const next = [...list];
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });
  };

  const endDrag = () => {
    if (orderIds && dragId) persistOrder(orderIds);
    setDragId(null);
    setOrderIds(null);
  };

  const renderRow = (req: ServiceRequest, reorderable = false) => {
    const isDone = DONE_STATUSES.includes(req.status);
    const label = req.request_type === 'Other' && req.custom_request ? req.custom_request : req.request_type;
    const isUnassigned = (req.assigned_brokers?.length ?? 0) === 0;
    const isDragging = dragId === req.id;

    return (
      <div
        key={req.id}
        ref={reorderable ? (el) => { if (el) rowRefs.current.set(req.id, el); else rowRefs.current.delete(req.id); } : undefined}
        onDragOver={reorderable ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } : undefined}
        onDragEnter={reorderable ? () => dragOverRow(req.id) : undefined}
        onDrop={reorderable ? (e) => { e.preventDefault(); endDrag(); } : undefined}
        className={`flex items-start gap-3 px-4 py-3 transition-colors border-l-2 ${
          isDragging ? 'opacity-50 bg-secondary/60 ' : ''
        }${
          !isDone && req.is_urgent
            ? 'border-red-400 hover:bg-secondary/40'
            : !isDone && isUnassigned
            ? 'border-amber-400 hover:bg-secondary/40'
            : isDone
            ? 'border-transparent opacity-60 hover:bg-secondary/30'
            : 'border-primary/50 hover:bg-secondary/40'
        }`}
      >
        {/* Drag handle */}
        {reorderable && (
          <div
            draggable
            onDragStart={(e) => startDrag(req.id, e)}
            onDragEnd={endDrag}
            title="Drag to reorder"
            className="mt-0.5 shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" />
              <circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" />
              <circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" />
            </svg>
          </div>
        )}
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
            <CheckIcon className="h-3 w-3" strokeWidth={3} />
          )}
        </button>

        {/* Content */}
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={() => openDetail(req)}
          title="View details"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[14px] font-semibold ${isDone ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
              {label}
            </span>
            {req.request_type === 'Other' && req.custom_request && (
              <span className="text-[12px] text-muted-foreground">({req.request_type})</span>
            )}
            {req.is_urgent && !isDone && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded border border-red-200 bg-red-50 text-red-600">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" /> Urgent
              </span>
            )}
            <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${STATUS_COLOR[req.status]}`}>
              {STATUS_LABEL[req.status]}
            </span>
            {req.due_at && (
              <span
                className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded border ${
                  !isDone && new Date(req.due_at) < new Date()
                    ? 'border-red-200 bg-red-50 text-red-600'
                    : 'border-border bg-secondary text-muted-foreground'
                }`}
              >
                <ClockIcon className="h-3 w-3" strokeWidth={2} />
                Due {formatDateTime(req.due_at)}
              </span>
            )}
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
          {req.notes.length > 0 && (
            <p className="text-[12px] text-amber-700 dark:text-amber-400 mt-0.5 line-clamp-1">
              <span className="font-semibold">{req.notes[req.notes.length - 1].author_name ?? 'Note'}:</span> {req.notes[req.notes.length - 1].content}
              {req.notes.length > 1 && <span className="text-muted-foreground"> · +{req.notes.length - 1} more</span>}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground mt-0.5">{formatDate(req.created_at)}</p>
        </div>

        {/* Open detail (active requests only) */}
        {!isDone && (
          <button
            onClick={() => openDetail(req)}
            title="Open request"
            className="shrink-0 rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
            </svg>
          </button>
        )}

        {/* Broker assignment */}
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          <BrokerPicker
            variant="inline"
            brokers={brokers}
            selected={(req.assigned_brokers ?? []).map((b) => b.id)}
            disabled={assigningId === req.id}
            onChange={(ids) => assignBrokers(req, ids)}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Service Requests"
        subtitle="Client requests requiring attention"
        action={<Button onClick={openCreate}>+ New Request</Button>}
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
        <Card padding="none">
          <div className="p-4 space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="h-14 rounded-xl shimmer" />)}
          </div>
        </Card>
      ) : displayed.length === 0 ? (
        <Card className="px-6 py-12 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <CheckCircleIcon className="h-8 w-8 text-primary" />
          </div>
          <p className="text-[14px] font-medium text-foreground">
            {tab === 'active' ? 'No active requests' : 'No completed requests'}
          </p>
          <p className="text-[13px] text-muted-foreground mt-1">
            {tab === 'active' ? 'All caught up!' : 'Resolved requests will appear here'}
          </p>
        </Card>
      ) : tab === 'active' ? (
        <Card padding="none">
          <div className="divide-y divide-border">
            {displayed.map((r) => renderRow(r, true))}
          </div>
        </Card>
      ) : (
        <Card padding="none">
          <button
            onClick={() => setCompletedCollapsed((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>Completed ({completed.length})</span>
            <ChevronDownIcon className={`h-4 w-4 transition-transform ${completedCollapsed ? '-rotate-90' : ''}`} strokeWidth={2} />
          </button>
          {!completedCollapsed && (
            <div className="divide-y divide-border border-t border-border">
              {displayed.map((r) => renderRow(r))}
            </div>
          )}
        </Card>
      )}

      {showCreate && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowCreate(false)} />
          <div className="relative w-full max-w-md rounded-2xl bg-card border border-border shadow-xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[16px] font-semibold text-foreground">New Service Request</h2>
              <button onClick={() => setShowCreate(false)} className="rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-foreground mb-1.5">Client <span className="text-muted-foreground font-normal">(optional)</span></label>
                <ClientPicker
                  clients={clients}
                  value={createClientId}
                  onChange={setCreateClientId}
                  placeholder="No client"
                />
              </div>

              <div>
                <label className="block text-[13px] font-medium text-foreground mb-1.5">Request type</label>
                <select
                  value={createType}
                  onChange={(e) => setCreateType(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {SERVICE_REQUEST_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              {createType === 'Other' && (
                <div>
                  <label className="block text-[13px] font-medium text-foreground mb-1.5">Describe the request <span className="text-destructive">*</span></label>
                  <input
                    type="text"
                    value={createCustom}
                    onChange={(e) => setCreateCustom(e.target.value)}
                    placeholder="Briefly describe what is needed..."
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}

              <div>
                <label className="block text-[13px] font-medium text-foreground mb-1.5">Additional details <span className="text-muted-foreground font-normal">(optional)</span></label>
                <textarea
                  value={createDesc}
                  onChange={(e) => setCreateDesc(e.target.value)}
                  rows={3}
                  placeholder="Any additional context..."
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>

              <div>
                <label className="block text-[13px] font-medium text-foreground mb-1.5">Due date &amp; time <span className="text-muted-foreground font-normal">(optional)</span></label>
                <input
                  type="datetime-local"
                  value={createDueAt}
                  onChange={(e) => setCreateDueAt(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-[13px] font-medium text-foreground mb-1.5">Assign to brokers <span className="text-muted-foreground font-normal">(optional)</span></label>
                <BrokerPicker
                  variant="field"
                  brokers={brokers}
                  selected={createBrokerIds}
                  onChange={setCreateBrokerIds}
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createUrgent}
                  onChange={(e) => setCreateUrgent(e.target.checked)}
                  className="h-4 w-4 rounded border-border accent-red-500"
                />
                <span className="text-[14px] text-foreground">Mark as urgent</span>
              </label>
            </div>

            <div className="flex gap-3 mt-6">
              <Button variant="secondary" className="flex-1" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button className="flex-1" onClick={handleCreate} loading={creating}>Create Request</Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <ConfirmDialog
        open={!!confirmCompleteReq}
        title="Mark as resolved?"
        message={`This will mark "${confirmCompleteReq?.request_type === 'Other' && confirmCompleteReq?.custom_request ? confirmCompleteReq.custom_request : confirmCompleteReq?.request_type}" as resolved. You can reopen it later if needed.`}
        confirmText="Mark Resolved"
        cancelText="Cancel"
        variant="primary"
        loading={toggling === confirmCompleteReq?.id}
        onConfirm={() => {
          if (confirmCompleteReq) doStatusChange(confirmCompleteReq, 'resolved');
          setConfirmCompleteReq(null);
        }}
        onCancel={() => { if (!toggling) setConfirmCompleteReq(null); }}
      />
    </div>
  );
}
