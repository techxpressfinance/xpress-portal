import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { formatDate, getErrorMessage } from '../../lib/utils';
import { TASK_STATUS_BADGE, TASK_PRIORITY_BADGE } from '../../lib/constants';
import { GlassCard, Badge, PageHeader, Button, Select, Input, StatCard } from '../../components/ui';
import type { TaskListItem, User } from '../../types';

interface CreateFormData {
  title: string;
  description: string;
  status: string;
  priority: string;
  due_date: string;
  assigned_to_id: string;
}

export default function Tasks() {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [staff, setStaff] = useState<User[]>([]);
  const [stats, setStats] = useState({ total: 0, todo: 0, in_progress: 0, completed: 0 });
  const perPage = 15;

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<CreateFormData>({
    defaultValues: { status: 'todo', priority: 'medium', assigned_to_id: '', description: '', due_date: '' },
  });

  const fetchData = () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('per_page', String(perPage));
    if (statusFilter) params.set('status', statusFilter);
    if (priorityFilter) params.set('priority', priorityFilter);
    if (assigneeFilter) params.set('assigned_to_id', assigneeFilter);
    if (search) params.set('search', search);

    api
      .get(`/tasks?${params}`)
      .then(({ data }) => {
        setTasks(data.items);
        setTotal(data.total);
      })
      .catch(() => toast('Failed to load tasks', 'error'))
      .finally(() => setLoading(false));
  };

  const fetchStats = () => {
    Promise.all([
      api.get('/tasks?per_page=1&status=todo'),
      api.get('/tasks?per_page=1&status=in_progress'),
      api.get('/tasks?per_page=1&status=completed'),
      api.get('/tasks?per_page=1'),
    ]).then(([todo, inProgress, completed, all]) => {
      setStats({
        total: all.data.total,
        todo: todo.data.total,
        in_progress: inProgress.data.total,
        completed: completed.data.total,
      });
    }).catch(() => {});
  };

  const fetchStaff = () => {
    api.get('/users?role=admin&per_page=100')
      .then(({ data }) => {
        const admins = data.items || data;
        api.get('/users?role=broker&per_page=100')
          .then(({ data: brokerData }) => {
            const brokers = brokerData.items || brokerData;
            setStaff([...admins, ...brokers]);
          });
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchData();
  }, [page, statusFilter, priorityFilter, assigneeFilter]);

  useEffect(() => {
    fetchStats();
    fetchStaff();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchData();
  };

  const onCreateSubmit = async (data: CreateFormData) => {
    try {
      const payload: Record<string, unknown> = {
        title: data.title.trim(),
        description: data.description.trim() || null,
        status: data.status,
        priority: data.priority,
        due_date: data.due_date || null,
        assigned_to_id: data.assigned_to_id || null,
      };
      await api.post('/tasks', payload);
      toast('Task created', 'success');
      reset();
      setShowForm(false);
      setPage(1);
      fetchData();
      fetchStats();
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to create task'), 'error');
    }
  };

  const totalPages = Math.ceil(total / perPage);

  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle="Manage team tasks and checklists"
        action={
          <Button onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : '+ New Task'}
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Total"
          value={stats.total}
          loading={loading && page === 1}
          gradient=""
          icon={<svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" /></svg>}
        />
        <StatCard
          label="To Do"
          value={stats.todo}
          loading={loading && page === 1}
          gradient=""
          icon={<svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>}
        />
        <StatCard
          label="In Progress"
          value={stats.in_progress}
          loading={loading && page === 1}
          gradient=""
          icon={<svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" /></svg>}
        />
        <StatCard
          label="Completed"
          value={stats.completed}
          loading={loading && page === 1}
          gradient=""
          icon={<svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>}
        />
      </div>

      {/* Create Form */}
      {showForm && (
        <GlassCard className="mb-6">
          <h3 className="text-[15px] font-semibold text-foreground mb-4">New Task</h3>
          <form onSubmit={handleSubmit(onCreateSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Title *"
                placeholder="Task title"
                error={errors.title?.message}
                {...register('title', { required: 'Title is required' })}
              />
              <Select label="Priority" {...register('priority')}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label="Status" {...register('status')}>
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
              </Select>
              <Select label="Assign To" {...register('assigned_to_id')}>
                <option value="">Unassigned</option>
                {staff.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>
                ))}
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Due Date" type="date" {...register('due_date')} />
              <Input label="Description" placeholder="Optional description" {...register('description')} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Creating...' : 'Create Task'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => { reset(); setShowForm(false); }}>
                Cancel
              </Button>
            </div>
          </form>
        </GlassCard>
      )}

      {/* Filters */}
      <GlassCard className="mb-6">
        <form onSubmit={handleSearch} className="flex flex-wrap gap-4 items-end">
          <Select
            label="Status"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          >
            <option value="">All Statuses</option>
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </Select>
          <Select
            label="Priority"
            value={priorityFilter}
            onChange={(e) => { setPriorityFilter(e.target.value); setPage(1); }}
          >
            <option value="">All Priorities</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </Select>
          <Select
            label="Assigned To"
            value={assigneeFilter}
            onChange={(e) => { setAssigneeFilter(e.target.value); setPage(1); }}
          >
            <option value="">All</option>
            {currentUser && <option value={currentUser.id}>My Tasks</option>}
            {staff.filter((u) => u.id !== currentUser?.id).map((u) => (
              <option key={u.id} value={u.id}>{u.full_name}</option>
            ))}
          </Select>
          <div className="flex-1 min-w-[140px] sm:min-w-[200px]">
            <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Search</label>
            <div className="flex gap-2">
              <Input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Task title..."
                className="flex-1"
              />
              <Button type="submit">Search</Button>
            </div>
          </div>
        </form>
      </GlassCard>

      {/* Table */}
      <GlassCard padding="none">
        {loading ? (
          <div className="p-6">
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="space-y-2">
                      <div className="h-4 w-48 rounded-lg shimmer" />
                      <div className="h-3 w-24 rounded-lg shimmer" />
                    </div>
                  </div>
                  <div className="h-6 w-20 rounded-full shimmer" />
                </div>
              ))}
            </div>
          </div>
        ) : tasks.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
              <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
            </div>
            <p className="text-[14px] text-muted-foreground">No tasks found</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[14px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-3 sm:px-6 py-4 text-[12px] font-medium text-muted-foreground">Task</th>
                    <th className="hidden sm:table-cell px-3 sm:px-6 py-4 text-[12px] font-medium text-muted-foreground">Priority</th>
                    <th className="px-3 sm:px-6 py-4 text-[12px] font-medium text-muted-foreground">Status</th>
                    <th className="hidden md:table-cell px-3 sm:px-6 py-4 text-[12px] font-medium text-muted-foreground">Assigned To</th>
                    <th className="hidden lg:table-cell px-3 sm:px-6 py-4 text-[12px] font-medium text-muted-foreground">Checklist</th>
                    <th className="hidden md:table-cell px-3 sm:px-6 py-4 text-[12px] font-medium text-muted-foreground">Due Date</th>
                    <th className="px-3 sm:px-6 py-4 text-[12px] font-medium text-muted-foreground"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tasks.map((task) => {
                    const isOverdue = task.due_date && task.status !== 'completed' && new Date(task.due_date) < new Date();
                    return (
                      <tr key={task.id} className="transition-colors hover:bg-secondary/50">
                        <td className="px-3 sm:px-6 py-4">
                          <div className="min-w-0">
                            <p className="text-[14px] font-medium text-foreground truncate">{task.title}</p>
                            {task.application_label && (
                              <p className="text-[12px] text-muted-foreground truncate">{task.application_label}</p>
                            )}
                            <p className="sm:hidden text-[12px] text-muted-foreground">
                              {TASK_PRIORITY_BADGE[task.priority].label} &middot; {task.assigned_to_name || 'Unassigned'}
                            </p>
                          </div>
                        </td>
                        <td className="hidden sm:table-cell px-3 sm:px-6 py-4">
                          <Badge type="custom" value={TASK_PRIORITY_BADGE[task.priority].label} className={TASK_PRIORITY_BADGE[task.priority].className} />
                        </td>
                        <td className="px-3 sm:px-6 py-4">
                          <Badge type="custom" value={TASK_STATUS_BADGE[task.status].label} className={TASK_STATUS_BADGE[task.status].className} />
                        </td>
                        <td className="hidden md:table-cell px-3 sm:px-6 py-4 text-[13px] text-foreground">
                          {task.assigned_to_name || <span className="text-muted-foreground">Unassigned</span>}
                        </td>
                        <td className="hidden lg:table-cell px-3 sm:px-6 py-4">
                          {task.checklist_total > 0 ? (
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-16 rounded-full bg-secondary overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-success transition-all"
                                  style={{ width: `${(task.checklist_completed / task.checklist_total) * 100}%` }}
                                />
                              </div>
                              <span className="text-[12px] text-muted-foreground">{task.checklist_completed}/{task.checklist_total}</span>
                            </div>
                          ) : (
                            <span className="text-[12px] text-muted-foreground">&mdash;</span>
                          )}
                        </td>
                        <td className="hidden md:table-cell px-3 sm:px-6 py-4 text-[13px]">
                          {task.due_date ? (
                            <span className={isOverdue ? 'text-destructive font-medium' : 'text-muted-foreground'}>
                              {formatDate(task.due_date)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">&mdash;</span>
                          )}
                        </td>
                        <td className="px-3 sm:px-6 py-4">
                          <Link to={`/admin/tasks/${task.id}`}>
                            <Button variant="ghost" size="sm">View</Button>
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 sm:px-6 py-4">
                <span className="text-[13px] text-muted-foreground">
                  {(page - 1) * perPage + 1}&ndash;{Math.min(page * perPage, total)} of {total}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </GlassCard>
    </div>
  );
}
