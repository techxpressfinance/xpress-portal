import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { GlassCard, StatCard, PageHeader, Badge, Button } from '../../components/ui';
import { getInitials } from '../../lib/utils';
import { ACTION_ICON_CONFIG, ACTION_LABELS, STATUS_BADGE } from '../../lib/constants';
import type { ActivityLog, LoanApplication, User } from '../../types';


export default function AdminDashboard() {
  const { user } = useAuth();
  const [applications, setApplications] = useState<LoanApplication[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [brokers, setBrokers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/applications?per_page=100'),
      api.get('/activity-logs?per_page=10'),
      api.get('/users'),
    ])
      .then(([appRes, logRes, usersRes]) => {
        setApplications(appRes.data.items);
        setLogs(logRes.data.items);
        setBrokers(usersRes.data.filter((u: User) => u.role === 'broker'));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const counts = {
    total: applications.length,
    draft: applications.filter((a) => a.status === 'draft').length,
    submitted: applications.filter((a) => a.status === 'submitted').length,
    reviewing: applications.filter((a) => a.status === 'reviewing').length,
    approved: applications.filter((a) => a.status === 'approved').length,
    rejected: applications.filter((a) => a.status === 'rejected').length,
  };

  const stats = [
    { label: 'Total', value: counts.total, gradient: 'from-primary to-primary', icon: <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg> },
    { label: 'Submitted', value: counts.submitted, gradient: 'from-chart-2 to-chart-2', icon: <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" /></svg> },
    { label: 'Reviewing', value: counts.reviewing, gradient: 'from-chart-4 to-chart-4', icon: <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg> },
    { label: 'Approved', value: counts.approved, gradient: 'from-success to-success', icon: <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>, valueColor: 'text-success' },
    { label: 'Rejected', value: counts.rejected, gradient: 'from-destructive to-destructive', icon: <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>, valueColor: 'text-destructive' },
  ];

  // Group applications by broker for the assignments section (many-to-many)
  const brokerAssignments = brokers.map((broker) => {
    const assigned = applications.filter((a) => a.assigned_brokers?.some((ab) => ab.id === broker.id));
    return { broker, applications: assigned };
  });
  const unassigned = applications.filter((a) => (!a.assigned_brokers || a.assigned_brokers.length === 0) && a.status !== 'draft');

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`Welcome back, ${user?.full_name?.split(' ')[0]}`}
        action={
          <Link to="/admin/applications">
            <Button>View All Applications</Button>
          </Link>
        }
      />

      {/* Stats Grid */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5 mb-8">
        {stats.map((stat) => (
          <StatCard
            key={stat.label}
            label={stat.label}
            value={stat.value}
            loading={loading}
            gradient={stat.gradient}
            icon={stat.icon}
            valueColor={stat.valueColor}
          />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2 mb-8">
        {/* Status Breakdown */}
        <GlassCard>
          <h2 className="text-[15px] font-semibold text-foreground mb-5">Status Overview</h2>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-8 rounded-lg shimmer" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {(['draft', 'submitted', 'reviewing', 'approved', 'rejected'] as const).map((status) => {
                const count = counts[status];
                const pct = counts.total > 0 ? (count / counts.total) * 100 : 0;
                return (
                  <div key={status} className="flex items-center gap-4">
                    <div className="w-24">
                      <Badge value={status} />
                    </div>
                    <div className="flex-1">
                      <div className="h-2.5 rounded-full bg-secondary overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${STATUS_BADGE[status].split(' ')[0].replace('/10', '')}`}
                          style={{ width: `${pct}%`, backgroundColor: 'currentColor', opacity: 0.6 }}
                        />
                      </div>
                    </div>
                    <span className="text-[14px] font-semibold text-foreground w-10 text-right">{count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </GlassCard>

        {/* Broker Workload */}
        <GlassCard>
          <h2 className="text-[15px] font-semibold text-foreground mb-5">Broker Workload</h2>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg shimmer" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-32 rounded-lg shimmer" />
                    <div className="h-3 w-20 rounded-lg shimmer" />
                  </div>
                </div>
              ))}
            </div>
          ) : brokers.length === 0 ? (
            <div className="rounded-xl bg-secondary/50 p-6 text-center">
              <p className="text-[14px] text-muted-foreground">No brokers registered</p>
            </div>
          ) : (
            <div className="space-y-3">
              {brokerAssignments.map(({ broker, applications: apps }) => (
                <div key={broker.id} className="flex items-center gap-3 rounded-xl bg-secondary/30 p-3 transition-colors hover:bg-secondary/50" style={{ transitionTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}>
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
                    <span className="text-[11px] font-semibold text-primary-foreground">
                      {getInitials(broker.full_name)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium text-foreground truncate">{broker.full_name}</p>
                    <p className="text-[12px] text-muted-foreground">
                      {apps.length === 0
                        ? 'No assignments'
                        : `${apps.length} application${apps.length !== 1 ? 's' : ''}`}
                    </p>
                  </div>
                  <span className="text-[20px] font-semibold text-foreground">{apps.length}</span>
                </div>
              ))}
              {unassigned.length > 0 && (
                <div className="flex items-center gap-3 rounded-xl bg-warning/5 border border-warning/20 p-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning/10">
                    <svg className="h-4 w-4 text-warning" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium text-warning">Unassigned</p>
                    <p className="text-[12px] text-muted-foreground">{unassigned.length} application{unassigned.length !== 1 ? 's' : ''} need assignment</p>
                  </div>
                  <span className="text-[20px] font-semibold text-warning">{unassigned.length}</span>
                </div>
              )}
            </div>
          )}
        </GlassCard>
      </div>

      {/* Broker Assignments Detail */}
      <GlassCard padding="none" className="mb-8">
        <div className="flex items-center justify-between border-b border-border px-6 py-5">
          <h2 className="text-[15px] font-semibold text-foreground">Broker Assignments</h2>
          <Link to="/admin/applications" className="text-[13px] font-medium text-primary hover:text-primary/80 transition-colors" style={{ transitionTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}>
            Manage all
          </Link>
        </div>
        {loading ? (
          <div className="p-6">
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="h-9 w-9 rounded-lg shimmer" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-48 rounded-lg shimmer" />
                    <div className="h-3 w-32 rounded-lg shimmer" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[14px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 sm:px-6 py-3 text-[12px] font-medium text-muted-foreground">Application</th>
                  <th className="hidden sm:table-cell px-3 sm:px-6 py-3 text-[12px] font-medium text-muted-foreground">Client</th>
                  <th className="px-3 sm:px-6 py-3 text-[12px] font-medium text-muted-foreground">Status</th>
                  <th className="hidden md:table-cell px-3 sm:px-6 py-3 text-[12px] font-medium text-muted-foreground">Assigned Broker</th>
                  <th className="px-3 sm:px-6 py-3 text-[12px] font-medium text-muted-foreground"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {applications
                  .filter((a) => a.status !== 'draft')
                  .slice(0, 10)
                  .map((app) => (
                    <tr key={app.id} className="transition-colors hover:bg-secondary/50" style={{ transitionTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}>
                      <td className="px-3 sm:px-6 py-3">
                        <p className="text-[14px] font-medium text-foreground capitalize">{app.loan_type} Loan</p>
                        <p className="text-[12px] text-muted-foreground">${Number(app.amount).toLocaleString()}</p>
                        <p className="sm:hidden text-[12px] text-muted-foreground">{app.user_name || 'Unknown'}</p>
                      </td>
                      <td className="hidden sm:table-cell px-3 sm:px-6 py-3 text-[14px] text-foreground">{app.user_name || 'Unknown'}</td>
                      <td className="px-3 sm:px-6 py-3"><Badge value={app.status} /></td>
                      <td className="hidden md:table-cell px-3 sm:px-6 py-3">
                        {app.assigned_brokers?.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {app.assigned_brokers.map((ab) => (
                              <div key={ab.id} className="flex items-center gap-1.5">
                                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary">
                                  <span className="text-[9px] font-semibold text-primary-foreground">
                                    {getInitials(ab.full_name)}
                                  </span>
                                </div>
                                <span className="text-[13px] font-medium text-foreground">{ab.full_name}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[13px] text-muted-foreground italic">Unassigned</span>
                        )}
                      </td>
                      <td className="px-3 sm:px-6 py-3">
                        <Link to={`/admin/applications/${app.id}`}>
                          <Button variant="ghost" size="sm">View</Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                {applications.filter((a) => a.status !== 'draft').length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-[14px] text-muted-foreground">
                      No active applications
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* Recent Activity */}
      <GlassCard padding="none">
        <div className="flex items-center justify-between border-b border-border px-6 py-5">
          <h2 className="text-[15px] font-semibold text-foreground">Recent Activity</h2>
          <Link to="/admin/activity" className="text-[13px] font-medium text-primary hover:text-primary/80 transition-colors" style={{ transitionTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}>
            View all
          </Link>
        </div>
        {loading ? (
          <div className="p-6">
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="h-9 w-9 rounded-xl shimmer" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-48 rounded-lg shimmer" />
                    <div className="h-3 w-32 rounded-lg shimmer" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : logs.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-[14px] text-muted-foreground">No activity yet</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {logs.map((log) => {
              let details: Record<string, string> = {};
              try {
                if (log.details) details = JSON.parse(log.details);
              } catch {}

              return (
                <div key={log.id} className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-secondary/50" style={{ transitionTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}>
                  {ACTION_ICON_CONFIG[log.action] ? (
                    <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${ACTION_ICON_CONFIG[log.action].bg}`}>
                      {ACTION_ICON_CONFIG[log.action].icon}
                    </div>
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary">
                      <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-foreground">
                      {ACTION_LABELS[log.action] || log.action}
                    </p>
                    <p className="text-[13px] text-muted-foreground truncate">
                      {log.user_name && <span className="text-foreground font-medium">{log.user_name}</span>}
                      {log.user_name && ' \u00b7 '}
                      {details.from && details.to
                        ? `${details.from} \u2192 ${details.to}`
                        : details.broker_name
                          ? `to ${details.broker_name}`
                          : details.filename || log.entity_type}
                    </p>
                  </div>
                  <span className="text-[12px] text-muted-foreground whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
