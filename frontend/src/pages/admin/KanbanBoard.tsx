import { useEffect, useState, useCallback, useRef, type DragEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { getInitials, relativeTime, fmtMoneyK, avatarColor, daysSince, getErrorMessage } from '../../lib/utils';
import { COLUMN_COLOR_OPTIONS, LOAN_CATEGORIES, LOAN_TYPE_LABELS, STATUS_LABEL, VALID_TRANSITIONS, findLoanSubType } from '../../lib/constants';
import { applicantDisplayName } from '../../lib/applicantName';

// Category scope value meaning "the signed-in broker's specialties".
const MY_FOCUS = 'mine';
import { ConfirmDialog, EmptyState } from '../../components/ui';
import type { ApplicationStatus, GateAnswer, KanbanBoard as KanbanBoardType, KanbanBoardListItem, KanbanColumn, LoanApplication, LoanCategory, NotificationAudience, NotificationChannel, StageGate, StageNotificationRule, User } from '../../types';

// ── Design tokens (map column color value → the theme token for the dot) ──
// These were fixed OKLCH literals, so a stage dot kept its light-mode colour
// on a dark board. Pointing them at the tokens lets them flip with the theme.

const COLOR_TO_TOKEN: Record<string, string> = {
  'muted-foreground': 'var(--color-muted-foreground)',
  'primary': 'var(--color-primary)',
  'chart-4': 'var(--color-chart-4)',
  'success': 'var(--color-success)',
  'destructive': 'var(--color-destructive)',
  'chart-2': 'var(--color-chart-2)',
  'chart-5': 'var(--color-chart-5)',
};
const colorDot = (key: string | null | undefined) => COLOR_TO_TOKEN[key || 'muted-foreground'] || COLOR_TO_TOKEN['muted-foreground'];

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
    chevronLeft: <path d="m15 6-6 6 6 6" />,
    board: <><rect x="3" y="4" width="6" height="16" rx="1.2" /><rect x="11" y="4" width="6" height="10" rx="1.2" /><rect x="19" y="4" width="2.5" height="7" rx="1" /></>,
    list: <><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
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
  business_loan: 'briefcase',
  equipment_finance: 'briefcase',
  commercial_property: 'briefcase',
  vehicle: 'car',
  home: 'home',
  home_loan: 'home',
  personal: 'user',
};

const LOAN_TYPE_LABEL: Record<string, string> = LOAN_TYPE_LABELS;

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(LOAN_CATEGORIES.map((c) => [c.value, c.label]));

// Segment control labels — "Commercial Loans" → "Commercial" etc.
const CATEGORY_SHORT: Record<string, string> = {
  asset_finance: 'Asset Finance',
  home_loan: 'Home Loan',
  commercial: 'Commercial',
};

// The form sub-type recorded at submission (inside the lend_extra_data JSON),
// or null for LEND-mode/legacy applications.
function appSubType(app: LoanApplication): string | null {
  if (!app.lend_extra_data) return null;
  try {
    const details = JSON.parse(app.lend_extra_data)?.loan_type_details;
    return details?.consumer_loan_type?.type || details?.commercial_loan_type?.type || null;
  } catch {
    return null;
  }
}

