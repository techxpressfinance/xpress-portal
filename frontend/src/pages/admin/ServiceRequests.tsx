import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { Button, ConfirmDialog, GlassCard, PageHeader } from '../../components/ui';
import { SERVICE_REQUEST_TYPES } from '../../lib/constants';
import { formatDate, formatDateTime } from '../../lib/utils';
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

const initials = (name: string) => name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

/** Multi-broker assignment control: avatar stack (inline) or chip box (field) that
 *  opens a checkbox dropdown. */
function BrokerPicker({
  brokers,
  selected,
  onChange,
  disabled,
  variant = 'inline',
}: {
  brokers: User[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  variant?: 'inline' | 'field';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const selectedBrokers = brokers.filter((b) => selected.includes(b.id));

  return (
    <div className="relative" ref={ref}>
      {variant === 'inline' ? (
        <button
          type="button"
          onClick={() => !disabled && setOpen((v) => !v)}
          disabled={disabled}
          className="flex items-center gap-1.5 disabled:opacity-50"
        >
          {selectedBrokers.length > 0 ? (
            <div className="flex -space-x-1.5">
              {selectedBrokers.slice(0, 3).map((b) => (
                <div
                  key={b.id}
                  title={b.full_name}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary ring-2 ring-card"
                >
                  {initials(b.full_name)}
                </div>
              ))}
              {selectedBrokers.length > 3 && (
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-muted-foreground ring-2 ring-card">
                  +{selectedBrokers.length - 3}
                </div>
              )}
            </div>
          ) : (
            <span className="text-[12px] rounded-lg border border-dashed border-border px-2 py-0.5 text-muted-foreground">
              Assign broker
            </span>
          )}
          <svg className="h-3.5 w-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full flex-wrap items-center gap-1.5 min-h-[42px] rounded-lg border border-border bg-background px-3 py-2 text-left text-[14px] focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {selectedBrokers.length === 0 ? (
            <span className="text-muted-foreground">Unassigned</span>
          ) : (
            selectedBrokers.map((b) => (
              <span key={b.id} className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[12px] font-medium text-primary">
                {b.full_name}
              </span>
            ))
          )}
          <svg className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
      )}

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-56 max-h-64 overflow-auto rounded-xl border border-border bg-card p-1 shadow-xl">
          {brokers.length === 0 ? (
            <p className="px-3 py-2 text-[13px] text-muted-foreground">No brokers available</p>
          ) : (
            brokers.map((b) => {
              const checked = selected.includes(b.id);
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => toggle(b.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-foreground hover:bg-secondary"
                >
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? 'border-primary bg-primary text-white' : 'border-border'}`}>
                    {checked && (
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    )}
                  </span>
                  <span className="truncate">{b.full_name}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminServiceRequests() {
  const { toast } = useToast();
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'active' | 'completed'>('active');
  const [toggling, setToggling] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [brokers, setBrokers] = useState<User[]>([]);
  const [clients, setClients] = useState<User[]>([]);
  const [completedCollapsed, setCompletedCollapsed] = useState(false);
  const [editingReq, setEditingReq] = useState<ServiceRequest | null>(null);
  const [editType, setEditType] = useState('');
  const [editCustom, setEditCustom] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [editStatus, setEditStatus] = useState<ServiceRequestStatus>('pending');
  const [editClientId, setEditClientId] = useState('');
  const [editBrokerIds, setEditBrokerIds] = useState<string[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [confirmCompleteReq, setConfirmCompleteReq] = useState<ServiceRequest | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createClientId, setCreateClientId] = useState('');
  const [createType, setCreateType] = useState('Status Update');
  const [createCustom, setCreateCustom] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createBrokerIds, setCreateBrokerIds] = useState<string[]>([]);
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

  const openCreate = () => {
    setCreateClientId('');
    setCreateType('Status Update');
    setCreateCustom('');
    setCreateDesc('');
    setCreateBrokerIds([]);
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

  const openEdit = (req: ServiceRequest) => {
    setEditType(req.request_type);
    setEditCustom(req.custom_request ?? '');
    setEditDesc(req.description ?? '');
    setNewNote('');
    setEditStatus(req.status);
    setEditClientId(req.client_id);
    setEditBrokerIds((req.assigned_brokers ?? []).map((b) => b.id));
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
        status: editStatus,
        client_id: editClientId || null,
        assigned_broker_ids: editBrokerIds,
        request_type: editType,
        custom_request: editType === 'Other' ? editCustom.trim() : null,
        description: editDesc.trim() || null,
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

  const addNote = async () => {
    if (!editingReq || !newNote.trim()) return;
    setAddingNote(true);
    try {
      const { data } = await api.post(`/service-requests/${editingReq.id}/notes`, { content: newNote.trim() });
      setRequests((prev) => prev.map((r) => (r.id === data.id ? data : r)));
      setEditingReq(data);
      setNewNote('');
    } catch {
      toast('Failed to add note', 'error');
    } finally {
      setAddingNote(false);
    }
  };

  // Active list honors the user's manual drag order; unplaced requests sit on top, newest first.
  const orderActive = (list: ServiceRequest[]) => {
    const placed = list.filter((r) => r.sort_position != null).sort((a, b) => a.sort_position! - b.sort_position!);
    const unplaced = list
      .filter((r) => r.sort_position == null)
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    return [...unplaced, ...placed];
  };

  const active = orderActive(requests.filter((r) => ACTIVE_STATUSES.includes(r.status)));
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

  const handleDrop = (targetId: string) => {
    const dragged = draggedId;
    setDraggedId(null);
    setDragOverId(null);
    if (!dragged || dragged === targetId) return;
    const ids = active.map((r) => r.id).filter((id) => id !== dragged);
    ids.splice(ids.indexOf(targetId), 0, dragged);
    persistOrder(ids);
  };

  const renderRow = (req: ServiceRequest, reorderable = false) => {
    const isDone = DONE_STATUSES.includes(req.status);
    const label = req.request_type === 'Other' && req.custom_request ? req.custom_request : req.request_type;
    const isUnassigned = (req.assigned_brokers?.length ?? 0) === 0;
    const isOver = reorderable && dragOverId === req.id && draggedId !== null && draggedId !== req.id;

    return (
      <div
        key={req.id}
        onDragOver={reorderable ? (e) => { e.preventDefault(); if (draggedId && dragOverId !== req.id) setDragOverId(req.id); } : undefined}
        onDrop={reorderable ? (e) => { e.preventDefault(); handleDrop(req.id); } : undefined}
        className={`flex items-start gap-3 px-4 py-3 transition-colors border-l-2 ${
          isOver ? 'border-t-2 border-t-primary' : ''
        } ${
          draggedId === req.id ? 'opacity-40 ' : ''
        }${
          !isDone && isUnassigned
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
            onDragStart={(e) => { setDraggedId(req.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', req.id); }}
            onDragEnd={() => { setDraggedId(null); setDragOverId(null); }}
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
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          )}
        </button>

        {/* Content */}
        <div
          className={`flex-1 min-w-0 ${!isDone ? 'cursor-pointer' : ''}`}
          onClick={!isDone ? () => openEdit(req) : undefined}
          title={!isDone ? 'Click to edit' : undefined}
        >
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
          {req.notes.length > 0 && (
            <p className="text-[12px] text-amber-700 dark:text-amber-400 mt-0.5 line-clamp-1">
              <span className="font-medium">Note:</span> {req.notes[req.notes.length - 1].content}
              {req.notes.length > 1 && <span className="text-muted-foreground"> · +{req.notes.length - 1} more</span>}
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
            {displayed.map((r) => renderRow(r, true))}
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
              {displayed.map((r) => renderRow(r))}
            </div>
          )}
        </GlassCard>
      )}

      {showCreate && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowCreate(false)} />
          <div className="relative w-full max-w-md rounded-2xl bg-card border border-border shadow-xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[16px] font-semibold text-foreground">New Service Request</h2>
              <button onClick={() => setShowCreate(false)} className="rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-foreground mb-1.5">Client <span className="text-muted-foreground font-normal">(optional)</span></label>
                <select
                  value={createClientId}
                  onChange={(e) => setCreateClientId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">No client</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.full_name}{c.email ? ` (${c.email})` : ''}</option>
                  ))}
                </select>
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
                <label className="block text-[13px] font-medium text-foreground mb-1.5">Assign to brokers <span className="text-muted-foreground font-normal">(optional)</span></label>
                <BrokerPicker
                  variant="field"
                  brokers={brokers}
                  selected={createBrokerIds}
                  onChange={setCreateBrokerIds}
                />
              </div>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[13px] font-medium text-foreground mb-1.5">Status</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as ServiceRequestStatus)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {(Object.keys(STATUS_LABEL) as ServiceRequestStatus[]).map((s) => (
                      <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-foreground mb-1.5">Assigned brokers</label>
                  <BrokerPicker
                    variant="field"
                    brokers={brokers}
                    selected={editBrokerIds}
                    onChange={setEditBrokerIds}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[13px] font-medium text-foreground mb-1.5">Client</label>
                <select
                  value={editClientId}
                  onChange={(e) => setEditClientId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {!clients.some((c) => c.id === editClientId) && editingReq?.client_name && (
                    <option value={editClientId}>{editingReq.client_name}{editingReq.client_email ? ` (${editingReq.client_email})` : ''}</option>
                  )}
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.full_name}{c.email ? ` (${c.email})` : ''}</option>
                  ))}
                </select>
              </div>

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

                {(editingReq?.notes.length ?? 0) > 0 && (
                  <div className="mb-2 space-y-2 max-h-48 overflow-auto">
                    {editingReq?.notes.map((n) => (
                      <div key={n.id} className="rounded-lg border border-border bg-secondary/40 px-3 py-2">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <span className="text-[12px] font-medium text-foreground">{n.author_name ?? 'Unknown'}</span>
                          <span className="text-[11px] text-muted-foreground">{formatDateTime(n.created_at)}</span>
                        </div>
                        <p className="text-[13px] text-foreground whitespace-pre-wrap">{n.content}</p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-end gap-2">
                  <textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    rows={2}
                    placeholder="Add a note (visible only to brokers and admins)..."
                    className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  />
                  <Button variant="secondary" onClick={addNote} loading={addingNote} disabled={!newNote.trim()}>Add</Button>
                </div>
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
