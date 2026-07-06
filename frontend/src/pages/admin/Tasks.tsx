import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { getErrorMessage } from '../../lib/utils';
import { DatePicker, EmptyState } from '../../components/ui';
import type { TaskListItem, User } from '../../types';

const STATUS_TABS = [
  { label: 'All', value: '' },
  { label: 'To Do', value: 'todo' },
  { label: 'Completed', value: 'completed' },
];

function relativeDueDate(dateStr: string): { label: string; overdue: boolean; today: boolean } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr);
  due.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < -1) return { label: `${Math.abs(diff)}d overdue`, overdue: true, today: false };
  if (diff === -1) return { label: 'Yesterday', overdue: true, today: false };
  if (diff === 0) return { label: 'Today', overdue: false, today: true };
  if (diff === 1) return { label: 'Tomorrow', overdue: false, today: false };
  if (diff < 7) return { label: due.toLocaleDateString('en-AU', { weekday: 'short' }), overdue: false, today: false };
  return { label: due.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }), overdue: false, today: false };
}

function CheckCircle({ priority, completed, toggling, onClick }: {
  priority: string; completed: boolean; toggling: boolean; onClick: (e: React.MouseEvent) => void;
}) {
  const ring = completed
    ? 'border-[var(--led-muted)] bg-[var(--led-muted)] text-white'
    : priority === 'urgent'
    ? 'border-red-500 hover:bg-red-500/10'
    : priority === 'high'
    ? 'border-orange-400 hover:bg-orange-400/10'
    : priority === 'medium'
    ? 'border-sky-400 hover:bg-sky-400/10'
    : 'border-[var(--led-line-strong)] hover:border-[var(--led-accent)] hover:bg-[var(--led-accent)]/5';

  return (
    <button
      onClick={onClick}
      disabled={toggling}
      className={`flex-none flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 transition-all disabled:opacity-50 ${ring}`}
    >
      {completed && (
        <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      )}
    </button>
  );
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
  const [showAddForm, setShowAddForm] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [completedCollapsed, setCompletedCollapsed] = useState(true);
  const addInputRef = useRef<HTMLInputElement>(null);

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
    api.get('/users?role=broker&per_page=100')
      .then(({ data }) => setStaff(data.items || data))
      .catch(() => {});
  };

  useEffect(() => { fetchData(); }, [page, statusFilter, assigneeFilter]);
  useEffect(() => { fetchStaff(); }, []);
  useEffect(() => {
    if (showAddForm && addInputRef.current) addInputRef.current.focus();
  }, [showAddForm]);

  const handleTabChange = (value: string) => { setStatusFilter(value); setPage(1); };

  const handleToggleComplete = async (task: TaskListItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (toggling) return;
    setToggling(task.id);
    const newStatus: TaskListItem['status'] = task.status === 'completed' ? 'todo' : 'completed';
    setTasks((prev) => {
      const updated = prev.map((t) => (t.id === task.id ? { ...t, status: newStatus } : t));
      return statusFilter ? updated.filter((t) => t.status === statusFilter) : updated;
    });
    try {
      await api.patch(`/tasks/${task.id}`, { status: newStatus });
    } catch {
      toast('Failed to update task', 'error');
      fetchData();
    } finally {
      setToggling(null);
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
      setShowAddForm(false);
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
    const due = task.due_date ? relativeDueDate(task.due_date) : null;
    const initials = task.assigned_to_name
      ? task.assigned_to_name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
      : null;
    const dueDateColor = due
      ? due.overdue
        ? 'text-red-500'
        : due.today
        ? 'text-amber-500'
        : 'text-[var(--led-muted)]'
      : '';

    return (
      <div
        key={task.id}
        onClick={() => navigate(`/admin/tasks/${task.id}`)}
        className="group flex items-center gap-3 py-2 border-b border-[var(--led-line)] last:border-0 rounded-lg px-2 -mx-2 transition-colors cursor-pointer hover:bg-[var(--led-surface-2)]/60"
      >
        <CheckCircle
          priority={task.priority}
          completed={isCompleted}
          toggling={toggling === task.id}
          onClick={(e) => handleToggleComplete(task, e)}
        />

        <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 min-w-0">
              <span
                className={`text-[14px] leading-snug truncate ${
                  isCompleted ? 'line-through text-[var(--led-muted)]' : 'text-foreground'
                }`}
              >
                {task.title}
              </span>
              {task.application_label && (
                <span className="shrink-0 text-[11px] text-[var(--led-muted)]">{task.application_label}</span>
              )}
            </div>
        </div>

        {task.checklist_total > 0 && (
          <span className="shrink-0 text-[12px] text-[var(--led-muted)] tabular-nums">
            {task.checklist_completed}/{task.checklist_total}
          </span>
        )}

        {due && (
          <span className={`shrink-0 text-[12px] font-medium ${dueDateColor}`}>
            {due.label}
          </span>
        )}

        {initials ? (
          <div className="shrink-0 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[var(--led-accent)]/15 text-[10px] font-semibold text-[var(--led-accent)]">
            {initials}
          </div>
        ) : (
          <div className="shrink-0 w-[22px]" />
        )}
      </div>
    );
  };

  const todoTasks = isAllTab ? tasks.filter((t) => t.status !== 'completed') : tasks;
  const completedTasks = isAllTab ? tasks.filter((t) => t.status === 'completed') : [];
  const totalPages = Math.ceil(total / perPage);

  const isBroker = currentUser?.role === 'broker';

  return (
    <div className="mx-auto max-w-3xl">
      {/* Header */}
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-[24px] font-bold text-foreground tracking-tight">Tasks</h1>
        <span className="text-[13px] text-[var(--led-muted)]">{total} task{total !== 1 ? 's' : ''}</span>
      </div>

      {/* Tab bar + filters */}
      <div className="flex items-center gap-1 mb-5 border-b border-[var(--led-line)]">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => handleTabChange(tab.value)}
            className={`pb-2.5 px-1 mr-3 text-[14px] font-medium border-b-2 -mb-px transition-colors ${
              statusFilter === tab.value
                ? 'border-[var(--led-accent)] text-[var(--led-accent)]'
                : 'border-transparent text-[var(--led-muted)] hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-3 pb-2">
          <select
            value={assigneeFilter}
            onChange={(e) => { setAssigneeFilter(e.target.value); setPage(1); }}
            className="text-[13px] bg-transparent border-0 text-[var(--led-muted)] focus:outline-none focus:text-foreground cursor-pointer"
          >
            <option value="">All brokers</option>
            {isBroker && currentUser && (
              <option value={currentUser.id}>My tasks</option>
            )}
            {staff.filter((u) => u.id !== currentUser?.id || !isBroker).map((u) => (
              <option key={u.id} value={u.id}>{u.full_name}</option>
            ))}
          </select>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); fetchData(); } }}
            placeholder="Search..."
            className="text-[13px] bg-transparent border-b border-transparent focus:border-[var(--led-line-strong)] text-foreground placeholder:text-[var(--led-muted)] focus:outline-none w-24 transition-all pb-0.5"
          />
        </div>
      </div>

      {/* Task list */}
      <div>
        {loading ? (
          <div className="space-y-3 py-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-3 py-1.5">
                <div className="h-[18px] w-[18px] rounded-full shimmer shrink-0" />
                <div className="h-4 rounded-lg shimmer" style={{ width: `${45 + i * 8}%` }} />
                <div className="h-4 w-14 rounded-lg shimmer ml-auto" />
              </div>
            ))}
          </div>
        ) : isAllTab ? (
          <>
            <div className="mb-5">
              <p className="text-[11px] font-semibold text-[var(--led-muted)] uppercase tracking-widest mb-1.5">
                To Do · {todoTasks.length}
              </p>
              {todoTasks.length === 0 ? (
                <p className="text-[14px] text-[var(--led-muted)] py-3">All caught up</p>
              ) : (
                todoTasks.map(renderTask)
              )}
            </div>

            {completedTasks.length > 0 && (
              <div>
                <button
                  onClick={() => setCompletedCollapsed((c) => !c)}
                  className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--led-muted)] uppercase tracking-widest mb-1.5 hover:text-foreground transition-colors"
                >
                  <svg
                    className={`h-3 w-3 transition-transform ${completedCollapsed ? '-rotate-90' : ''}`}
                    fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                  </svg>
                  Completed · {completedTasks.length}
                </button>
                {!completedCollapsed && completedTasks.map(renderTask)}
              </div>
            )}
          </>
        ) : tasks.length === 0 ? (
          <EmptyState
            title="No tasks"
            description="Create a task, or adjust the status and broker filters above."
          />
        ) : (
          tasks.map(renderTask)
        )}

        {!isAllTab && totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 mt-2 border-t border-[var(--led-line)]">
            <span className="text-[12px] text-[var(--led-muted)]">
              {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} of {total}
            </span>
            <div className="flex gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 rounded-lg text-[13px] text-[var(--led-muted)] hover:text-foreground hover:bg-[var(--led-surface-2)] disabled:opacity-40 transition-colors">←</button>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1 rounded-lg text-[13px] text-[var(--led-muted)] hover:text-foreground hover:bg-[var(--led-surface-2)] disabled:opacity-40 transition-colors">→</button>
            </div>
          </div>
        )}

        {/* Add task */}
        <div className="mt-3">
          {showAddForm ? (
            <form
              onSubmit={handleQuickAdd}
              className="border border-[var(--led-line-strong)] rounded-xl p-4 space-y-3 bg-[var(--led-surface)]"
            >
              <input
                ref={addInputRef}
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Task name"
                disabled={adding}
                className="w-full bg-transparent text-[14px] font-medium text-foreground placeholder:text-[var(--led-muted)] focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setShowAddForm(false); setNewTitle(''); }
                }}
              />
              <div className="flex items-center gap-2 flex-wrap">
                <DatePicker
                  value={newDueDate}
                  onChange={(v) => setNewDueDate(v)}
                  placeholder="Due date"
                  className="text-[12px] h-8 py-1"
                />
                <select
                  value={newAssignee}
                  onChange={(e) => setNewAssignee(e.target.value)}
                  className="text-[12px] rounded-lg border border-[var(--led-line-strong)] bg-transparent px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-[var(--led-accent)]"
                >
                  <option value="">Assignee</option>
                  {staff.map((u) => (
                    <option key={u.id} value={u.id}>{u.full_name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setNewUrgent((u) => !u)}
                  className={`text-[12px] font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
                    newUrgent
                      ? 'text-red-500 bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-900'
                      : 'text-[var(--led-muted)] border-[var(--led-line-strong)] hover:text-foreground'
                  }`}
                >
                  {newUrgent ? '● Urgent' : 'Priority'}
                </button>
              </div>
              <div className="flex gap-2 pt-2 border-t border-[var(--led-line)]">
                <button
                  type="submit"
                  disabled={adding || !newTitle.trim()}
                  className="text-[13px] font-semibold px-4 py-1.5 rounded-lg bg-[var(--led-accent)] text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                  {adding ? 'Adding...' : 'Add task'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddForm(false);
                    setNewTitle('');
                    setNewDueDate('');
                    setNewAssignee('');
                    setNewUrgent(false);
                  }}
                  className="text-[13px] font-medium px-3 py-1.5 rounded-lg text-[var(--led-muted)] hover:text-foreground hover:bg-[var(--led-surface-2)] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-2 w-full py-2 px-2 -mx-2 text-[14px] text-[var(--led-muted)] hover:text-[var(--led-accent)] rounded-lg hover:bg-[var(--led-surface-2)]/60 transition-colors group"
            >
              <svg
                className="h-4 w-4 transition-colors"
                fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add task
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
