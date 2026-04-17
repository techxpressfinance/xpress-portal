import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/Toast';
import { GlassCard, Badge, Button } from '../../components/ui';
import { ACTION_ICON_CONFIG, ACTION_LABELS, LOAN_TYPE_ICONS } from '../../lib/constants';
import type { ActivityLog, DashboardStats, LoanApplication, User } from '../../types';

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toLocaleString()}`;
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [dashStats, setDashStats] = useState<DashboardStats | null>(null);
  const [applications, setApplications] = useState<LoanApplication[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [brokers, setBrokers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);

  useEffect(() => {
    const isAdmin = user?.role === 'admin';
    Promise.allSettled([
      api.get('/dashboard/stats'),
      api.get('/applications?per_page=100'),
      isAdmin ? api.get('/activity-logs?per_page=15') : Promise.resolve(null),
      api.get('/users'),
    ])
      .then(([statsRes, appRes, logRes, usersRes]) => {
        const failed: string[] = [];
        if (statsRes.status === 'fulfilled') setDashStats(statsRes.value.data);
        else failed.push('stats');
        if (appRes.status === 'fulfilled') setApplications(appRes.value.data.items);
        else failed.push('applications');
        if (logRes.status === 'fulfilled' && logRes.value) setLogs(logRes.value.data.items);
        if (usersRes.status === 'fulfilled') setBrokers(usersRes.value.data.filter((u: User) => u.role === 'broker'));
        else failed.push('brokers');
        if (failed.length) toast(`Failed to load: ${failed.join(', ')}`, 'error');
      })
      .finally(() => setLoading(false));
  }, [user?.role]);

  const counts = {
    total: dashStats ? Object.values(dashStats.status_counts).reduce((a, b) => a + b, 0) : 0,
    draft: dashStats?.status_counts.draft ?? 0,
    application_received: dashStats?.status_counts.application_received ?? 0,
    application_assessed: dashStats?.status_counts.application_assessed ?? 0,
    submitted: dashStats?.status_counts.submitted ?? 0,
    approval: dashStats?.status_counts.approval ?? 0,
    settled: dashStats?.status_counts.settled ?? 0,
    rejected: dashStats?.status_counts.rejected ?? 0,
  };

  const totalVolume = dashStats ? Object.values(dashStats.volume_by_status).reduce((a, b) => a + b, 0) : 0;

  const brokerAssignments = brokers.map((broker) => {
    const assigned = applications.filter((a) => a.assigned_brokers?.some((ab) => ab.id === broker.id));
    return { broker, applications: assigned };
  });

  const weekDelta = dashStats
    ? dashStats.apps_last_week > 0
      ? Math.round(((dashStats.apps_this_week - dashStats.apps_last_week) / dashStats.apps_last_week) * 100)
      : dashStats.apps_this_week > 0 ? 100 : 0
    : 0;

  const loanTypes = ['personal', 'home', 'business', 'vehicle'] as const;
  const maxLoanTypeVolume = dashStats ? Math.max(...loanTypes.map((t) => dashStats.volume_by_loan_type[t] ?? 0), 1) : 1;

  const selectedApp = applications.find(a => a.id === selectedAppId);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  };

  return (
    <div className="flex flex-col h-full min-h-[calc(100vh-4rem)] pb-8">
      <div className="flex items-center justify-between mb-8 mt-2">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight text-foreground">
            {getGreeting()}, {user?.full_name?.split(' ')[0] || 'Admin'}
          </h1>
          <p className="text-[15px] text-muted-foreground mt-1">Here's what's happening with your applications today.</p>
        </div>
        <div className="flex gap-3">
          <Link to="/admin/applications">
            <Button className="rounded-full px-5 h-10 shadow-sm transition-transform hover:scale-105 active:scale-95">All Applications</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 items-start">
        {/* Left Column (Main Data) */}
        <div className="lg:col-span-8 flex flex-col gap-5">

          {/* Top HUD (Heads Up Display) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            <GlassCard className="flex flex-col justify-center p-5">
              <span className="text-[13px] font-medium text-muted-foreground mb-1">Total Pipeline</span>
              <span className="text-[32px] font-semibold led-tnum text-foreground tracking-tight">{loading ? '--' : formatVolume(totalVolume)}</span>
            </GlassCard>
            <GlassCard className="flex flex-col justify-center p-5">
              <span className="text-[13px] font-medium text-muted-foreground mb-1">Active Apps</span>
              <span className="text-[32px] font-semibold led-tnum text-foreground tracking-tight">{loading ? '--' : counts.total - counts.draft - counts.settled - counts.rejected}</span>
            </GlassCard>
            <GlassCard className="flex flex-col justify-center p-5">
              <span className="text-[13px] font-medium text-success mb-1">Settled</span>
              <span className="text-[32px] font-semibold led-tnum text-foreground tracking-tight">{loading ? '--' : counts.settled}</span>
            </GlassCard>
            <GlassCard className="flex flex-col justify-center p-5 relative overflow-hidden">
              <span className="text-[13px] font-medium text-muted-foreground mb-1">This Week</span>
              <div className="flex items-baseline gap-2">
                <span className="text-[32px] font-semibold led-tnum text-foreground tracking-tight">{loading ? '--' : dashStats?.apps_this_week ?? 0}</span>
                {!loading && weekDelta !== 0 && (
                  <span className={`text-[13px] font-medium ${weekDelta > 0 ? 'text-success' : 'text-destructive'}`}>
                    {weekDelta > 0 ? '+' : ''}{weekDelta}%
                  </span>
                )}
              </div>
            </GlassCard>
          </div>

          <div className="grid grid-cols-2 gap-5">
            {/* 30-Day Velocity */}
            <GlassCard padding="none" className="flex flex-col">
              <div className="px-5 pt-5 pb-2">
                <h2 className="text-[16px] font-semibold text-foreground tracking-tight">30-Day Velocity</h2>
              </div>
              <div className="p-5 pt-4">
                <div className="flex items-end gap-[2px] h-16 w-full">
                  {dashStats?.daily_trend?.map((d, i) => (
                    <div key={i} className="flex-1 bg-primary/20 rounded-[2px] hover:bg-primary transition-all duration-300 relative group" style={{ height: `${Math.max((d.count / (Math.max(...(dashStats.daily_trend.map(x => x.count)) || [1]))) * 100, 5)}%` }}>
                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-foreground text-background text-[11px] font-medium px-2 py-0.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-sm z-10 pointer-events-none">{d.count}</div>
                    </div>
                  ))}
                </div>
              </div>
            </GlassCard>

            {/* 6-Month Trend */}
            <GlassCard padding="none" className="flex flex-col">
              <div className="px-5 pt-5 pb-2">
                <h2 className="text-[16px] font-semibold text-foreground tracking-tight">6-Month Trend</h2>
              </div>
              <div className="p-5 pt-4">
                <div className="flex items-end gap-[4px] h-16 w-full">
                  {dashStats?.monthly_trend?.map((m, i) => (
                    <div key={i} className="flex-1 bg-primary/30 rounded-sm hover:bg-primary transition-all duration-300 relative group" style={{ height: `${Math.max((m.count / (Math.max(...(dashStats.monthly_trend.map(x => x.count)) || [1]))) * 100, 5)}%` }}>
                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-foreground text-background text-[11px] font-medium px-2 py-0.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-sm z-10 pointer-events-none">{m.count}</div>
                    </div>
                  ))}
                </div>
              </div>
            </GlassCard>

            {/* Volume by Loan Type */}
            <GlassCard padding="none" className="flex flex-col">
              <div className="px-5 pt-5 pb-2">
                <h2 className="text-[16px] font-semibold text-foreground tracking-tight">Volume by Type</h2>
              </div>
              <div className="p-5 pt-2 space-y-4">
                {loanTypes.map((type) => {
                  const count = dashStats?.count_by_loan_type[type] ?? 0;
                  const volume = dashStats?.volume_by_loan_type[type] ?? 0;
                  const pct = (volume / maxLoanTypeVolume) * 100;
                  return (
                    <div key={type}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-secondary/50 flex items-center justify-center text-muted-foreground">
                            {LOAN_TYPE_ICONS[type]}
                          </div>
                          <span className="text-[14px] font-medium text-foreground capitalize">{type}</span>
                          <span className="text-[12px] text-muted-foreground ml-1">({count})</span>
                        </div>
                        <span className="text-[14px] font-semibold led-tnum text-foreground">{formatVolume(volume)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-secondary/50 overflow-hidden">
                        <div className="h-full bg-primary rounded-full transition-all duration-1000 ease-out" style={{ width: `${Math.max(pct, count > 0 ? 2 : 0)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </GlassCard>

            {/* Status Breakdown */}
            <GlassCard padding="none" className="flex flex-col">
              <div className="px-5 pt-5 pb-2">
                <h2 className="text-[16px] font-semibold text-foreground tracking-tight">Status Breakdown</h2>
              </div>
              <div className="p-5 pt-2 space-y-4">
                {(['application_received', 'application_assessed', 'submitted', 'approval'] as const).map((status) => {
                  const count = counts[status];
                  const pct = counts.total > 0 ? (count / counts.total) * 100 : 0;
                  const volume = dashStats?.volume_by_status[status] ?? 0;
                  return (
                    <div key={status} className="flex items-center gap-3">
                      <div className="w-[140px] shrink-0 flex items-center">
                        <Badge value={status} className="truncate" />
                      </div>
                      <div className="flex-1 min-w-[50px]">
                        <div className="h-2 rounded-full bg-secondary/50 overflow-hidden">
                          <div className={`h-full bg-primary opacity-70 rounded-full transition-all duration-1000 ease-out`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <div className="flex flex-col items-end w-16 shrink-0">
                        <span className="text-[13px] font-semibold led-tnum text-foreground">{count}</span>
                        <span className="text-[11px] text-muted-foreground">{formatVolume(volume)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </GlassCard>
            
            {/* Lender Insights */}
            <GlassCard padding="none" className="flex flex-col">
              <div className="px-5 pt-5 pb-2">
                <h2 className="text-[16px] font-semibold text-foreground tracking-tight">Top Lenders</h2>
              </div>
              <div className="p-5 pt-2 space-y-3">
                {dashStats?.top_lenders?.map((lender, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-[10px]">{i + 1}</div>
                      <span className="text-[14px] font-medium text-foreground">{lender.name}</span>
                    </div>
                    <span className="text-[13px] font-semibold led-tnum">{lender.approvals}</span>
                  </div>
                ))}
                {(!dashStats?.top_lenders || dashStats.top_lenders.length === 0) && !loading && (
                  <div className="text-[13px] text-muted-foreground italic text-center py-2">No lender data</div>
                )}
              </div>
            </GlassCard>
            
            {/* Referral Leaderboard */}
            <GlassCard padding="none" className="flex flex-col">
              <div className="px-5 pt-5 pb-2">
                <h2 className="text-[16px] font-semibold text-foreground tracking-tight">Top Referrers</h2>
              </div>
              <div className="p-5 pt-2 space-y-3">
                {dashStats?.top_referrers?.map((ref, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded-full bg-accent/10 text-accent flex items-center justify-center font-bold text-[10px]">{i + 1}</div>
                      <span className="text-[14px] font-medium text-foreground">{ref.name}</span>
                    </div>
                    <span className="text-[13px] font-semibold led-tnum">{ref.count}</span>
                  </div>
                ))}
                {(!dashStats?.top_referrers || dashStats.top_referrers.length === 0) && !loading && (
                  <div className="text-[13px] text-muted-foreground italic text-center py-2">No referral data</div>
                )}
              </div>
            </GlassCard>
          </div>

          {/* Active Applications Dense Table */}
          <GlassCard padding="none" className="flex-1 min-h-[400px] flex flex-col overflow-hidden">
            <div className="px-5 pt-5 pb-4 flex items-center justify-between">
              <h2 className="text-[16px] font-semibold text-foreground tracking-tight">Active Queue</h2>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-left text-[14px]">
                <thead className="bg-surface/50 backdrop-blur-md sticky top-0 z-10 border-y border-border/50">
                  <tr>
                    <th className="px-5 py-3 text-[12px] font-medium text-muted-foreground">ID</th>
                    <th className="px-5 py-3 text-[12px] font-medium text-muted-foreground">Client</th>
                    <th className="px-5 py-3 text-[12px] font-medium text-muted-foreground">Type / Amount</th>
                    <th className="px-5 py-3 text-[12px] font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {applications.filter(a => !['draft', 'settled', 'rejected'].includes(a.status)).map((app) => (
                    <tr
                      key={app.id}
                      className={`cursor-pointer transition-colors hover:bg-secondary/30 ${selectedAppId === app.id ? 'bg-secondary/50' : ''}`}
                      onClick={() => setSelectedAppId(app.id)}
                    >
                      <td className="px-5 py-4 led-tnum text-muted-foreground">{app.id.substring(0, 8)}</td>
                      <td className="px-5 py-4 font-medium text-foreground">{app.user_name || 'Unknown'}</td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-secondary/50 flex items-center justify-center text-[10px] text-muted-foreground">
                            {LOAN_TYPE_ICONS[app.loan_type]}
                          </div>
                          <span className="led-tnum">${Number(app.amount).toLocaleString()}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4"><Badge value={app.status} className="py-1 px-3" /></td>
                    </tr>
                  ))}
                  {applications.length === 0 && !loading && (
                    <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">No active applications in queue.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </div>

        {/* Right Column (Insights & Activity) */}
        <div className="lg:col-span-4 flex flex-col gap-5">
          
          {/* Needs Attention (Tasks) */}
          <GlassCard padding="none" className="flex flex-col">
            <div className="px-5 pt-5 pb-2 flex justify-between items-center">
              <h2 className="text-[16px] font-semibold text-foreground tracking-tight">Needs Attention</h2>
            </div>
            <div className="p-3 pt-1 space-y-2">
              {dashStats?.action_items?.map((task) => (
                <div key={task.id} className="p-3 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-colors border border-border/30">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-[14px] font-medium text-foreground leading-snug">{task.title}</span>
                    {task.priority === 'urgent' && <span className="w-2 h-2 rounded-full bg-destructive mt-1.5 shrink-0" />}
                    {task.priority === 'high' && <span className="w-2 h-2 rounded-full bg-warning mt-1.5 shrink-0" />}
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[12px] text-muted-foreground capitalize">{task.status.replace('_', ' ')}</span>
                    {task.due_date && <span className="text-[11px] text-muted-foreground led-tnum">Due {new Date(task.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}
                  </div>
                </div>
              ))}
              {(!dashStats?.action_items || dashStats.action_items.length === 0) && !loading && (
                <div className="text-[13px] text-muted-foreground italic text-center py-4">You're all caught up!</div>
              )}
            </div>
          </GlassCard>

          {/* Broker Workload Compact */}
          <GlassCard padding="none" className="flex flex-col">
            <div className="px-5 pt-5 pb-2">
              <h2 className="text-[16px] font-semibold text-foreground tracking-tight">Workload</h2>
            </div>
            <div className="p-3 pt-1 space-y-1">
              {brokerAssignments.map(({ broker, applications: apps }) => (
                <div key={broker.id} className="flex items-center justify-between p-3 rounded-xl hover:bg-secondary/40 transition-colors cursor-default">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-medium text-[12px]">
                      {broker.full_name?.substring(0, 2).toUpperCase() || 'BR'}
                    </div>
                    <span className="text-[14px] font-medium">{broker.full_name}</span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-[14px] font-semibold led-tnum text-foreground">{apps.length}</span>
                    <span className="text-[11px] text-muted-foreground">apps</span>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>

          {/* Activity Feed */}
          <GlassCard padding="none" className="flex-1 min-h-[300px] flex flex-col">
            <div className="px-5 pt-5 pb-2">
              <h2 className="text-[16px] font-semibold text-foreground tracking-tight">Live Feed</h2>
            </div>
            <div className="overflow-auto p-3 pt-1 space-y-2 flex-1">
              {logs.map(log => (
                <div key={log.id} className="flex gap-4 p-3 rounded-xl hover:bg-secondary/40 transition-colors text-[13px]">
                  <div className="mt-1 w-8 h-8 rounded-full bg-secondary/50 flex items-center justify-center text-muted-foreground shrink-0">
                    {ACTION_ICON_CONFIG[log.action]?.icon || '•'}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <div>
                      <span className="font-semibold text-foreground">{log.user_name || 'System'}</span>
                      <span className="text-muted-foreground mx-1.5">{ACTION_LABELS[log.action]?.toLowerCase() || log.action}</span>
                      <span className="font-medium text-foreground">{log.entity_type}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground/80">{new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>
      </div>

      {/* Master-Detail Inspector Panel (Apple Sheet style) */}
      {selectedAppId && selectedApp && (
        <>
          <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 transition-opacity" onClick={() => setSelectedAppId(null)} />
          <div className="fixed inset-y-4 right-4 w-full max-w-md bg-card/90 backdrop-blur-2xl shadow-2xl border border-border/50 rounded-[32px] z-50 transform transition-transform duration-300 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-6 pb-4">
              <div className="flex items-center gap-3">
                <Badge value={selectedApp.status} className="py-1 px-3 shadow-sm" />
                <span className="text-[13px] font-medium text-muted-foreground led-tnum">{selectedApp.id.substring(0, 8)}</span>
              </div>
              <button onClick={() => setSelectedAppId(null)} className="w-8 h-8 rounded-full bg-secondary/80 flex items-center justify-center hover:bg-secondary text-muted-foreground transition-colors">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <div className="p-6 pt-2 flex-1 overflow-auto">
              <h2 className="text-[28px] font-semibold mb-2 tracking-tight">{selectedApp.user_name || 'Unknown Client'}</h2>
              <div className="flex items-center gap-2 mb-8">
                <div className="w-6 h-6 rounded-full bg-secondary/50 flex items-center justify-center text-[10px] text-muted-foreground">
                  {LOAN_TYPE_ICONS[selectedApp.loan_type]}
                </div>
                <p className="text-[16px] text-muted-foreground capitalize">{selectedApp.loan_type} Loan &middot; <span className="led-tnum font-semibold text-foreground">${Number(selectedApp.amount).toLocaleString()}</span></p>
              </div>

              <div className="space-y-6 bg-secondary/20 p-5 rounded-[24px] border border-border/30">
                <div>
                  <label className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider block mb-2">Assigned Broker</label>
                  {selectedApp.assigned_brokers?.length ? (
                    selectedApp.assigned_brokers.map(b => (
                      <div key={b.id} className="flex items-center gap-3 mb-2 last:mb-0">
                        <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-medium text-[12px]">
                          {b.full_name?.substring(0, 2).toUpperCase() || 'BR'}
                        </div>
                        <div className="text-[15px] font-medium">{b.full_name}</div>
                      </div>
                    ))
                  ) : <div className="text-[14px] text-warning italic">Unassigned</div>}
                </div>
                <div className="h-[1px] w-full bg-border/50" />
                <div>
                  <label className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider block mb-2">Created At</label>
                  <div className="text-[15px] font-medium">{new Date(selectedApp.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</div>
                </div>
              </div>
            </div>
            
            <div className="p-6 pt-4 bg-gradient-to-t from-card to-card/0">
              <Link to={`/admin/applications/${selectedApp.id}`} className="block">
                <Button className="w-full h-12 rounded-[16px] text-[15px] font-semibold shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]">
                  Open Full File
                </Button>
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
