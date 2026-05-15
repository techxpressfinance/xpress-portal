import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/Toast';
import { formatDate } from '../../lib/utils';
import { GlassCard, Badge, Button } from '../../components/ui';
import type { LoanApplication } from '../../types';

export default function ClientDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [applications, setApplications] = useState<LoanApplication[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/applications')
      .then(({ data }) => setApplications(data.items))
      .catch(() => toast('Failed to load applications', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const activeCount = applications.filter((a) => !['settled', 'rejected'].includes(a.status)).length;

  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'short', month: 'long', day: 'numeric', year: 'numeric',
  });

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good Morning';
    if (h < 18) return 'Good Afternoon';
    return 'Good Evening';
  })();

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col pb-8">
      <div className="mb-8 mt-2 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="led-chip led-chip-accent">Client</span>
            <span className="text-[12px] text-[var(--led-muted)]">{todayLabel}</span>
          </div>
          <div>
            <h1 className="text-[34px] font-semibold tracking-[-0.05em] text-[var(--led-ink)]">
              {greeting}, {user?.full_name?.split(' ')[0]}
            </h1>
            <p className="mt-2 max-w-2xl text-[14px] leading-6 text-[var(--led-muted)]">
              Here's an overview of your loan applications
            </p>
          </div>
        </div>
        <Link to="/applications/new">
          <Button size="lg" className="h-11 px-5">+ New Application</Button>
        </Link>
      </div>

      <div className="grid flex-1 grid-cols-1 items-start gap-5 lg:grid-cols-12">
        <div className="flex flex-col gap-5 lg:col-span-8">
          <div className="grid gap-5 sm:grid-cols-2">
            <GlassCard padding="none" className="h-full">
              <div className="h-1 bg-[var(--led-accent)]" />
              <div className="p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Total Applications</p>
                <p className="mt-3 text-[32px] font-semibold tracking-[-0.05em] led-tnum text-[var(--led-ink)]">
                  {loading ? '--' : applications.length}
                </p>
                <p className="mt-4 text-[13px] leading-6 text-[var(--led-muted)]">Applications you have submitted</p>
              </div>
            </GlassCard>
            <GlassCard padding="none" className="h-full">
              <div className="h-1 bg-[var(--led-success)]" />
              <div className="p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Active</p>
                <p className="mt-3 text-[32px] font-semibold tracking-[-0.05em] led-tnum text-[var(--led-ink)]">
                  {loading ? '--' : activeCount}
                </p>
                <p className="mt-4 text-[13px] leading-6 text-[var(--led-muted)]">Applications currently in progress</p>
              </div>
            </GlassCard>
          </div>

          <GlassCard padding="none" className="flex flex-col">
            <div className="border-b border-[var(--led-line)] px-6 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Files</p>
              <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Recent Applications</h2>
            </div>
            {loading ? (
              <div className="p-6 space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-xl shimmer" />
                      <div className="space-y-2">
                        <div className="h-4 w-24 rounded shimmer" />
                        <div className="h-3 w-16 rounded shimmer" />
                      </div>
                    </div>
                    <div className="h-6 w-16 rounded-full shimmer" />
                  </div>
                ))}
              </div>
            ) : applications.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--led-surface-2)]">
                  <svg className="h-8 w-8 text-[var(--led-muted)]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                </div>
                <p className="text-[14px] font-medium text-[var(--led-ink)] mb-1">No applications yet</p>
                <p className="text-[13px] text-[var(--led-muted)] mb-5">Get started by creating your first loan application</p>
                <Link to="/applications/new">
                  <Button size="sm">Create Application</Button>
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-[var(--led-line)]">
                {applications.slice(0, 5).map((app) => (
                  <Link
                    key={app.id}
                    to={`/applications/${app.id}`}
                    className="flex items-center justify-between px-6 py-4 transition-colors hover:bg-[var(--led-surface-2)]"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--led-surface-2)]">
                        <span className="text-[14px] font-semibold text-[var(--led-muted)] capitalize">
                          {app.loan_type.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="text-[14px] font-semibold text-[var(--led-ink)] capitalize">
                          {app.loan_type} Loan
                        </p>
                        <p className="text-[13px] text-[var(--led-muted)]">
                          ${Number(app.amount).toLocaleString()} &middot; {formatDate(app.created_at)}
                        </p>
                      </div>
                    </div>
                    <Badge value={app.status} />
                  </Link>
                ))}
              </div>
            )}
          </GlassCard>
        </div>

        <div className="flex flex-col gap-5 lg:col-span-4">
          <GlassCard padding="none" className="flex flex-col">
            <div className="border-b border-[var(--led-line)] px-6 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Quick Access</p>
              <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Navigation</h2>
            </div>
            <div className="p-4 space-y-2">
              {[
                { label: 'All Applications', to: '/applications', icon: <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg> },
                { label: 'Messages', to: '/messages', icon: <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" /></svg> },
                { label: 'Service Requests', to: '/service-requests', icon: <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" /></svg> },
              ].map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="flex items-center gap-3 rounded-[14px] border border-[var(--led-line)] bg-[var(--led-surface-2)] px-4 py-3.5 text-[14px] font-medium text-[var(--led-ink)] transition-colors hover:bg-[var(--led-bg-2)]"
                >
                  <span className="text-[var(--led-muted)]">{link.icon}</span>
                  {link.label}
                  <svg className="ml-auto h-4 w-4 text-[var(--led-muted)]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                </Link>
              ))}
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
