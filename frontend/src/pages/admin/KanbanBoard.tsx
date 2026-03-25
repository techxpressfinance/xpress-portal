import { useEffect, useState, useCallback, useRef, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { formatDate, getInitials } from '../../lib/utils';
import { VALID_TRANSITIONS, COLUMN_COLOR_OPTIONS, COLUMN_COLOR_BG } from '../../lib/constants';
import { PageHeader, Input, Button } from '../../components/ui';
import type { KanbanBoard as KanbanBoardType, KanbanBoardListItem, KanbanColumn, LoanApplication, ApplicationStatus, User } from '../../types';

// ── Card Component ──────────────────────────────────────────

function KanbanCard({ app, onDragStart }: { app: LoanApplication; onDragStart: (e: DragEvent, app: LoanApplication) => void }) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, app)}
      className="rounded-xl bg-background border border-border p-3.5 transition-all duration-200 hover:border-primary/30 hover:shadow-sm cursor-grab active:cursor-grabbing"
    >
      <Link to={`/admin/applications/${app.id}`} className="block">
        <div className="flex items-center gap-2.5 mb-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary">
            <span className="text-[10px] font-semibold text-muted-foreground">
              {app.user_name ? getInitials(app.user_name) : '??'}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-foreground truncate">{app.user_name || 'Unknown'}</p>
            {app.user_email && <p className="text-[11px] text-muted-foreground truncate">{app.user_email}</p>}
          </div>
        </div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] font-medium text-muted-foreground capitalize">{app.loan_type}</span>
          <span className="text-[13px] font-semibold text-foreground">${Number(app.amount).toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">{formatDate(app.created_at)}</span>
          {app.assigned_brokers.length > 0 && (
            <div className="flex -space-x-1.5">
              {app.assigned_brokers.slice(0, 3).map((ab) => (
                <div key={ab.id} className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[8px] font-semibold text-primary-foreground border-2 border-background" title={ab.full_name}>
                  {getInitials(ab.full_name)}
                </div>
              ))}
              {app.assigned_brokers.length > 3 && (
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-secondary text-[8px] font-medium text-muted-foreground border-2 border-background">
                  +{app.assigned_brokers.length - 3}
                </div>
              )}
            </div>
          )}
        </div>
      </Link>
    </div>
  );
}

// ── Column Component ────────────────────────────────────────

function BoardColumn({
  col,
  apps,
  dragOverColumn,
  isAdmin,
  onDragStart,
  onDragOver,
  onDrop,
  onDragLeave,
  onEditColumn,
  onDeleteColumn,
}: {
  col: KanbanColumn;
  apps: LoanApplication[];
  dragOverColumn: string | null;
  isAdmin: boolean;
  onDragStart: (e: DragEvent, app: LoanApplication) => void;
  onDragOver: (e: DragEvent, columnId: string) => void;
  onDrop: (e: DragEvent, columnId: string) => void;
  onDragLeave: () => void;
  onEditColumn: (col: KanbanColumn) => void;
  onDeleteColumn: (col: KanbanColumn) => void;
}) {
  const isOver = dragOverColumn === col.id;

  return (
    <div className="min-w-[260px] flex-1">
      <div className="flex items-center gap-2.5 mb-3 px-1 group">
        <div className={`h-2.5 w-2.5 rounded-full ${COLUMN_COLOR_BG[col.color || 'muted-foreground'] || 'bg-muted-foreground'}`} />
        <span className="text-[13px] font-semibold text-foreground">{col.title}</span>
        {col.mapped_status && (
          <span className="text-[10px] text-muted-foreground/60">{col.mapped_status}</span>
        )}
        <span className="ml-auto rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {apps.length}
        </span>
        {isAdmin && (
          <div className="hidden group-hover:flex items-center gap-1">
            <button onClick={() => onEditColumn(col)} className="p-0.5 rounded text-muted-foreground hover:text-foreground" title="Edit column">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" /></svg>
            </button>
            <button onClick={() => onDeleteColumn(col)} className="p-0.5 rounded text-muted-foreground hover:text-destructive" title="Delete column">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
            </button>
          </div>
        )}
      </div>
      <div
        className={`space-y-2.5 rounded-xl p-2.5 min-h-[200px] transition-colors duration-200 ${isOver ? 'bg-primary/10 ring-2 ring-primary/30' : 'bg-secondary/30'}`}
        onDragOver={(e) => onDragOver(e, col.id)}
        onDrop={(e) => onDrop(e, col.id)}
        onDragLeave={onDragLeave}
      >
        {apps.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <p className="text-[12px] text-muted-foreground">{isOver ? 'Drop here' : 'No applications'}</p>
          </div>
        ) : (
          apps.map((app) => <KanbanCard key={app.id} app={app} onDragStart={onDragStart} />)
        )}
      </div>
    </div>
  );
}

