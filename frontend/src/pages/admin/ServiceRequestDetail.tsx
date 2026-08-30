import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { formatDate, formatDateTime, getErrorMessage, toDateTimeLocalInput, dateTimeLocalToUTC } from '../../lib/utils';
import { SERVICE_REQUEST_TYPES } from '../../lib/constants';
import { Button, Breadcrumbs } from '../../components/ui';
import { BrokerPicker, ClientPicker } from '../../components/ServiceRequestPickers';
import FileDropzone from '../../components/FileDropzone';
import type { ServiceRequest, ServiceRequestAttachment, ServiceRequestChecklistItem, ServiceRequestStatus, User } from '../../types';
import { CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';

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

const requestLabel = (req: ServiceRequest) =>
  req.request_type === 'Other' && req.custom_request ? req.custom_request : req.request_type;

export default function ServiceRequestDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [req, setReq] = useState<ServiceRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [brokers, setBrokers] = useState<User[]>([]);
  const [clients, setClients] = useState<User[]>([]);
  const [editing, setEditing] = useState(false);

  const [editStatus, setEditStatus] = useState<ServiceRequestStatus>('pending');
  const [editUrgent, setEditUrgent] = useState(false);
  const [editDueAt, setEditDueAt] = useState('');
  const [editClientId, setEditClientId] = useState('');
  const [editBrokerIds, setEditBrokerIds] = useState<string[]>([]);
  const [editType, setEditType] = useState('');
  const [editCustom, setEditCustom] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [saving, setSaving] = useState(false);

  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [newChecklistItem, setNewChecklistItem] = useState('');
  const [addingChecklistItem, setAddingChecklistItem] = useState(false);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  const populate = (r: ServiceRequest) => {
    setEditStatus(r.status);
    setEditUrgent(r.is_urgent);
    setEditDueAt(toDateTimeLocalInput(r.due_at));
    setEditClientId(r.client_id);
    setEditBrokerIds((r.assigned_brokers ?? []).map((b) => b.id));
    setEditType(r.request_type);
    setEditCustom(r.custom_request ?? '');
    setEditDesc(r.description ?? '');
  };

  const fetchReq = () => {
    if (!id) return;
    api.get(`/service-requests/${id}`)
      .then(({ data }) => { setReq(data); populate(data); })
      .catch(() => toast('Failed to load service request', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchReq();
    api.get('/users')
      .then(({ data }) => {
        const users: User[] = Array.isArray(data) ? data : (data.items ?? []);
        setBrokers(users.filter((u) => u.role === 'broker'));
        setClients(users.filter((u) => u.role === 'client'));
      })
      .catch(() => {});
  }, [id]);

  const handleSave = async () => {
    if (!id) return;
    if (editType === 'Other' && !editCustom.trim()) {
      toast('Please describe the request', 'error');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.patch(`/service-requests/${id}`, {
        status: editStatus,
        is_urgent: editUrgent,
        due_at: dateTimeLocalToUTC(editDueAt),
        client_id: editClientId || null,
        assigned_broker_ids: editBrokerIds,
        request_type: editType,
        custom_request: editType === 'Other' ? editCustom.trim() : null,
        description: editDesc.trim() || null,
      });
      setReq(data);
      populate(data);
      setEditing(false);
      toast('Service request updated', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to update'), 'error');
    } finally {
      setSaving(false);
    }
  };

  // Inline status change (view mode), e.g. mark resolved without opening the editor.
  const changeStatus = async (status: ServiceRequestStatus) => {
    if (!id) return;
    try {
      const { data } = await api.patch(`/service-requests/${id}`, { status });
      setReq(data);
      populate(data);
    } catch {
      toast('Failed to update status', 'error');
    }
  };

  const toggleUrgent = async () => {
    if (!id || !req) return;
    try {
      const { data } = await api.patch(`/service-requests/${id}`, { is_urgent: !req.is_urgent });
      setReq(data);
      populate(data);
    } catch {
      toast('Failed to update', 'error');
    }
  };

  const assignBrokers = async (ids: string[]) => {
    if (!id) return;
    try {
      const { data } = await api.patch(`/service-requests/${id}`, { assigned_broker_ids: ids });
      setReq(data);
      populate(data);
    } catch {
      toast('Failed to assign', 'error');
    }
  };

  const addNote = async () => {
    if (!id || !newNote.trim()) return;
    setAddingNote(true);
    try {
      const { data } = await api.post(`/service-requests/${id}/notes`, { content: newNote.trim() });
      setReq(data);
      setNewNote('');
    } catch {
      toast('Failed to add note', 'error');
    } finally {
      setAddingNote(false);
    }
  };

  const addChecklistItem = async () => {
    if (!id || !newChecklistItem.trim()) return;
    setAddingChecklistItem(true);
    try {
      const { data } = await api.post(`/service-requests/${id}/checklist`, { title: newChecklistItem.trim() });
      setReq(data);
      setNewChecklistItem('');
    } catch {
      toast('Failed to add item', 'error');
    } finally {
      setAddingChecklistItem(false);
    }
  };

  const toggleChecklistItem = async (item: ServiceRequestChecklistItem) => {
    if (!id) return;
    try {
      const { data } = await api.patch(`/service-requests/${id}/checklist/${item.id}/toggle`);
      setReq(data);
    } catch {
      toast('Failed to update item', 'error');
    }
  };

  const deleteChecklistItem = async (itemId: string) => {
    if (!id) return;
    try {
      const { data } = await api.delete(`/service-requests/${id}/checklist/${itemId}`);
      setReq(data);
    } catch {
      toast('Failed to delete item', 'error');
    }
  };

  const reorderChecklist = async (orderedIds: string[]) => {
    if (!id) return;
    try {
      const { data } = await api.put(`/service-requests/${id}/checklist/reorder`, { item_ids: orderedIds });
      setReq(data);
    } catch {
      toast('Failed to reorder', 'error');
    }
  };

  const handleChecklistDrop = (targetId: string) => {
    if (!req || !draggedItemId || draggedItemId === targetId) {
      setDraggedItemId(null);
      setDragOverItemId(null);
      return;
    }
    const ids = req.checklist_items.map((i) => i.id);
    const from = ids.indexOf(draggedItemId);
    const to = ids.indexOf(targetId);
    setDraggedItemId(null);
    setDragOverItemId(null);
    if (from === -1 || to === -1) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    reorderChecklist(ids);
  };

  const uploadAttachment = async (file: File) => {
    if (!id) return;
    setUploadingAttachment(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post(`/service-requests/${id}/attachments`, formData);
      setReq(data);
      toast('Attachment uploaded', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to upload attachment'), 'error');
    } finally {
      setUploadingAttachment(false);
    }
  };

  const downloadAttachment = async (attachment: ServiceRequestAttachment) => {
    if (!id) return;
    let url: string | null = null;
    let a: HTMLAnchorElement | null = null;
    try {
      const { data } = await api.get(`/service-requests/${id}/attachments/${attachment.id}/download`, { responseType: 'blob' });
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

  const deleteAttachment = async (attachmentId: string) => {
    if (!id) return;
    try {
      const { data } = await api.delete(`/service-requests/${id}/attachments/${attachmentId}`);
      setReq(data);
    } catch {
      toast('Failed to delete attachment', 'error');
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 pt-2">
        <div className="h-5 w-32 rounded-lg shimmer" />
        <div className="h-8 w-72 rounded-lg shimmer" />
        <div className="h-4 w-48 rounded-lg shimmer" />
        <div className="h-4 w-56 rounded-lg shimmer" />
      </div>
    );
  }

  if (!req) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="text-[14px] text-muted-foreground mb-4">This service request does not exist or has been deleted.</p>
        <Button variant="secondary" onClick={() => navigate('/admin/service-requests')}>Back to Service Requests</Button>
      </div>
    );
  }

  const items = req.checklist_items ?? [];
  const completed = items.filter((i) => i.is_completed).length;
  const isDone = req.status === 'resolved' || req.status === 'closed';

  return (
    <div className="mx-auto max-w-2xl">
      <Breadcrumbs items={[
        { label: 'Service Requests', href: '/admin/service-requests' },
        { label: requestLabel(req) },
      ]} />

      {(
        /* ── In-place editable detail ── */
        <div className="space-y-6 pb-6">
          {/* Title row */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              {editing ? (
                <div className="space-y-2">
                  <select
                    value={editType}
                    onChange={(e) => setEditType(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[18px] font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {SERVICE_REQUEST_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  {editType === 'Other' && (
                    <input
                      type="text"
                      value={editCustom}
                      onChange={(e) => setEditCustom(e.target.value)}
                      placeholder="Briefly describe what is needed..."
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className={`text-[22px] font-bold text-foreground leading-snug ${isDone ? 'line-through text-muted-foreground' : ''}`}>
                    {requestLabel(req)}
                  </h1>
                  {req.request_type === 'Other' && req.custom_request && (
                    <span className="text-[13px] text-muted-foreground">({req.request_type})</span>
                  )}
                  {req.is_urgent && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded border border-red-200 bg-red-50 text-red-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-500" /> Urgent
                    </span>
                  )}
                </div>
              )}

              {editing ? (
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={3}
                  placeholder="Additional details (optional)..."
                  className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              ) : (
                req.description && (
                  <p className="mt-1.5 text-[14px] text-muted-foreground leading-relaxed whitespace-pre-wrap">{req.description}</p>
                )
              )}
            </div>

            {editing ? (
              <div className="flex gap-2 shrink-0">
                <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
                <Button variant="secondary" size="sm" onClick={() => { setEditing(false); populate(req); }}>Cancel</Button>
              </div>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>Edit</Button>
            )}
          </div>

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-[13px] border-y border-border py-4">
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Status</p>
              {editing ? (
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as ServiceRequestStatus)}
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {(Object.keys(STATUS_LABEL) as ServiceRequestStatus[]).map((s) => (
                    <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                  ))}
                </select>
              ) : (
                <span className={`inline-flex text-[12px] font-medium px-2 py-0.5 rounded border ${STATUS_COLOR[req.status]}`}>
                  {STATUS_LABEL[req.status]}
                </span>
              )}
            </div>

            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Assigned brokers</p>
              {editing ? (
                <BrokerPicker variant="field" brokers={brokers} selected={editBrokerIds} onChange={setEditBrokerIds} />
              ) : (
                <BrokerPicker
                  variant="inline"
                  brokers={brokers}
                  selected={(req.assigned_brokers ?? []).map((b) => b.id)}
                  onChange={assignBrokers}
                />
              )}
            </div>

            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Client</p>
              {editing ? (
                <ClientPicker
                  clients={clients}
                  value={editClientId}
                  onChange={setEditClientId}
                  fallbackLabel={req.client_name
                    ? `${req.client_name}${req.client_email ? ` (${req.client_email})` : ''}`
                    : undefined}
                />
              ) : req.client_name ? (
                <div>
                  <span className="text-foreground font-medium">{req.client_name}</span>
                  {req.client_email && <span className="text-muted-foreground"> · {req.client_email}</span>}
                </div>
              ) : (
                <span className="text-muted-foreground italic">No client</span>
              )}
            </div>

            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Created</p>
              <span className="text-foreground font-medium">{formatDate(req.created_at)}</span>
            </div>

            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Due</p>
              {editing ? (
                <input
                  type="datetime-local"
                  value={editDueAt}
                  onChange={(e) => setEditDueAt(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              ) : req.due_at ? (
                <span className={`font-medium ${!isDone && new Date(req.due_at) < new Date() ? 'text-red-600' : 'text-foreground'}`}>
                  {formatDateTime(req.due_at)}
                </span>
              ) : (
                <span className="text-muted-foreground italic">No due date</span>
              )}
            </div>
          </div>

          {/* Urgent toggle (edit) / quick status actions (view) */}
          {editing ? (
            <label className="flex items-center gap-2 cursor-pointer w-fit">
              <input
                type="checkbox"
                checked={editUrgent}
                onChange={(e) => setEditUrgent(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-red-500"
              />
              <span className="text-[14px] text-foreground">Mark as urgent</span>
            </label>
          ) : (
            <div className="flex items-center gap-2">
              {isDone ? (
                <Button variant="secondary" size="sm" onClick={() => changeStatus('in_progress')}>Reopen request</Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => changeStatus('resolved')}>Mark resolved</Button>
              )}
              <Button variant="secondary" size="sm" onClick={toggleUrgent}>
                {req.is_urgent ? 'Clear urgent' : 'Mark urgent'}
              </Button>
            </div>
          )}

          {/* Checklist */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[13px] font-semibold text-foreground">Checklist <span className="text-muted-foreground font-normal">(internal)</span></p>
              {items.length > 0 && (
                <div className="flex items-center gap-2.5">
                  <div className="h-1.5 w-20 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(completed / items.length) * 100}%` }} />
                  </div>
                  <span className="text-[12px] text-muted-foreground tabular-nums">{completed}/{items.length}</span>
                </div>
              )}
            </div>

            <div className="space-y-0.5 mb-3">
              {items.map((item) => (
                <div
                  key={item.id}
                  draggable
                  onDragStart={() => setDraggedItemId(item.id)}
                  onDragOver={(e) => { e.preventDefault(); setDragOverItemId(item.id); }}
                  onDragLeave={() => setDragOverItemId((cur) => (cur === item.id ? null : cur))}
                  onDrop={() => handleChecklistDrop(item.id)}
                  onDragEnd={() => { setDraggedItemId(null); setDragOverItemId(null); }}
                  className={`group flex items-center gap-2 rounded-lg px-2 py-2 transition-colors -mx-2 ${dragOverItemId === item.id ? 'bg-primary/10' : 'hover:bg-secondary/60'} ${draggedItemId === item.id ? 'opacity-50' : ''}`}
                >
                  <span className="cursor-grab text-muted-foreground/40 group-hover:text-muted-foreground select-none" title="Drag to reorder">⠿</span>
                  <button
                    type="button"
                    onClick={() => toggleChecklistItem(item)}
                    className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors ${item.is_completed ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-border hover:border-emerald-400'}`}
                  >
                    {item.is_completed && (
                      <CheckIcon className="h-3 w-3" strokeWidth={3} />
                    )}
                  </button>
                  <span className={`flex-1 text-[14px] ${item.is_completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>{item.title}</span>
                  <button
                    type="button"
                    onClick={() => deleteChecklistItem(item.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all p-1 rounded"
                  >
                    <XMarkIcon className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </div>
              ))}
              {items.length === 0 && (
                <p className="text-[13px] text-muted-foreground px-2 py-1">No items yet.</p>
              )}
            </div>

            {/* Adding items is only available in edit mode; view mode allows toggling. */}
            {editing && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newChecklistItem}
                  onChange={(e) => setNewChecklistItem(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChecklistItem(); } }}
                  placeholder="Add an item..."
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <Button variant="secondary" size="sm" onClick={addChecklistItem} loading={addingChecklistItem} disabled={!newChecklistItem.trim()}>Add</Button>
              </div>
            )}
          </div>

          {/* Attachments */}
          <div className="border-t border-border pt-5">
            <p className="text-[13px] font-semibold text-foreground mb-3">Attachments</p>

            {req.attachments.length > 0 && (
              <div className="mb-3 space-y-1.5">
                {req.attachments.map((a) => (
                  <div key={a.id} className="group flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2">
                    <svg className="h-4 w-4 shrink-0 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739 10.682 20.432a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.5L8.552 18.448a1.5 1.5 0 0 1-2.121-2.121L16.5 6.75" />
                    </svg>
                    <button type="button" onClick={() => downloadAttachment(a)} className="flex-1 min-w-0 text-left text-[13px] text-foreground truncate hover:underline">
                      {a.original_filename}
                    </button>
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      {a.uploaded_by_name ? `${a.uploaded_by_name} · ` : ''}{formatDate(a.uploaded_at)}
                    </span>
                    <button
                      type="button"
                      onClick={() => deleteAttachment(a.id)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all p-1 rounded shrink-0"
                    >
                      <XMarkIcon className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <FileDropzone uploading={uploadingAttachment} onFile={uploadAttachment} onError={(msg) => toast(msg, 'error')} />
          </div>

          {/* Broker notes */}
          <div className="border-t border-border pt-5">
            <p className="text-[13px] font-semibold text-foreground mb-3">Broker notes <span className="text-muted-foreground font-normal">(internal)</span></p>

            {req.notes.length > 0 && (
              <div className="mb-3 space-y-2">
                {req.notes.map((n) => (
                  <div key={n.id} className="rounded-lg border border-border bg-secondary/40 px-3 py-2">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                        {initials(n.author_name ?? 'Unknown')}
                      </div>
                      <span className="text-[12px] font-semibold text-primary">{n.author_name ?? 'Unknown'}</span>
                      <span className="ml-auto text-[11px] text-muted-foreground">{formatDateTime(n.created_at)}</span>
                    </div>
                    <p className="text-[13px] text-foreground whitespace-pre-wrap pl-7">{n.content}</p>
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
              <Button variant="secondary" size="sm" onClick={addNote} loading={addingNote} disabled={!newNote.trim()}>Add</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
