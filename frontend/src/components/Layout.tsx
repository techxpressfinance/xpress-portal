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

const navLinkClass = (isActive: boolean, collapsed: boolean) =>
  `relative flex items-center ${collapsed ? 'justify-center' : 'gap-3'} rounded-md ${collapsed ? 'px-2' : 'px-3'} py-[7px] text-[13px] font-medium transition-colors duration-150 ${isActive
    ? "text-[var(--led-accent-ink)] bg-[var(--led-accent-tint)] before:content-[''] before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-[18px] before:w-[3px] before:rounded-r-full before:bg-[var(--led-accent)]"
    : 'text-[var(--led-muted)] hover:text-[var(--led-ink)] hover:bg-[var(--led-surface-2)]'
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
    <div className="ledger-theme flex h-screen overflow-hidden text-foreground" style={{ background: 'var(--led-bg)', color: 'var(--led-ink)' }}>
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
        style={sidebarOpen ? { background: 'var(--led-surface)', borderRight: '1px solid var(--led-line)', animation: 'slideInLeft 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' } : { background: 'var(--led-surface)', borderRight: '1px solid var(--led-line)' }}
      >
        {/* Logo */}
        <div className="flex h-24 items-center px-2">
          <Link to="/" className="flex h-full w-full items-center" onClick={() => setSidebarOpen(false)}>
            <img
              src={tenant?.logo_url || defaultLogo}
              alt={brandName}
              className="h-full w-full object-contain"
            />
          </Link>
        </div>

        {/* Navigation */}
        <nav className={`flex-1 overflow-y-auto ${collapsed ? 'px-2' : 'px-3'} py-2 space-y-0.5`} onClick={() => setSidebarOpen(false)}>
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
                <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                {!collapsed && 'Applications'}
              </NavLink>
              <NavLink to="/referrer/clients" data-tour="nav-clients" className={linkClass} title="Clients">
                <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" /></svg>
                {!collapsed && 'Clients'}
              </NavLink>
              <NavLink to="/referrer/messages" data-tour="nav-messages" className={linkClass} title="Messages">
                <div className="relative shrink-0">
                  <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" /></svg>
                  {collapsed && unreadCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--led-accent)] px-1 text-[10px] font-semibold text-white">
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
                <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" /></svg>
                {!collapsed && 'Service Requests'}
              </NavLink>
            </>
          ) : !isAdmin ? (
            <>
              <NavLink to="/dashboard" data-tour="nav-dashboard" className={linkClass} title="Dashboard">
                <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z" /></svg>
                {!collapsed && 'Dashboard'}
              </NavLink>
              <NavLink to="/applications" data-tour="nav-applications" className={linkClass} title="Applications">
                <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                {!collapsed && 'Applications'}
              </NavLink>
              <NavLink to="/messages" data-tour="nav-messages" className={linkClass} title="Messages">
                <div className="relative shrink-0">
                  <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" /></svg>
                  {collapsed && unreadCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--led-accent)] px-1 text-[10px] font-semibold text-white">
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
                <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" /></svg>
                {!collapsed && 'Service Requests'}
              </NavLink>
            </>
          ) : (
            <>
              <button
                onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
                className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3'} rounded-xl ${collapsed ? 'px-2' : 'px-3'} py-2.5 text-[13px] font-medium transition-all duration-200 border w-full bg-[var(--led-accent-tint)] border-[var(--led-accent-tint-2)] text-[var(--led-accent-ink)] hover:bg-[var(--led-accent-tint-2)]`}
                title="Search (⌘K)"
              >
                <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left">Command Search</span>
                    <kbd className="rounded-md border border-[var(--led-accent-tint-2)] bg-[var(--led-surface)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--led-accent-ink)] shadow-sm">⌘K</kbd>
                  </>
                )}
              </button>

              <div className="led-nav-group">
                {!collapsed && <p className="led-nav-title"></p>}
                <NavLink to="/admin" end className={linkClass} title="Dashboard">
                  <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z" /></svg>
                  {!collapsed && 'Dashboard'}
                </NavLink>
                <NavLink to="/admin/applications" className={linkClass} title="Applications">
                  <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                  {!collapsed && 'Applications'}
                </NavLink>
                <NavLink to="/admin/board" className={linkClass} title="Board">
                  <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125c-.621 0-1.125.504-1.125 1.125v12.75c0 .621.504 1.125 1.125 1.125Z" /></svg>
                  {!collapsed && 'Board'}
                </NavLink>
                <NavLink to="/admin/tasks" className={linkClass} title="Tasks">
                  <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                  {!collapsed && 'Tasks'}
                </NavLink>
              </div>

              <div className="led-nav-group">
                {!collapsed && <p className="led-nav-title">Coverage</p>}
                <NavLink to="/admin/contacts" className={linkClass} title="Contacts">
                  <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Zm6-10.125a1.875 1.875 0 1 1-3.75 0 1.875 1.875 0 0 1 3.75 0Zm-1.875 4.875a3.375 3.375 0 0 0-3.375 3.375h6.75a3.375 3.375 0 0 0-3.375-3.375Z" /></svg>
                  {!collapsed && 'Contacts'}
                </NavLink>
                <NavLink to="/admin/companies" className={linkClass} title="Companies">
                  <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" /></svg>
                  {!collapsed && 'Companies'}
                </NavLink>
                <NavLink to="/admin/quotes" className={linkClass} title="Quotes">
                  <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" /></svg>
                  {!collapsed && 'Quotes'}
                </NavLink>
                <NavLink to="/admin/messages" className={linkClass} title="Messages">
                  <div className="relative shrink-0">
                    <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" /></svg>
                    {collapsed && unreadCount > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--led-accent)] px-1 text-[10px] font-semibold text-white">
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
                  <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" /></svg>
                  {!collapsed && 'Service Requests'}
                </NavLink>
                <NavLink to="/admin/calculators" className={linkClass} title="Calculators">
                  <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 15.75V18m-7.5-6.75h.008v.008H8.25v-.008Zm0 2.25h.008v.008H8.25V13.5Zm0 2.25h.008v.008H8.25v-.008Zm0 2.25h.008v.008H8.25V18Zm2.498-6.75h.007v.008h-.007v-.008Zm0 2.25h.007v.008h-.007V13.5Zm0 2.25h.007v.008h-.007v-.008Zm0 2.25h.007v.008h-.007V18Zm2.504-6.75h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V13.5Zm0 2.25h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V18Zm2.498-6.75h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V13.5ZM8.25 6h7.5v2.25h-7.5V6ZM12 2.25c-1.892 0-3.758.11-5.593.322C5.307 2.7 4.5 3.65 4.5 4.757V19.5a2.25 2.25 0 0 0 2.25 2.25h10.5a2.25 2.25 0 0 0 2.25-2.25V4.757c0-1.108-.806-2.057-1.907-2.185A48.507 48.507 0 0 0 12 2.25Z" /></svg>
                  {!collapsed && 'Calculators'}
                </NavLink>
                <NavLink to="/admin/broker-analytics" className={linkClass} title="Broker Analytics">
                  <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" /></svg>
                  {!collapsed && 'Broker Analytics'}
                </NavLink>
                <NavLink to="/admin/lender-analytics" className={linkClass} title="Lender Analytics">
                  <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" /></svg>
                  {!collapsed && 'Analytics'}
                </NavLink>
                <NavLink to="/admin/lenders" className={linkClass} title="Lenders">
                  <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0 0 12 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75Z" /></svg>
                  {!collapsed && 'Lenders'}
                </NavLink>
              </div>

              <div className="led-nav-group">
                {!collapsed && <p className="led-nav-title">Control</p>}
                {user?.role === 'admin' && (
                  <NavLink to="/admin/activity" className={linkClass} title="Activity">
                    <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                    {!collapsed && 'Activity'}
                  </NavLink>
                )}
                {user?.role === 'admin' && (
                  <NavLink to="/admin/deleted-applications" className={linkClass} title="Deleted">
                    <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                    {!collapsed && 'Deleted'}
                  </NavLink>
                )}
                {(user?.role === 'admin' || user?.role === 'broker') && (
                  <NavLink to="/admin/users" className={linkClass} title="Clients">
                    <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" /></svg>
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
                    <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" /></svg>
                    {!collapsed && 'Referrers'}
                  </NavLink>
                )}
                {user?.role === 'admin' && (
                  <NavLink to="/admin/broker-groups" className={linkClass} title="Broker Groups">
                    <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" /></svg>
                    {!collapsed && 'Broker Groups'}
                  </NavLink>
                )}
              </div>
            </>
          )}

          <div className="!mt-5 !pt-4 border-t border-border">
            <NavLink to="/profile" data-tour="nav-profile" className={linkClass} title="Profile">
              <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
              {!collapsed && 'Profile'}
            </NavLink>
            {tourSteps && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); startTour(); }}
                className={`mt-0.5 flex w-full items-center ${collapsed ? 'justify-center' : 'gap-3'} rounded-lg ${collapsed ? 'px-2' : 'px-3'} py-2 text-[13px] font-medium transition-all duration-200 border border-transparent text-[var(--led-muted)] hover:text-[var(--led-ink)] hover:bg-[var(--led-surface-2)]`}
                title="Take the tour"
              >
                <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
                </svg>
                {!collapsed && 'Take the tour'}
              </button>
            )}
          </div>
        </nav>

        {/* Keep notifications outside the scrollable navigation so they are always reachable. */}
        {!isSuperAdmin && (
          <div className="shrink-0 border-t border-[var(--led-line)] px-3 py-2" data-tour="nav-notifications">
            <NotificationCenter collapsed={collapsed} />
          </div>
        )}

        {/* Collapse toggle (desktop only) */}
        <div className="hidden lg:flex items-center justify-center py-2 px-3">
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
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" /></svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" /></svg>
                  )}
                </button>
                <button
                  onClick={confirmLogout}
                  className="rounded-lg p-2 text-[var(--led-muted)] hover:bg-[var(--led-danger-tint)] hover:text-[var(--led-danger)] transition-all duration-200"
                  title="Sign out"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" /></svg>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-xl bg-[var(--led-surface-2)] border border-[var(--led-line)] p-3 shadow-sm">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--led-ink)] text-[12px] font-semibold text-[var(--led-surface)]">
                  {user.full_name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-[13px] font-medium text-[var(--led-ink)]">{user.full_name}</p>
                  <p className="text-[11px] text-[var(--led-muted)] capitalize">{user.role}</p>
                </div>
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={toggleTheme}
                    className="rounded-lg p-1.5 text-[var(--led-muted)] hover:text-[var(--led-ink)] transition-colors"
                    title={theme === 'light' ? 'Dark mode' : 'Light mode'}
                  >
                    {theme === 'light' ? (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" /></svg>
                    ) : (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" /></svg>
                    )}
                  </button>
                  <button
                    onClick={confirmLogout}
                    className="rounded-lg p-1.5 text-[var(--led-muted)] hover:text-[var(--led-danger)] hover:bg-[var(--led-danger-tint)] transition-colors"
                    title="Sign out"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" /></svg>
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
        <header className="flex h-12 items-center bg-background px-4 lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-xl p-2 text-muted-foreground hover:bg-secondary transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>
          </button>
          <img src={tenant?.logo_url || defaultLogo} alt={brandName} className="ml-2.5 h-9 w-auto object-contain" />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-10">
          <div className="mx-auto max-w-6xl">
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
            className="relative w-full max-w-[360px] rounded-t-2xl sm:rounded-2xl bg-background border border-border p-6 pb-8 sm:pb-6 shadow-xl"
            style={{ animation: 'fadeInUp 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
          >
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-chart-4/10">
              <svg className="h-6 w-6 text-chart-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
              </svg>
            </div>
            <h3 className="text-center text-[17px] font-semibold text-foreground mb-1">
              Sign out?
            </h3>
            <p className="text-center text-[14px] text-muted-foreground mb-6">
              You'll need to sign in again to access your account.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 rounded-xl bg-secondary px-4 py-2.5 text-[14px] font-medium text-foreground transition-all duration-200 hover:bg-secondary/80"
              >
                Cancel
              </button>
              <button
                onClick={handleLogout}
                className="flex-1 rounded-xl bg-destructive px-4 py-2.5 text-[14px] font-medium text-white transition-all duration-200 hover:opacity-85"
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
