import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import api from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/Toast';
import { GlassCard, Badge, Button } from '../../components/ui';
import { ACTION_ICON_CONFIG, ACTION_LABELS, LOAN_TYPE_ICONS } from '../../lib/constants';
import type { ActivityLog, DashboardStats, LoanApplication, User } from '../../types';

type MetricTone = 'accent' | 'success' | 'warning' | 'neutral';

interface DeskMetricCardProps {
  label: string;
  value: string | number;
  detail: string;
  loading?: boolean;
  tone?: MetricTone;
  delta?: string;
}

interface TrendTooltipProps {
  active?: boolean;
  payload?: Array<{
    value: number;
    payload: {
      count: number;
      fullLabel: string;
    };
  }>;
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toLocaleString()}`;
}

function formatDayLabel(date: string): string {
  return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatFullDayLabel(date: string): string {
  return new Date(date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDays(value: number | null): string {
  if (value == null) return 'N/A';
  return `${value.toFixed(1)}d`;
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function TrendTooltip({ active, payload }: TrendTooltipProps) {
  if (!active || !payload?.length) return null;

  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div
      className="rounded-[14px] border border-[var(--led-line)] bg-[var(--led-surface)] px-3 py-2 shadow-[var(--led-shadow-md)]"
      style={{ color: 'var(--led-ink)' }}
    >
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--led-muted)]">Observed Volume</div>
      <div className="mt-1 text-[15px] font-semibold led-tnum">{point.count}</div>
      <div className="mt-1 text-[12px] text-[var(--led-muted)]">{point.fullLabel}</div>
    </div>
  );
}

function DeskMetricCard({ label, value, detail, loading = false, tone = 'neutral', delta }: DeskMetricCardProps) {
  const toneStyles: Record<MetricTone, { line: string; chip: string }> = {
    accent: {
      line: 'bg-[var(--led-accent)]',
      chip: 'led-chip led-chip-accent',
    },
    success: {
      line: 'bg-[var(--led-success)]',
      chip: 'led-chip led-chip-success',
    },
    warning: {
      line: 'bg-[var(--led-warning)]',
      chip: 'led-chip led-chip-warning',
    },
    neutral: {
      line: 'bg-[var(--led-line-strong)]',
      chip: 'led-chip',
    },
  };

  return (
    <GlassCard padding="none" className="h-full">
      <div className={`h-1 ${toneStyles[tone].line}`} />
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">{label}</p>
            <p className="mt-3 text-[32px] font-semibold tracking-[-0.05em] led-tnum text-[var(--led-ink)]">
              {loading ? '--' : value}
            </p>
          </div>
          {delta && !loading && <span className={toneStyles[tone].chip}>{delta}</span>}
        </div>
        <p className="mt-4 text-[13px] leading-6 text-[var(--led-muted)]">{detail}</p>
      </div>
    </GlassCard>
  );
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
  const activeApplications = applications.filter((app) => !['draft', 'settled', 'rejected'].includes(app.status));
  const totalActiveExposure = activeApplications.reduce((sum, app) => sum + Number(app.amount || 0), 0);
  const approvalsInFlight = counts.submitted + counts.approval;
  const settlementRate = counts.total > 0 ? (counts.settled / counts.total) * 100 : 0;
  const rejectedRate = counts.total > 0 ? (counts.rejected / counts.total) * 100 : 0;
  const unassignedActive = activeApplications.filter((app) => !app.assigned_brokers?.length).length;

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const overdueActions = dashStats?.action_items?.filter((task) => task.due_date && new Date(task.due_date) < startOfToday).length ?? 0;
  const urgentActions = dashStats?.action_items?.filter((task) => task.priority === 'urgent').length ?? 0;

  const brokerAssignments = brokers
    .map((broker) => {
      const assigned = activeApplications.filter((a) => a.assigned_brokers?.some((ab) => ab.id === broker.id));
      return { broker, applications: assigned };
    })
    .sort((a, b) => b.applications.length - a.applications.length || a.broker.full_name.localeCompare(b.broker.full_name));

  const maxBrokerLoad = Math.max(...brokerAssignments.map(({ applications: assignedApps }) => assignedApps.length), 1);

  const weekDelta = dashStats
    ? dashStats.apps_last_week > 0
      ? Math.round(((dashStats.apps_this_week - dashStats.apps_last_week) / dashStats.apps_last_week) * 100)
      : dashStats.apps_this_week > 0 ? 100 : 0
    : 0;

  const loanTypes = ['personal', 'home', 'business', 'vehicle'] as const;
  const maxLoanTypeVolume = dashStats ? Math.max(...loanTypes.map((t) => dashStats.volume_by_loan_type[t] ?? 0), 1) : 1;
  const topLenderApprovalMax = Math.max(...(dashStats?.top_lenders?.map((lender) => lender.approvals) ?? [1]), 1);

  const dailyTrendData = (dashStats?.daily_trend ?? []).map((entry) => ({
    label: formatDayLabel(entry.date),
    fullLabel: formatFullDayLabel(entry.date),
    count: entry.count,
  }));
  const dailyTotal = dailyTrendData.reduce((sum, entry) => sum + entry.count, 0);
  const dailyAverage = dailyTrendData.length ? dailyTotal / dailyTrendData.length : 0;
  const dailyPeak = dailyTrendData.reduce<{ count: number; fullLabel: string } | null>((peak, entry) => {
    if (!peak || entry.count > peak.count) {
      return { count: entry.count, fullLabel: entry.fullLabel };
    }
    return peak;
  }, null);

  const monthlyTrendData = (dashStats?.monthly_trend ?? []).map((entry) => ({
    label: entry.month,
    fullLabel: entry.month,
    count: entry.count,
  }));
  const monthlyAverage = monthlyTrendData.length
    ? monthlyTrendData.reduce((sum, entry) => sum + entry.count, 0) / monthlyTrendData.length
    : 0;
  const monthlyPeak = monthlyTrendData.reduce<{ count: number; fullLabel: string } | null>((peak, entry) => {
    if (!peak || entry.count > peak.count) {
      return { count: entry.count, fullLabel: entry.fullLabel };
    }
    return peak;
  }, null);

  const selectedApp = activeApplications.find((app) => app.id === selectedAppId);


  const stageRows = ([
    'application_received',
    'application_assessed',
    'submitted',
    'approval',
  ] as const).map((status) => {
    const count = counts[status];
    const volume = dashStats?.volume_by_status[status] ?? 0;
    const pct = counts.total > 0 ? (count / counts.total) * 100 : 0;
    return { status, count, volume, pct };
  });

  const signalRows = [
    {
      label: 'Unassigned Live Files',
      value: unassignedActive,
      detail: 'Files awaiting broker ownership',
      tone: unassignedActive > 0 ? 'warning' : 'neutral',
    },
    {
      label: 'Overdue Exceptions',
      value: overdueActions,
      detail: 'Tasks beyond scheduled due date',
      tone: overdueActions > 0 ? 'warning' : 'neutral',
    },
    {
      label: 'Approvals in Flight',
      value: approvalsInFlight,
      detail: 'Submitted or in approval stage',
      tone: 'accent' as MetricTone,
    },
    {
      label: 'Rejected Share',
      value: formatPercent(rejectedRate),
      detail: 'Share of the current book rejected',
      tone: rejectedRate > 20 ? 'warning' : 'neutral',
    },
  ];

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  })();

  const todayLabel = today.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col pb-8">
      <div className="mb-8 mt-2 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="led-chip led-chip-accent">Xpress</span>
            <span className="text-[12px] text-[var(--led-muted)]">{todayLabel}</span>
          </div>
          <div>
            <h1 className="text-[34px] font-semibold tracking-[-0.05em] text-[var(--led-ink)]">
              {greeting}, {user?.full_name?.split(' ')[0] || 'Desk'}
            </h1>
            <p className="mt-2 max-w-3xl text-[14px] leading-6 text-[var(--led-muted)]">
              {overdueActions > 0
                ? `${overdueActions} overdue exception ${overdueActions === 1 ? 'item' : 'items'} require desk attention. `
                : 'No overdue exceptions on the desk. '}
              {approvalsInFlight} files are in lender execution and {unassignedActive} live files remain without coverage.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="led-card px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Avg Turnaround</p>
            <p className="mt-1 text-[22px] font-semibold tracking-[-0.03em] led-tnum text-[var(--led-ink)]">
              {loading ? '--' : formatDays(dashStats?.avg_turnaround_days ?? null)}
            </p>
          </div>
          <div className="led-card px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Urgent Exceptions</p>
            <p className="mt-1 text-[22px] font-semibold tracking-[-0.03em] led-tnum text-[var(--led-ink)]">
              {loading ? '--' : urgentActions}
            </p>
          </div>
          <Link to="/admin/applications">
            <Button size="lg" className="h-11 px-5">
              Open Live Queue
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 items-start gap-5 lg:grid-cols-12">
        <div className="flex flex-col gap-5 lg:col-span-8">
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <DeskMetricCard
              label="Pipeline Exposure"
              value={formatVolume(totalVolume)}
              detail={`${counts.total} mandates in the current book`}
              loading={loading}
              tone="accent"
            />
            <DeskMetricCard
              label="Live Mandates"
              value={activeApplications.length}
              detail={`${formatVolume(totalActiveExposure)} currently active across the desk`}
              loading={loading}
              tone="neutral"
            />
            <DeskMetricCard
              label="Weekly Intake"
              value={dashStats?.apps_this_week ?? 0}
              detail={`${dashStats?.apps_last_week ?? 0} booked in the prior week`}
              loading={loading}
              tone={weekDelta >= 0 ? 'success' : 'warning'}
              delta={!loading && weekDelta !== 0 ? `${weekDelta > 0 ? '+' : ''}${weekDelta}%` : undefined}
            />
            <DeskMetricCard
              label="Settlements Booked"
              value={counts.settled}
              detail={`${formatPercent(settlementRate)} of the total book has settled`}
              loading={loading}
              tone="success"
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <GlassCard padding="none" className="flex flex-col">
              <div className="border-b border-[var(--led-line)] px-6 py-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Applications</p>
                    <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">30-Day Intake Velocity</h2>

                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">30D Total</p>
                    <p className="mt-1 text-[20px] font-semibold led-tnum text-[var(--led-ink)]">{loading ? '--' : dailyTotal}</p>
                  </div>
                </div>
              </div>
              <div className="h-[300px] px-4 py-4">
                {!loading && dailyTrendData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dailyTrendData} margin={{ top: 12, right: 12, left: -18, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="var(--led-line)" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 12, fill: 'var(--led-muted)' }}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={24}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 12, fill: 'var(--led-muted)' }}
                        tickLine={false}
                        axisLine={false}
                        width={32}
                      />
                      <Tooltip content={<TrendTooltip />} cursor={{ stroke: 'var(--led-line-strong)', strokeWidth: 1 }} />
                      <Area
                        type="monotone"
                        dataKey="count"
                        stroke="var(--led-accent)"
                        strokeWidth={2}
                        fill="var(--led-accent)"
                        fillOpacity={0.12}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-[13px] text-[var(--led-muted)]">
                    {loading ? 'Loading intake data...' : 'No recent intake activity'}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4 border-t border-[var(--led-line)] px-6 py-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Peak Session</p>
                  <p className="mt-1 text-[14px] font-medium text-[var(--led-ink)]">
                    {loading ? '--' : `${dailyPeak?.count ?? 0} on ${dailyPeak?.fullLabel ?? 'n/a'}`}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Run Rate</p>
                  <p className="mt-1 text-[14px] font-medium text-[var(--led-ink)]">
                    {loading ? '--' : `${dailyAverage.toFixed(1)} files per day`}
                  </p>
                </div>
              </div>
            </GlassCard>

            <GlassCard padding="none" className="flex flex-col">
              <div className="border-b border-[var(--led-line)] px-6 py-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Origination</p>
                    <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">6-Month Booking Trend</h2>

                  </div>
                  <div className="flex gap-6">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Peak Month</p>
                      <p className="mt-1 text-[20px] font-semibold led-tnum text-[var(--led-ink)]">
                        {loading ? '--' : monthlyPeak?.count ?? 0}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Avg / Month</p>
                      <p className="mt-1 text-[20px] font-semibold led-tnum text-[var(--led-ink)]">
                        {loading ? '--' : monthlyAverage.toFixed(1)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="h-[300px] px-4 py-4">
                {!loading && monthlyTrendData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyTrendData} margin={{ top: 12, right: 12, left: -18, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="var(--led-line)" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 12, fill: 'var(--led-muted)' }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 12, fill: 'var(--led-muted)' }}
                        tickLine={false}
                        axisLine={false}
                        width={32}
                      />
                      <Tooltip content={<TrendTooltip />} cursor={{ fill: 'rgba(15, 23, 42, 0.04)' }} />
                      <Bar dataKey="count" fill="var(--led-accent)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-[13px] text-[var(--led-muted)]">
                    {loading ? 'Loading monthly data...' : 'No monthly trend data yet'}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4 border-t border-[var(--led-line)] px-6 py-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Peak Month</p>
                  <p className="mt-1 text-[14px] font-medium text-[var(--led-ink)]">
                    {loading ? '--' : `${monthlyPeak?.fullLabel ?? 'n/a'} with ${monthlyPeak?.count ?? 0} files`}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Six-Month Mean</p>
                  <p className="mt-1 text-[14px] font-medium text-[var(--led-ink)]">
                    {loading ? '--' : `${monthlyAverage.toFixed(1)} files per month`}
                  </p>
                </div>
              </div>
            </GlassCard>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <GlassCard padding="none" className="flex flex-col">
              <div className="border-b border-[var(--led-line)] px-6 py-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Portfolio Mix</p>
                <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Volume by Product</h2>
              </div>
              <div className="space-y-4 p-6">
                {loanTypes.map((type) => {
                  const count = dashStats?.count_by_loan_type[type] ?? 0;
                  const volume = dashStats?.volume_by_loan_type[type] ?? 0;
                  const pct = maxLoanTypeVolume > 0 ? (volume / maxLoanTypeVolume) * 100 : 0;
                  return (
                    <div key={type}>
                      <div className="mb-2 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-[var(--led-line)] bg-[var(--led-surface-2)] text-[var(--led-muted)]">
                            {LOAN_TYPE_ICONS[type]}
                          </div>
                          <div>
                            <p className="text-[14px] font-medium capitalize text-[var(--led-ink)]">{type}</p>
                            <p className="text-[12px] text-[var(--led-muted)]">{count} files</p>
                          </div>
                        </div>
                        <span className="text-[14px] font-semibold led-tnum text-[var(--led-ink)]">{formatVolume(volume)}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-[var(--led-bg-2)]">
                        <div className="h-full rounded-full bg-[var(--led-accent)]" style={{ width: `${Math.max(pct, count > 0 ? 3 : 0)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </GlassCard>

            <GlassCard padding="none" className="flex flex-col">
              <div className="border-b border-[var(--led-line)] px-6 py-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Pipeline Staging</p>
                <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Stage Allocation</h2>
              </div>
              <div className="space-y-4 p-6">
                {stageRows.map((row) => (
                  <div key={row.status} className="grid grid-cols-[minmax(120px,160px)_1fr_auto] items-center gap-4">
                    <div className="min-w-0">
                      <Badge value={row.status} className="truncate" />
                    </div>
                    <div className="space-y-2">
                      <div className="h-2 overflow-hidden rounded-full bg-[var(--led-bg-2)]">
                        <div className="h-full rounded-full bg-[var(--led-accent)]" style={{ width: `${row.pct}%` }} />
                      </div>

                    </div>
                    <div className="text-right">
                      <p className="text-[14px] font-semibold led-tnum text-[var(--led-ink)]">{row.count}</p>
                      <p className="text-[12px] text-[var(--led-muted)]">{formatVolume(row.volume)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>

            <GlassCard padding="none" className="flex flex-col">
              <div className="border-b border-[var(--led-line)] px-6 py-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Lender Flow</p>
                <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Top Lenders</h2>
              </div>
              <div className="space-y-4 p-6">
                {dashStats?.top_lenders?.map((lender, index) => (
                  <div key={lender.name}>
                    <div className="mb-2 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--led-accent-tint)] text-[11px] font-semibold text-[var(--led-accent-ink)]">
                          {index + 1}
                        </div>
                        <span className="text-[14px] font-medium text-[var(--led-ink)]">{lender.name}</span>
                      </div>
                      <span className="text-[14px] font-semibold led-tnum text-[var(--led-ink)]">{lender.approvals}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--led-bg-2)]">
                      <div
                        className="h-full rounded-full bg-[var(--led-accent)]"
                        style={{ width: `${Math.max((lender.approvals / topLenderApprovalMax) * 100, lender.approvals > 0 ? 6 : 0)}%` }}
                      />
                    </div>
                  </div>
                ))}
                {(!dashStats?.top_lenders || dashStats.top_lenders.length === 0) && !loading && (
                  <div className="rounded-[14px] border border-dashed border-[var(--led-line)] px-4 py-8 text-center text-[13px] text-[var(--led-muted)]">
                    No lender approval data yet.
                  </div>
                )}
              </div>
            </GlassCard>

            <GlassCard padding="none" className="flex flex-col">
              <div className="border-b border-[var(--led-line)] px-6 py-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Execution Signals</p>
                <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Desk Risk Markers</h2>
              </div>
              <div className="grid gap-4 p-6 sm:grid-cols-2">
                {signalRows.map((signal) => (
                  <div key={signal.label} className="rounded-[16px] border border-[var(--led-line)] bg-[var(--led-surface-2)] p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">{signal.label}</p>
                    <p className="mt-3 text-[26px] font-semibold tracking-[-0.04em] led-tnum text-[var(--led-ink)]">{signal.value}</p>
                    <p className="mt-3 text-[13px] leading-6 text-[var(--led-muted)]">{signal.detail}</p>
                  </div>
                ))}
              </div>
            </GlassCard>
          </div>

          <GlassCard padding="none" className="flex min-h-[440px] flex-col overflow-hidden">
            <div className="border-b border-[var(--led-line)] px-6 py-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Execution Queue</p>
                  <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Live Application Book</h2>
                </div>
                <p className="text-[13px] text-[var(--led-muted)]">{activeApplications.length} live files currently on the desk</p>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-left text-[14px]">
                <thead className="sticky top-0 z-10 bg-[var(--led-surface-2)]">
                  <tr className="border-b border-[var(--led-line)]">
                    <th className="px-6 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">File</th>
                    <th className="px-6 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Client</th>
                    <th className="px-6 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Product</th>
                    <th className="px-6 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Exposure</th>
                    <th className="px-6 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Coverage</th>
                    <th className="px-6 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Stage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--led-line)]">
                  {activeApplications.map((app) => (
                    <tr
                      key={app.id}
                      className={`cursor-pointer transition-colors hover:bg-[var(--led-surface-2)] ${selectedAppId === app.id ? 'bg-[var(--led-accent-tint)]' : ''}`}
                      onClick={() => setSelectedAppId(app.id)}
                    >
                      <td className="px-6 py-4 align-top">
                        <div className="text-[13px] font-semibold led-tnum text-[var(--led-ink)]">{app.id.substring(0, 8)}</div>
                        <div className="mt-1 text-[12px] text-[var(--led-muted)]">
                          {new Date(app.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </div>
                      </td>
                      <td className="px-6 py-4 align-top">
                        <div className="font-medium text-[var(--led-ink)]">{app.user_name || 'Unknown client'}</div>
                        <div className="mt-1 text-[12px] text-[var(--led-muted)]">{app.user_email || 'No email on file'}</div>
                      </td>
                      <td className="px-6 py-4 align-top">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-[10px] border border-[var(--led-line)] bg-[var(--led-surface-2)] text-[11px] text-[var(--led-muted)]">
                            {LOAN_TYPE_ICONS[app.loan_type]}
                          </div>
                          <span className="capitalize text-[var(--led-ink)]">{app.loan_type}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 align-top">
                        <div className="text-[14px] font-semibold led-tnum text-[var(--led-ink)]">${Number(app.amount).toLocaleString()}</div>
                        <div className="mt-1 text-[12px] text-[var(--led-muted)]">Requested amount</div>
                      </td>
                      <td className="px-6 py-4 align-top">
                        <div className="text-[13px] text-[var(--led-ink)]">
                          {app.assigned_brokers?.length
                            ? app.assigned_brokers.map((broker) => broker.full_name).join(', ')
                            : 'Unassigned'}
                        </div>
                      </td>
                      <td className="px-6 py-4 align-top">
                        <Badge value={app.status} className="py-1 px-3" />
                      </td>
                    </tr>
                  ))}
                  {!loading && activeApplications.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-14 text-center text-[13px] text-[var(--led-muted)]">
                        No live applications are waiting in the execution queue.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </div>

        <div className="flex flex-col gap-5 lg:col-span-4">
          <GlassCard padding="none" className="flex flex-col">
            <div className="border-b border-[var(--led-line)] px-6 py-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Exception Queue</p>
                  <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Needs Attention</h2>
                </div>
                <span className={`led-chip ${overdueActions > 0 ? 'led-chip-warning' : 'led-chip-accent'}`}>
                  {loading ? '--' : `${dashStats?.action_items?.length ?? 0} open`}
                </span>
              </div>
            </div>
            <div className="space-y-3 p-4">
              {dashStats?.action_items?.map((task) => (
                <div key={task.id} className="rounded-[16px] border border-[var(--led-line)] bg-[var(--led-surface-2)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[14px] font-medium leading-6 text-[var(--led-ink)]">{task.title}</span>
                    {task.priority === 'urgent' && <span className="led-chip led-chip-danger">Urgent</span>}
                    {task.priority === 'high' && <span className="led-chip led-chip-warning">High</span>}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-[12px] text-[var(--led-muted)]">
                    <span className="capitalize">{task.status.replace('_', ' ')}</span>
                    {task.due_date && (
                      <span className="led-tnum">
                        Due {new Date(task.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {(!dashStats?.action_items || dashStats.action_items.length === 0) && !loading && (
                <div className="rounded-[16px] border border-dashed border-[var(--led-line)] px-4 py-10 text-center text-[13px] text-[var(--led-muted)]">
                  No open exception items on the desk.
                </div>
              )}
            </div>
          </GlassCard>

          <GlassCard padding="none" className="flex flex-col">
            <div className="border-b border-[var(--led-line)] px-6 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Capacity</p>
              <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Desk Workload</h2>
            </div>
            <div className="space-y-3 p-4">
              {brokerAssignments.map(({ broker, applications: assignedApps }) => (
                <div key={broker.id} className="rounded-[16px] border border-[var(--led-line)] bg-[var(--led-surface-2)] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--led-accent-tint)] text-[12px] font-semibold text-[var(--led-accent-ink)]">
                        {broker.full_name?.substring(0, 2).toUpperCase() || 'BR'}
                      </div>
                      <div>
                        <p className="text-[14px] font-medium text-[var(--led-ink)]">{broker.full_name}</p>
                        <p className="text-[12px] text-[var(--led-muted)]">{assignedApps.length} active files</p>
                      </div>
                    </div>
                    <span className="text-[15px] font-semibold led-tnum text-[var(--led-ink)]">{assignedApps.length}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--led-bg-2)]">
                    <div
                      className="h-full rounded-full bg-[var(--led-accent)]"
                      style={{ width: `${Math.max((assignedApps.length / maxBrokerLoad) * 100, assignedApps.length > 0 ? 6 : 0)}%` }}
                    />
                  </div>
                </div>
              ))}
              {!loading && brokerAssignments.length === 0 && (
                <div className="rounded-[16px] border border-dashed border-[var(--led-line)] px-4 py-10 text-center text-[13px] text-[var(--led-muted)]">
                  No broker workload data is available.
                </div>
              )}
            </div>
          </GlassCard>

          <GlassCard padding="none" className="flex min-h-[320px] flex-col">
            <div className="border-b border-[var(--led-line)] px-6 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Operations</p>
              <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Activity Tape</h2>
            </div>
            <div className="flex-1 space-y-3 overflow-auto p-4">
              {logs.map((log) => (
                <div key={log.id} className="flex gap-3 rounded-[16px] border border-[var(--led-line)] bg-[var(--led-surface-2)] p-4">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--led-bg)] text-[var(--led-muted)]">
                    {ACTION_ICON_CONFIG[log.action]?.icon || '•'}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] leading-6 text-[var(--led-ink)]">
                      <span className="font-semibold">{log.user_name || 'System'}</span>
                      <span className="mx-1.5 text-[var(--led-muted)]">{ACTION_LABELS[log.action]?.toLowerCase() || log.action}</span>
                      <span className="font-medium">{log.entity_type}</span>
                    </p>
                    <p className="mt-1 text-[12px] text-[var(--led-muted)]">
                      {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
              {!loading && logs.length === 0 && (
                <div className="rounded-[16px] border border-dashed border-[var(--led-line)] px-4 py-10 text-center text-[13px] text-[var(--led-muted)]">
                  No recent operational activity.
                </div>
              )}
            </div>
          </GlassCard>
        </div>
      </div>

      {selectedAppId && selectedApp && (
        <>
          <div className="fixed inset-0 z-40 bg-black/28 transition-opacity" onClick={() => setSelectedAppId(null)} />
          <div className="fixed inset-y-6 right-6 z-50 flex w-full max-w-md flex-col overflow-hidden rounded-[22px] border border-[var(--led-line-strong)] bg-[var(--led-surface)] shadow-[var(--led-shadow-lg)]">
            <div className="flex items-center justify-between border-b border-[var(--led-line)] p-6">
              <div className="flex items-center gap-3">
                <Badge value={selectedApp.status} className="py-1 px-3" />
                <span className="text-[12px] font-medium led-tnum text-[var(--led-muted)]">{selectedApp.id.substring(0, 8)}</span>
              </div>
              <button
                onClick={() => setSelectedAppId(null)}
                className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-[var(--led-line)] bg-[var(--led-surface-2)] text-[var(--led-muted)] transition-colors hover:text-[var(--led-ink)]"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="flex-1 space-y-6 overflow-auto p-6">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Application Detail</p>
                <h2 className="mt-3 text-[30px] font-semibold tracking-[-0.05em] text-[var(--led-ink)]">
                  {selectedApp.user_name || 'Unknown Client'}
                </h2>
                <div className="mt-3 flex items-center gap-2 text-[14px] text-[var(--led-muted)]">
                  <div className="flex h-7 w-7 items-center justify-center rounded-[10px] border border-[var(--led-line)] bg-[var(--led-surface-2)] text-[11px]">
                    {LOAN_TYPE_ICONS[selectedApp.loan_type]}
                  </div>
                  <span className="capitalize">{selectedApp.loan_type} loan</span>
                  <span>&middot;</span>
                  <span className="font-semibold led-tnum text-[var(--led-ink)]">${Number(selectedApp.amount).toLocaleString()}</span>
                </div>
              </div>

              <div className="space-y-5 rounded-[18px] border border-[var(--led-line)] bg-[var(--led-surface-2)] p-5">
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Assigned Coverage</label>
                  <div className="mt-3 space-y-2">
                    {selectedApp.assigned_brokers?.length ? (
                      selectedApp.assigned_brokers.map((broker) => (
                        <div key={broker.id} className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--led-accent-tint)] text-[12px] font-semibold text-[var(--led-accent-ink)]">
                            {broker.full_name?.substring(0, 2).toUpperCase() || 'BR'}
                          </div>
                          <div className="text-[14px] font-medium text-[var(--led-ink)]">{broker.full_name}</div>
                        </div>
                      ))
                    ) : (
                      <div className="text-[14px] text-[var(--led-warning)]">Unassigned</div>
                    )}
                  </div>
                </div>

                <div className="h-px bg-[var(--led-line)]" />

                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Created</label>
                  <div className="mt-2 text-[14px] font-medium text-[var(--led-ink)]">
                    {new Date(selectedApp.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                  </div>
                </div>

                <div className="h-px bg-[var(--led-line)]" />

                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Last Updated</label>
                  <div className="mt-2 text-[14px] font-medium text-[var(--led-ink)]">
                    {new Date(selectedApp.updated_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-[var(--led-line)] p-6">
              <Link to={`/admin/applications/${selectedApp.id}`} className="block">
                <Button className="h-11 w-full rounded-[12px] text-[14px] font-semibold">
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