function loanTypeChip(app: LoanApplication): { icon: string; label: string } {
  const sub = appSubType(app);
  const subDef = sub ? findLoanSubType(sub) : undefined;
  return {
    icon: LOAN_TYPE_ICON[app.loan_type] || 'user',
    label: subDef?.short || LOAN_TYPE_LABEL[app.loan_type] || app.loan_type,
  };
}

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
        <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
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
  columnId,
  moveTargets,
  onMoveTo,
  onDragStart,
  isDragging,
  flash,
}: {
  app: LoanApplication;
  columnId: string;
  /** Every other stage in this view — the menu alternative to a long drag. */
  moveTargets: KanbanColumn[];
  onMoveTo: (app: LoanApplication, fromColumnId: string, toColumnId: string) => void;
  onDragStart: (e: DragEvent, app: LoanApplication) => void;
  isDragging?: boolean;
  flash?: boolean;
}) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    if (menuOpen) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);
  const shortId = app.id.replace(/-/g, '').slice(-6).toUpperCase();
  const { icon: ltIcon, label: ltLabel } = loanTypeChip(app);
  const isDirectLead = app.user_role === 'referrer' || app.user_role === 'broker' || app.user_role === 'admin';
  // The owner of a staff-created card is the broker who created it, never the
  // applicant — fall back to the borrowing entity instead of their name.
  const clientName = applicantDisplayName(app);
  const referrerName = app.referrer?.organization_name
    || app.referrer?.full_name
    || (app.user_role === 'referrer' ? app.user_name || null : null);
  const businessSubtitle = app.business_name && app.business_name !== clientName ? app.business_name : null;
  const subtitle = businessSubtitle || (!isDirectLead ? app.user_email : null) || '';
  const brokers = app.assigned_brokers || [];
  // Time in THIS stage, matching the column header's average. updated_at moves
  // on any edit, so it would show a stale badge on a card that arrived today.
  const days = daysSince(app.stage_entered_at || app.updated_at);
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
        <div ref={menuRef} style={{ position: 'relative', marginLeft: 'auto' }}>
          <button
            type="button"
            className="led-btn led-btn-ghost led-btn-sm led-btn-icon led-card-menu"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
            title="Move to a stage"
            aria-label="Move to a stage"
          >
            <Icon name="dotsV" size={12} />
          </button>
          {menuOpen && (
            <div
              className="led-popover"
              style={{ top: 'calc(100% + 4px)', right: 0, minWidth: 210, maxHeight: 320, overflowY: 'auto' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="led-popover-label">Move to</div>
              {moveTargets.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  className="led-popover-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    onMoveTo(app, columnId, target.id);
                  }}
                >
                  <span className="led-sdot" style={{ background: colorDot(target.color) }} />
                  {target.title}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="led-kanban-card-title">{clientName}</div>
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

      {referrerName && (
        <div style={{ fontSize: 11, color: 'var(--led-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
          <Icon name="users" size={10} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{referrerName}</span>
        </div>
      )}
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
                  style={{ background: 'var(--led-surface-2)', color: 'var(--led-muted)' }}
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
  collapsed,
  onToggleCollapse,
  moveTargets,
  onMoveTo,
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
  collapsed: boolean;
  onToggleCollapse: (columnId: string) => void;
  moveTargets: KanbanColumn[];
  onMoveTo: (app: LoanApplication, fromColumnId: string, toColumnId: string) => void;
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
  // Time in *this stage* where we know it; cards that have never been moved here
  // fall back to updated_at, which is the best we can say about them.
  const avgDays = apps.length
    ? Math.round(apps.reduce((sum, a) => sum + daysSince(a.stage_entered_at || a.updated_at), 0) / apps.length)
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

  if (collapsed) {
    return (
      <button
        type="button"
        className={`led-kanban-col led-kanban-col-collapsed ${dropClass}`}
        onClick={() => onToggleCollapse(col.id)}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragLeave={handleDragLeave}
        title={`${col.title} — click to expand`}
      >
        <span className="led-sdot" style={{ background: colorDot(col.color) }} />
        <span className="led-chip led-mono led-tnum" style={{ height: 20, fontSize: 11 }}>{apps.length}</span>
        <span className="led-kanban-col-collapsed-title">{col.title}</span>
      </button>
    );
  }

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
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.005em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {col.title}
          </div>
          {col.team && (
            <div style={{ fontSize: 10, color: 'var(--led-muted)', letterSpacing: '0.02em', textTransform: 'uppercase', marginTop: 1 }}>
              {col.team}
            </div>
          )}
        </div>
        <span className="led-chip led-mono led-tnum" style={{ height: 20, fontSize: 11 }}>{apps.length}</span>
        <button
          type="button"
          className="led-btn led-btn-ghost led-btn-sm led-btn-icon"
          onClick={() => onToggleCollapse(col.id)}
          title="Collapse stage"
          aria-label={`Collapse ${col.title}`}
        >
          <Icon name="chevronLeft" size={12} />
        </button>
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
                  <Icon name="edit" size={13} />Edit stage
                </button>
                <button
                  type="button"
                  className="led-popover-item"
                  onClick={() => { setMenuOpen(false); onDeleteColumn(col); }}
                  style={{ color: 'var(--led-danger)' }}
                >
                  <Icon name="trash" size={13} />Delete stage
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
            columnId={col.id}
            moveTargets={moveTargets}
            onMoveTo={onMoveTo}
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
  const isAdmin = user?.role === 'admin' || user?.role === 'broker';
  // Board creation is admin-only on the backend; brokers manage columns/cards
  const canCreateBoard = user?.role === 'admin';

  // Board state
  const [boards, setBoards] = useState<KanbanBoardListItem[]>([]);
  const [activeBoard, setActiveBoard] = useState<KanbanBoardType | null>(null);
  const [appsByColumn, setAppsByColumn] = useState<Record<string, LoanApplication[]>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Loan-category specialties: boards and cards open scoped to them, and every
  // scope stays switchable from the filters below.
  const mySpecialties = user?.specialties ?? [];
  const [showAllBoards, setShowAllBoards] = useState(false);

  // Filter state
  const [categoryFilter, setCategoryFilter] = useState(() => (mySpecialties.length ? MY_FOCUS : ''));
  const [subTypeFilter, setSubTypeFilter] = useState('');
  const [brokerFilter, setBrokerFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [dateRangeFilter, setDateRangeFilter] = useState('');
  const [updatedRangeFilter, setUpdatedRangeFilter] = useState('');
  const [stageAgeFilter, setStageAgeFilter] = useState('');
  const [brokersList, setBrokersList] = useState<{ id: string; full_name: string }[]>([]);
  const [clientsList, setClientsList] = useState<{ id: string; full_name: string; email: string }[]>([]);
  // 'mine' is a UI-only scope; the API takes explicit category slugs.
  const categoryParam = categoryFilter === MY_FOCUS ? mySpecialties.join(',') : categoryFilter;
  // Identity of the current filter set — what the cards on screen must match.
  const filterKey = JSON.stringify([categoryParam, search, subTypeFilter, brokerFilter, clientFilter, dateRangeFilter, updatedRangeFilter, stageAgeFilter]);
  // Boards outside the broker's specialties are collapsed behind a toggle;
  // uncategorised boards are always shown. The active board stays visible even
  // if it is off-specialty, so switching to it never makes its tab disappear.
  const boardInScope = useCallback(
    (b: KanbanBoardListItem) =>
      showAllBoards || !mySpecialties.length || !b.loan_category || mySpecialties.includes(b.loan_category as LoanCategory),
    [showAllBoards, mySpecialties.join(',')], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const visibleBoards = boards.filter((b) => boardInScope(b) || b.id === activeBoard?.id);
  const hiddenBoardCount = showAllBoards ? 0 : boards.length - boards.filter(boardInScope).length;

  // Drag state
  const [draggedApp, setDraggedApp] = useState<LoanApplication | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [dragOverValidity, setDragOverValidity] = useState<DropValidity>(null);
  const dragSourceColumn = useRef<string | null>(null);
  const dragOverlayRef = useRef<HTMLDivElement>(null);
  // The filter set the cards on screen were fetched for. A filter clicked while
  // the first load is still in flight has to be honoured, so the refresh effect
  // keys off this rather than an "initial load finished" flag — flipping a ref
  // re-renders nothing, so such a click used to be dropped for good, leaving the
  // tab highlighted over unfiltered cards.
  const loadedFilterKey = useRef<string | null>(null);
  // Bumped by every view load. A response whose sequence is stale is discarded,
  // so a slow earlier fetch can't land on top of a newer one.
  const viewSeq = useRef(0);
  // The category the current column set was fetched for, so filters that don't
  // change the stage set don't re-request it.
  const loadedStageCategory = useRef<string | null>(null);
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());

  // Which stages are collapsed. A 14-stage view is wider than any screen, so
  // this is remembered per board + category view rather than reset each visit.
  // Nothing collapses on its own — a column vanishing unasked is worse than
  // scrolling for it; "Collapse empty" is one click away instead.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Modal state
  const [showCreateBoard, setShowCreateBoard] = useState(false);
  const [editingColumn, setEditingColumn] = useState<KanbanColumn | null>(null);
  const [showBoardSettings, setShowBoardSettings] = useState(false);
  const [pendingMove, setPendingMove] = useState<{
    app: LoanApplication;
    sourceColumnId: string;
    targetColumnId: string;
    targetColumnTitle: string;
    targetColumnStatus: ApplicationStatus | null;
    gates: StageGate[];
    notifications: StageNotificationRule[];
  } | null>(null);
  const [movingApp, setMovingApp] = useState(false);
  // Answers to the target stage's gates, keyed by gate id.
  const [gateAnswers, setGateAnswers] = useState<Record<string, GateAnswer>>({});
  // Whether to send each of the target stage's messages, keyed by rule id.
  const [notifyChoices, setNotifyChoices] = useState<Record<string, boolean>>({});

  // Form state
  // Shared by the create-board and board-settings forms. Both MUST fill them on
  // open — settings seeds from the active board, create clears them — or one
  // modal shows (and can save) the other's values.
  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardDesc, setNewBoardDesc] = useState('');
  const [newBoardCategory, setNewBoardCategory] = useState('');
  const [colColor, setColColor] = useState('muted-foreground');
  const [colTitle, setColTitle] = useState('');
  const [colTeam, setColTeam] = useState('');
  const [colStatus, setColStatus] = useState<string>('draft');
  const [addingColumn, setAddingColumn] = useState(false);
  const [deletingColumn, setDeletingColumn] = useState<KanbanColumn | null>(null);
  const [newGateLabel, setNewGateLabel] = useState('');
  const [savingGate, setSavingGate] = useState(false);
  const [newRuleAudience, setNewRuleAudience] = useState<NotificationAudience>('client');
  const [newRuleChannel, setNewRuleChannel] = useState<NotificationChannel>('email');
  const [newRuleSubject, setNewRuleSubject] = useState('');
  const [newRuleBody, setNewRuleBody] = useState('');
  const [savingRule, setSavingRule] = useState(false);

  // ── Data fetching ──

  const fetchBoards = useCallback(async () => {
    const { data } = await api.get('/kanban/boards');
    setBoards(data);
    return data as KanbanBoardListItem[];
  }, []);

  // The category in view decides which stages come back — and creates them on
  // first look. Board and cards are always fetched with the same category so
  // the columns and the cards in them can never disagree.
  const collapseKey = activeBoard ? `kanban:collapsed:${activeBoard.id}:${activeBoard.stage_category ?? 'status'}` : null;

  useEffect(() => {
    if (!collapseKey) return;
    try {
      const stored = localStorage.getItem(collapseKey);
      setCollapsed(new Set(stored ? (JSON.parse(stored) as string[]) : []));
    } catch {
      setCollapsed(new Set());
    }
  }, [collapseKey]);

  const persistCollapsed = useCallback((next: Set<string>) => {
    setCollapsed(next);
    if (!collapseKey) return;
    try {
      localStorage.setItem(collapseKey, JSON.stringify([...next]));
    } catch { /* a browser refusing storage is not worth failing the board over */ }
  }, [collapseKey]);

  const toggleCollapse = useCallback((columnId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(columnId)) next.delete(columnId); else next.add(columnId);
      if (collapseKey) {
        try { localStorage.setItem(collapseKey, JSON.stringify([...next])); } catch { /* ignore */ }
      }
      return next;
    });
  }, [collapseKey]);

  const fetchBoard = useCallback(async (boardId: string, category?: string, isCurrent?: () => boolean) => {
    const params = category ? `?category=${encodeURIComponent(category)}` : '';
    const { data } = await api.get(`/kanban/boards/${boardId}${params}`);
    if (!isCurrent || isCurrent()) setActiveBoard(data);
    return data as KanbanBoardType;
  }, []);

  const fetchApplications = useCallback(async (
    boardId: string,
    filters: { search?: string; category?: string; sub_type?: string; broker_id?: string; client_id?: string; date_range?: string; updated_range?: string; min_days_in_stage?: string } = {},
    isCurrent?: () => boolean,
  ) => {
    const params = new URLSearchParams();
    if (filters.search) params.set('search', filters.search);
    if (filters.category) params.set('category', filters.category);
    if (filters.sub_type) params.set('sub_type', filters.sub_type);
    if (filters.broker_id) params.set('broker_id', filters.broker_id);
    if (filters.client_id) params.set('client_id', filters.client_id);
    if (filters.date_range) params.set('date_range', filters.date_range);
    if (filters.updated_range) params.set('updated_range', filters.updated_range);
    if (filters.min_days_in_stage) params.set('min_days_in_stage', filters.min_days_in_stage);
    const { data } = await api.get(`/kanban/boards/${boardId}/applications?${params}`);
    if (isCurrent && !isCurrent()) return false;
    setAppsByColumn(data);
    return true;
  }, []);

  // Every route into the board — first paint, switching board, changing a
  // filter — goes through here, so they all share one staleness rule. The key is
  // claimed up front: a filter changed mid-flight leaves it stale, which is what
  // tells the refresh effect there is work to do.
  const loadView = useCallback(async (boardId: string) => {
    const seq = ++viewSeq.current;
    const isCurrent = () => seq === viewSeq.current;
    const key = filterKey;
    loadedFilterKey.current = key;
    try {
      // Only the category decides the stage set. Refetching 14 columns on every
      // search keystroke is wasted work — and makes the board flicker.
      if (loadedStageCategory.current !== categoryParam) {
        await fetchBoard(boardId, categoryParam, isCurrent);
        if (!isCurrent()) return;
        loadedStageCategory.current = categoryParam;
      }
      await fetchApplications(boardId, { search, category: categoryParam, sub_type: subTypeFilter, broker_id: brokerFilter, client_id: clientFilter, date_range: dateRangeFilter, updated_range: updatedRangeFilter, min_days_in_stage: stageAgeFilter }, isCurrent);
    } catch (err) {
      // Nothing was applied, so leave the key unclaimed and let the next filter
      // change retry rather than skipping it as already loaded.
      if (isCurrent()) loadedFilterKey.current = null;
      throw err;
    }
  }, [fetchBoard, fetchApplications, filterKey, search, categoryParam, subTypeFilter, brokerFilter, clientFilter, dateRangeFilter, updatedRangeFilter, stageAgeFilter]);

  const loadBoard = useCallback(async (boardId: string) => {
    setLoading(true);
    // A different board never shares the current board's columns.
    loadedStageCategory.current = null;
    try {
      await loadView(boardId);
    } catch {
      toast('Failed to load board', 'error');
    } finally {
      setLoading(false);
    }
  }, [loadView, toast]);

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
          // Prefer a board scoped to one of the broker's specialties, then any
          // board they can see, then whatever exists.
          const onSpecialty = boardList.filter((b) => b.loan_category && mySpecialties.includes(b.loan_category as LoanCategory));
          const inScope = boardList.filter(boardInScope);
          const pool = onSpecialty.length ? onSpecialty : inScope.length ? inScope : boardList;
          const defaultBoard = pool.find((b) => b.is_default) || pool[0];
          await loadBoard(defaultBoard.id);
        }
      } catch {
        if (!cancelled) toast('Failed to load boards', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The cards on screen don't match the filters. Covers a filter changed after
  // the board settled, and one changed while the first load was still running —
  // that load claimed the older key, so this fires as soon as the board id lands.
  // Keyed on the board *id* so refreshing the board object can't re-trigger it.
  const activeBoardId = activeBoard?.id;
  useEffect(() => {
    if (!activeBoardId || loadedFilterKey.current === filterKey) return;
    const timeout = setTimeout(() => {
      loadView(activeBoardId).catch(() => toast('Failed to refresh the board', 'error'));
    }, 300);
    return () => clearTimeout(timeout);
  }, [filterKey, activeBoardId, loadView, toast]);

  // Category scope: the board's own category (category boards) or the primary
  // category segment (unscoped boards). The Type filter lists that category's
  // sub-types, or every category's sub-types (grouped) when viewing All.
  // Drop a sub-type filter that falls outside the scope being viewed.
  const boardCategory = activeBoard?.loan_category || null;
  const effectiveCategory = boardCategory || categoryFilter || null;
  const categoryTypes = effectiveCategory ? (LOAN_CATEGORIES.find((c) => c.value === effectiveCategory)?.types ?? []) : [];
  useEffect(() => {
    if (effectiveCategory && subTypeFilter && !categoryTypes.some((t) => t.value === subTypeFilter)) {
      setSubTypeFilter('');
    }
    if (boardCategory) setCategoryFilter('');
  }, [effectiveCategory, boardCategory]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Drag and drop ──

  const getDropValidity = useCallback((targetColumnId: string): DropValidity => {
    if (!draggedApp) return null;
    if (dragSourceColumn.current === targetColumnId) return 'same';
    const targetCol = activeBoard?.columns.find((c) => c.id === targetColumnId);
    if (!targetCol?.mapped_status) return 'invalid';
    // Stage boards carry several stages per status, so the status transition
    // table has nothing useful to say about a move between them — the backend
    // relaxes it for these boards too.
    if (activeBoard && !activeBoard.enforce_transitions) return 'valid';
    const allowed = VALID_TRANSITIONS[draggedApp.status] || [];
    if (!allowed.includes(targetCol.mapped_status)) return 'invalid';
    return 'valid';
  }, [draggedApp, activeBoard]);

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

    const sourceColId = dragSourceColumn.current;
    if (!sourceColId) {
      setDraggedApp(null);
      return;
    }

    const movedApp = draggedApp;
    setDraggedApp(null);
    dragSourceColumn.current = null;

    beginMove(movedApp, sourceColId, targetColumnId);
  };

  /** Open the move confirmation for a card. Shared by drag-and-drop and the
   *  card's "Move to" menu, so both raise exactly the same gates and messages. */
  const beginMove = (movedApp: LoanApplication, sourceColId: string, targetColumnId: string) => {
    if (!activeBoard || sourceColId === targetColumnId) return;
    const targetCol = activeBoard.columns.find((c) => c.id === targetColumnId);
    if (!targetCol) return;

    // Seed each gate's answer. An approval-conditions gate starts from whatever
    // the application already carries, so a re-entry doesn't retype the list.
    const gates = targetCol.gates || [];
    const seeded: Record<string, GateAnswer> = {};
    for (const gate of gates) {
      const existing = gate.target === 'approval_conditions'
        ? (movedApp.approval_conditions?.map((c) => c.text) || [])
        : [];
      seeded[gate.id] = {
        gate_id: gate.id,
        confirmed: false,
        value: gate.target === 'approval_conditions' ? (movedApp.approval_lender_name || '') : '',
        items: existing.length ? existing : [''],
      };
    }
    setGateAnswers(seeded);

    const notifications = targetCol.notifications || [];
    setNotifyChoices(Object.fromEntries(notifications.map((r) => [r.id, r.default_enabled])));

    setPendingMove({
      app: movedApp,
      sourceColumnId: sourceColId,
      targetColumnId,
      targetColumnTitle: targetCol.title,
      targetColumnStatus: targetCol.mapped_status,
      gates,
      notifications,
    });
  };

  const sortedColumns = [...(activeBoard?.columns ?? [])].sort((a, b) => a.position - b.position);

  const pendingGates = pendingMove?.gates ?? [];
  const pendingNotifications = pendingMove?.notifications ?? [];
  // The modal is shown for anything the mover has to answer or confirm.
  const hasGates = pendingGates.length > 0 || pendingNotifications.length > 0;

  const answerFor = (gate: StageGate): GateAnswer =>
    gateAnswers[gate.id] ?? { gate_id: gate.id, confirmed: false, value: '', items: [''] };

  const updateAnswer = (gateId: string, patch: Partial<GateAnswer>) =>
    setGateAnswers((prev) => ({
      ...prev,
      [gateId]: { ...(prev[gateId] ?? { gate_id: gateId, confirmed: false, value: '', items: [''] }), ...patch },
    }));

  // Mirrors the backend's gate rules, so the Move button is only live once the
  // move would actually be accepted.
  const gatesSatisfied = pendingGates.every((gate) => {
    if (!gate.is_required) return true;
    const answer = answerFor(gate);
    if (gate.kind === 'confirm') return answer.confirmed;
    const items = answer.items.map((i) => i.trim()).filter(Boolean);
    if (!items.length) return false;
    return gate.target !== 'approval_conditions' || answer.value.trim().length > 0;
  });

  const confirmMoveApplication = async () => {
    if (!activeBoard || !pendingMove) return;
    if (!gatesSatisfied) return;

    setMovingApp(true);
    const prevApps = { ...appsByColumn };

    setAppsByColumn((prev) => {
      const updated = { ...prev };
      updated[pendingMove.sourceColumnId] = (prev[pendingMove.sourceColumnId] || []).filter((a) => a.id !== pendingMove.app.id);
      updated[pendingMove.targetColumnId] = [
        ...(prev[pendingMove.targetColumnId] || []),
        { ...pendingMove.app, kanban_column_id: pendingMove.targetColumnId, status: pendingMove.targetColumnStatus ?? pendingMove.app.status },
      ];
      return updated;
    });

    try {
      await api.post(
        `/kanban/boards/${activeBoard.id}/columns/${pendingMove.targetColumnId}/move/${pendingMove.app.id}`,
        {
          gate_responses: pendingGates.map((gate) => {
            const answer = answerFor(gate);
            return {
              gate_id: gate.id,
              confirmed: answer.confirmed,
              value: answer.value.trim(),
              items: answer.items.map((i) => i.trim()).filter(Boolean),
            };
          }),
          notifications: pendingNotifications.map((rule) => ({
            rule_id: rule.id,
            send: notifyChoices[rule.id] ?? rule.default_enabled,
          })),
        },
      );
      setFlashIds(new Set([pendingMove.app.id]));
      setTimeout(() => setFlashIds(new Set()), 900);
      toast(`Moved to "${pendingMove.targetColumnTitle}"`, 'success');
      setPendingMove(null);
      setGateAnswers({});
      setNotifyChoices({});
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
      const { data } = await api.post('/kanban/boards', { name: newBoardName, description: newBoardDesc || null, loan_category: newBoardCategory || null });
      setShowCreateBoard(false);
      setNewBoardName('');
      setNewBoardDesc('');
      setNewBoardCategory('');
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
      await api.patch(`/kanban/boards/${activeBoard.id}`, { name: newBoardName, description: newBoardDesc, loan_category: newBoardCategory || null });
      setShowBoardSettings(false);
      await fetchBoards();
      await fetchBoard(activeBoard.id, categoryParam);
      toast('Board updated', 'success');
    } catch {
      toast('Failed to update board', 'error');
    }
  };

  // ── Column management ──

  const resetColumnForm = () => {
    setColColor('muted-foreground');
    setColTitle('');
    setColTeam('');
    setColStatus('draft');
  };

  const closeColumnModal = () => {
    setEditingColumn(null);
    setAddingColumn(false);
    setNewGateLabel('');
    setNewRuleSubject('');
    setNewRuleBody('');
    resetColumnForm();
  };

  const handleEditColumn = async () => {
    if (!activeBoard || !colTitle.trim()) return;
    const payload = {
      title: colTitle.trim(),
      team: colTeam.trim(),
      mapped_status: colStatus,
      color: colColor,
      // Join the view being looked at, not the board's plain status columns.
      loan_category: activeBoard.stage_category,
    };
    try {
      if (editingColumn) {
        await api.patch(`/kanban/boards/${activeBoard.id}/columns/${editingColumn.id}`, payload);
      } else {
        await api.post(`/kanban/boards/${activeBoard.id}/columns`, payload);
      }
      closeColumnModal();
      await loadBoard(activeBoard.id);
      toast(editingColumn ? 'Stage updated' : 'Stage added', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to save stage'), 'error');
    }
  };

  // Gates are managed against a saved stage, so these call straight through and
  // reload the board rather than batching into the stage form's Save.
  const handleAddGate = async () => {
    if (!activeBoard || !editingColumn || !newGateLabel.trim()) return;
    setSavingGate(true);
    try {
      await api.post(`/kanban/boards/${activeBoard.id}/columns/${editingColumn.id}/gates`, {
        kind: 'confirm',
        label: newGateLabel.trim(),
      });
      setNewGateLabel('');
      const board = await fetchBoard(activeBoard.id, categoryParam);
      setEditingColumn(board.columns.find((c) => c.id === editingColumn.id) ?? null);
      toast('Confirmation added', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to add the confirmation'), 'error');
    } finally {
      setSavingGate(false);
    }
  };

  const handleDeleteGate = async (gate: StageGate) => {
    if (!activeBoard || !editingColumn) return;
    try {
      await api.delete(`/kanban/boards/${activeBoard.id}/columns/${editingColumn.id}/gates/${gate.id}`);
      const board = await fetchBoard(activeBoard.id, categoryParam);
      setEditingColumn(board.columns.find((c) => c.id === editingColumn.id) ?? null);
      toast('Confirmation removed', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to remove the confirmation'), 'error');
    }
  };

  const handleAddNotificationRule = async () => {
    if (!activeBoard || !editingColumn || !newRuleBody.trim()) return;
    setSavingRule(true);
    try {
      await api.post(`/kanban/boards/${activeBoard.id}/columns/${editingColumn.id}/notifications`, {
        audience: newRuleAudience,
        channel: newRuleChannel,
        subject: newRuleChannel === 'email' ? newRuleSubject.trim() : null,
        body: newRuleBody.trim(),
      });
      setNewRuleSubject('');
      setNewRuleBody('');
      const board = await fetchBoard(activeBoard.id, categoryParam);
      setEditingColumn(board.columns.find((c) => c.id === editingColumn.id) ?? null);
      toast('Message added', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to add the message'), 'error');
    } finally {
      setSavingRule(false);
    }
  };

  const handleDeleteNotificationRule = async (rule: StageNotificationRule) => {
    if (!activeBoard || !editingColumn) return;
    try {
      await api.delete(`/kanban/boards/${activeBoard.id}/columns/${editingColumn.id}/notifications/${rule.id}`);
      const board = await fetchBoard(activeBoard.id, categoryParam);
      setEditingColumn(board.columns.find((c) => c.id === editingColumn.id) ?? null);
      toast('Message removed', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to remove the message'), 'error');
    }
  };

  const handleDeleteColumn = (col: KanbanColumn) => setDeletingColumn(col);

  const confirmDeleteColumn = async () => {
    if (!activeBoard || !deletingColumn) return;
    try {
      await api.delete(`/kanban/boards/${activeBoard.id}/columns/${deletingColumn.id}`);
      setDeletingColumn(null);
      await loadBoard(activeBoard.id);
      toast('Stage deleted', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to delete stage'), 'error');
      setDeletingColumn(null);
    }
  };

  const openEditColumn = (col: KanbanColumn) => {
    setColColor(col.color || 'muted-foreground');
    setColTitle(col.title);
    setColTeam(col.team || '');
    setColStatus(col.mapped_status || 'draft');
    setAddingColumn(false);
    setEditingColumn(col);
  };

  const openAddColumn = () => {
    resetColumnForm();
    setEditingColumn(null);
    setAddingColumn(true);
  };

  const handleSwitchBoard = async (boardId: string) => {
    await loadBoard(boardId);
  };

  const getColumnApps = (colId: string): LoanApplication[] => appsByColumn[colId] || [];

  const activeFilterCount = [categoryFilter, subTypeFilter, brokerFilter, clientFilter, dateRangeFilter, updatedRangeFilter, stageAgeFilter].filter(Boolean).length;
  const clearAllFilters = () => {
    setCategoryFilter('');
    setSubTypeFilter('');
    setBrokerFilter('');
    setClientFilter('');
    setDateRangeFilter('');
    setUpdatedRangeFilter('');
    setStageAgeFilter('');
  };

  // Filter pill values
  const subTypePill = subTypeFilter ? (findLoanSubType(subTypeFilter)?.short || subTypeFilter) : 'All';
  const brokerPill = brokerFilter ? (brokersList.find((b) => b.id === brokerFilter)?.full_name.split(' ')[0] || 'All') : 'All';
  const clientPill = clientFilter ? (clientsList.find((c) => c.id === clientFilter)?.full_name.split(' ')[0] || 'All') : 'All';
  const DATE_RANGE_LABELS: Record<string, string> = { this_month: 'This month', last_month: 'Last month', this_quarter: 'This quarter', last_quarter: 'Last quarter', this_year: 'This year' };
  const datePill = dateRangeFilter ? (DATE_RANGE_LABELS[dateRangeFilter] || 'All') : 'All time';
  const updatedPill = updatedRangeFilter ? (DATE_RANGE_LABELS[updatedRangeFilter] || 'All') : 'All time';
  const STAGE_AGE_LABELS: Record<string, string> = { '7': '7+ days', '14': '14+ days', '30': '30+ days', '60': '60+ days' };
  const stageAgePill = stageAgeFilter ? (STAGE_AGE_LABELS[stageAgeFilter] || stageAgeFilter) : 'Any';

  // ── Render ──

  return (
    // Escape <main>'s responsive padding exactly and pin the page to the
    // viewport: the toolbar stays put and each column scrolls its own cards,
    // so the page itself never scrolls vertically.
    <div
      className="ledger-theme led-fade-up -m-4 sm:-m-6 lg:-m-10 flex flex-col h-[calc(100dvh-3rem)] lg:h-dvh"
      style={{ background: 'var(--led-bg)' }}
    >
      {/* Header */}
      {/* Not sticky: the page is viewport-pinned (columns scroll internally), and
          sticky would get force-shifted into <main>'s padding box, overlapping the
          columns. relative+zIndex keeps filter popovers above the board. */}
      <header style={{ padding: '20px 24px 0', background: 'var(--led-bg)', position: 'relative', zIndex: 20, borderBottom: '1px solid var(--led-line)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, paddingBottom: 14 }}>
          <div style={{ minWidth: 0 }}>
            <h1 className="led-h-page" style={{ margin: 0 }}>{activeBoard?.name || 'Pipeline'}</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--led-muted)' }}>
              {boardCategory ? `${CATEGORY_LABEL[boardCategory]} only · ` : ''}Drag cards between stages · live sync
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
                {canCreateBoard && (
                  <button type="button" className="led-btn led-btn-outline led-btn-sm" onClick={() => { setNewBoardName(''); setNewBoardDesc(''); setNewBoardCategory(''); setShowCreateBoard(true); }}>
                    <Icon name="plus" size={12} /> Board
                  </button>
                )}
                {activeBoard && (
                  <button
                    type="button"
                    className="led-btn led-btn-outline led-btn-sm led-btn-icon"
                    onClick={() => {
                      setNewBoardName(activeBoard.name);
                      setNewBoardDesc(activeBoard.description || '');
                      setNewBoardCategory(activeBoard.loan_category || '');
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

        {/* Board tabs — scoped to the broker's specialties unless they opt out */}
        {(visibleBoards.length > 1 || hiddenBoardCount > 0) && (
          <div className="led-tabs">
            {visibleBoards.map((b) => (
              <button
                key={b.id}
                type="button"
                className={`led-tab ${activeBoard?.id === b.id ? 'led-active' : ''}`}
                onClick={() => handleSwitchBoard(b.id)}
              >
                {b.name}
              </button>
            ))}
            {hiddenBoardCount > 0 && (
              <button
                type="button"
                className="led-tab"
                onClick={() => setShowAllBoards(true)}
                title="Show boards outside your specialties"
              >
                Show all boards ({hiddenBoardCount})
              </button>
            )}
            {showAllBoards && mySpecialties.length > 0 && (
              <button type="button" className="led-tab" onClick={() => setShowAllBoards(false)}>
                Show my boards
              </button>
            )}
          </div>
        )}

        {/* Filter bar — row 1: primary category scope + search; row 2: refinements.
            Lives inside the sticky header so filters never slide under it. */}
        <div style={{ padding: '14px 0 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {!boardCategory && (
            <div className="led-segment">
              <button
                type="button"
                className={!categoryFilter ? 'led-active' : ''}
                onClick={() => setCategoryFilter('')}
              >
                All
              </button>
              {mySpecialties.length > 0 && (
                <button
                  type="button"
                  className={categoryFilter === MY_FOCUS ? 'led-active' : ''}
                  onClick={() => setCategoryFilter(MY_FOCUS)}
                  title={`My specialties: ${mySpecialties.map((s) => CATEGORY_LABEL[s] || s).join(', ')}`}
                >
                  Mine
                </button>
              )}
              {LOAN_CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className={categoryFilter === c.value ? 'led-active' : ''}
                  onClick={() => setCategoryFilter(c.value)}
                >
                  {CATEGORY_SHORT[c.value] || c.label}
                </button>
              ))}
            </div>
          )}
          <div className="led-search">
            <Icon name="search" size={13} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search clients…"
            />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>

        <FilterPill label="Type" value={subTypePill} active={!!subTypeFilter} icon="filter">
          {(close) => {
            const typeButton = (t: { value: string; label: string; short: string }) => (
              <button
                key={t.value}
                type="button"
                className={`led-popover-item ${subTypeFilter === t.value ? 'led-active' : ''}`}
                onClick={() => { setSubTypeFilter(t.value); close(); }}
                title={t.label}
              >
                {t.short}
              </button>
            );
            return (
              <div style={{ maxHeight: 360, overflowY: 'auto', minWidth: 180 }}>
                <button type="button" className={`led-popover-item ${!subTypeFilter ? 'led-active' : ''}`} onClick={() => { setSubTypeFilter(''); close(); }}>All types</button>
                {effectiveCategory
                  ? categoryTypes.map(typeButton)
                  : LOAN_CATEGORIES.map((c) => (
                    <div key={c.value}>
                      <div style={{ padding: '8px 10px 3px', fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--led-muted)' }}>
                        {CATEGORY_SHORT[c.value] || c.label}
                      </div>
                      {c.types.map(typeButton)}
                    </div>
                  ))}
              </div>
            );
          }}
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

        {/* A stage view is wider than any screen, so collapsing is a first-class
            control rather than something hidden per column. */}
        {sortedColumns.length > 8 && (
          collapsed.size > 0 ? (
            <button
              type="button"
              className="led-btn led-btn-ghost led-btn-sm"
              style={{ color: 'var(--led-muted)' }}
              onClick={() => persistCollapsed(new Set())}
            >
              Expand all ({collapsed.size})
            </button>
          ) : (
            <button
              type="button"
              className="led-btn led-btn-ghost led-btn-sm"
              style={{ color: 'var(--led-muted)' }}
              onClick={() => persistCollapsed(new Set(sortedColumns.filter((c) => !getColumnApps(c.id).length).map((c) => c.id)))}
              disabled={sortedColumns.every((c) => getColumnApps(c.id).length)}
            >
              Collapse empty
            </button>
          )
        )}

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
        </div>
      </header>

      {/* Board canvas */}
      {loading ? (
        <div style={{ padding: '14px 24px 20px', flex: 1, minHeight: 0 }}>
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
        <div style={{ padding: '14px 24px 20px', flex: 1, minHeight: 0 }}>
          <div className="led-kanban-scroller">
            {sortedColumns.map((col) => (
              <BoardColumn
                key={col.id}
                col={col}
                apps={getColumnApps(col.id)}
                dragOverColumn={dragOverColumn}
                dropValidity={dragOverColumn === col.id ? dragOverValidity : null}
                draggedAppId={draggedApp?.id || null}
                isAdmin={isAdmin}
                collapsed={collapsed.has(col.id)}
                onToggleCollapse={toggleCollapse}
                moveTargets={sortedColumns.filter((c) => c.id !== col.id)}
                onMoveTo={beginMove}
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
                onClick={openAddColumn}
                title="Add a stage to this board"
              >
                <Icon name="plus" size={13} /> Add stage
              </button>
            )}
          </div>
        </div>
      ) : (
        <EmptyState
          title="No boards found"
          description="Boards group applications into pipeline stages."
          action={
            canCreateBoard ? (
              <button type="button" className="led-btn led-btn-accent" onClick={() => { setNewBoardName(''); setNewBoardDesc(''); setNewBoardCategory(''); setShowCreateBoard(true); }}>
                <Icon name="plus" size={13} /> Create your first board
              </button>
            ) : undefined
          }
        />
      )}

      {/* ── Create Board Modal ── */}
      <Modal open={showCreateBoard} onClose={() => setShowCreateBoard(false)} title="Create board">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input className="led-input" placeholder="Board name" value={newBoardName} onChange={(e) => setNewBoardName(e.target.value)} autoFocus />
          <input className="led-input" placeholder="Description (optional)" value={newBoardDesc} onChange={(e) => setNewBoardDesc(e.target.value)} />
          <div>
            <div className="led-label" style={{ marginBottom: 6 }}>Loan category</div>
            <select className="led-input" value={newBoardCategory} onChange={(e) => setNewBoardCategory(e.target.value)} style={{ cursor: 'pointer' }}>
              <option value="">All applications</option>
              {LOAN_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <p className="led-caption" style={{ margin: '6px 0 0' }}>Category boards only show applications of that category.</p>
          </div>
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
          <div>
            <div className="led-label" style={{ marginBottom: 6 }}>Loan category</div>
            <select className="led-input" value={newBoardCategory} onChange={(e) => setNewBoardCategory(e.target.value)} style={{ cursor: 'pointer' }}>
              <option value="">All applications</option>
              {LOAN_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
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

      {/* ── Add / Edit Stage Modal ── */}
      <Modal
        open={!!editingColumn || addingColumn}
        onClose={closeColumnModal}
        title={editingColumn ? 'Edit stage' : 'Add stage'}
      >
        <ColumnForm
          title={colTitle}
          setTitle={setColTitle}
          team={colTeam}
          setTeam={setColTeam}
          mappedStatus={colStatus}
          setMappedStatus={setColStatus}
          color={colColor}
          setColor={setColColor}
        />

        {/* Gates are saved against the stage as you add them, not on Save — so
            they only appear once the stage itself exists. */}
        {editingColumn && (
          <div style={{ borderTop: '1px solid var(--led-line)', marginTop: 14, paddingTop: 12 }}>
            <div className="led-label" style={{ marginBottom: 6 }}>Confirmations before a card enters</div>
            <div style={{ fontSize: 11, color: 'var(--led-muted)', lineHeight: 1.45, marginBottom: 8 }}>
              Each one must be ticked to move a card here, and who ticked it is recorded
              against the move.
            </div>
            {editingColumn.gates.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                {editingColumn.gates.map((gate) => (
                  <div
                    key={gate.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                      borderRadius: 8, background: 'var(--led-surface-2)',
                    }}
                  >
                    <span className="led-chip" style={{ height: 18, fontSize: 10 }}>
                      {gate.kind === 'checklist' ? 'Checklist' : 'Confirm'}
                    </span>
                    <span style={{ flex: 1, fontSize: 12, color: 'var(--led-ink)' }}>{gate.label}</span>
                    <button
                      type="button"
                      className="led-btn led-btn-ghost led-btn-sm led-btn-icon"
                      onClick={() => handleDeleteGate(gate)}
                      title="Remove"
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="led-input"
                placeholder="e.g. The client has signed the privacy consent"
                value={newGateLabel}
                onChange={(e) => setNewGateLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddGate(); } }}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="led-btn led-btn-ghost led-btn-sm"
                onClick={handleAddGate}
                disabled={!newGateLabel.trim() || savingGate}
              >
                Add
              </button>
            </div>
          </div>
        )}

        {/* Who gets told when a card lands here. The mover confirms each one on
            the way through; sending itself is switched off for now. */}
        {editingColumn && (
          <div style={{ borderTop: '1px solid var(--led-line)', marginTop: 14, paddingTop: 12 }}>
            <div className="led-label" style={{ marginBottom: 6 }}>Messages on entering this stage</div>
            <div style={{ fontSize: 11, color: 'var(--led-muted)', lineHeight: 1.45, marginBottom: 8 }}>
              Offered to whoever moves the card, pre-ticked. Nothing sends yet — every
              decision is recorded so you can review the traffic before switching it on.
              You can use {'{client_name}'}, {'{recipient_name}'}, {'{stage}'}, {'{lender}'}, {'{amount}'} and {'{reference}'}.
            </div>
            {editingColumn.notifications.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                {editingColumn.notifications.map((rule) => (
                  <div
                    key={rule.id}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 8px', borderRadius: 8, background: 'var(--led-surface-2)' }}
                  >
                    <span className="led-chip" style={{ height: 18, fontSize: 10, textTransform: 'capitalize' }}>
                      {rule.audience} · {rule.channel}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--led-ink)', whiteSpace: 'pre-wrap' }}>
                      {rule.subject && <strong style={{ display: 'block' }}>{rule.subject}</strong>}
                      {rule.body}
                    </span>
                    <button
                      type="button"
                      className="led-btn led-btn-ghost led-btn-sm led-btn-icon"
                      onClick={() => handleDeleteNotificationRule(rule)}
                      title="Remove"
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <select
                className="led-input"
                value={newRuleAudience}
                onChange={(e) => setNewRuleAudience(e.target.value as NotificationAudience)}
                style={{ flex: 1, cursor: 'pointer' }}
              >
                <option value="client">Client</option>
                <option value="referrer">Referrer</option>
                <option value="broker">Broker</option>
              </select>
              <select
                className="led-input"
                value={newRuleChannel}
                onChange={(e) => setNewRuleChannel(e.target.value as NotificationChannel)}
                style={{ flex: 1, cursor: 'pointer' }}
              >
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
            </div>
            {newRuleChannel === 'email' && (
              <input
                className="led-input"
                placeholder="Subject"
                value={newRuleSubject}
                onChange={(e) => setNewRuleSubject(e.target.value)}
                style={{ marginBottom: 6 }}
              />
            )}
            <textarea
              className="led-input"
              placeholder="Message — e.g. Hi {client_name}, your application has been submitted to a lender."
              value={newRuleBody}
              onChange={(e) => setNewRuleBody(e.target.value)}
              rows={3}
              style={{ resize: 'vertical', marginBottom: 6 }}
            />
            <button
              type="button"
              className="led-btn led-btn-ghost led-btn-sm"
              onClick={handleAddNotificationRule}
              disabled={!newRuleBody.trim() || savingRule}
            >
              Add message
            </button>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" className="led-btn led-btn-ghost" onClick={closeColumnModal}>Cancel</button>
          <button type="button" className="led-btn led-btn-accent" onClick={handleEditColumn} disabled={!colTitle.trim()}>
            {editingColumn ? 'Save' : 'Add stage'}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deletingColumn}
        title="Delete stage"
        message={`Delete "${deletingColumn?.title}" from this board? Applications keep their status — only the stage is removed.`}
        confirmText="Delete"
        variant="danger"
        onConfirm={confirmDeleteColumn}
        onCancel={() => setDeletingColumn(null)}
      />

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
                  <Icon name={loanTypeChip(draggedApp).icon} size={11} />
                  {loanTypeChip(draggedApp).label}
                </span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--led-ink)', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {applicantDisplayName(draggedApp)}
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
        open={!!pendingMove && !hasGates}
        title="Move card"
        message={pendingMove ? (
          <>
            Move <span className="font-semibold text-foreground">
              {applicantDisplayName(pendingMove.app, 'this application')}
            </span> to <span className="font-semibold text-foreground">{pendingMove.targetColumnTitle}</span>?
          </>
        ) : null}
        confirmText="Move"
        cancelText="Cancel"
        variant="primary"
        loading={movingApp}
        onConfirm={confirmMoveApplication}
        onCancel={() => {
          if (!movingApp) { setPendingMove(null); setGateAnswers({}); setNotifyChoices({}); }
        }}
      />

      {/* ── Stage Gates Modal ── */}
      {/* Everything a stage asks before it will take the card. Rendered from the
          stage's own gate list, so a new compliance stop needs no code here. */}
      <Modal
        open={!!pendingMove && hasGates}
        onClose={() => { if (!movingApp) { setPendingMove(null); setGateAnswers({}); setNotifyChoices({}); } }}
        title={`Move to ${pendingMove?.targetColumnTitle ?? ''}`}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p className="led-caption" style={{ margin: 0 }}>
            Move <strong style={{ color: 'var(--led-ink)' }}>
              {pendingMove ? applicantDisplayName(pendingMove.app, 'this application') : ''}
            </strong> to <strong style={{ color: 'var(--led-ink)' }}>{pendingMove?.targetColumnTitle}</strong>.
          </p>

          {pendingGates.map((gate) => {
            const answer = answerFor(gate);
            if (gate.kind === 'confirm') {
              return (
                <label
                  key={gate.id}
                  style={{
                    display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer',
                    padding: 10, borderRadius: 10, border: '1px solid var(--led-line)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={answer.confirmed}
                    onChange={(e) => updateAnswer(gate.id, { confirmed: e.target.checked })}
                    style={{ marginTop: 2, cursor: 'pointer' }}
                  />
                  <span>
                    <span style={{ fontSize: 13, color: 'var(--led-ink)' }}>
                      {gate.label}
                      {gate.is_required && <span style={{ color: 'var(--led-danger)' }}> *</span>}
                    </span>
                    {gate.help_text && (
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--led-muted)', marginTop: 3, lineHeight: 1.45 }}>
                        {gate.help_text}
                      </span>
                    )}
                  </span>
                </label>
              );
            }
            return (
              <div key={gate.id}>
                <div className="led-label" style={{ marginBottom: 6 }}>
                  {gate.label}
                  {gate.is_required && <span style={{ color: 'var(--led-danger)' }}> *</span>}
                </div>
                {gate.help_text && (
                  <div style={{ fontSize: 11, color: 'var(--led-muted)', marginBottom: 8, lineHeight: 1.45 }}>
                    {gate.help_text}
                  </div>
                )}
                {gate.target === 'approval_conditions' && (
                  <input
                    className="led-input"
                    placeholder="Lender name — e.g. ANZ, Pepper Money..."
                    value={answer.value}
                    onChange={(e) => updateAnswer(gate.id, { value: e.target.value })}
                    style={{ marginBottom: 8 }}
                  />
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {answer.items.map((item, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        className="led-input"
                        placeholder={`Item ${i + 1}`}
                        value={item}
                        onChange={(e) => updateAnswer(gate.id, {
                          items: answer.items.map((x, idx) => (idx === i ? e.target.value : x)),
                        })}
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        className="led-btn led-btn-ghost led-btn-sm led-btn-icon"
                        onClick={() => updateAnswer(gate.id, { items: answer.items.filter((_, idx) => idx !== i) })}
                        disabled={answer.items.length <= 1}
                      >
                        <Icon name="close" size={12} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="led-btn led-btn-ghost led-btn-sm"
                  style={{ marginTop: 8 }}
                  onClick={() => updateAnswer(gate.id, { items: [...answer.items, ''] })}
                >
                  + Add item
                </button>
              </div>
            );
          })}

          {pendingNotifications.length > 0 && (
            <div style={{ borderTop: '1px solid var(--led-line)', paddingTop: 12 }}>
              <div className="led-label" style={{ marginBottom: 6 }}>Let them know</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pendingNotifications.map((rule) => {
                  const on = notifyChoices[rule.id] ?? rule.default_enabled;
                  return (
                    <label
                      key={rule.id}
                      style={{
                        display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer',
                        padding: 10, borderRadius: 10, border: '1px solid var(--led-line)',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => setNotifyChoices((prev) => ({ ...prev, [rule.id]: e.target.checked }))}
                        style={{ marginTop: 2, cursor: 'pointer' }}
                      />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ fontSize: 13, color: 'var(--led-ink)', textTransform: 'capitalize' }}>
                          {rule.audience} · {rule.channel}
                        </span>
                        <span style={{ display: 'block', fontSize: 11, color: 'var(--led-muted)', marginTop: 3, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
                          {rule.subject ? `${rule.subject} — ` : ''}{rule.body}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: 'var(--led-muted)', marginTop: 8, lineHeight: 1.45 }}>
                Sending is switched off for now — your choice is recorded against the move
                either way, and nothing leaves the building.
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 }}>
            <button
              type="button"
              className="led-btn led-btn-ghost"
              onClick={() => { if (!movingApp) { setPendingMove(null); setGateAnswers({}); setNotifyChoices({}); } }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="led-btn led-btn-accent"
              onClick={confirmMoveApplication}
              disabled={!gatesSatisfied || movingApp}
            >
              {movingApp ? 'Moving...' : 'Confirm & move'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Stage form ──
// A stage has its own name and owning team; `mapped_status` is the coarse status
// it rolls up to, which is what the client sees and what drives status emails.

function ColumnForm({
  title, setTitle, team, setTeam, mappedStatus, setMappedStatus, color, setColor,
}: {
  title: string; setTitle: (s: string) => void;
  team: string; setTeam: (s: string) => void;
  mappedStatus: string; setMappedStatus: (s: string) => void;
  color: string; setColor: (s: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div className="led-label" style={{ marginBottom: 6 }}>Stage name</div>
        <input
          className="led-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Waiting for Tax Invoice"
        />
      </div>
      <div>
        <div className="led-label" style={{ marginBottom: 6 }}>Team</div>
        <input
          className="led-input"
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          placeholder="Who owns this stage (optional)"
        />
      </div>
      <div>
        <div className="led-label" style={{ marginBottom: 6 }}>Reports as status</div>
        <select className="led-input" value={mappedStatus} onChange={(e) => setMappedStatus(e.target.value)} style={{ cursor: 'pointer' }}>
          {(Object.keys(STATUS_LABEL) as ApplicationStatus[]).map((st) => (
            <option key={st} value={st}>{STATUS_LABEL[st]}</option>
          ))}
        </select>
        <div style={{ fontSize: 11, color: 'var(--led-muted)', marginTop: 5, lineHeight: 1.45 }}>
          What the client sees, and what status notifications use. Several stages
          can report the same status.
        </div>
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