// ── Modal Wrapper ───────────────────────────────────────────

function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl bg-background border border-border p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ── Main Board Component ────────────────────────────────────

export default function KanbanBoardPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // Board state
  const [boards, setBoards] = useState<KanbanBoardListItem[]>([]);
  const [activeBoard, setActiveBoard] = useState<KanbanBoardType | null>(null);
  const [appsByColumn, setAppsByColumn] = useState<Record<string, LoanApplication[]>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Filter state
  const [loanTypeFilter, setLoanTypeFilter] = useState('');
  const [brokerFilter, setBrokerFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [dateRangeFilter, setDateRangeFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [brokersList, setBrokersList] = useState<{ id: string; full_name: string }[]>([]);
  const [clientsList, setClientsList] = useState<{ id: string; full_name: string; email: string }[]>([]);

  // Drag state
  const [draggedApp, setDraggedApp] = useState<LoanApplication | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const dragSourceColumn = useRef<string | null>(null);
  const initialLoadDone = useRef(false);

  // Modal state
  const [showCreateBoard, setShowCreateBoard] = useState(false);
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [editingColumn, setEditingColumn] = useState<KanbanColumn | null>(null);
  const [showBoardSettings, setShowBoardSettings] = useState(false);

  // Form state
  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardDesc, setNewBoardDesc] = useState('');
  const [colTitle, setColTitle] = useState('');
  const [colMappedStatus, setColMappedStatus] = useState('');
  const [colColor, setColColor] = useState('muted-foreground');

  // ── Data fetching ──────────────────────────────────────

  const fetchBoards = useCallback(async () => {
    const { data } = await api.get('/kanban/boards');
    setBoards(data);
    return data as KanbanBoardListItem[];
  }, []);

  const fetchBoard = useCallback(async (boardId: string) => {
    const { data } = await api.get(`/kanban/boards/${boardId}`);
    setActiveBoard(data);
    return data as KanbanBoardType;
  }, []);

  const fetchApplications = useCallback(async (
    boardId: string,
    filters: { search?: string; loan_type?: string; broker_id?: string; client_id?: string; date_range?: string } = {},
  ) => {
    const params = new URLSearchParams();
    if (filters.search) params.set('search', filters.search);
    if (filters.loan_type) params.set('loan_type', filters.loan_type);
    if (filters.broker_id) params.set('broker_id', filters.broker_id);
    if (filters.client_id) params.set('client_id', filters.client_id);
    if (filters.date_range) params.set('date_range', filters.date_range);
    const { data } = await api.get(`/kanban/boards/${boardId}/applications?${params}`);
    setAppsByColumn(data);
  }, []);

  const loadBoard = useCallback(async (boardId: string) => {
    setLoading(true);
    try {
      await fetchBoard(boardId);
      await fetchApplications(boardId, { search, loan_type: loanTypeFilter, broker_id: brokerFilter, client_id: clientFilter, date_range: dateRangeFilter });
    } catch {
      toast('Failed to load board', 'error');
    } finally {
      setLoading(false);
    }
  }, [fetchBoard, fetchApplications, search, loanTypeFilter, brokerFilter, clientFilter, dateRangeFilter, toast]);

  // Fetch broker/client lists for filter dropdowns
  const fetchFilterOptions = useCallback(async () => {
    try {
      const { data } = await api.get('/users');
      const users = data as User[];
      setBrokersList(users.filter((u) => u.role === 'broker' || u.role === 'admin').map((u) => ({ id: u.id, full_name: u.full_name })));
      setClientsList(users.filter((u) => u.role === 'client').map((u) => ({ id: u.id, full_name: u.full_name, email: u.email })));
    } catch { /* ignore - filters just won't populate */ }
  }, []);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const boardList = await fetchBoards();
        if (cancelled) return;
        fetchFilterOptions();
        if (boardList.length > 0) {
          const defaultBoard = boardList.find((b) => b.is_default) || boardList[0];
          await loadBoard(defaultBoard.id);
        }
      } catch {
        if (!cancelled) toast('Failed to load boards', 'error');
      } finally {
        if (!cancelled) {
          setLoading(false);
          initialLoadDone.current = true;
        }
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch apps when search or filters change (debounced)
  useEffect(() => {
    if (!activeBoard || !initialLoadDone.current) return;
    const timeout = setTimeout(() => {
      fetchApplications(activeBoard.id, { search, loan_type: loanTypeFilter, broker_id: brokerFilter, client_id: clientFilter, date_range: dateRangeFilter }).catch(() => {});
    }, 300);
    return () => clearTimeout(timeout);
  }, [search, loanTypeFilter, brokerFilter, clientFilter, dateRangeFilter, activeBoard, fetchApplications]);

  // ── Drag and drop ──────────────────────────────────────

  const handleDragStart = (e: DragEvent, app: LoanApplication) => {
    setDraggedApp(app);
    // Find which column this app belongs to
    for (const [colId, apps] of Object.entries(appsByColumn)) {
      if (apps.some((a) => a.id === app.id)) {
        dragSourceColumn.current = colId;
        break;
      }
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', app.id);
  };

  const handleDragOver = (e: DragEvent, columnId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverColumn !== columnId) setDragOverColumn(columnId);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = async (e: DragEvent, targetColumnId: string) => {
    e.preventDefault();
    setDragOverColumn(null);

    if (!draggedApp || !activeBoard) return;
    if (dragSourceColumn.current === targetColumnId) {
      setDraggedApp(null);
      return;
    }

    const targetCol = activeBoard.columns.find((c) => c.id === targetColumnId);
    if (!targetCol?.mapped_status) {
      setDraggedApp(null);
      return;
    }

    // Client-side transition validation
    const currentStatus = draggedApp.status;
    const allowed = VALID_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(targetCol.mapped_status)) {
      toast(`Cannot move from "${currentStatus}" to "${targetCol.mapped_status}"`, 'error');
      setDraggedApp(null);
      return;
    }

    // Optimistic update
    const prevApps = { ...appsByColumn };
    const sourceColId = dragSourceColumn.current!;
    setAppsByColumn((prev) => {
      const updated = { ...prev };
      updated[sourceColId] = (prev[sourceColId] || []).filter((a) => a.id !== draggedApp.id);
      updated[targetColumnId] = [...(prev[targetColumnId] || []), { ...draggedApp, status: targetCol.mapped_status as ApplicationStatus }];
      return updated;
    });

    try {
      await api.post(`/kanban/boards/${activeBoard.id}/columns/${targetColumnId}/move/${draggedApp.id}`);
      toast(`Moved to "${targetCol.title}"`, 'success');
    } catch (err: any) {
      // Revert optimistic update
      setAppsByColumn(prevApps);
      const msg = err?.response?.data?.detail || 'Failed to move application';
      toast(msg, 'error');
    }
    setDraggedApp(null);
    dragSourceColumn.current = null;
  };

  // ── Board management ──────────────────────────────────

  const handleCreateBoard = async () => {
    if (!newBoardName.trim()) return;
    try {
      const { data } = await api.post('/kanban/boards', { name: newBoardName, description: newBoardDesc || null });
      setShowCreateBoard(false);
      setNewBoardName('');
      setNewBoardDesc('');
      await fetchBoards();
      await loadBoard(data.id);
      toast('Board created', 'success');
    } catch {
      toast('Failed to create board', 'error');
    }
  };

  const handleDeleteBoard = async () => {
    if (!activeBoard) return;
    try {
      await api.delete(`/kanban/boards/${activeBoard.id}`);
      setShowBoardSettings(false);
      const boardList = await fetchBoards();
      if (boardList.length > 0) await loadBoard(boardList[0].id);
      else setActiveBoard(null);
      toast('Board deleted', 'success');
    } catch (err: any) {
      toast(err?.response?.data?.detail || 'Failed to delete board', 'error');
    }
  };

  const handleSaveBoardSettings = async () => {
    if (!activeBoard) return;
    try {
      await api.patch(`/kanban/boards/${activeBoard.id}`, { name: newBoardName, description: newBoardDesc });
      setShowBoardSettings(false);
      await fetchBoards();
      await fetchBoard(activeBoard.id);
      toast('Board updated', 'success');
    } catch {
      toast('Failed to update board', 'error');
    }
  };

  // ── Column management ─────────────────────────────────

  const handleAddColumn = async () => {
    if (!activeBoard || !colTitle.trim()) return;
    try {
      await api.post(`/kanban/boards/${activeBoard.id}/columns`, {
        title: colTitle,
        mapped_status: colMappedStatus || null,
        position: activeBoard.columns.length,
        color: colColor,
      });
      setShowAddColumn(false);
      resetColForm();
      await loadBoard(activeBoard.id);
      toast('Column added', 'success');
    } catch (err: any) {
      toast(err?.response?.data?.detail || 'Failed to add column', 'error');
    }
  };

  const handleEditColumn = async () => {
    if (!activeBoard || !editingColumn || !colTitle.trim()) return;
    try {
      await api.patch(`/kanban/boards/${activeBoard.id}/columns/${editingColumn.id}`, {
        title: colTitle,
        mapped_status: colMappedStatus || null,
        color: colColor,
      });
      setEditingColumn(null);
      resetColForm();
      await loadBoard(activeBoard.id);
      toast('Column updated', 'success');
    } catch (err: any) {
      toast(err?.response?.data?.detail || 'Failed to update column', 'error');
    }
  };

  const handleDeleteColumn = async (col: KanbanColumn) => {
    if (!activeBoard) return;
    if (!confirm(`Delete column "${col.title}"?`)) return;
    try {
      await api.delete(`/kanban/boards/${activeBoard.id}/columns/${col.id}`);
      await loadBoard(activeBoard.id);
      toast('Column deleted', 'success');
    } catch (err: any) {
      toast(err?.response?.data?.detail || 'Failed to delete column', 'error');
    }
  };

  const resetColForm = () => {
    setColTitle('');
    setColMappedStatus('');
    setColColor('muted-foreground');
  };

  const openEditColumn = (col: KanbanColumn) => {
    setColTitle(col.title);
    setColMappedStatus(col.mapped_status || '');
    setColColor(col.color || 'muted-foreground');
    setEditingColumn(col);
  };

  const handleSwitchBoard = async (boardId: string) => {
    await loadBoard(boardId);
  };

  // ── Filter apps by search (client-side for instant results) ──

  const getColumnApps = (colId: string): LoanApplication[] => {
    return appsByColumn[colId] || [];
  };

  // ── Active filter count ─────────────────────────────────

  const activeFilterCount = [loanTypeFilter, brokerFilter, clientFilter, dateRangeFilter].filter(Boolean).length;

  const clearAllFilters = () => {
    setLoanTypeFilter('');
    setBrokerFilter('');
    setClientFilter('');
    setDateRangeFilter('');
  };

  // ── Render ─────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <PageHeader title={activeBoard?.name || 'Application Board'} subtitle="Kanban view of all loan applications" />
          {boards.length > 1 && (
            <select
              className="text-[13px] bg-secondary border border-border rounded-lg px-2 py-1 text-foreground ml-2"
              value={activeBoard?.id || ''}
              onChange={(e) => handleSwitchBoard(e.target.value)}
            >
              {boards.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients..." className="w-44" />
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 text-[13px] font-medium transition-colors whitespace-nowrap ${activeFilterCount > 0 ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z" /></svg>
            Filters{activeFilterCount > 0 && ` (${activeFilterCount})`}
          </button>
          {isAdmin && (
            <>
              <button
                onClick={() => setShowAddColumn(true)}
                className="text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
              >
                + Column
              </button>
              <button
                onClick={() => setShowCreateBoard(true)}
                className="text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
              >
                + Board
              </button>
              {activeBoard && (
                <button
                  onClick={() => {
                    setNewBoardName(activeBoard.name);
                    setNewBoardDesc(activeBoard.description || '');
                    setShowBoardSettings(true);
                  }}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                  title="Board settings"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
                </button>
              )}
            </>
          )}
          <Link to="/admin/applications" className="text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap">
            List view
          </Link>
        </div>
      </div>

      {/* Filter bar */}
      {showFilters && (
        <div className="flex flex-wrap items-center gap-3 mb-4 p-3 rounded-xl bg-secondary/30 border border-border">
          {/* Loan type */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Loan Type</label>
            <select
              className="text-[13px] bg-background border border-border rounded-lg px-2.5 py-1.5 text-foreground min-w-[130px]"
              value={loanTypeFilter}
              onChange={(e) => setLoanTypeFilter(e.target.value)}
            >
              <option value="">All types</option>
              <option value="personal">Personal</option>
              <option value="home">Home</option>
              <option value="business">Business</option>
              <option value="vehicle">Vehicle</option>
            </select>
          </div>

          {/* Broker */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Broker</label>
            <select
              className="text-[13px] bg-background border border-border rounded-lg px-2.5 py-1.5 text-foreground min-w-[150px]"
              value={brokerFilter}
              onChange={(e) => setBrokerFilter(e.target.value)}
            >
              <option value="">All brokers</option>
              {brokersList.map((b) => (
                <option key={b.id} value={b.id}>{b.full_name}</option>
              ))}
            </select>
          </div>

          {/* Client */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Client</label>
            <select
              className="text-[13px] bg-background border border-border rounded-lg px-2.5 py-1.5 text-foreground min-w-[150px]"
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
            >
              <option value="">All clients</option>
              {clientsList.map((c) => (
                <option key={c.id} value={c.id}>{c.full_name} ({c.email})</option>
              ))}
            </select>
          </div>

          {/* Date range */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Period</label>
            <select
              className="text-[13px] bg-background border border-border rounded-lg px-2.5 py-1.5 text-foreground min-w-[140px]"
              value={dateRangeFilter}
              onChange={(e) => setDateRangeFilter(e.target.value)}
            >
              <option value="">All time</option>
              <option value="this_month">This month</option>
              <option value="last_month">Last month</option>
              <option value="this_quarter">This quarter</option>
              <option value="last_quarter">Last quarter</option>
              <option value="this_year">This year</option>
            </select>
          </div>

          {/* Clear all */}
          {activeFilterCount > 0 && (
            <button
              onClick={clearAllFilters}
              className="self-end text-[12px] font-medium text-muted-foreground hover:text-destructive transition-colors pb-1.5"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {/* Board columns */}
      {loading ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="min-w-[280px] flex-1">
              <div className="h-8 w-24 rounded-lg shimmer mb-3" />
              <div className="space-y-3">
                {[1, 2, 3].map((j) => <div key={j} className="h-28 rounded-xl shimmer" />)}
              </div>
            </div>
          ))}
        </div>
      ) : activeBoard ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {activeBoard.columns.map((col) => (
            <BoardColumn
              key={col.id}
              col={col}
              apps={getColumnApps(col.id)}
              dragOverColumn={dragOverColumn}
              isAdmin={isAdmin}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragLeave={handleDragLeave}
              onEditColumn={openEditColumn}
              onDeleteColumn={handleDeleteColumn}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-4">No boards found.</p>
          {isAdmin && <Button onClick={() => setShowCreateBoard(true)}>Create your first board</Button>}
        </div>
      )}

      {/* ── Create Board Modal ───────────────────────────── */}
      <Modal open={showCreateBoard} onClose={() => setShowCreateBoard(false)} title="Create Board">
        <div className="space-y-3">
          <Input placeholder="Board name" value={newBoardName} onChange={(e) => setNewBoardName(e.target.value)} />
          <Input placeholder="Description (optional)" value={newBoardDesc} onChange={(e) => setNewBoardDesc(e.target.value)} />
          <p className="text-[12px] text-muted-foreground">Default columns (Draft, Submitted, Reviewing, Approved, Rejected) will be created automatically.</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowCreateBoard(false)}>Cancel</Button>
            <Button onClick={handleCreateBoard} disabled={!newBoardName.trim()}>Create</Button>
          </div>
        </div>
      </Modal>

      {/* ── Board Settings Modal ─────────────────────────── */}
      <Modal open={showBoardSettings} onClose={() => setShowBoardSettings(false)} title="Board Settings">
        <div className="space-y-3">
          <Input placeholder="Board name" value={newBoardName} onChange={(e) => setNewBoardName(e.target.value)} />
          <Input placeholder="Description" value={newBoardDesc} onChange={(e) => setNewBoardDesc(e.target.value)} />
          <div className="flex justify-between pt-2">
            <Button variant="secondary" onClick={handleDeleteBoard} className="text-destructive">Delete Board</Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setShowBoardSettings(false)}>Cancel</Button>
              <Button onClick={handleSaveBoardSettings} disabled={!newBoardName.trim()}>Save</Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* ── Add Column Modal ─────────────────────────────── */}
      <Modal open={showAddColumn} onClose={() => { setShowAddColumn(false); resetColForm(); }} title="Add Column">
        <div className="space-y-3">
          <Input placeholder="Column title" value={colTitle} onChange={(e) => setColTitle(e.target.value)} />
          <div>
            <label className="text-[12px] font-medium text-muted-foreground mb-1 block">Map to application status (optional)</label>
            <select
              className="w-full text-[13px] bg-secondary border border-border rounded-lg px-3 py-2 text-foreground"
              value={colMappedStatus}
              onChange={(e) => setColMappedStatus(e.target.value)}
            >
              <option value="">None (organizational only)</option>
              <option value="draft">Draft</option>
              <option value="submitted">Submitted</option>
              <option value="reviewing">Reviewing</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div>
            <label className="text-[12px] font-medium text-muted-foreground mb-1 block">Color</label>
            <div className="flex gap-2">
              {COLUMN_COLOR_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setColColor(opt.value)}
                  className={`h-6 w-6 rounded-full ${COLUMN_COLOR_BG[opt.value] || 'bg-muted-foreground'} transition-all ${colColor === opt.value ? 'ring-2 ring-offset-2 ring-primary ring-offset-background' : 'opacity-60 hover:opacity-100'}`}
                  title={opt.label}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => { setShowAddColumn(false); resetColForm(); }}>Cancel</Button>
            <Button onClick={handleAddColumn} disabled={!colTitle.trim()}>Add</Button>
          </div>
        </div>
      </Modal>

      {/* ── Edit Column Modal ────────────────────────────── */}
      <Modal open={!!editingColumn} onClose={() => { setEditingColumn(null); resetColForm(); }} title="Edit Column">
        <div className="space-y-3">
          <Input placeholder="Column title" value={colTitle} onChange={(e) => setColTitle(e.target.value)} />
          <div>
            <label className="text-[12px] font-medium text-muted-foreground mb-1 block">Map to application status (optional)</label>
            <select
              className="w-full text-[13px] bg-secondary border border-border rounded-lg px-3 py-2 text-foreground"
              value={colMappedStatus}
              onChange={(e) => setColMappedStatus(e.target.value)}
            >
              <option value="">None (organizational only)</option>
              <option value="draft">Draft</option>
              <option value="submitted">Submitted</option>
              <option value="reviewing">Reviewing</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div>
            <label className="text-[12px] font-medium text-muted-foreground mb-1 block">Color</label>
            <div className="flex gap-2">
              {COLUMN_COLOR_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setColColor(opt.value)}
                  className={`h-6 w-6 rounded-full ${COLUMN_COLOR_BG[opt.value] || 'bg-muted-foreground'} transition-all ${colColor === opt.value ? 'ring-2 ring-offset-2 ring-primary ring-offset-background' : 'opacity-60 hover:opacity-100'}`}
                  title={opt.label}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => { setEditingColumn(null); resetColForm(); }}>Cancel</Button>
            <Button onClick={handleEditColumn} disabled={!colTitle.trim()}>Save</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
