import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../hooks/useConfirm';
import { formatDate, formatDateTime, getErrorMessage, toDateTimeLocalInput, dateTimeLocalToUTC } from '../../lib/utils';
import { TASK_PRIORITY_BADGE } from '../../lib/constants';
import { Button, Select, Input, Breadcrumbs, DatePicker } from '../../components/ui';
import FileDropzone from '../../components/FileDropzone';
import type { Task, ChecklistItem, TaskAttachment, User } from '../../types';
import { CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';

function priorityDotClass(priority: string): string {
  switch (priority) {
    case 'urgent': return 'bg-red-500';
    case 'high': return 'bg-orange-400';
    case 'medium': return 'bg-sky-400';
    default: return 'bg-[var(--led-line-strong)]';
  }
}

function CheckCircle({ completed, onClick }: { completed: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
        completed
          ? 'border-[var(--led-muted)] bg-[var(--led-muted)] text-white'
          : 'border-[var(--led-line-2)] hover:border-[var(--led-accent)] hover:bg-[var(--led-accent)]/5'
      }`}
    >
      {completed && (
        <CheckIcon className="h-3 w-3" strokeWidth={3} />
      )}
    </button>
  );
}

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [staff, setStaff] = useState<User[]>([]);
  const [newItemTitle, setNewItemTitle] = useState('');
  const [addingItem, setAddingItem] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editPriority, setEditPriority] = useState('');
  const [editAssignee, setEditAssignee] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editDueTime, setEditDueTime] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchTask = () => {
    if (!id) return;
    api.get(`/tasks/${id}`)
      .then(({ data }) => { setTask(data); populateEditForm(data); })
      .catch(() => toast('Failed to load task', 'error'))
      .finally(() => setLoading(false));
  };

  const populateEditForm = (t: Task) => {
    setEditTitle(t.title);
    setEditDescription(t.description || '');
    setEditStatus(t.status);
    setEditPriority(t.priority);
    setEditAssignee(t.assigned_to_id || '');
    // Split the stored UTC due date into local date + time parts for the inputs.
    const local = t.due_date ? toDateTimeLocalInput(t.due_date) : '';
    setEditDueDate(local ? local.split('T')[0] : '');
    setEditDueTime(local ? local.split('T')[1] : '');
  };

  const fetchStaff = () => {
    api.get('/users?role=broker&per_page=100')
      .then(({ data }) => setStaff(data.items || data))
      .catch(() => {});
  };

  useEffect(() => { fetchTask(); fetchStaff(); }, [id]);

  const handleSave = async () => {
    if (!id || !task) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      if (editTitle.trim() !== task.title) payload.title = editTitle.trim();
      if (editDescription !== (task.description || '')) payload.description = editDescription || null;
      if (editStatus !== task.status) payload.status = editStatus;
      if (editPriority !== task.priority) payload.priority = editPriority;
      if (editAssignee !== (task.assigned_to_id || '')) payload.assigned_to_id = editAssignee || null;
      // Default to 5pm local when only a date is set, matching the quick-add form.
      const newDue = editDueDate ? dateTimeLocalToUTC(`${editDueDate}T${editDueTime || '17:00'}`) : null;
      const oldDue = task.due_date ? new Date(task.due_date).toISOString() : null;
      if (newDue !== oldDue) payload.due_date = newDue;

      if (Object.keys(payload).length > 0) {
        const { data } = await api.patch(`/tasks/${id}`, payload);
        setTask(data);
        populateEditForm(data);
        toast('Task updated', 'success');
      }
      setEditing(false);
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to update task'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const startRename = () => {
    if (!task) return;
    setRenameValue(task.title);
    setRenaming(true);
  };

  const saveRename = async () => {
    if (!id || !task) return;
    const trimmed = renameValue.trim();
    setRenaming(false);
    if (!trimmed || trimmed === task.title) return;
    try {
      const { data } = await api.patch(`/tasks/${id}`, { title: trimmed });
      setTask(data);
      populateEditForm(data);
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to rename task'), 'error');
    }
  };

  const toggleUrgent = async () => {
    if (!id || !task) return;
    const next = task.priority === 'urgent' ? 'low' : 'urgent';
    try {
      const { data } = await api.patch(`/tasks/${id}`, { priority: next });
      setTask(data);
      populateEditForm(data);
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to update task'), 'error');
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    if (!(await confirm({
      title: 'Delete this task?',
      message: 'This cannot be undone.',
      confirmText: 'Delete',
      variant: 'danger',
    }))) return;
    setDeleting(true);
    try {
      await api.delete(`/tasks/${id}`);
      toast('Task deleted', 'success');
      navigate('/admin/tasks');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to delete task'), 'error');
      setDeleting(false);
    }
  };

  const handleToggleItem = async (item: ChecklistItem) => {
    if (!id) return;
    try {
      await api.patch(`/tasks/${id}/checklist/${item.id}/toggle`);
      fetchTask();
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to toggle item'), 'error');
    }
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !newItemTitle.trim()) return;
    setAddingItem(true);
    try {
      await api.post(`/tasks/${id}/checklist`, { title: newItemTitle.trim() });
      setNewItemTitle('');
      fetchTask();
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to add item'), 'error');
    } finally {
      setAddingItem(false);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!id) return;
    try {
      await api.delete(`/tasks/${id}/checklist/${itemId}`);
      fetchTask();
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to delete item'), 'error');
    }
  };

  const uploadAttachment = async (file: File) => {
    if (!id) return;
    setUploadingAttachment(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await api.post(`/tasks/${id}/attachments`, formData);
      fetchTask();
      toast('Attachment uploaded', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to upload attachment'), 'error');
    } finally {
      setUploadingAttachment(false);
    }
  };

  const downloadAttachment = async (attachment: TaskAttachment) => {
    if (!id) return;
    let url: string | null = null;
    let a: HTMLAnchorElement | null = null;
    try {
      const { data } = await api.get(`/tasks/${id}/attachments/${attachment.id}/download`, { responseType: 'blob' });
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
      await api.delete(`/tasks/${id}/attachments/${attachmentId}`);
      fetchTask();
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to delete attachment'), 'error');
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

  if (!task) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="text-[14px] text-[var(--led-muted)] mb-4">This task does not exist or has been deleted.</p>
        <Link to="/admin/tasks"><Button variant="secondary">Back to Tasks</Button></Link>
      </div>
    );
  }

  const completedCount = task.checklist_items.filter((i) => i.is_completed).length;
  const totalItems = task.checklist_items.length;
  const isCompleted = task.status === 'completed';
  const isOverdue = task.due_date && !isCompleted && new Date(task.due_date) < new Date();
  const initials = task.assigned_to_name
    ? task.assigned_to_name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : null;

  /* Checklist — shown in both view and edit modes (items save independently). */
  const checklistSection = (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[13px] font-semibold text-foreground">Checklist</p>
        {totalItems > 0 && (
          <div className="flex items-center gap-2.5">
            <div className="h-1.5 w-20 rounded-full bg-[var(--led-surface-2)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--led-success)] transition-all"
                style={{ width: `${(completedCount / totalItems) * 100}%` }}
              />
            </div>
            <span className="text-[12px] text-[var(--led-muted)] tabular-nums">{completedCount}/{totalItems}</span>
          </div>
        )}
      </div>

      <div className="space-y-0.5 mb-3">
        {task.checklist_items.map((item) => (
          <div
            key={item.id}
            className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-[var(--led-surface-2)]/60 transition-colors -mx-2"
          >
            <CheckCircle completed={item.is_completed} onClick={() => handleToggleItem(item)} />
            <span className={`flex-1 text-[14px] ${item.is_completed ? 'line-through text-[var(--led-muted)]' : 'text-foreground'}`}>
              {item.title}
            </span>
            <button
              onClick={() => handleDeleteItem(item.id)}
              className="opacity-0 group-hover:opacity-100 text-[var(--led-muted)] hover:text-red-500 transition-all p-1 rounded"
            >
              <XMarkIcon className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        ))}
        {totalItems === 0 && (
          <p className="text-[13px] text-[var(--led-muted)] px-2 py-1">No items yet.</p>
        )}
      </div>

      {/* Adding items is only available in edit mode; view mode allows toggling. */}
      {editing && (
        <form onSubmit={handleAddItem} className="flex gap-2">
          <Input
            type="text"
            value={newItemTitle}
            onChange={(e) => setNewItemTitle(e.target.value)}
            placeholder="Add an item..."
            className="flex-1"
          />
          <Button type="submit" variant="secondary" size="sm" disabled={addingItem || !newItemTitle.trim()}>
            {addingItem ? '...' : 'Add'}
          </Button>
        </form>
      )}
    </div>
  );

  /* Attachments — shown in both view and edit modes. */
  const attachmentsSection = (
    <div>
      <p className="text-[13px] font-semibold text-foreground mb-3">Attachments</p>

      {task.attachments.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {task.attachments.map((a) => (
            <div key={a.id} className="group flex items-center gap-2 rounded-lg border border-[var(--led-line)] bg-[var(--led-surface-2)]/50 px-3 py-2">
              <svg className="h-4 w-4 shrink-0 text-[var(--led-muted)]" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739 10.682 20.432a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.5L8.552 18.448a1.5 1.5 0 0 1-2.121-2.121L16.5 6.75" />
              </svg>
              <button type="button" onClick={() => downloadAttachment(a)} className="flex-1 min-w-0 text-left text-[13px] text-foreground truncate hover:underline">
                {a.original_filename}
              </button>
              <span className="text-[11px] text-[var(--led-muted)] shrink-0">
                {a.uploaded_by_name ? `${a.uploaded_by_name} · ` : ''}{formatDate(a.uploaded_at)}
              </span>
              <button
                onClick={() => deleteAttachment(a.id)}
                className="opacity-0 group-hover:opacity-100 text-[var(--led-muted)] hover:text-red-500 transition-all p-1 rounded shrink-0"
              >
                <XMarkIcon className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      )}

      <FileDropzone uploading={uploadingAttachment} onFile={uploadAttachment} onError={(msg) => toast(msg, 'error')} />
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl">
      <Breadcrumbs items={[
        { label: 'Tasks', href: '/admin/tasks' },
        { label: task.title },
      ]} />

      {editing ? (
        /* ── Edit form ── */
        <div className="space-y-4 pb-6">
          <Input label="Title *" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
          <div>
            <label className="block text-[13px] font-medium text-[var(--led-muted)] mb-1.5">Description</label>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={3}
              placeholder="Add a description..."
              className="w-full rounded-xl border border-[var(--led-line-2)] bg-[var(--led-surface)] px-3.5 py-2.5 text-[14px] text-foreground placeholder:text-[var(--led-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--led-accent)]/30 transition-all resize-none"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Status" value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
              <option value="todo">To Do</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
            </Select>
            <div>
              <label className="block text-[13px] font-medium text-[var(--led-muted)] mb-1.5">Priority</label>
              <label className="flex items-center gap-2 cursor-pointer mt-2.5">
                <input
                  type="checkbox"
                  checked={editPriority === 'urgent'}
                  onChange={(e) => setEditPriority(e.target.checked ? 'urgent' : 'low')}
                  className="h-4 w-4 rounded border-border accent-red-500"
                />
                <span className="text-[14px] text-foreground">Mark as urgent</span>
              </label>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Assigned To" value={editAssignee} onChange={(e) => setEditAssignee(e.target.value)}>
              <option value="">Unassigned</option>
              {staff.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name}</option>
              ))}
            </Select>
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1.5">Due Date &amp; Time</label>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <DatePicker value={editDueDate} onChange={(v) => setEditDueDate(v)} />
                </div>
                <input
                  type="time"
                  value={editDueTime}
                  onChange={(e) => setEditDueTime(e.target.value)}
                  disabled={!editDueDate}
                  aria-label="Due time"
                  className="led-input h-10 w-28 px-3 disabled:opacity-40"
                />
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-[var(--led-line)]">{checklistSection}</div>
          <div className="pt-2 border-t border-[var(--led-line)]">{attachmentsSection}</div>

          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</Button>
            <Button variant="secondary" onClick={() => { setEditing(false); populateEditForm(task); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        /* ── View mode ── */
        <div className="space-y-6 pb-6">
          {/* Title row */}
          <div className="flex items-start gap-3">
            <div className="mt-1">
              <div className={`h-3 w-3 rounded-full ${priorityDotClass(task.priority)}`} title={`Priority: ${task.priority}`} />
            </div>
            <div className="flex-1 min-w-0">
              {renaming ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={saveRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveRename();
                    if (e.key === 'Escape') setRenaming(false);
                  }}
                  className="w-full bg-transparent text-[22px] font-bold text-foreground leading-snug focus:outline-none border-b-2 border-[var(--led-accent)] pb-0.5"
                />
              ) : (
                <h1
                  onClick={startRename}
                  title="Click to rename"
                  className={`text-[22px] font-bold text-foreground leading-snug cursor-text ${isCompleted ? 'line-through text-[var(--led-muted)]' : ''}`}
                >
                  {task.title}
                </h1>
              )}
              {task.description && (
                <div className="mt-3 rounded-xl border border-[var(--led-line)] bg-[var(--led-surface-2)]/50 px-4 py-3">
                  <p className="text-[15px] font-medium text-foreground leading-relaxed whitespace-pre-wrap">{task.description}</p>
                </div>
              )}
            </div>
          </div>

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-[13px] border-y border-[var(--led-line)] py-4">
            <div>
              <p className="text-[11px] font-semibold text-[var(--led-muted)] uppercase tracking-wider mb-1">Assignee</p>
              {initials ? (
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--led-accent)]/15 text-[10px] font-semibold text-[var(--led-accent)]">
                    {initials}
                  </div>
                  <span className="text-foreground font-medium">{task.assigned_to_name}</span>
                </div>
              ) : (
                <span className="text-[var(--led-muted)] italic">Unassigned</span>
              )}
            </div>

            <div>
              <p className="text-[11px] font-semibold text-[var(--led-muted)] uppercase tracking-wider mb-1">Status</p>
              <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${
                task.status === 'completed' ? 'text-[var(--led-success)]'
                : task.status === 'in_progress' ? 'text-amber-500'
                : 'text-foreground'
              }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${
                  task.status === 'completed' ? 'bg-[var(--led-success)]'
                  : task.status === 'in_progress' ? 'bg-amber-500'
                  : 'bg-[var(--led-muted)]'
                }`} />
                {task.status === 'todo' ? 'To Do' : task.status === 'in_progress' ? 'In Progress' : 'Completed'}
              </span>
            </div>

            {task.due_date && (
              <div>
                <p className="text-[11px] font-semibold text-[var(--led-muted)] uppercase tracking-wider mb-1">Due Date</p>
                <span className={`text-[13px] font-medium ${isOverdue ? 'text-red-500' : 'text-foreground'}`}>
                  {formatDateTime(task.due_date)}
                  {isOverdue && ' — overdue'}
                </span>
              </div>
            )}

            {task.priority === 'urgent' && (
              <div>
                <p className="text-[11px] font-semibold text-[var(--led-muted)] uppercase tracking-wider mb-1">Priority</p>
                <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${TASK_PRIORITY_BADGE.urgent.className}`}>
                  ● Urgent
                </span>
              </div>
            )}

            <div>
              <p className="text-[11px] font-semibold text-[var(--led-muted)] uppercase tracking-wider mb-1">Created by</p>
              <span className="text-foreground font-medium">{task.created_by_name || '—'}</span>
              <span className="text-[var(--led-muted)]"> · {formatDate(task.created_at)}</span>
            </div>
          </div>

          {/* Linked application */}
          {task.application_id && task.application_label && (
            <div className="rounded-xl bg-[var(--led-accent)]/5 border border-[var(--led-accent)]/15 px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold text-[var(--led-muted)] uppercase tracking-wider mb-0.5">Linked Application</p>
                <p className="text-[14px] font-medium text-foreground">{task.application_label}</p>
              </div>
              <Link to={`/admin/applications/${task.application_id}`}>
                <Button variant="ghost" size="sm">View →</Button>
              </Link>
            </div>
          )}

          {/* Checklist */}
          {checklistSection}

          {/* Attachments */}
          <div className="border-t border-[var(--led-line)] pt-5">{attachmentsSection}</div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2 border-t border-[var(--led-line)]">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>Edit task</Button>
            <Button variant="secondary" size="sm" onClick={toggleUrgent}>
              {task.priority === 'urgent' ? 'Clear urgent' : 'Mark urgent'}
            </Button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-[13px] text-[var(--led-muted)] hover:text-red-500 transition-colors disabled:opacity-40"
            >
              {deleting ? 'Deleting...' : 'Delete task'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
