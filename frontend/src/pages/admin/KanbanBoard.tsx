import { useEffect, useState, useCallback, useRef, type DragEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { getInitials, relativeTime, fmtMoneyK, avatarColor, daysSince } from '../../lib/utils';
import { COLUMN_COLOR_OPTIONS } from '../../lib/constants';
import { ConfirmDialog } from '../../components/ui';
import type { KanbanBoard as KanbanBoardType, KanbanBoardListItem, KanbanColumn, LoanApplication, User } from '../../types';

// ── Design tokens (map column color value → OKLCH for the Ledger dot) ──

const COLOR_TO_OKLCH: Record<string, string> = {
  'muted-foreground': 'oklch(0.62 0.02 0)',
  'primary': 'oklch(0.55 0.22 268)',
  'chart-4': 'oklch(0.72 0.15 65)',
  'success': 'oklch(0.62 0.15 155)',
  'destructive': 'oklch(0.58 0.20 20)',
  'chart-2': 'oklch(0.62 0.14 210)',
  'chart-5': 'oklch(0.55 0.19 300)',
};
const colorDot = (key: string | null | undefined) => COLOR_TO_OKLCH[key || 'muted-foreground'] || COLOR_TO_OKLCH['muted-foreground'];

// ── Icons (minimal set) ──

function Icon({ name, size = 14, className = '' }: { name: string; size?: number; className?: string }) {
  const paths: Record<string, ReactNode> = {
    briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /></>,
    car: <path d="M3 13h18l-2-6H5l-2 6Zm0 0v4a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-2m10 0v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-4M7 16h.01M17 16h.01" />,
    home: <path d="M3 12 12 4l9 8v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z" />,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    chevronDown: <path d="m6 9 6 6 6-6" />,
    chevronRight: <path d="m9 6 6 6-6 6" />,
    board: <><rect x="3" y="4" width="6" height="16" rx="1.2" /><rect x="11" y="4" width="6" height="10" rx="1.2" /><rect x="19" y="4" width="2.5" height="7" rx="1" /></>,
    list: <><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></>,
    edit: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />,
    trash: <><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-13M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" /></>,
    dotsV: <><circle cx="12" cy="5" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="12" cy="19" r="1.3" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v4M16 3v4" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 2.5-5 6-5s6 2 6 5" /><circle cx="17" cy="9" r="2.5" /><path d="M15.5 14.5c3 0 5.5 2 5.5 5" /></>,
    filter: <path d="M4 5h16l-6 8v6l-4-2v-4L4 5Z" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      {paths[name] || null}
    </svg>
  );
}

const LOAN_TYPE_ICON: Record<string, string> = {
  business: 'briefcase',
  vehicle: 'car',
  home: 'home',
  personal: 'user',
};

const LOAN_TYPE_LABEL: Record<string, string> = {
  business: 'Business',
  vehicle: 'Vehicle',
  home: 'Home',
  personal: 'Personal',
};

// ── Avatar ──

function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  return (
    <span
      className={`led-avatar ${size === 'sm' ? 'led-avatar-sm' : ''}`}
      style={{ background: avatarColor(name) }}
      title={name}
    >
      {getInitials(name)}
    </span>
  );
}

// ── Filter Pill with popover ──

