import { useEffect, useMemo, useState } from 'react';
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
import { GlassCard, Button, Skeleton, EmptyState } from '../../components/ui';
import { CopyButton } from '../../components/ui/CopyButton';
import { ACTION_ICON_CONFIG, ACTION_LABELS } from '../../lib/constants';
import { formatShortDate, formatTime } from '../../lib/utils';
import type { ActivityLog, DashboardStats, LoanApplication } from '../../types';

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
  return `$${Math.round(v).toLocaleString('en-AU')}`;
}

function formatDayLabel(date: string): string {
  return new Date(date).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' });
}

function formatFullDayLabel(date: string): string {
  return new Date(date).toLocaleDateString('en-AU', { weekday: 'short', month: 'short', day: 'numeric' });
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
              {loading ? <Skeleton width={80} height={36} className="mt-1" /> : value}
            </p>
          </div>
          {delta && !loading && <span className={toneStyles[tone].chip}>{delta}</span>}
        </div>
        <p className="mt-4 text-[13px] leading-6 text-[var(--led-muted)]">{loading ? <Skeleton width={180} height={16} /> : detail}</p>
      </div>
    </GlassCard>
  );
}

const TERMINAL_STATUSES = ['draft', 'settled', 'rejected', 'not_proceeding'];
const ACTIVE_STATUSES = ['application_received', 'application_assessed', 'submitted', 'approval'] as const;

