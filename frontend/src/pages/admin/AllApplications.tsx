import { useEffect, useState, useRef, useMemo, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { getInitials, relativeTime, fmtMoneyK, avatarColor } from '../../lib/utils';
import { STATUS_LABEL } from '../../lib/constants';
import type { LoanApplication, ApplicationStatus, User } from '../../types';
import { Skeleton, EmptyState } from '../../components/ui';

// ── Icons ──

function Icon({ name, size = 14, strokeWidth = 1.75, className = '' }: { name: string; size?: number; strokeWidth?: number; className?: string }) {
  const paths: Record<string, ReactNode> = {
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    check: <path d="m4 12 5 5L20 6" />,
    chevronDown: <path d="m6 9 6 6 6-6" />,
    chevronLeft: <path d="m15 6-6 6 6 6" />,
    chevronRight: <path d="m9 6 6 6-6 6" />,
    chevronsLeft: <path d="m11 6-6 6 6 6M17 6l-6 6 6 6" />,
    chevronsRight: <path d="m7 6 6 6-6 6M13 6l6 6-6 6" />,
    arrowDown: <path d="M12 5v14M5 12l7 7 7-7" />,
    arrowUp: <path d="M12 19V5M5 12l7-7 7 7" />,
    board: <><rect x="3" y="4" width="6" height="16" rx="1.2" /><rect x="11" y="4" width="6" height="10" rx="1.2" /><rect x="19" y="4" width="2.5" height="7" rx="1" /></>,
    list: <><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>,
    filter: <path d="M4 5h16l-6 8v6l-4-2v-4L4 5Z" />,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 2.5-5 6-5s6 2 6 5" /><circle cx="17" cy="9" r="2.5" /><path d="M15.5 14.5c3 0 5.5 2 5.5 5" /></>,
    briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /></>,
    car: <path d="M3 13h18l-2-6H5l-2 6Zm0 0v4a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-2m10 0v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-4M7 16h.01M17 16h.01" />,
    home: <path d="M3 12 12 4l9 8v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z" />,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" /></>,
    dotsV: <><circle cx="12" cy="5" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="12" cy="19" r="1.3" /></>,
    circle: <circle cx="12" cy="12" r="9" />,
    refresh: <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 4v4h-4M21 12a9 9 0 0 1-15 6.7L3 16M3 20v-4h4" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
      {paths[name] || null}
    </svg>
  );
}

const LOAN_TYPE_ICON: Record<string, string> = { business: 'briefcase', vehicle: 'car', home: 'home', personal: 'user' };
const LOAN_TYPE_LABEL: Record<string, string> = { business: 'Business', vehicle: 'Vehicle', home: 'Home', personal: 'Personal' };

const STATUS_CHIP: Record<ApplicationStatus, { cls: string; dot: string }> = {
  draft: { cls: '', dot: 'oklch(0.62 0.02 0)' },
  application_received: { cls: 'led-chip-info', dot: 'oklch(0.62 0.12 230)' },
  application_assessed: { cls: 'led-chip-violet', dot: 'oklch(0.55 0.19 300)' },
  submitted: { cls: 'led-chip-accent', dot: 'oklch(0.55 0.22 268)' },
  approval: { cls: 'led-chip-warning', dot: 'oklch(0.72 0.15 65)' },
  settled: { cls: 'led-chip-success', dot: 'oklch(0.62 0.15 155)' },
  rejected: { cls: 'led-chip-danger', dot: 'oklch(0.58 0.20 20)' },
  not_proceeding: { cls: '', dot: 'oklch(0.50 0.08 40)' },
};

// ── Avatar ──

function Avatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' }) {
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

// ── Filter Pill ──

function FilterPill({
  label, value, active, icon, children,
}: {
  label: string; value: string; active: boolean; icon?: string;
  children: (close: () => void) => ReactNode;
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
      <button type="button" className={`led-filter-pill ${active ? 'led-active' : ''}`} onClick={() => setOpen((o) => !o)}>
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

// ── Main ──

type SortKey = 'user_name' | 'amount' | 'status' | 'updated_at';
type SortDir = 'asc' | 'desc';

export default function AllApplications() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [applications, setApplications] = useState<LoanApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<'active' | 'closed'>('active');
  const [statusFilter, setStatusFilter] = useState('');
  const [loanTypeFilter, setLoanTypeFilter] = useState('');
  const [brokerFilter, setBrokerFilter] = useState('');
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'updated_at', dir: 'desc' });
  const [brokersList, setBrokersList] = useState<{ id: string; full_name: string }[]>([]);
  const perPage = 15;

  const ACTIVE_STATUSES: ApplicationStatus[] = ['draft', 'application_received', 'application_assessed', 'submitted', 'approval'];
  const CLOSED_STATUSES: ApplicationStatus[] = ['settled', 'rejected', 'not_proceeding'];

  const fetchData = () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('per_page', String(perPage));
    if (statusFilter) params.set('status', statusFilter);
    else params.set('closed', view === 'closed' ? 'true' : 'false');
    if (loanTypeFilter) params.set('loan_type', loanTypeFilter);
    if (search) params.set('search', search);

    api
      .get(`/applications?${params}`)
      .then(({ data }) => {
        setApplications(data.items);
        setTotal(data.total);
      })
      .catch(() => toast('Failed to load applications', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
  }, [page, view, statusFilter, loanTypeFilter, search]);

  useEffect(() => {
    api.get('/users')
      .then(({ data }) => {
        const users = data as User[];
        setBrokersList(users.filter((u) => u.role === 'broker' || u.role === 'admin').map((u) => ({ id: u.id, full_name: u.full_name })));
      })
      .catch(() => { /* ignore */ });
  }, []);

  // debounced search
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchDraft !== search) {
        setPage(1);
        setSearch(searchDraft);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [searchDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(() => {
    let arr = applications.slice();
    if (brokerFilter) {
      arr = arr.filter((a) => a.assigned_brokers?.some((ab) => ab.id === brokerFilter));
    }
    arr.sort((a, b) => {
      let av: any = a[sort.key];
      let bv: any = b[sort.key];
      if (sort.key === 'user_name') { av = a.user_name || ''; bv = b.user_name || ''; }
      if (sort.key === 'amount') { av = Number(a.amount) || 0; bv = Number(b.amount) || 0; }
      if (sort.key === 'status') { av = STATUS_LABEL[a.status] || a.status; bv = STATUS_LABEL[b.status] || b.status; }
      if (sort.key === 'updated_at') { av = new Date(a.updated_at).getTime(); bv = new Date(b.updated_at).getTime(); }
      if (av < bv) return sort.dir === 'asc' ? -1 : 1;
      if (av > bv) return sort.dir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [applications, brokerFilter, sort]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const activeFilterCount = [statusFilter, loanTypeFilter, brokerFilter, search].filter(Boolean).length;
  const viewStatuses = view === 'active' ? ACTIVE_STATUSES : CLOSED_STATUSES;

  const toggleSort = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));

  const clearFilters = () => {
    setStatusFilter('');
    setLoanTypeFilter('');
    setBrokerFilter('');
    setSearchDraft('');
    setSearch('');
    setPage(1);
  };

  // Filter pill values
  const statusPill = statusFilter ? (STATUS_LABEL[statusFilter as ApplicationStatus] || statusFilter) : 'All';
  const typePill = loanTypeFilter ? (LOAN_TYPE_LABEL[loanTypeFilter] || loanTypeFilter) : 'All';
  const brokerPill = brokerFilter ? (brokersList.find((b) => b.id === brokerFilter)?.full_name.split(' ')[0] || 'All') : 'Any';

  const SortHead = ({ k, children, align = 'left' }: { k: SortKey; children: ReactNode; align?: 'left' | 'right' }) => (
    <th style={{ textAlign: align }}>
      <button
        type="button"
        className={`led-sort-head ${sort.key === k ? 'led-sort-active' : ''}`}
        onClick={() => toggleSort(k)}
      >
        {children}
        {sort.key === k && <Icon name={sort.dir === 'asc' ? 'arrowUp' : 'arrowDown'} size={10} />}
      </button>
    </th>
  );

  return (
    <div className="ledger-theme led-fade-up" style={{ minHeight: '100%', background: 'var(--led-bg)', margin: -24, padding: 0 }}>
      {/* Header */}
      <header style={{ padding: '20px 24px 0', background: 'var(--led-bg)', position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, paddingBottom: 14 }}>
          <div style={{ minWidth: 0 }}>
            <h1 className="led-h-page" style={{ margin: 0 }}>Applications</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--led-muted)' }}>
              <span className="led-mono led-tnum">{sorted.length}</span> of <span className="led-mono led-tnum">{total}</span> shown
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div className="led-segment">
              <button
                type="button"
                className={view === 'active' ? 'led-active' : ''}
                onClick={() => { setView('active'); setStatusFilter(''); setPage(1); }}
              >Active</button>
              <button
                type="button"
                className={view === 'closed' ? 'led-active' : ''}
                onClick={() => { setView('closed'); setStatusFilter(''); setPage(1); }}
              >Closed</button>
            </div>
            {view === 'active' && (
              <button
                type="button"
                className="led-btn led-btn-primary led-btn-sm"
                onClick={() => navigate('/admin/applications/new')}
                style={{ gap: 6 }}
              >
                <Icon name="plus" size={12} /> New Application
              </button>
            )}
            <div className="led-segment">
              <button type="button" className="led-active"><Icon name="list" size={12} /> Table</button>
              <Link to="/admin/board" style={{ textDecoration: 'none' }}>
                <button type="button"><Icon name="board" size={12} /> Board</button>
              </Link>
            </div>
            <button type="button" className="led-btn led-btn-outline led-btn-sm led-btn-icon" onClick={fetchData} title="Refresh">
              <Icon name="refresh" size={13} />
            </button>
          </div>
        </div>
      </header>

      {/* Filter bar */}
      <div style={{ padding: '40px 24px 12px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div className="led-search">
          <Icon name="search" size={13} />
          <input
            type="text"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Name or email…"
            style={{ width: 240 }}
          />
        </div>

        <FilterPill label="Status" value={statusPill} active={!!statusFilter} icon="filter">
          {(close) => (
            <>
              <button type="button" className={`led-popover-item ${!statusFilter ? 'led-active' : ''}`} onClick={() => { setStatusFilter(''); setPage(1); close(); }}>All {view}</button>
              {viewStatuses.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`led-popover-item ${statusFilter === s ? 'led-active' : ''}`}
                  onClick={() => { setStatusFilter(s); setPage(1); close(); }}
                >
                  <span className="led-sdot" style={{ background: STATUS_CHIP[s].dot, width: 6, height: 6 }} />
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </>
          )}
        </FilterPill>

        <FilterPill label="Type" value={typePill} active={!!loanTypeFilter} icon="filter">
          {(close) => (
            <>
              <button type="button" className={`led-popover-item ${!loanTypeFilter ? 'led-active' : ''}`} onClick={() => { setLoanTypeFilter(''); setPage(1); close(); }}>All types</button>
              {['personal', 'home', 'business', 'vehicle'].map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`led-popover-item ${loanTypeFilter === t ? 'led-active' : ''}`}
                  onClick={() => { setLoanTypeFilter(t); setPage(1); close(); }}
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
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                <button type="button" className={`led-popover-item ${!brokerFilter ? 'led-active' : ''}`} onClick={() => { setBrokerFilter(''); close(); }}>Any broker</button>
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
              </div>
            )}
          </FilterPill>
        )}

        {activeFilterCount > 0 && (
          <button type="button" className="led-btn led-btn-ghost led-btn-sm" onClick={clearFilters} style={{ color: 'var(--led-muted)' }}>
            <Icon name="close" size={12} /> Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{ padding: '0 24px 32px' }}>
        <div className="led-card">
          <div className="led-table-wrap" style={{ maxHeight: 'calc(100vh - 280px)' }}>
            <table className="led-table">
              <thead>
                <tr>
                  <SortHead k="user_name">Applicant</SortHead>
                  <th>Company</th>
                  <th>ID</th>
                  <th>Type</th>
                  <SortHead k="amount" align="right">Amount</SortHead>
                  <SortHead k="status">Status</SortHead>
                  <th>Broker</th>
                  <th>Referrer</th>
                  <SortHead k="updated_at" align="right">Updated</SortHead>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [1, 2, 3, 4, 5].map((i) => (
                    <tr key={i}>
                      <td><div className="flex items-center gap-2"><Skeleton width={22} height={22} circle /><Skeleton width={100} height={14} /></div></td>
                      <td><Skeleton width={80} height={14} /></td>
                      <td><Skeleton width={60} height={12} /></td>
                      <td><Skeleton width={60} height={14} /></td>
                      <td style={{ textAlign: 'right' }}><Skeleton width={60} height={14} /></td>
                      <td><Skeleton width={70} height={20} /></td>
                      <td><div className="flex items-center gap-2"><Skeleton width={22} height={22} circle /><Skeleton width={60} height={12} /></div></td>
                      <td><Skeleton width={60} height={12} /></td>
                      <td style={{ textAlign: 'right' }}><Skeleton width={50} height={12} /></td>
                      <td><Skeleton width={16} height={16} /></td>
                    </tr>
                  ))
                ) : sorted.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-10">
                      <EmptyState
                        title="No applications found"
                        description="Try adjusting your filters or search terms."
                        icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>}
                      />
                    </td>
                  </tr>
                ) : sorted.map((app) => {
                  const shortId = app.id.replace(/-/g, '').slice(-6).toUpperCase();
                  const ltIcon = LOAN_TYPE_ICON[app.loan_type] || 'user';
                  const ltLabel = LOAN_TYPE_LABEL[app.loan_type] || app.loan_type;
                  const chip = STATUS_CHIP[app.status] || STATUS_CHIP.draft;
                  const firstBroker = app.assigned_brokers?.[0];
                  const isDirectLead = app.user_role === 'referrer' || app.user_role === 'broker' || app.user_role === 'admin';
                  const clientName = isDirectLead
                    ? [app.applicant_first_name, app.applicant_last_name].filter(Boolean).join(' ') || app.user_name || ''
                    : app.user_name || '';
                  const referrerName = isDirectLead ? app.user_name || null : null;
                  const subtitle = isDirectLead ? null : (app.user_email || '');

                  return (
                    <tr key={app.id} onClick={() => navigate(`/admin/applications/${app.id}`)}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                          <Avatar name={clientName} size="sm" />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 500, color: 'var(--led-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                              {clientName}
                            </div>
                            {subtitle && (
                              <div style={{ fontSize: 12, color: 'var(--led-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                                {subtitle}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        {app.business_name ? (
                          <span style={{ fontSize: 13, color: 'var(--led-ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', maxWidth: 160 }}>
                            {app.business_name}
                          </span>
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--led-muted)' }}>—</span>
                        )}
                      </td>
                      <td>
                        <span className="led-mono" style={{ fontSize: 11.5, color: 'var(--led-muted)', letterSpacing: 0.3 }}>
                          APP-{shortId}
                        </span>
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--led-ink-2)' }}>
                          <Icon name={ltIcon} size={13} /> {ltLabel}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span className="led-mono led-tnum" style={{ fontWeight: 500 }}>
                          {fmtMoneyK(Number(app.amount) || 0)}
                        </span>
                      </td>
                      <td>
                        <span className={`led-chip ${chip.cls}`} style={{ height: 22 }}>
                          <span className="led-chip-dot" style={{ background: chip.dot }} />
                          {STATUS_LABEL[app.status] || app.status}
                        </span>
                      </td>
                      <td>
                        {firstBroker ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <Avatar name={firstBroker.full_name} size="sm" />
                            <span style={{ fontSize: 12.5 }}>
                              {firstBroker.full_name.split(' ')[0]}
                              {app.assigned_brokers.length > 1 && (
                                <span style={{ color: 'var(--led-muted)' }}> +{app.assigned_brokers.length - 1}</span>
                              )}
                            </span>
                          </div>
                        ) : (
                          <span className="led-chip" style={{ color: 'var(--led-muted)' }}>
                            <Icon name="plus" size={10} /> Unassigned
                          </span>
                        )}
                      </td>
                      <td>
                        {referrerName ? (
                          <span style={{ fontSize: 12.5, color: 'var(--led-ink-2)' }}>{referrerName}</span>
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--led-muted)' }}>None</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span className="led-mono led-tnum" style={{ fontSize: 12, color: 'var(--led-muted)' }}>
                          {relativeTime(app.updated_at)}
                        </span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="led-btn led-btn-ghost led-btn-sm led-btn-icon">
                          <Icon name="dotsV" size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="led-pagination">
            <span className="led-mono led-tnum">
              {total === 0 ? '0' : (page - 1) * perPage + 1}–{Math.min(page * perPage, total)} of {total}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                className="led-btn led-btn-ghost led-btn-sm led-btn-icon"
                onClick={() => setPage(1)}
                disabled={page === 1}
                style={{ opacity: page === 1 ? 0.4 : 1 }}
              >
                <Icon name="chevronsLeft" size={13} />
              </button>
              <button
                type="button"
                className="led-btn led-btn-ghost led-btn-sm led-btn-icon"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                style={{ opacity: page === 1 ? 0.4 : 1 }}
              >
                <Icon name="chevronLeft" size={13} />
              </button>
              <span className="led-mono led-tnum" style={{ padding: '0 8px' }}>
                {page} / {totalPages}
              </span>
              <button
                type="button"
                className="led-btn led-btn-ghost led-btn-sm led-btn-icon"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                style={{ opacity: page >= totalPages ? 0.4 : 1 }}
              >
                <Icon name="chevronRight" size={13} />
              </button>
              <button
                type="button"
                className="led-btn led-btn-ghost led-btn-sm led-btn-icon"
                onClick={() => setPage(totalPages)}
                disabled={page >= totalPages}
                style={{ opacity: page >= totalPages ? 0.4 : 1 }}
              >
                <Icon name="chevronsRight" size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