function FilterPill({
  label,
  value,
  active,
  children,
  icon,
}: {
  label: string;
  value: string;
  active: boolean;
  children: (close: () => void) => ReactNode;
  icon?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className={`led-filter-pill ${active ? 'led-active' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        {icon && <Icon name={icon} size={12} />}
        <span className="led-pill-label">{label}:</span>
        <span>{value}</span>
        <Icon name="chevronDown" size={11} />
      </button>
      {open && (
        <div className="led-popover" style={{ top: 'calc(100% + 6px)', left: 0 }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

// ── Card ──

function KanbanCard({
  app,
  onDragStart,
  isDragging,
  flash,
}: {
  app: LoanApplication;
  onDragStart: (e: DragEvent, app: LoanApplication) => void;
  isDragging?: boolean;
  flash?: boolean;
}) {
  const navigate = useNavigate();
  const shortId = app.id.replace(/-/g, '').slice(-6).toUpperCase();
  const ltIcon = LOAN_TYPE_ICON[app.loan_type] || 'user';
  const ltLabel = LOAN_TYPE_LABEL[app.loan_type] || app.loan_type;
  const subtitle = app.business_name || app.user_email || '';
  const brokers = app.assigned_brokers || [];
  const days = daysSince(app.updated_at);
  const isStale = days >= 7;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, app)}
      onClick={(e) => {
        if (isDragging) { e.preventDefault(); return; }
        navigate(`/admin/applications/${app.id}`);
      }}
      className={`led-kanban-card ${isDragging ? 'led-dragging' : ''} ${flash ? 'led-flash-row' : ''}`}
    >
      <div className="led-kanban-card-row">
        <span className="led-kanban-card-id">APP-{shortId}</span>
        <span className="led-kanban-card-lt">
          <Icon name={ltIcon} size={11} /> {ltLabel}
        </span>
      </div>

      <div className="led-kanban-card-title">{app.user_name || 'Unknown'}</div>
      {subtitle ? <div className="led-kanban-card-sub">{subtitle}</div> : <div style={{ height: 8 }} />}

      <div className="led-kanban-card-row">
        <span className="led-kanban-card-amt">{fmtMoneyK(Number(app.amount) || 0)}</span>
        {isStale && (
          <span className="led-chip led-chip-warning" style={{ height: 18, fontSize: 10.5 }} title={`${days}d in stage`}>
            <Icon name="clock" size={10} />
            {days}d
          </span>
        )}
      </div>

      <div className="led-kanban-card-foot">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {brokers.length > 0 ? (
            <div className="led-avatar-stack" style={{ display: 'inline-flex' }}>
              {brokers.slice(0, 3).map((ab) => (
                <Avatar key={ab.id} name={ab.full_name} size="sm" />
              ))}
              {brokers.length > 3 && (
                <span
                  className="led-avatar led-avatar-sm"
                  style={{ background: 'var(--led-bg-2)', color: 'var(--led-muted)' }}
                >
                  +{brokers.length - 3}
                </span>
              )}
            </div>
          ) : (
            <span
              style={{
                width: 22, height: 22, borderRadius: '50%',
                border: '1.5px dashed var(--led-line-strong)',
                display: 'inline-block',
              }}
              title="Unassigned"
            />
          )}
        </div>
        <span className="led-mono led-tnum" style={{ fontSize: 10.5, color: 'var(--led-muted)' }}>
          {relativeTime(app.updated_at)}
        </span>
      </div>
    </div>
  );
}

// ── Column ──

type DropValidity = 'valid' | 'invalid' | 'same' | null;

function BoardColumn({
  col,
  apps,
  dragOverColumn,
  dropValidity,
  draggedAppId,
  isAdmin,
  flashIds,
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
  dropValidity: DropValidity;
  draggedAppId: string | null;
  isAdmin: boolean;
  flashIds: Set<string>;
  onDragStart: (e: DragEvent, app: LoanApplication) => void;
  onDragOver: (e: DragEvent, columnId: string) => void;
  onDrop: (e: DragEvent, columnId: string) => void;
  onDragLeave: (e: DragEvent, columnId: string) => void;
  onEditColumn: (col: KanbanColumn) => void;
  onDeleteColumn: (col: KanbanColumn) => void;
}) {
  const isOver = dragOverColumn === col.id;
  const dragCounterRef = useRef(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    if (menuOpen) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const totalAmount = apps.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
  const avgDays = apps.length
    ? Math.round(apps.reduce((sum, a) => sum + daysSince(a.updated_at), 0) / apps.length)
    : 0;

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) onDragOver(e, col.id);
  };
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const handleDragLeave = (e: DragEvent) => {
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) onDragLeave(e, col.id);
  };
  const handleDrop = (e: DragEvent) => {
    dragCounterRef.current = 0;
    onDrop(e, col.id);
  };

  const dropClass =
    isOver && dropValidity === 'valid' ? 'led-drop-valid'
      : isOver && dropValidity === 'invalid' ? 'led-drop-invalid'
        : isOver && dropValidity === 'same' ? 'led-drop-same'
          : '';

  return (
    <div
      className={`led-kanban-col ${dropClass}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragLeave={handleDragLeave}
    >
      <div className="led-kanban-col-header">
        <span className="led-sdot" style={{ background: colorDot(col.color) }} />
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.005em', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {col.title}
        </div>
        <span className="led-chip led-mono led-tnum" style={{ height: 20, fontSize: 11 }}>{apps.length}</span>
        {isAdmin && (
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              className="led-btn led-btn-ghost led-btn-sm led-btn-icon"
              onClick={() => setMenuOpen((o) => !o)}
              title="Column actions"
            >
              <Icon name="dotsV" size={12} />
            </button>
            {menuOpen && (
              <div className="led-popover" style={{ top: 'calc(100% + 4px)', right: 0, minWidth: 160 }}>
                <button
                  type="button"
                  className="led-popover-item"
                  onClick={() => { setMenuOpen(false); onEditColumn(col); }}
                >
                  <Icon name="edit" size={13} />Edit column
                </button>
                <button
                  type="button"
                  className="led-popover-item"
                  style={{ color: 'var(--led-danger)' }}
                  onClick={() => { setMenuOpen(false); onDeleteColumn(col); }}
                >
                  <Icon name="trash" size={13} />Delete column
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="led-kanban-col-meta">
        <span className="led-mono led-tnum">{fmtMoneyK(totalAmount)} value</span>
        <span className="led-mono led-tnum">avg {avgDays}d</span>
      </div>

      <div className="led-kanban-list">
        {apps.length === 0 && !isOver && (
          <div className="led-kanban-empty">Drop cards here</div>
        )}
        {apps.map((app) => (
          <KanbanCard
            key={app.id}
            app={app}
            onDragStart={onDragStart}
            isDragging={app.id === draggedAppId}
            flash={flashIds.has(app.id)}
          />
        ))}
        {isOver && dropValidity === 'valid' && (
          <div className="led-kanban-drop-hint">Release to move here</div>
        )}
        {isOver && dropValidity === 'invalid' && (
          <div className="led-kanban-drop-hint led-invalid">Not a valid transition</div>
        )}
      </div>
    </div>
  );
}

// ── Modal (portal, wraps content in ledger-theme) ──

function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return createPortal(
    <div className="ledger-theme" style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,18,0.45)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <div style={{
        position: 'relative', zIndex: 10, width: '100%', maxWidth: 440,
        borderRadius: 16, background: 'var(--led-surface)',
        border: '1px solid var(--led-line)', padding: 20,
        boxShadow: 'var(--led-shadow-lg)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.006em', color: 'var(--led-ink)', margin: 0 }}>{title}</h3>
          <button type="button" className="led-btn led-btn-ghost led-btn-sm led-btn-icon" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ── Main ──

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
  const [updatedRangeFilter, setUpdatedRangeFilter] = useState('');
  const [stageAgeFilter, setStageAgeFilter] = useState('');
  const [brokersList, setBrokersList] = useState<{ id: string; full_name: string }[]>([]);
  const [clientsList, setClientsList] = useState<{ id: string; full_name: string; email: string }[]>([]);

  // Drag state
  const [draggedApp, setDraggedApp] = useState<LoanApplication | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [dragOverValidity, setDragOverValidity] = useState<DropValidity>(null);
  const dragSourceColumn = useRef<string | null>(null);
  const dragOverlayRef = useRef<HTMLDivElement>(null);
  const initialLoadDone = useRef(false);
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());

  // Modal state
  const [showCreateBoard, setShowCreateBoard] = useState(false);
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [editingColumn, setEditingColumn] = useState<KanbanColumn | null>(null);
  const [showBoardSettings, setShowBoardSettings] = useState(false);
  const [pendingMove, setPendingMove] = useState<{
    app: LoanApplication;
    sourceColumnId: string;
    targetColumnId: string;
    targetColumnTitle: string;
  } | null>(null);
  const [movingApp, setMovingApp] = useState(false);

  // Form state
  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardDesc, setNewBoardDesc] = useState('');
  const [colTitle, setColTitle] = useState('');
  const [colMappedStatus, setColMappedStatus] = useState('');
  const [colColor, setColColor] = useState('muted-foreground');

  // ── Data fetching ──

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
    filters: { search?: string; loan_type?: string; broker_id?: string; client_id?: string; date_range?: string; updated_range?: string; min_days_in_stage?: string } = {},
  ) => {
    const params = new URLSearchParams();
    if (filters.search) params.set('search', filters.search);
    if (filters.loan_type) params.set('loan_type', filters.loan_type);
    if (filters.broker_id) params.set('broker_id', filters.broker_id);
    if (filters.client_id) params.set('client_id', filters.client_id);
    if (filters.date_range) params.set('date_range', filters.date_range);
    if (filters.updated_range) params.set('updated_range', filters.updated_range);
    if (filters.min_days_in_stage) params.set('min_days_in_stage', filters.min_days_in_stage);
    const { data } = await api.get(`/kanban/boards/${boardId}/applications?${params}`);
    setAppsByColumn(data);
  }, []);

  const loadBoard = useCallback(async (boardId: string) => {
    setLoading(true);
    try {
      await fetchBoard(boardId);
      await fetchApplications(boardId, { search, loan_type: loanTypeFilter, broker_id: brokerFilter, client_id: clientFilter, date_range: dateRangeFilter, updated_range: updatedRangeFilter, min_days_in_stage: stageAgeFilter });
    } catch {
      toast('Failed to load board', 'error');
    } finally {
      setLoading(false);
    }
  }, [fetchBoard, fetchApplications, search, loanTypeFilter, brokerFilter, clientFilter, dateRangeFilter, updatedRangeFilter, stageAgeFilter, toast]);

  const fetchFilterOptions = useCallback(async () => {
    try {
      const { data } = await api.get('/users');
      const users = data as User[];
      setBrokersList(users.filter((u) => u.role === 'broker' || u.role === 'admin').map((u) => ({ id: u.id, full_name: u.full_name })));
      setClientsList(users.filter((u) => u.role === 'client').map((u) => ({ id: u.id, full_name: u.full_name, email: u.email })));
    } catch { /* ignore */ }
  }, []);

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

  useEffect(() => {
    if (!activeBoard || !initialLoadDone.current) return;
    const timeout = setTimeout(() => {
      fetchApplications(activeBoard.id, { search, loan_type: loanTypeFilter, broker_id: brokerFilter, client_id: clientFilter, date_range: dateRangeFilter, updated_range: updatedRangeFilter, min_days_in_stage: stageAgeFilter }).catch(() => toast('Failed to refresh applications', 'error'));
    }, 300);
    return () => clearTimeout(timeout);
  }, [search, loanTypeFilter, brokerFilter, clientFilter, dateRangeFilter, updatedRangeFilter, stageAgeFilter, activeBoard, fetchApplications]);

  // ── Drag and drop ──

  const getDropValidity = useCallback((targetColumnId: string): DropValidity => {
    if (!draggedApp) return null;
    if (dragSourceColumn.current === targetColumnId) return 'same';
    return 'valid';
  }, [draggedApp]);

  const handleDragStart = (e: DragEvent, app: LoanApplication) => {
    setDraggedApp(app);
    for (const [colId, colApps] of Object.entries(appsByColumn)) {
      if (colApps.some((a) => a.id === app.id)) {
        dragSourceColumn.current = colId;
        break;
      }
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', app.id);
    const emptyImg = document.createElement('canvas');
    emptyImg.width = 1;
    emptyImg.height = 1;
    e.dataTransfer.setDragImage(emptyImg, 0, 0);
    requestAnimationFrame(() => {
      if (dragOverlayRef.current) {
        dragOverlayRef.current.style.transform = `translate3d(${e.clientX - 130}px, ${e.clientY - 40}px, 0)`;
      }
    });
  };

  useEffect(() => {
    if (!draggedApp) return;
    let animationFrameId: number;
    const handleGlobalDragOver = (e: globalThis.DragEvent) => {
      e.preventDefault();
      if (!animationFrameId && dragOverlayRef.current) {
        animationFrameId = requestAnimationFrame(() => {
          if (dragOverlayRef.current) {
            dragOverlayRef.current.style.transform = `translate3d(${e.clientX - 130}px, ${e.clientY - 40}px, 0)`;
          }
          animationFrameId = 0;
        });
      }
    };
    document.addEventListener('dragover', handleGlobalDragOver);
    return () => {
      document.removeEventListener('dragover', handleGlobalDragOver);
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [draggedApp]);

  const handleDragOver = (_e: DragEvent, columnId: string) => {
    if (dragOverColumn !== columnId) {
      setDragOverColumn(columnId);
      setDragOverValidity(getDropValidity(columnId));
    }
  };

  const handleDragLeave = (_e: DragEvent, _columnId: string) => {
    setDragOverColumn(null);
    setDragOverValidity(null);
  };

  const handleDragEnd = () => {
    setDraggedApp(null);
    setDragOverColumn(null);
    setDragOverValidity(null);
    dragSourceColumn.current = null;
  };

  useEffect(() => {
    if (!draggedApp) return;
    const cleanup = () => handleDragEnd();
    document.addEventListener('dragend', cleanup);
    return () => document.removeEventListener('dragend', cleanup);
  }, [draggedApp]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDrop = async (e: DragEvent, targetColumnId: string) => {
    e.preventDefault();
    setDragOverColumn(null);
    setDragOverValidity(null);

    if (!draggedApp || !activeBoard) return;
    if (dragSourceColumn.current === targetColumnId) {
      setDraggedApp(null);
      return;
    }

    const targetCol = activeBoard.columns.find((c) => c.id === targetColumnId);
    if (!targetCol) {
      setDraggedApp(null);
      return;
    }

    const sourceColId = dragSourceColumn.current;
    if (!sourceColId) {
      setDraggedApp(null);
      return;
    }

    const movedApp = draggedApp;
    setDraggedApp(null);
    dragSourceColumn.current = null;

    setPendingMove({
      app: movedApp,
      sourceColumnId: sourceColId,
      targetColumnId,
      targetColumnTitle: targetCol.title,
    });
  };

  const confirmMoveApplication = async () => {
    if (!activeBoard || !pendingMove) return;

    setMovingApp(true);
    const prevApps = { ...appsByColumn };

    setAppsByColumn((prev) => {
      const updated = { ...prev };
      updated[pendingMove.sourceColumnId] = (prev[pendingMove.sourceColumnId] || []).filter((a) => a.id !== pendingMove.app.id);
      updated[pendingMove.targetColumnId] = [
        ...(prev[pendingMove.targetColumnId] || []),
        { ...pendingMove.app, kanban_column_id: pendingMove.targetColumnId },
      ];
      return updated;
    });

    try {
      await api.post(`/kanban/boards/${activeBoard.id}/columns/${pendingMove.targetColumnId}/move/${pendingMove.app.id}`);
      setFlashIds(new Set([pendingMove.app.id]));
      setTimeout(() => setFlashIds(new Set()), 900);
      toast(`Moved to "${pendingMove.targetColumnTitle}"`, 'success');
      setPendingMove(null);
    } catch (err: any) {
      setAppsByColumn(prevApps);
      const msg = err?.response?.data?.detail || 'Failed to move application';
      toast(msg, 'error');
    } finally {
      setMovingApp(false);
    }
  };

  // ── Board management ──

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

  // ── Column management ──

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

  const getColumnApps = (colId: string): LoanApplication[] => appsByColumn[colId] || [];

  const activeFilterCount = [loanTypeFilter, brokerFilter, clientFilter, dateRangeFilter, updatedRangeFilter, stageAgeFilter].filter(Boolean).length;
  const clearAllFilters = () => {
    setLoanTypeFilter('');
    setBrokerFilter('');
    setClientFilter('');
    setDateRangeFilter('');
    setUpdatedRangeFilter('');
    setStageAgeFilter('');
  };

  // Filter pill values
  const loanTypePill = loanTypeFilter ? (LOAN_TYPE_LABEL[loanTypeFilter] || loanTypeFilter) : 'All';
  const brokerPill = brokerFilter ? (brokersList.find((b) => b.id === brokerFilter)?.full_name.split(' ')[0] || 'All') : 'All';
  const clientPill = clientFilter ? (clientsList.find((c) => c.id === clientFilter)?.full_name.split(' ')[0] || 'All') : 'All';
  const DATE_RANGE_LABELS: Record<string, string> = { this_month: 'This month', last_month: 'Last month', this_quarter: 'This quarter', last_quarter: 'Last quarter', this_year: 'This year' };
  const datePill = dateRangeFilter ? (DATE_RANGE_LABELS[dateRangeFilter] || 'All') : 'All time';
  const updatedPill = updatedRangeFilter ? (DATE_RANGE_LABELS[updatedRangeFilter] || 'All') : 'All time';
  const STAGE_AGE_LABELS: Record<string, string> = { '7': '7+ days', '14': '14+ days', '30': '30+ days', '60': '60+ days' };
  const stageAgePill = stageAgeFilter ? (STAGE_AGE_LABELS[stageAgeFilter] || stageAgeFilter) : 'Any';

  // ── Render ──

  return (
    <div className="ledger-theme led-fade-up" style={{ minHeight: '100%', background: 'var(--led-bg)', margin: -24, padding: 0 }}>
      {/* Header */}
      <header style={{ padding: '20px 24px 0', background: 'var(--led-bg)', position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, paddingBottom: 14 }}>
          <div style={{ minWidth: 0 }}>
            <h1 className="led-h-page" style={{ margin: 0 }}>{activeBoard?.name || 'Pipeline'}</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--led-muted)' }}>
              Drag cards between stages · live sync
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div className="led-segment">
              <button type="button" className="led-active"><Icon name="board" size={12} /> Board</button>
              <Link to="/admin/applications" style={{ textDecoration: 'none' }}>
                <button type="button"><Icon name="list" size={12} /> Table</button>
              </Link>
            </div>
            {isAdmin && (
              <>
                <button type="button" className="led-btn led-btn-outline led-btn-sm" onClick={() => setShowCreateBoard(true)}>
                  <Icon name="plus" size={12} /> Board
                </button>
                {activeBoard && (
                  <button
                    type="button"
                    className="led-btn led-btn-outline led-btn-sm led-btn-icon"
                    onClick={() => {
                      setNewBoardName(activeBoard.name);
                      setNewBoardDesc(activeBoard.description || '');
                      setShowBoardSettings(true);
                    }}
                    title="Board settings"
                  >
                    <Icon name="settings" size={13} />
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Board tabs */}
        {boards.length > 1 && (
          <div className="led-tabs">
            {boards.map((b) => (
              <button
                key={b.id}
                type="button"
                className={`led-tab ${activeBoard?.id === b.id ? 'led-active' : ''}`}
                onClick={() => handleSwitchBoard(b.id)}
              >
                {b.name}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* Filter bar */}
      <div style={{ padding: '40px 24px 10px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div className="led-search">
          <Icon name="search" size={13} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients…"
          />
        </div>

        <FilterPill label="Type" value={loanTypePill} active={!!loanTypeFilter} icon="filter">
          {(close) => (
            <>
              <button type="button" className={`led-popover-item ${!loanTypeFilter ? 'led-active' : ''}`} onClick={() => { setLoanTypeFilter(''); close(); }}>All types</button>
              {['personal', 'home', 'business', 'vehicle'].map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`led-popover-item ${loanTypeFilter === t ? 'led-active' : ''}`}
                  onClick={() => { setLoanTypeFilter(t); close(); }}
                >
                  <Icon name={LOAN_TYPE_ICON[t]} size={13} />
                  {LOAN_TYPE_LABEL[t]}
                </button>
              ))}
            </>
          )}
        </FilterPill>

        {brokersList.length > 0 && (
          <FilterPill label="Broker" value={brokerPill} active={!!brokerFilter} icon="users">
            {(close) => (
              <>
                <button type="button" className={`led-popover-item ${!brokerFilter ? 'led-active' : ''}`} onClick={() => { setBrokerFilter(''); close(); }}>All brokers</button>
                {brokersList.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className={`led-popover-item ${brokerFilter === b.id ? 'led-active' : ''}`}
                    onClick={() => { setBrokerFilter(b.id); close(); }}
                  >
                    <Avatar name={b.full_name} size="sm" />{b.full_name}
                  </button>
                ))}
              </>
            )}
          </FilterPill>
        )}

        {clientsList.length > 0 && (
          <FilterPill label="Client" value={clientPill} active={!!clientFilter} icon="user">
            {(close) => (
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                <button type="button" className={`led-popover-item ${!clientFilter ? 'led-active' : ''}`} onClick={() => { setClientFilter(''); close(); }}>All clients</button>
                {clientsList.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`led-popover-item ${clientFilter === c.id ? 'led-active' : ''}`}
                    onClick={() => { setClientFilter(c.id); close(); }}
                  >
                    <Avatar name={c.full_name} size="sm" />{c.full_name}
                  </button>
                ))}
              </div>
            )}
          </FilterPill>
        )}

        <FilterPill label="Created" value={datePill} active={!!dateRangeFilter} icon="calendar">
          {(close) => (
            <>
              <button type="button" className={`led-popover-item ${!dateRangeFilter ? 'led-active' : ''}`} onClick={() => { setDateRangeFilter(''); close(); }}>All time</button>
              {[
                { v: 'this_month', l: 'This month' },
                { v: 'last_month', l: 'Last month' },
                { v: 'this_quarter', l: 'This quarter' },
                { v: 'last_quarter', l: 'Last quarter' },
                { v: 'this_year', l: 'This year' },
              ].map((o) => (
                <button
                  key={o.v}
                  type="button"
                  className={`led-popover-item ${dateRangeFilter === o.v ? 'led-active' : ''}`}
                  onClick={() => { setDateRangeFilter(o.v); close(); }}
                >
                  {o.l}
                </button>
              ))}
            </>
          )}
        </FilterPill>

        <FilterPill label="Updated" value={updatedPill} active={!!updatedRangeFilter} icon="calendar">
          {(close) => (
            <>
              <button type="button" className={`led-popover-item ${!updatedRangeFilter ? 'led-active' : ''}`} onClick={() => { setUpdatedRangeFilter(''); close(); }}>All time</button>
              {[
                { v: 'this_month', l: 'This month' },
                { v: 'last_month', l: 'Last month' },
                { v: 'this_quarter', l: 'This quarter' },
                { v: 'last_quarter', l: 'Last quarter' },
                { v: 'this_year', l: 'This year' },
              ].map((o) => (
                <button
                  key={o.v}
                  type="button"
                  className={`led-popover-item ${updatedRangeFilter === o.v ? 'led-active' : ''}`}
                  onClick={() => { setUpdatedRangeFilter(o.v); close(); }}
                >
                  {o.l}
                </button>
              ))}
            </>
          )}
        </FilterPill>

        <FilterPill label="In stage" value={stageAgePill} active={!!stageAgeFilter} icon="clock">
          {(close) => (
            <>
              <button type="button" className={`led-popover-item ${!stageAgeFilter ? 'led-active' : ''}`} onClick={() => { setStageAgeFilter(''); close(); }}>Any</button>
              {[
                { v: '7', l: '7+ days' },
                { v: '14', l: '14+ days' },
                { v: '30', l: '30+ days' },
                { v: '60', l: '60+ days' },
              ].map((o) => (
                <button
                  key={o.v}
                  type="button"
                  className={`led-popover-item ${stageAgeFilter === o.v ? 'led-active' : ''}`}
                  onClick={() => { setStageAgeFilter(o.v); close(); }}
                >
                  {o.l}
                </button>
              ))}
            </>
          )}
        </FilterPill>

        {activeFilterCount > 0 && (
          <button
            type="button"
            className="led-btn led-btn-ghost led-btn-sm"
            style={{ color: 'var(--led-muted)' }}
            onClick={clearAllFilters}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Board canvas */}
      {loading ? (
        <div style={{ padding: '4px 24px 32px' }}>
          <div className="led-kanban-scroller">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="led-kanban-col">
                <div style={{ height: 28, marginBottom: 8 }} className="shimmer" />
                <div style={{ height: 14, marginBottom: 10, width: '60%' }} className="shimmer" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[1, 2].map((j) => <div key={j} style={{ height: 96, borderRadius: 10 }} className="shimmer" />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : activeBoard ? (
        <div style={{ padding: '4px 24px 32px' }}>
          <div className="led-kanban-scroller">
            {activeBoard.columns.map((col) => (
              <BoardColumn
                key={col.id}
                col={col}
                apps={getColumnApps(col.id)}
                dragOverColumn={dragOverColumn}
                dropValidity={dragOverColumn === col.id ? dragOverValidity : null}
                draggedAppId={draggedApp?.id || null}
                isAdmin={isAdmin}
                flashIds={flashIds}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragLeave={handleDragLeave}
                onEditColumn={openEditColumn}
                onDeleteColumn={handleDeleteColumn}
              />
            ))}
            {isAdmin && (
              <button
                type="button"
                className="led-kanban-add-col"
                onClick={() => setShowAddColumn(true)}
              >
                <Icon name="plus" size={13} /> Add stage
              </button>
            )}
          </div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          <p style={{ color: 'var(--led-muted)', marginBottom: 16 }}>No boards found.</p>
          {isAdmin && (
            <button type="button" className="led-btn led-btn-accent" onClick={() => setShowCreateBoard(true)}>
              <Icon name="plus" size={13} /> Create your first board
            </button>
          )}
        </div>
      )}

      {/* ── Create Board Modal ── */}
      <Modal open={showCreateBoard} onClose={() => setShowCreateBoard(false)} title="Create board">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input className="led-input" placeholder="Board name" value={newBoardName} onChange={(e) => setNewBoardName(e.target.value)} autoFocus />
          <input className="led-input" placeholder="Description (optional)" value={newBoardDesc} onChange={(e) => setNewBoardDesc(e.target.value)} />
          <p className="led-caption" style={{ margin: 0 }}>Default columns will be created automatically.</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
            <button type="button" className="led-btn led-btn-ghost" onClick={() => setShowCreateBoard(false)}>Cancel</button>
            <button type="button" className="led-btn led-btn-accent" onClick={handleCreateBoard} disabled={!newBoardName.trim()}>
              Create board
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Board Settings Modal ── */}
      <Modal open={showBoardSettings} onClose={() => setShowBoardSettings(false)} title="Board settings">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input className="led-input" placeholder="Board name" value={newBoardName} onChange={(e) => setNewBoardName(e.target.value)} />
          <input className="led-input" placeholder="Description" value={newBoardDesc} onChange={(e) => setNewBoardDesc(e.target.value)} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <button type="button" className="led-btn led-btn-danger" onClick={handleDeleteBoard}>
              <Icon name="trash" size={12} /> Delete
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="led-btn led-btn-ghost" onClick={() => setShowBoardSettings(false)}>Cancel</button>
              <button type="button" className="led-btn led-btn-accent" onClick={handleSaveBoardSettings} disabled={!newBoardName.trim()}>Save</button>
            </div>
          </div>
        </div>
      </Modal>

      {/* ── Add Column Modal ── */}
      <Modal open={showAddColumn} onClose={() => { setShowAddColumn(false); resetColForm(); }} title="Add stage">
        <ColumnForm
          title={colTitle} setTitle={setColTitle}
          mappedStatus={colMappedStatus} setMappedStatus={setColMappedStatus}
          color={colColor} setColor={setColColor}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" className="led-btn led-btn-ghost" onClick={() => { setShowAddColumn(false); resetColForm(); }}>Cancel</button>
          <button type="button" className="led-btn led-btn-accent" onClick={handleAddColumn} disabled={!colTitle.trim()}>Add stage</button>
        </div>
      </Modal>

      {/* ── Edit Column Modal ── */}
      <Modal open={!!editingColumn} onClose={() => { setEditingColumn(null); resetColForm(); }} title="Edit stage">
        <ColumnForm
          title={colTitle} setTitle={setColTitle}
          mappedStatus={colMappedStatus} setMappedStatus={setColMappedStatus}
          color={colColor} setColor={setColColor}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" className="led-btn led-btn-ghost" onClick={() => { setEditingColumn(null); resetColForm(); }}>Cancel</button>
          <button type="button" className="led-btn led-btn-accent" onClick={handleEditColumn} disabled={!colTitle.trim()}>Save</button>
        </div>
      </Modal>

      {/* ── Drag Overlay ── */}
      {draggedApp && createPortal(
        <div className="ledger-theme" style={{ position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none' }}>
          <div
            ref={dragOverlayRef}
            style={{ position: 'fixed', left: 0, top: 0, willChange: 'transform', transform: 'translate3d(-9999px, -9999px, 0)' }}
          >
            <div
              style={{
                width: 260,
                background: 'var(--led-surface)',
                border: '1px solid var(--led-line)',
                borderRadius: 10,
                padding: 12,
                boxShadow: 'var(--led-shadow-lg)',
                transform: 'rotate(2deg)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 8 }}>
                <span className="led-mono" style={{ fontSize: 10.5, color: 'var(--led-muted)', letterSpacing: 0.3 }}>
                  APP-{draggedApp.id.replace(/-/g, '').slice(-6).toUpperCase()}
                </span>
                <span style={{ fontSize: 10.5, color: 'var(--led-ink-2)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Icon name={LOAN_TYPE_ICON[draggedApp.loan_type] || 'user'} size={11} />
                  {LOAN_TYPE_LABEL[draggedApp.loan_type] || draggedApp.loan_type}
                </span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--led-ink)', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {draggedApp.user_name || 'Unknown'}
              </div>
              <div className="led-mono led-tnum" style={{ fontSize: 14, fontWeight: 600, color: 'var(--led-ink)' }}>
                {fmtMoneyK(Number(draggedApp.amount) || 0)}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      <ConfirmDialog
        open={!!pendingMove}
        title="Move card"
        message={pendingMove ? (
          <>
            Move <span className="font-semibold text-foreground">{pendingMove.app.user_name || 'this application'}</span> to <span className="font-semibold text-foreground">{pendingMove.targetColumnTitle}</span>?
          </>
        ) : null}
        confirmText="Move"
        cancelText="Cancel"
        variant="primary"
        loading={movingApp}
        onConfirm={confirmMoveApplication}
        onCancel={() => {
          if (!movingApp) setPendingMove(null);
        }}
      />
    </div>
  );
}

// ── Column form (shared between Add + Edit) ──

function ColumnForm({
  title, setTitle,
  mappedStatus, setMappedStatus,
  color, setColor,
}: {
  title: string; setTitle: (s: string) => void;
  mappedStatus: string; setMappedStatus: (s: string) => void;
  color: string; setColor: (s: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <input className="led-input" placeholder="Stage title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      <div>
        <div className="led-label" style={{ marginBottom: 6 }}>Map to status (optional)</div>
        <select
          className="led-input"
          value={mappedStatus}
          onChange={(e) => setMappedStatus(e.target.value)}
          style={{ cursor: 'pointer' }}
        >
          <option value="">None (organizational only)</option>
          <option value="draft">Draft</option>
          <option value="application_received">Application Received</option>
          <option value="application_assessed">Application Assessed</option>
          <option value="submitted">Submitted</option>
          <option value="approval">Approval</option>
          <option value="settled">Settled</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>
      <div>
        <div className="led-label" style={{ marginBottom: 6 }}>Color</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {COLUMN_COLOR_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setColor(opt.value)}
              title={opt.label}
              style={{
                width: 24, height: 24, borderRadius: '50%',
                background: colorDot(opt.value),
                border: 0,
                cursor: 'pointer',
                opacity: color === opt.value ? 1 : 0.55,
                outline: color === opt.value ? '2px solid var(--led-accent)' : 'none',
                outlineOffset: 2,
                transition: 'opacity 120ms ease, outline-offset 120ms ease',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

