import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { formatDate, getErrorMessage } from '../../lib/utils';
import { TASK_STATUS_BADGE, TASK_PRIORITY_BADGE } from '../../lib/constants';
import { GlassCard, Badge, Button, Select, Input, Breadcrumbs, DatePicker } from '../../components/ui';
import type { Task, ChecklistItem, User } from '../../types';

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [staff, setStaff] = useState<User[]>([]);
  const [newItemTitle, setNewItemTitle] = useState('');
  const [addingItem, setAddingItem] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editPriority, setEditPriority] = useState('');
  const [editAssignee, setEditAssignee] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
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
    setEditDueDate(t.due_date ? t.due_date.split('T')[0] : '');
  };

  const fetchStaff = () => {
    Promise.all([
      api.get('/users?role=admin&per_page=100'),
      api.get('/users?role=broker&per_page=100'),
      api.get('/users?role=referrer&per_page=100'),
    ]).then(([{ data: adminData }, { data: brokerData }, { data: referrerData }]) => {
      const combined = [
        ...(adminData.items || adminData),
        ...(brokerData.items || brokerData),
        ...(referrerData.items || referrerData),
      ];
      setStaff(combined.filter((u, i, arr) => arr.findIndex((x) => x.id === u.id) === i));
    }).catch(() => {});
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
      const newDue = editDueDate || null;
      const oldDue = task.due_date ? task.due_date.split('T')[0] : null;
      if (newDue !== oldDue) payload.due_date = editDueDate ? new Date(editDueDate).toISOString() : null;

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

  const handleDelete = async () => {
    if (!id || !confirm('Are you sure you want to delete this task?')) return;
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

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl">
        <GlassCard>
          <div className="space-y-4">
            <div className="h-6 w-64 rounded-lg shimmer" />
            <div className="h-4 w-48 rounded-lg shimmer" />
            <div className="h-4 w-32 rounded-lg shimmer" />
          </div>
        </GlassCard>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="mx-auto max-w-2xl">
        <GlassCard>
          <p className="text-[14px] text-muted-foreground">This task does not exist or has been deleted.</p>
          <Link to="/admin/tasks"><Button variant="secondary" className="mt-4">Back to Tasks</Button></Link>
        </GlassCard>
      </div>
    );
  }

  const completedCount = task.checklist_items.filter((i) => i.is_completed).length;
  const totalItems = task.checklist_items.length;
  const isOverdue = task.due_date && task.status !== 'completed' && new Date(task.due_date) < new Date();

  return (
    <div className="mx-auto max-w-2xl">
      <Breadcrumbs items={[
        { label: 'Tasks', href: '/admin/tasks' },
        { label: task?.title || 'Detail' },
      ]} />

      {/* Task detail */}
      <GlassCard className="mb-4">
        {editing ? (
          <div className="space-y-4">
            <Input label="Title *" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            <Input label="Description" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label="Status" value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
              </Select>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Priority</label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editPriority === 'urgent'}
                    onChange={(e) => setEditPriority(e.target.checked ? 'urgent' : 'low')}
                    className="h-4 w-4 rounded border-border accent-destructive"
                  />
                  <span className="text-[14px] text-foreground">Mark as urgent</span>
                </label>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label="Assigned To" value={editAssignee} onChange={(e) => setEditAssignee(e.target.value)}>
                <option value="">Unassigned</option>
                {staff.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>
                ))}
              </Select>
              <DatePicker label="Due Date" value={editDueDate} onChange={(v) => setEditDueDate(v)} />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
              <Button variant="secondary" onClick={() => { setEditing(false); populateEditForm(task); }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 mb-3">
              <h1 className="text-[20px] font-semibold text-foreground leading-snug">{task.title}</h1>
              <div className="flex shrink-0 gap-2">
                <Badge type="custom" value={TASK_STATUS_BADGE[task.status].label} className={TASK_STATUS_BADGE[task.status].className} />
                {task.priority === 'urgent' && (
                  <Badge type="custom" value="Urgent" className={TASK_PRIORITY_BADGE.urgent.className} />
                )}
              </div>
            </div>

            {task.description && (
              <p className="text-[14px] text-muted-foreground mb-4">{task.description}</p>
            )}

            {/* Meta row */}
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-muted-foreground mb-4">
              <span>
                Assigned to{' '}
                <span className="text-foreground font-medium">{task.assigned_to_name || 'nobody'}</span>
              </span>
              {task.due_date && (
                <span>
                  Due{' '}
                  <span className={`font-medium ${isOverdue ? 'text-destructive' : 'text-foreground'}`}>
                    {formatDate(task.due_date)}
                  </span>
                </span>
              )}
              <span>
                Created by{' '}
                <span className="text-foreground font-medium">{task.created_by_name || 'unknown'}</span>
                {' '}on{' '}
                <span className="text-foreground font-medium">{formatDate(task.created_at)}</span>
              </span>
            </div>

            {task.application_id && task.application_label && (
              <div className="mb-4 rounded-xl bg-primary/5 border border-primary/10 p-3 flex items-center justify-between">
                <div>
                  <p className="text-[12px] font-medium text-muted-foreground">Linked Application</p>
                  <p className="text-[14px] font-medium text-foreground">{task.application_label}</p>
                </div>
                <Link to={`/admin/applications/${task.application_id}`}>
                  <Button variant="ghost" size="sm">View</Button>
                </Link>
              </div>
            )}

            <div className="flex gap-2 pt-3 border-t border-border">
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>Edit</Button>
              <Button variant="danger" size="sm" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </>
        )}
      </GlassCard>

      {/* Checklist */}
      <GlassCard>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[15px] font-semibold text-foreground">Checklist</h2>
          {totalItems > 0 && (
            <div className="flex items-center gap-3">
              <div className="h-1.5 w-24 rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full rounded-full bg-success transition-all"
                  style={{ width: `${(completedCount / totalItems) * 100}%` }}
                />
              </div>
              <span className="text-[12px] text-muted-foreground">{completedCount}/{totalItems}</span>
            </div>
          )}
        </div>

        {totalItems === 0 && (
          <p className="text-[13px] text-muted-foreground mb-4">No items yet.</p>
        )}

        <div className="space-y-1">
          {task.checklist_items.map((item) => (
            <div
              key={item.id}
              className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-secondary/50 transition-colors"
            >
              <button
                onClick={() => handleToggleItem(item)}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                  item.is_completed
                    ? 'border-success bg-success text-white'
                    : 'border-border hover:border-primary'
                }`}
              >
                {item.is_completed && (
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                )}
              </button>
              <span className={`flex-1 text-[14px] ${item.is_completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                {item.title}
              </span>
              <button
                onClick={() => handleDeleteItem(item.id)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-1"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        <form onSubmit={handleAddItem} className="mt-3 flex gap-2">
          <Input
            type="text"
            value={newItemTitle}
            onChange={(e) => setNewItemTitle(e.target.value)}
            placeholder="Add an item..."
            className="flex-1"
          />
          <Button type="submit" variant="secondary" size="sm" disabled={addingItem || !newItemTitle.trim()}>
            {addingItem ? 'Adding...' : 'Add'}
          </Button>
        </form>
      </GlassCard>
    </div>
  );
}