export default function AdminDashboard() {
  const { user } = useAuth();
  const isBroker = user?.role === 'broker';
  const { toast } = useToast();
  const [dashStats, setDashStats] = useState<DashboardStats | null>(null);
  const [applications, setApplications] = useState<LoanApplication[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteLink, setInviteLink] = useState<string | null>(null);


  useEffect(() => {
    const isAdmin = user?.role === 'admin';
    Promise.allSettled([
      api.get('/dashboard/stats'),
      api.get('/applications?per_page=100'),
      isAdmin ? api.get('/activity-logs?per_page=15') : Promise.resolve(null),
    ])
      .then(([statsRes, appRes, logRes]) => {
        const failed: string[] = [];
        if (statsRes.status === 'fulfilled') setDashStats(statsRes.value.data);
        else failed.push('stats');
        if (appRes.status === 'fulfilled') setApplications(appRes.value.data.items);
        else failed.push('applications');
        if (logRes.status === 'fulfilled' && logRes.value) setLogs(logRes.value.data.items);
        if (failed.length) toast(`Failed to load: ${failed.join(', ')}`, 'error');
      })
      .finally(() => setLoading(false));

    api.get('/referrals/my-link')
      .then(({ data }) => setInviteLink(`${window.location.origin}/register?ref=${data.code}`))
      .catch(() => { });
  }, [user?.role]);

  const counts = useMemo(() => ({
    total: dashStats ? Object.values(dashStats.status_counts).reduce((a, b) => a + b, 0) : 0,
    draft: dashStats?.status_counts.draft ?? 0,
    application_received: dashStats?.status_counts.application_received ?? 0,
    application_assessed: dashStats?.status_counts.application_assessed ?? 0,
    submitted: dashStats?.status_counts.submitted ?? 0,
    approval: dashStats?.status_counts.approval ?? 0,
    settled: dashStats?.status_counts.settled ?? 0,
    rejected: dashStats?.status_counts.rejected ?? 0,
  }), [dashStats]);

  const activeApplications = useMemo(
    () => applications.filter((app) => !TERMINAL_STATUSES.includes(app.status)),
    [applications],
  );
  const totalVolume = dashStats
    ? ACTIVE_STATUSES.reduce((sum, s) => sum + (dashStats.volume_by_status[s] ?? 0), 0)
    : 0;
  const totalActiveExposure = activeApplications.reduce((sum, app) => sum + Number(app.amount || 0), 0);
  const approvalsInFlight = counts.submitted + counts.approval;
  const rateBase = counts.total - counts.draft - (dashStats?.status_counts.not_proceeding ?? 0);
  const settlementRate = rateBase > 0 ? (counts.settled / rateBase) * 100 : 0;
  const unassignedActive = activeApplications.filter((app) => !app.assigned_brokers?.length).length;

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const overdueActions = dashStats?.action_items?.filter((task) => task.due_date && new Date(task.due_date) < startOfToday).length ?? 0;
  const urgentActions = dashStats?.action_items?.filter((task) => task.priority === 'urgent').length ?? 0;

  const weekDelta = dashStats
    ? dashStats.apps_last_week > 0
      ? Math.round(((dashStats.apps_this_week - dashStats.apps_last_week) / dashStats.apps_last_week) * 100)
      : dashStats.apps_this_week > 0 ? 100 : 0
    : 0;

  const topLenderApprovalMax = Math.max(...(dashStats?.top_lenders?.map((lender) => lender.approvals) ?? [1]), 1);

  const dailyTrendData = useMemo(
    () => (dashStats?.daily_trend ?? []).map((entry) => ({
      label: formatDayLabel(entry.date),
      fullLabel: formatFullDayLabel(entry.date),
      count: entry.count,
    })),
    [dashStats],
  );
  const dailyTotal = useMemo(() => dailyTrendData.reduce((sum, entry) => sum + entry.count, 0), [dailyTrendData]);
  const dailyAverage = dailyTrendData.length ? dailyTotal / dailyTrendData.length : 0;
  const dailyPeak = useMemo(() => dailyTrendData.reduce<{ count: number; fullLabel: string } | null>((peak, entry) => {
    if (!peak || entry.count > peak.count) return { count: entry.count, fullLabel: entry.fullLabel };
    return peak;
  }, null), [dailyTrendData]);

  const monthlyTrendData = useMemo(
    () => (dashStats?.monthly_trend ?? []).map((entry) => ({
      label: entry.month,
      fullLabel: entry.month,
      count: entry.count,
    })),
    [dashStats],
  );
  const monthlyAverage = useMemo(
    () => monthlyTrendData.length ? monthlyTrendData.reduce((sum, entry) => sum + entry.count, 0) / monthlyTrendData.length : 0,
    [monthlyTrendData],
  );
  const monthlyPeak = useMemo(() => monthlyTrendData.reduce<{ count: number; fullLabel: string } | null>((peak, entry) => {
    if (!peak || entry.count > peak.count) return { count: entry.count, fullLabel: entry.fullLabel };
    return peak;
  }, null), [monthlyTrendData]);

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  })();

  const todayLabel = today.toLocaleDateString('en-AU', {
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
            <h1 className="text-[26px] sm:text-[34px] font-semibold tracking-[-0.05em] text-[var(--led-ink)]">
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
          {!isBroker && (
            <div className="led-card px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Avg Turnaround</p>
              <p className="mt-1 text-[22px] font-semibold tracking-[-0.03em] led-tnum text-[var(--led-ink)]">
                {loading ? <Skeleton width={60} height={28} /> : formatDays(dashStats?.avg_turnaround_days ?? null)}
              </p>
            </div>
          )}
          <div className="led-card px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Urgent Exceptions</p>
            <p className="mt-1 text-[22px] font-semibold tracking-[-0.03em] led-tnum text-[var(--led-ink)]">
              {loading ? <Skeleton width={60} height={28} /> : urgentActions}
            </p>
          </div>
          {inviteLink && (
            <div className="led-card px-4 py-3 max-w-[260px]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Your Invite Link</p>
              <div className="mt-1 flex items-center gap-2">
                <p className="min-w-0 truncate text-[13px] font-medium text-[var(--led-ink)]" title={inviteLink}>
                  {inviteLink.replace(/^https?:\/\//, '')}
                </p>
                <CopyButton text={inviteLink} size="sm" />
              </div>
            </div>
          )}
          <Link to="/admin/applications">
            <Button size="lg" className="h-11 px-5">
              Open Live Queue
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 items-start gap-5 lg:grid-cols-12">
        <div className="flex flex-col gap-5 lg:col-span-8">
          <div className={`grid gap-5 sm:grid-cols-2 ${isBroker ? '' : 'xl:grid-cols-4'}`}>
            {!isBroker && (
              <DeskMetricCard
                label="Pipeline Exposure"
                value={formatVolume(totalVolume)}
                detail={`${counts.total} mandates in the current book`}
                loading={loading}
                tone="accent"
              />
            )}
            <DeskMetricCard
              label="Live Mandates"
              value={activeApplications.length}
              detail={`${formatVolume(totalActiveExposure)} currently active across the desk`}
              loading={loading}
              tone="neutral"
            />
            {!isBroker && (
              <DeskMetricCard
                label="Weekly Intake"
                value={dashStats?.apps_this_week ?? 0}
                detail={`${dashStats?.apps_last_week ?? 0} booked in the prior week`}
                loading={loading}
                tone={weekDelta >= 0 ? 'success' : 'warning'}
                delta={!loading && weekDelta !== 0 ? `${weekDelta > 0 ? '+' : ''}${weekDelta}%` : undefined}
              />
            )}
            <DeskMetricCard
              label="Settlements Booked"
              value={counts.settled}
              detail={`${formatPercent(settlementRate)} of the total book has settled`}
              loading={loading}
              tone="success"
            />
          </div>

          {!isBroker && <div className="grid gap-5 xl:grid-cols-2">
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
                ) : loading ? (
                  <div className="flex h-full flex-col justify-center gap-4 px-6">
                    <Skeleton height={200} />
                    <div className="flex gap-4">
                      <Skeleton height={40} className="flex-1" />
                      <Skeleton height={40} className="flex-1" />
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <EmptyState title="No recent intake" description="Application intake data will appear here once available." />
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
                ) : loading ? (
                  <div className="flex h-full flex-col justify-center gap-4 px-6">
                    <Skeleton height={200} />
                    <div className="flex gap-4">
                      <Skeleton height={40} className="flex-1" />
                      <Skeleton height={40} className="flex-1" />
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <EmptyState title="No monthly data" description="Monthly booking trends will appear here once available." />
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
          </div>}

          {/* Conversion Funnel */}
          <GlassCard padding="none">
            <div className="border-b border-[var(--led-line)] px-6 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Conversion Intelligence</p>
              <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Pipeline Funnel</h2>
              <p className="mt-1 text-[13px] text-[var(--led-muted)]">Drop-off rates between each stage — click any stage to filter applications.</p>
            </div>
            <div className="p-6">
              {loading ? (
                <div className="space-y-4 py-4">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="flex items-center gap-4">
                      <Skeleton width={80} height={16} />
                      <Skeleton height={28} className="flex-1" />
                      <Skeleton width={40} height={16} />
                    </div>
                  ))}
                </div>
              ) : (() => {
                const pipeline: { status: string; label: string; color: string }[] = [
                  { status: 'draft', label: 'Draft', color: 'var(--led-muted)' },
                  { status: 'application_received', label: 'Received', color: '#3b82f6' },
                  { status: 'application_assessed', label: 'Assessed', color: '#8b5cf6' },
                  { status: 'submitted', label: 'Submitted', color: '#f59e0b' },
                  { status: 'approval', label: 'Approval', color: '#10b981' },
                  { status: 'settled', label: 'Settled', color: '#059669' },
                ];
                const maxCount = Math.max(...pipeline.map((s) => dashStats?.status_counts[s.status] ?? 0), 1);
                const totalCreated = (dashStats?.status_counts.draft ?? 0) + (dashStats?.status_counts.application_received ?? 0) +
                  (dashStats?.status_counts.application_assessed ?? 0) + (dashStats?.status_counts.submitted ?? 0) +
                  (dashStats?.status_counts.approval ?? 0) + (dashStats?.status_counts.settled ?? 0) +
                  (dashStats?.status_counts.rejected ?? 0) + (dashStats?.status_counts.not_proceeding ?? 0);

                return (
                  <div className="space-y-3">
                    {pipeline.map((stage, i) => {
                      const count = dashStats?.status_counts[stage.status] ?? 0;
                      const prevCount = i > 0 ? (dashStats?.status_counts[pipeline[i - 1].status] ?? 0) : totalCreated;
                      const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
                      const convRate = prevCount > 0 ? Math.round((count / prevCount) * 100) : null;

                      return (
                        <div key={stage.status}>
                          <div className="flex items-center gap-4">
                            <div className="w-[90px] shrink-0 text-right">
                              <span className="text-[12px] font-semibold text-[var(--led-muted)]">{stage.label}</span>
                            </div>
                            <div className="flex-1 flex items-center gap-3">
                              <div className="flex-1 h-7 rounded-lg overflow-hidden bg-[var(--led-bg-2)] relative">
                                <div
                                  className="h-full rounded-lg transition-all duration-500"
                                  style={{
                                    width: `${Math.max(pct, count > 0 ? 2 : 0)}%`,
                                    background: stage.color,
                                    opacity: 0.85,
                                  }}
                                />
                                {count > 0 && (
                                  <span className="absolute inset-y-0 left-3 flex items-center text-[12px] font-semibold text-white mix-blend-plus-lighter">
                                    {count}
                                  </span>
                                )}
                              </div>
                              <span className="w-[42px] shrink-0 text-right text-[13px] font-semibold led-tnum text-[var(--led-ink)]">
                                {count}
                              </span>
                            </div>
                          </div>
                          {i < pipeline.length - 1 && convRate !== null && (
                            <div className="flex items-center gap-4 my-1">
                              <div className="w-[90px] shrink-0" />
                              <div className="flex-1 flex items-center gap-2 px-1">
                                <div className="h-px flex-1 border-l-2 border-dashed border-[var(--led-line)] ml-4" style={{ width: '16px', flex: 'none' }} />
                                <span className={`text-[11px] font-medium ${convRate >= 50 ? 'text-emerald-500' : convRate >= 25 ? 'text-amber-500' : 'text-red-500'}`}>
                                  {convRate}% proceed
                                </span>
                                <div className="h-px flex-1 border-dashed border-t border-[var(--led-line)]" />
                              </div>
                              <div className="w-[42px] shrink-0" />
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Terminal states */}
                    <div className="mt-4 pt-4 border-t border-[var(--led-line)] flex items-center gap-6">
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded-full bg-red-500/60" />
                        <span className="text-[12px] text-[var(--led-muted)]">Rejected: <strong className="text-[var(--led-ink)]">{dashStats?.status_counts.rejected ?? 0}</strong></span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded-full bg-[var(--led-muted)]/40" />
                        <span className="text-[12px] text-[var(--led-muted)]">Not Proceeding: <strong className="text-[var(--led-ink)]">{dashStats?.status_counts.not_proceeding ?? 0}</strong></span>
                      </div>
                      <div className="ml-auto">
                        <span className="text-[12px] text-[var(--led-muted)]">Overall settlement rate: </span>
                        <strong className="text-[13px] text-emerald-500">{formatPercent(settlementRate)}</strong>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </GlassCard>

          <div className="grid gap-5 xl:grid-cols-2">
            <GlassCard padding="none" className="flex flex-col">
              <div className="border-b border-[var(--led-line)] px-6 py-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Lender Flow</p>
                <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Top Lenders</h2>
              </div>
              <div className="space-y-4 p-6">
                {loading
                  ? [1, 2, 3, 4].map((i) => (
                      <div key={i}>
                        <div className="mb-2 flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3">
                            <Skeleton width={28} height={28} circle />
                            <Skeleton width={120} height={16} />
                          </div>
                          <Skeleton width={40} height={16} />
                        </div>
                        <Skeleton height={8} />
                      </div>
                    ))
                  : dashStats?.top_lenders?.map((lender, index) => (
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
                  <EmptyState title="No lender data" description="Top lender approvals will appear here once applications progress." />
                )}
              </div>
            </GlassCard>

          </div>

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
              {loading
                ? [1, 2, 3].map((i) => (
                    <div key={i} className="rounded-[16px] border border-[var(--led-line)] bg-[var(--led-surface-2)] p-4 space-y-3">
                      <Skeleton height={16} className="w-3/4" />
                      <div className="flex justify-between">
                        <Skeleton width={60} height={14} />
                        <Skeleton width={80} height={14} />
                      </div>
                    </div>
                  ))
                : dashStats?.action_items?.map((task) => (
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
                            Due {formatShortDate(task.due_date)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
              {(!dashStats?.action_items || dashStats.action_items.length === 0) && !loading && (
                <EmptyState title="All clear" description="No open exception items on the desk." />
              )}
            </div>
          </GlassCard>

          <GlassCard padding="none" className="flex min-h-[320px] flex-col">
            <div className="border-b border-[var(--led-line)] px-6 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Operations</p>
              <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Activity Tape</h2>
            </div>
            <div className="flex-1 space-y-3 overflow-auto p-4">
              {loading
                ? [1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex gap-3 rounded-[16px] border border-[var(--led-line)] bg-[var(--led-surface-2)] p-4">
                      <Skeleton width={32} height={32} circle />
                      <div className="flex-1 space-y-2">
                        <Skeleton height={14} className="w-3/4" />
                        <Skeleton width={80} height={12} />
                      </div>
                    </div>
                  ))
                : logs.map((log) => (
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
                          {formatTime(log.created_at)}
                        </p>
                      </div>
                    </div>
                  ))}
              {!loading && logs.length === 0 && (
                <EmptyState title="No activity" description="Recent operational activity will appear here." />
              )}
            </div>
          </GlassCard>
        </div>
      </div>

    </div>
  );
}
