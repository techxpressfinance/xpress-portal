import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useTenant } from '../contexts/TenantContext';
import { useTheme } from '../hooks/useTheme';
import GlobalSearch from './GlobalSearch';
import NotificationCenter from './NotificationCenter';
import OnboardingTour from './OnboardingTour';
import PageTransition from './PageTransition';
import {
  getTourSteps,
  isTourCompleted,
  markTourCompleted,
} from '../lib/tourSteps';
import { ArrowRightStartOnRectangleIcon, Bars3Icon, BuildingLibraryIcon, BuildingOfficeIcon, CalculatorIcon, ChartBarIcon, CheckCircleIcon, ClipboardDocumentListIcon, ClockIcon, CreditCardIcon, DocumentTextIcon, EnvelopeIcon, ExclamationTriangleIcon, LinkIcon, MagnifyingGlassIcon, MoonIcon, QuestionMarkCircleIcon, SunIcon, TrashIcon, UserCircleIcon, UserGroupIcon, UsersIcon } from '@heroicons/react/24/outline';

const navLinkClass = (isActive: boolean, collapsed: boolean) =>
  `relative flex h-8 items-center ${collapsed ? 'justify-center' : 'gap-2.5'} rounded-[7px] px-2 text-[13px] transition-colors duration-150 ${isActive
    ? 'font-semibold text-[var(--led-accent)] bg-[var(--led-accent-tint)] shadow-[inset_2px_0_0_var(--led-accent)]'
    : 'font-medium text-[var(--led-ink-2)] hover:text-[var(--led-ink)] hover:bg-[var(--led-surface-2)]'
  }`;

