import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { getErrorMessage } from '../../lib/utils';
import { GlassCard } from '../../components/ui';
import type { TaskListItem, User } from '../../types';

const STATUS_TABS = [
  { label: 'All', value: '' },
  { label: 'To Do', value: 'todo' },
  { label: 'Completed', value: 'completed' },
];

function relativeDueDate(dateStr: string): { label: string; overdue: boolean } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr);
  due.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < -1) return { label: `${Math.abs(diff)}d overdue`, overdue: true };
  if (diff === -1) return { label: 'Yesterday', overdue: true };
  if (diff === 0) return { label: 'Today', overdue: true };
  if (diff === 1) return { label: 'Tomorrow', overdue: false };
  if (diff < 7) return { label: due.toLocaleDateString('en-AU', { weekday: 'short' }), overdue: false };
  return { label: due.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }), overdue: false };
}

export default function Tasks() {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [staff, setStaff] = useState<User[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newUrgent, setNewUrgent] = useState(false);
  const [newDueDate, setNewDueDate] = useState('');
  const [newAssignee, setNewAssignee] = useState('');
  const [adding, setAdding] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [completedCollapsed, setCompletedCollapsed] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  const isAllTab = statusFilter === '';
  const perPage = isAllTab ? 100 : 25;

  const fetchData = () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('per_page', String(perPage));
    if (statusFilter) params.set('status', statusFilter);
    if (assigneeFilter) params.set('assigned_to_id', assigneeFilter);
    if (search) params.set('search', search);
    api.get(`/tasks?${params}`)
      .then(({ data }) => { setTasks(data.items); setTotal(data.total); })
      .catch(() => toast('Failed to load tasks', 'error'))
      .finally(() => setLoading(false));
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

  useEffect(() => { fetchData(); }, [page, statusFilter, assigneeFilter]);
  useEffect(() => { fetchStaff(); }, []);
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const handleTabChange = (value: string) => { setStatusFilter(value); setPage(1); };

  const handleToggleComplete = async (task: TaskListItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (toggling) return;
    setToggling(task.id);
    const newStatus = task.status === 'completed' ? 'todo' : 'completed';
    try {
      await api.patch(`/tasks/${task.id}`, { status: newStatus });
      fetchData();
    } catch {
      toast('Failed to update task', 'error');
    } finally {
      setToggling(null);
    }
  };

  const handleStartEdit = (task: TaskListItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(task.id);
    setEditingTitle(task.title);
  };

  const handleSaveEdit = async (taskId: string) => {
    const trimmed = editingTitle.trim();
    setEditingId(null);
    if (!trimmed) return;
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, title: trimmed } : t));
    try {
      await api.patch(`/tasks/${taskId}`, { title: trimmed });
    } catch {
      toast('Failed to rename task', 'error');
      fetchData();
    }
  };

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setAdding(true);
    try {
      const payload: Record<string, unknown> = {
        title: newTitle.trim(),
        status: 'todo',
        priority: newUrgent ? 'urgent' : 'low',
      };
      if (newDueDate) payload.due_date = new Date(newDueDate).toISOString();
      if (newAssignee) payload.assigned_to_id = newAssignee;
      await api.post('/tasks', payload);
      setNewTitle('');
      setNewUrgent(false);
      setNewDueDate('');
      setNewAssignee('');
      setPage(1);
      fetchData();
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to create task'), 'error');
    } finally {
      setAdding(false);
    }
  };

  const renderTask = (task: TaskListItem) => {
    const isCompleted = task.status === 'completed';
    const isUrgent = task.priority === 'urgent' && !isCompleted;
    const isEditing = editingId === task.id;
    const initials = task.assigned_to_name
      ? task.assigned_to_name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
      : null;
    const due = task.due_date ? relativeDueDate(task.due_date) : null;
    const dueOverdue = due?.overdue && !isCompleted;

    return (
      <div
        key={task.id}
        onClick={() => { if (!isEditing) navigate(`/admin/tasks/${task.id}`); }}
        className={`flex items-center gap-3 px-4 py-2.5 transition-colors group border-l-2 ${
          isUrgent ? 'border-destructive bg-destructive/[0.03] hover:bg-destructive/[0.06]' : 'border-transparent hover:bg-secondary/40'
        } ${isEditing ? 'cursor-default' : 'cursor-pointer'}`}
      >
        {/* Circle toggle */}
        <button
          onClick={(e) => handleToggleComplete(task, e)}
          disabled={toggling === task.id}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
            isCompleted
              ? 'border-success bg-success text-white'
              : isUrgent
              ? 'border-destructive hover:bg-destructive/10'
              : 'border-border hover:border-primary'
          }`}
        >
          {isCompleted && (
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          )}
        </button>

        {/* Title */}
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <input
              ref={editInputRef}
              value={editingTitle}
              onChange={(e) => setEditingTitle(e.target.value)}
              onBlur={() => handleSaveEdit(task.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveEdit(task.id);
                if (e.key === 'Escape') setEditingId(null);
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-full bg-transparent text-[14px] text-foreground focus:outline-none border-b border-primary pb-px"
            />
          ) : (
            <span
              onClick={(e) => handleStartEdit(task, e)}
              title="Click to rename"
              className={`text-[14px] cursor-text ${isCompleted ? 'line-through text-muted-foreground' : 'text-foreground'}`}
            >
              {task.title}
            </span>
          )}
          {task.application_label && !isEditing && (
            <span className="ml-2 text-[12px] text-muted-foreground">{task.application_label}</span>
          )}
        </div>

        {/* Checklist progress */}
        {task.checklist_total > 0 && (
          <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">
            {task.checklist_completed}/{task.checklist_total}
          </span>
        )}

        {/* Due date */}
        {due ? (
          <span className={`shrink-0 text-[12px] font-medium ${dueOverdue ? 'text-destructive' : 'text-muted-foreground'}`}>
            {due.label}
          </span>
        ) : (
          <span className="shrink-0 w-14" />
        )}

        {/* Assignee initials */}
        {initials ? (
          <div className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[11px] font-medium text-primary">
            {initials}
          </div>
        ) : (
          <div className="shrink-0 w-6" />
        )}
      </div>
    );
  };

  const todoTasks = isAllTab ? tasks.filter((t) => t.status !== 'completed') : tasks;
  const completedTasks = isAllTab ? tasks.filter((t) => t.status === 'completed') : [];
  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-[22px] font-semibold text-foreground">Tasks</h1>
        <span className="text-[13px] text-muted-foreground">{total} task{total !== 1 ? 's' : ''}</span>
      </div>

      {/* Tab pills */}
      <div className="flex gap-1 mb-4 p-1 bg-secondary rounded-xl w-fit">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => handleTabChange(tab.value)}
            className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
              statusFilter === tab.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <select
          value={assigneeFilter}
          onChange={(e) => { setAssigneeFilter(e.target.value); setPage(1); }}
          className="text-[13px] rounded-lg border border-border bg-background px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All people</option>
          {currentUser && <option value={currentUser.id}>My tasks</option>}
          {staff.filter((u) => u.id !== currentUser?.id).map((u) => (
            <option key={u.id} value={u.id}>{u.full_name}</option>
          ))}
        </select>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); fetchData(); } }}
          placeholder="Search tasks..."
          className="text-[13px] rounded-lg border border-border bg-background px-2.5 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary flex-1 min-w-[140px]"
        />
      </div>

      <GlassCard padding="none">
        {loading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-5 w-5 rounded-full shimmer shrink-0" />
                <div className="h-4 rounded-lg shimmer flex-1" />
                <div className="h-4 w-16 rounded-lg shimmer" />
              </div>
            ))}
          </div>
        ) : isAllTab ? (
          <>
            {/* To Do group */}
            <div>
              <div className="px-4 pt-3 pb-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  To Do · {todoTasks.length}
                </span>
              </div>
              {todoTasks.length === 0 ? (
                <p className="px-4 py-3 text-[13px] text-muted-foreground italic">All caught up!</p>
              ) : (
                <div className="divide-y divide-border">{todoTasks.map(renderTask)}</div>
              )}
            </div>

            {/* Completed group */}
            {completedTasks.length > 0 && (
              <div className="border-t border-border">
                <button
                  onClick={() => setCompletedCollapsed((c) => !c)}
                  className="w-full flex items-center gap-2 px-4 pt-3 pb-1.5 text-left hover:bg-secondary/30 transition-colors"
                >
                  <svg
                    className={`h-3 w-3 text-muted-foreground transition-transform ${completedCollapsed ? '-rotate-90' : ''}`}
                    fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                  </svg>
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Completed · {completedTasks.length}
                  </span>
                </button>
                {!completedCollapsed && (
                  <div className="divide-y divide-border">{completedTasks.map(renderTask)}</div>
                )}
              </div>
            )}
          </>
        ) : tasks.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-[14px] text-muted-foreground italic">Nothing here</p>
          </div>
        ) : (
          <div className="divide-y divide-border">{tasks.map(renderTask)}</div>
        )}

        {/* Quick-add */}
        <div className="border-t border-border px-4 py-3">
          <form onSubmit={handleQuickAdd} className="flex items-center gap-2 flex-wrap">
            <button
              type="submit"
              disabled={adding || !newTitle.trim()}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-border hover:border-primary transition-colors text-muted-foreground hover:text-primary disabled:opacity-40"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="New task..."
              disabled={adding}
              className="flex-1 min-w-[120px] bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <input
              type="date"
              value={newDueDate}
              onChange={(e) => setNewDueDate(e.target.value)}
              title="Due date"
              className="text-[12px] rounded-lg border border-border bg-background px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <select
              value={newAssignee}
              onChange={(e) => setNewAssignee(e.target.value)}
              title="Assign to"
              className="text-[12px] rounded-lg border border-border bg-background px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Assign to...</option>
              {staff.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setNewUrgent((u) => !u)}
              className={`shrink-0 text-[12px] font-medium px-2 py-0.5 rounded transition-colors ${
                newUrgent ? 'text-destructive bg-destructive/10' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Urgent
            </button>
          </form>
        </div>

        {/* Pagination — only for To Do / Completed tabs */}
        {!isAllTab && totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <span className="text-[12px] text-muted-foreground">
              {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} of {total}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-40 transition-colors"
              >←</button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-40 transition-colors"
              >→</button>
            </div>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
