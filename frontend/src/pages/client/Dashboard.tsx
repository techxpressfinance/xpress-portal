import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/Toast';
import { formatDate } from '../../lib/utils';
import { Card, Badge, Button, Skeleton, EmptyState } from '../../components/ui';
import type { LoanApplication } from '../../types';
import { ChatBubbleBottomCenterTextIcon, ClipboardDocumentListIcon, DocumentTextIcon } from '@heroicons/react/24/outline';

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

  // Broker on the most recent application that has one assigned (applications come ordered newest-first)
  const myBroker = applications.find((a) => a.assigned_broker_name)?.assigned_broker_name ?? null;
  const brokerInitials = myBroker
    ? myBroker.split(' ').filter(Boolean).slice(0, 2).map((n) => n.charAt(0).toUpperCase()).join('')
    : '';

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
            <h1 className="text-[26px] sm:text-[34px] font-semibold tracking-[-0.05em] text-[var(--led-ink)]">
              {greeting}, {user?.full_name?.split(' ')[0]}
            </h1>
            <p className="mt-2 max-w-2xl text-[14px] leading-6 text-[var(--led-muted)]">
              Here's an overview of your loan applications
            </p>
          </div>

          {myBroker && (
            <Link
              to="/messages"
              className="group inline-flex items-center gap-3 rounded-[16px] border border-[var(--led-line)] bg-[var(--led-surface-2)] px-4 py-3 transition-colors hover:bg-[var(--led-neutral-tint)]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--led-accent)] text-[14px] font-semibold text-[var(--led-accent-ink)]">
                {brokerInitials}
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Your Broker</p>
                <p className="text-[14px] font-semibold text-[var(--led-ink)]">{myBroker}</p>
              </div>
              <span className="ml-2 inline-flex items-center gap-1 text-[13px] font-medium text-[var(--led-accent)] opacity-0 transition-opacity group-hover:opacity-100">
                Message
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
              </span>
            </Link>
          )}
        </div>
        <Link to="/applications/new" data-tour="new-application">
          <Button size="lg" className="h-11 px-5">+ New Application</Button>
        </Link>
      </div>

      <div className="grid flex-1 grid-cols-1 items-start gap-5 lg:grid-cols-12">
        <div className="flex flex-col gap-5 lg:col-span-8">
          <div className="grid gap-5 sm:grid-cols-2">
            <Card padding="none" className="h-full">
              <div className="h-1 bg-[var(--led-accent)]" />
              <div className="p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Total Applications</p>
                <p className="mt-3 text-[32px] font-semibold tracking-[-0.05em] led-tnum text-[var(--led-ink)]">
                  {loading ? <Skeleton width={60} height={36} className="mt-1" /> : applications.length}
                </p>
                <p className="mt-4 text-[13px] leading-6 text-[var(--led-muted)]">Applications you have submitted</p>
              </div>
            </Card>
            <Card padding="none" className="h-full">
              <div className="h-1 bg-[var(--led-success)]" />
              <div className="p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Active</p>
                <p className="mt-3 text-[32px] font-semibold tracking-[-0.05em] led-tnum text-[var(--led-ink)]">
                  {loading ? <Skeleton width={60} height={36} className="mt-1" /> : activeCount}
                </p>
                <p className="mt-4 text-[13px] leading-6 text-[var(--led-muted)]">Applications currently in progress</p>
              </div>
            </Card>
          </div>

          <Card padding="none" className="flex flex-col">
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
              <EmptyState
                title="No applications yet"
                description="Get started by creating your first loan application."
                icon={
                  <DocumentTextIcon className="h-5 w-5" />
                }
                action={
                  <Link to="/applications/new">
                    <Button size="sm">Create Application</Button>
                  </Link>
                }
              />
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
                          ${Number(app.amount).toLocaleString('en-AU')} &middot; {formatDate(app.created_at)}
                        </p>
                      </div>
                    </div>
                    <Badge value={app.status} />
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-5 lg:col-span-4">
          <Card padding="none" className="flex flex-col">
            <div className="border-b border-[var(--led-line)] px-6 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Quick Access</p>
              <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Navigation</h2>
            </div>
            <div className="p-4 space-y-2">
              {[
                { label: 'All Applications', to: '/applications', icon: <DocumentTextIcon className="h-4 w-4" strokeWidth={2} /> },
                { label: 'Messages', to: '/messages', icon: <ChatBubbleBottomCenterTextIcon className="h-4 w-4" strokeWidth={2} /> },
                { label: 'Service Requests', to: '/service-requests', icon: <ClipboardDocumentListIcon className="h-4 w-4" strokeWidth={2} /> },
              ].map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="flex items-center gap-3 rounded-[14px] border border-[var(--led-line)] bg-[var(--led-surface-2)] px-4 py-3.5 text-[14px] font-medium text-[var(--led-ink)] transition-colors hover:bg-[var(--led-neutral-tint)]"
                >
                  <span className="text-[var(--led-muted)]">{link.icon}</span>
                  {link.label}
                  <svg className="ml-auto h-4 w-4 text-[var(--led-muted)]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