export default function Layout() {
  const { user, logout } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();
  const { theme, toggle: toggleTheme } = useTheme();
  const brandName = tenant?.name || 'Xpress Finance';
  const defaultLogo = theme === 'dark' ? '/xpress-dark.svg' : '/xpress-light.svg';
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true');
  const [unreadCount, setUnreadCount] = useState(0);
  const [tourOpen, setTourOpen] = useState(false);
  const unreadIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tourSteps = getTourSteps(user?.role);

  // Auto-launch tour on first login for client/referrer users
  useEffect(() => {
    if (!user || !tourSteps) return;
    if (!isTourCompleted(user.id)) {
      // Defer to next tick so the layout finishes mounting and nav links are in the DOM
      const id = setTimeout(() => {
        setTourOpen(true);
        // Mark as seen as soon as it auto-opens so it only ever auto-launches once,
        // even if the user dismisses it by refreshing instead of finishing/skipping.
        markTourCompleted(user.id);
      }, 400);
      return () => clearTimeout(id);
    }
  }, [user, tourSteps]);

  const startTour = () => {
    setSidebarOpen(true);
    setTourOpen(true);
  };

  const handleTourClose = () => {
    setTourOpen(false);
    setSidebarOpen(false);
    if (user) markTourCompleted(user.id);
  };

  // Keep mobile sidebar open while tour runs so nav-link targets are visible
  useEffect(() => {
    if (tourOpen) setSidebarOpen(true);
  }, [tourOpen]);

  const fetchUnreadCount = useCallback(() => {
    if (user && user.role !== 'super_admin') {
      api.get('/messages/unread-count')
        .then(({ data }) => setUnreadCount(data.count))
        .catch(() => { });
    }
  }, [user]);

  useEffect(() => {
    fetchUnreadCount();
    unreadIntervalRef.current = setInterval(fetchUnreadCount, 60_000);
    const onEvent = () => fetchUnreadCount();
    window.addEventListener('unread-count-changed', onEvent);
    return () => {
      if (unreadIntervalRef.current) clearInterval(unreadIntervalRef.current);
      window.removeEventListener('unread-count-changed', onEvent);
    };
  }, [fetchUnreadCount]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      localStorage.setItem('sidebar-collapsed', String(!prev));
      return !prev;
    });
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const confirmLogout = () => setShowLogoutConfirm(true);

  const isSuperAdmin = user?.role === 'super_admin';
  const isAdmin = user?.role === 'admin' || user?.role === 'broker';
  const isReferrer = user?.role === 'referrer';

  const linkClass = (props: { isActive: boolean }) =>
    navLinkClass(props.isActive, collapsed);

  return (
    <div className="ledger-theme flex h-[100dvh] overflow-hidden text-foreground" style={{ background: 'var(--led-bg)', color: 'var(--led-ink)' }}>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm lg:hidden"
          style={{ animation: 'fadeIn 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col transition-all duration-300 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] lg:static lg:translate-x-0 ${collapsed ? 'w-[72px]' : 'w-64'
          } ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={sidebarOpen ? { background: 'var(--led-bg-2)', borderRight: '1px solid var(--led-line)', animation: 'slideInLeft 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' } : { background: 'var(--led-bg-2)', borderRight: '1px solid var(--led-line)' }}
      >
        {/* Logo. Height-capped with w-auto rather than w-full: a tenant logo can
            be any aspect ratio, and letting width drive would stretch a tall
            mark past the row. max-w-full is what shrinks it in the 72px rail. */}
        <div className="flex h-28 shrink-0 items-center justify-center border-b border-[var(--led-line)] px-2">
          <Link to="/" className="flex h-full w-full items-center justify-center" onClick={() => setSidebarOpen(false)}>
            <img
              src={tenant?.logo_url || defaultLogo}
              alt={brandName}
              className={`${collapsed ? 'max-h-14' : 'max-h-[88px]'} w-full h-auto max-w-[220px] object-contain object-center scale-[1.15]`}
            />
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5" onClick={() => setSidebarOpen(false)}>
          {isSuperAdmin ? (
            <>
              <NavLink to="/platform" end className={linkClass} title="Dashboard">
                <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z" /></svg>
                {!collapsed && 'Dashboard'}
              </NavLink>
              <NavLink to="/platform/tenants" className={linkClass} title="Tenants">
                <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5M3.75 3v18m16.5-18v18M5.25 3h13.5M5.25 21h13.5M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" /></svg>
                {!collapsed && 'Tenants'}
              </NavLink>
            </>
          ) : isReferrer ? (
            <>
              <NavLink to="/referrer/applications" data-tour="nav-applications" className={linkClass} title="Applications">
                <DocumentTextIcon className="h-[18px] w-[18px] shrink-0" />
                {!collapsed && 'Applications'}
              </NavLink>
              <NavLink to="/referrer/clients" data-tour="nav-clients" className={linkClass} title="Clients">
                <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" /></svg>
                {!collapsed && 'Clients'}
              </NavLink>
              <NavLink to="/referrer/messages" data-tour="nav-messages" className={linkClass} title="Messages">
                <div className="relative shrink-0">
                  <EnvelopeIcon className="h-[18px] w-[18px]" />
                  {collapsed && unreadCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--led-accent)] px-1 text-[10px] font-semibold text-[var(--led-accent-ink)]">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </div>
                {!collapsed && <span className="flex-1">Messages</span>}
                {!collapsed && unreadCount > 0 && (
                  <span className="shrink-0 text-[11px] font-semibold tabular-nums text-[var(--led-muted)]">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </NavLink>
              <NavLink to="/referrer/service-requests" data-tour="nav-service-requests" className={linkClass} title="Service Requests">
                <ClipboardDocumentListIcon className="h-[18px] w-[18px] shrink-0" />
                {!collapsed && 'Service Requests'}
              </NavLink>
              <NavLink to="/referrer/business-details" className={linkClass} title="Business Details">
                <CreditCardIcon className="h-[18px] w-[18px] shrink-0" />
                {!collapsed && 'Business Details'}
              </NavLink>
            </>
          ) : !isAdmin ? (
            <>
              <NavLink to="/dashboard" data-tour="nav-dashboard" className={linkClass} title="Dashboard">
                <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z" /></svg>
                {!collapsed && 'Dashboard'}
              </NavLink>
              <NavLink to="/applications" data-tour="nav-applications" className={linkClass} title="Applications">
                <DocumentTextIcon className="h-[18px] w-[18px] shrink-0" />
                {!collapsed && 'Applications'}
              </NavLink>
              <NavLink to="/messages" data-tour="nav-messages" className={linkClass} title="Messages">
                <div className="relative shrink-0">
                  <EnvelopeIcon className="h-[18px] w-[18px]" />
                  {collapsed && unreadCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--led-accent)] px-1 text-[10px] font-semibold text-[var(--led-accent-ink)]">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </div>
                {!collapsed && <span className="flex-1">Messages</span>}
                {!collapsed && unreadCount > 0 && (
                  <span className="shrink-0 text-[11px] font-semibold tabular-nums text-[var(--led-muted)]">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </NavLink>
              <NavLink to="/service-requests" data-tour="nav-service-requests" className={linkClass} title="Service Requests">
                <ClipboardDocumentListIcon className="h-[18px] w-[18px] shrink-0" />
                {!collapsed && 'Service Requests'}
              </NavLink>
            </>
          ) : (
            <>
              <button
                onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
                className={`flex h-8 items-center ${collapsed ? 'justify-center' : 'gap-2.5'} rounded-[7px] px-2 text-[13px] font-medium transition-colors duration-150 border w-full bg-[var(--led-accent-tint)] border-[var(--led-accent-tint-2)] text-[var(--led-accent)] hover:bg-[var(--led-accent-tint-2)]`}
                title="Search (⌘K)"
              >
                <MagnifyingGlassIcon className="h-[18px] w-[18px] shrink-0" />
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left">Command Search</span>
                    <kbd className="rounded-md border border-[var(--led-accent-tint-2)] bg-[var(--led-surface)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--led-accent)] shadow-sm">⌘K</kbd>
                  </>
                )}
              </button>

              <div className="led-nav-group">
                {!collapsed && <p className="led-nav-title"></p>}
                <NavLink to="/admin" end className={linkClass} title="Dashboard">
                  <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z" /></svg>
                  {!collapsed && 'Dashboard'}
                </NavLink>
              </div>

              <div className="led-nav-group">
                {!collapsed && <p className="led-nav-title">Pipeline</p>}
                <NavLink to="/admin/applications" className={linkClass} title="Applications">
                  <DocumentTextIcon className="h-[18px] w-[18px] shrink-0" />
                  {!collapsed && 'Applications'}
                </NavLink>
                <NavLink to="/admin/board" className={linkClass} title="Board">
                  <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125c-.621 0-1.125.504-1.125 1.125v12.75c0 .621.504 1.125 1.125 1.125Z" /></svg>
                  {!collapsed && 'Board'}
                </NavLink>
                <NavLink to="/admin/tasks" className={linkClass} title="Tasks">
                  <CheckCircleIcon className="h-[18px] w-[18px] shrink-0" />
                  {!collapsed && 'Tasks'}
                </NavLink>
                <NavLink to="/admin/quotes" className={linkClass} title="Quotes">
                  <ClipboardDocumentListIcon className="h-[18px] w-[18px] shrink-0" />
                  {!collapsed && 'Quotes'}
                </NavLink>
              </div>

              <div className="led-nav-group">
                {!collapsed && <p className="led-nav-title">People</p>}
                <NavLink to="/admin/contacts" className={linkClass} title="Contacts">
                  <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Zm6-10.125a1.875 1.875 0 1 1-3.75 0 1.875 1.875 0 0 1 3.75 0Zm-1.875 4.875a3.375 3.375 0 0 0-3.375 3.375h6.75a3.375 3.375 0 0 0-3.375-3.375Z" /></svg>
                  {!collapsed && 'Contacts'}
                </NavLink>
                <NavLink to="/admin/companies" className={linkClass} title="Entities">
                  <BuildingOfficeIcon className="h-[18px] w-[18px] shrink-0" />
                  {!collapsed && 'Entities'}
                </NavLink>
                {(user?.role === 'admin' || user?.role === 'broker') && (
                  <NavLink to="/admin/users" className={linkClass} title="Clients">
                    <UsersIcon className="h-[18px] w-[18px] shrink-0" />
                    {!collapsed && 'Clients'}
                  </NavLink>
                )}
                {user?.role === 'admin' && (
                  <NavLink to="/admin/brokers" className={linkClass} title="Brokers">
                    <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0 1 12 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 0 1-.673-.38m0 0A2.18 2.18 0 0 1 3 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                    {!collapsed && 'Brokers'}
                  </NavLink>
                )}
                {(user?.role === 'admin' || user?.role === 'broker') && (
                  <NavLink to="/admin/referrers" className={linkClass} title="Referrers">
                    <LinkIcon className="h-[18px] w-[18px] shrink-0" />
                    {!collapsed && 'Referrers'}
                  </NavLink>
                )}
                {user?.role === 'admin' && (
                  <NavLink to="/admin/broker-groups" className={linkClass} title="Broker Groups">
                    <UserGroupIcon className="h-[18px] w-[18px] shrink-0" />
                    {!collapsed && 'Broker Groups'}
                  </NavLink>
                )}
              </div>

              <div className="led-nav-group">
                {!collapsed && <p className="led-nav-title">Operations</p>}
                <NavLink to="/admin/messages" className={linkClass} title="Messages">
                  <div className="relative shrink-0">
                    <EnvelopeIcon className="h-[18px] w-[18px]" />
                    {collapsed && unreadCount > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--led-accent)] px-1 text-[10px] font-semibold text-[var(--led-accent-ink)]">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </div>
                  {!collapsed && <span className="flex-1">Messages</span>}
                  {!collapsed && unreadCount > 0 && (
                    <span className="shrink-0 text-[11px] font-semibold tabular-nums text-[var(--led-muted)]">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </NavLink>
                <NavLink to="/admin/service-requests" className={linkClass} title="Service Requests">
                  <ClipboardDocumentListIcon className="h-[18px] w-[18px] shrink-0" />
                  {!collapsed && 'Service Requests'}
                </NavLink>
                <NavLink to="/admin/calculators" className={linkClass} title="Calculators">
                  <CalculatorIcon className="h-[18px] w-[18px] shrink-0" />
                  {!collapsed && 'Calculators'}
                </NavLink>
                <NavLink to="/admin/lenders" className={linkClass} title="Lenders">
                  <BuildingLibraryIcon className="h-[18px] w-[18px] shrink-0" />
                  {!collapsed && 'Lenders'}
                </NavLink>
                <NavLink to="/admin/arrears" className={linkClass} title="Arrears Book">
                  <ExclamationTriangleIcon className="h-[18px] w-[18px] shrink-0" />
                  {!collapsed && 'Arrears Book'}
                </NavLink>
                <NavLink to="/admin/analytics" className={linkClass} title="Analytics">
                  <ChartBarIcon className="h-[18px] w-[18px] shrink-0" />
                  {!collapsed && 'Analytics'}
                </NavLink>
              </div>

              {user?.role === 'admin' && (
                <div className="led-nav-group">
                  {!collapsed && <p className="led-nav-title">Control</p>}
                  <NavLink to="/admin/activity" className={linkClass} title="Activity">
                    <ClockIcon className="h-[18px] w-[18px] shrink-0" />
                    {!collapsed && 'Activity'}
                  </NavLink>
                  <NavLink to="/admin/deleted-applications" className={linkClass} title="Deleted">
                    <TrashIcon className="h-[18px] w-[18px] shrink-0" />
                    {!collapsed && 'Deleted'}
                  </NavLink>
                </div>
              )}
            </>
          )}

          <div className="!mt-5 !pt-4 border-t border-border">
            <NavLink to="/profile" data-tour="nav-profile" className={linkClass} title="Profile">
              <UserCircleIcon className="h-[18px] w-[18px] shrink-0" />
              {!collapsed && 'Profile'}
            </NavLink>
            {tourSteps && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); startTour(); }}
                className={`mt-0.5 flex w-full items-center ${collapsed ? 'justify-center' : 'gap-3'} rounded-lg ${collapsed ? 'px-2' : 'px-3'} py-2 text-[13px] font-medium transition-all duration-200 border border-transparent text-[var(--led-muted)] hover:text-[var(--led-ink)] hover:bg-[var(--led-surface-2)]`}
                title="Take the tour"
              >
                <QuestionMarkCircleIcon className="h-[18px] w-[18px] shrink-0" />
                {!collapsed && 'Take the tour'}
              </button>
            )}
          </div>
        </nav>

        {/* Keep notifications outside the scrollable navigation so they are always reachable. */}
        {!isSuperAdmin && (
          <div className="shrink-0 border-t border-[var(--led-line)] px-3 pt-2 pb-1" data-tour="nav-notifications">
            <NotificationCenter collapsed={collapsed} />
          </div>
        )}

        {/* Collapse toggle (desktop only) */}
        <div className="hidden lg:flex items-center justify-center border-t border-[var(--led-line)] px-3 pt-2">
          <button
            onClick={toggleCollapsed}
            className="w-full flex items-center justify-center rounded-lg p-2 text-[var(--led-muted)] hover:bg-[var(--led-surface-2)] hover:text-[var(--led-ink)] transition-all duration-200"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg className={`h-4 w-4 transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" />
            </svg>
          </button>
        </div>

        {/* User section */}
        {user && (
          <div className="px-3 pb-3">
            {collapsed ? (
              <div className="flex flex-col items-center gap-1.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--led-surface-2)] border border-[var(--led-line)] text-[12px] font-semibold text-[var(--led-ink)] shadow-sm" title={user.full_name}>
                  {user.full_name.charAt(0).toUpperCase()}
                </div>
                <button
                  onClick={toggleTheme}
                  className="rounded-lg p-2 text-[var(--led-muted)] hover:bg-[var(--led-surface-2)] hover:text-[var(--led-ink)] transition-all duration-200"
                  title={theme === 'light' ? 'Dark mode' : 'Light mode'}
                >
                  {theme === 'light' ? (
                    <MoonIcon className="h-4 w-4" />
                  ) : (
                    <SunIcon className="h-4 w-4" />
                  )}
                </button>
                <button
                  onClick={confirmLogout}
                  className="rounded-lg p-2 text-[var(--led-muted)] hover:bg-[var(--led-danger-tint)] hover:text-[var(--led-danger)] transition-all duration-200"
                  title="Sign out"
                >
                  <ArrowRightStartOnRectangleIcon className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 rounded-[9px] border border-[var(--led-line)] bg-[var(--led-surface)] p-2 shadow-[var(--led-shadow-sm)]">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--led-accent-tint-2)] text-[11px] font-semibold text-[var(--led-accent)]">
                  {user.full_name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-[12.5px] font-medium text-[var(--led-ink)]">{user.full_name}</p>
                  <p className="text-[11px] text-[var(--led-muted)] capitalize">{user.role}</p>
                </div>
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={toggleTheme}
                    className="rounded-lg p-1.5 text-[var(--led-muted)] hover:text-[var(--led-ink)] transition-colors"
                    title={theme === 'light' ? 'Dark mode' : 'Light mode'}
                  >
                    {theme === 'light' ? (
                      <MoonIcon className="h-4 w-4" />
                    ) : (
                      <SunIcon className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    onClick={confirmLogout}
                    className="rounded-lg p-1.5 text-[var(--led-muted)] hover:text-[var(--led-danger)] hover:bg-[var(--led-danger-tint)] transition-colors"
                    title="Sign out"
                  >
                    <ArrowRightStartOnRectangleIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden relative z-[1]">
        {/* Mobile header */}
        <header className="flex h-[72px] shrink-0 items-center justify-center border-b border-[var(--led-line)] bg-[var(--led-bg-2)] px-4 lg:hidden relative">
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute left-4 rounded-xl p-2 text-muted-foreground hover:bg-secondary transition-colors"
          >
            <Bars3Icon className="h-5 w-5" />
          </button>
          <img src={tenant?.logo_url || defaultLogo} alt={brandName} className="h-14 w-auto max-w-[200px] object-contain object-center scale-[1.1]" />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-10">
          <div className="mx-auto w-full max-w-[1600px] min-w-0">
            <PageTransition>
              <Outlet />
            </PageTransition>
          </div>
        </main>
      </div>
      <GlobalSearch />
      {tourSteps && (
        <OnboardingTour
          steps={tourSteps}
          open={tourOpen}
          onClose={handleTourClose}
          onFinish={() => user && markTourCompleted(user.id)}
        />
      )}
      {showLogoutConfirm && createPortal(
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm"
            style={{ animation: 'fadeIn 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
            onClick={() => setShowLogoutConfirm(false)}
          />
          <div
            className="relative w-full max-w-[360px] rounded-t-2xl border border-[var(--led-line)] bg-[var(--led-surface)] p-6 pb-8 shadow-[var(--led-shadow-lg)] sm:rounded-2xl sm:pb-6"
            style={{ animation: 'fadeInUp 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
          >
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--led-warning-tint)]">
              <ArrowRightStartOnRectangleIcon className="h-6 w-6 text-[var(--led-warning)]" />
            </div>
            <h3 className="mb-1 text-center text-[17px] font-semibold text-[var(--led-ink)]">
              Sign out?
            </h3>
            <p className="mb-6 text-center text-[14px] text-[var(--led-muted)]">
              You'll need to sign in again to access your account.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 rounded-[9px] border border-[var(--led-line-2)] bg-[var(--led-surface)] px-4 py-2.5 text-[14px] font-medium text-[var(--led-ink-2)] shadow-[var(--led-shadow-sm)] transition-colors duration-200 hover:border-[var(--led-line-strong)] hover:text-[var(--led-ink)]"
              >
                Cancel
              </button>
              <button
                onClick={handleLogout}
                className="flex-1 rounded-[9px] bg-[var(--led-danger)] px-4 py-2.5 text-[14px] font-medium text-[var(--color-destructive-foreground)] shadow-[var(--led-shadow-sm)] transition-opacity duration-200 hover:opacity-85"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
