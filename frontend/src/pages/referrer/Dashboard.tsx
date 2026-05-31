import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import api from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/Toast';
import { GlassCard, Badge, Button, Skeleton, EmptyState, LoanTypeIcon } from '../../components/ui';
import { formatShortDate, formatDateTime } from '../../lib/utils';
import type { ExternalReferrerStats, LoanApplication } from '../../types';

type MetricTone = 'accent' | 'success' | 'warning' | 'neutral';

interface DeskMetricCardProps {
  label: string;
  value: string | number;
  detail: string;
  loading?: boolean;
  tone?: MetricTone;
}

interface AppAnalytics {
  total_applications: number;
  total_value: number;
  settled_count: number;
  settled_value: number;
  approval_count: number;
  active_count: number;
  by_status: Record<string, number>;
  by_loan_type: Record<string, number>;
  monthly_trend?: Array<{ month: string; count: number }>;
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toLocaleString()}`;
}

const STATUS_ORDER = [
  'application_received',
  'application_assessed',
  'submitted',
  'approval',
  'settled',
  'rejected',
  'draft',
] as const;

interface TrendTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; payload: { count: number; fullLabel: string } }>;
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
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--led-muted)]">Applications</div>
      <div className="mt-1 text-[15px] font-semibold led-tnum">{point.count}</div>
      <div className="mt-1 text-[12px] text-[var(--led-muted)]">{point.fullLabel}</div>
    </div>
  );
}

function DeskMetricCard({ label, value, detail, loading = false, tone = 'neutral' }: DeskMetricCardProps) {
  const toneStyles: Record<MetricTone, { line: string; }> = {
    accent: { line: 'bg-[var(--led-accent)]' },
    success: { line: 'bg-[var(--led-success)]' },
    warning: { line: 'bg-[var(--led-warning)]' },
    neutral: { line: 'bg-[var(--led-line-strong)]' },
  };

  return (
    <GlassCard padding="none" className="h-full">
      <div className={`h-1 ${toneStyles[tone].line}`} />
      <div className="p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">{label}</p>
        <p className="mt-3 text-[32px] font-semibold tracking-[-0.05em] led-tnum text-[var(--led-ink)]">
          {loading ? <Skeleton width={80} height={36} className="mt-1" /> : value}
        </p>
        <p className="mt-4 text-[13px] leading-6 text-[var(--led-muted)]">{loading ? <Skeleton width={160} height={16} /> : detail}</p>
      </div>
    </GlassCard>
  );
}

export default function ReferrerDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [stats, setStats] = useState<ExternalReferrerStats>({ total_referred: 0, signed_up: 0, applied: 0 });
  const [analytics, setAnalytics] = useState<AppAnalytics | null>(null);
  const [applications, setApplications] = useState<LoanApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);

  useEffect(() => {
    Promise.allSettled([
      api.get('/external-referrers/stats'),
      api.get('/applications/analytics'),
      api.get('/applications?per_page=50'),
    ])
      .then(([statsRes, analyticsRes, appsRes]) => {
        if (statsRes.status === 'fulfilled') setStats(statsRes.value.data);
        if (analyticsRes.status === 'fulfilled') setAnalytics(analyticsRes.value.data);
        if (appsRes.status === 'fulfilled') setApplications(appsRes.value.data.items ?? []);
        if (statsRes.status === 'rejected' || analyticsRes.status === 'rejected') {
          toast('Failed to load some dashboard data', 'error');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const activeApplications = applications.filter(
    (app) => !['draft', 'settled', 'rejected'].includes(app.status),
  );
  const settlementRate = analytics && analytics.total_applications > 0
    ? (analytics.settled_count / analytics.total_applications) * 100
    : 0;

  const maxStatusCount = analytics ? Math.max(1, ...Object.values(analytics.by_status)) : 1;
  const loanTypes = ['personal', 'home', 'business', 'vehicle'] as const;
  const maxLoanTypeCount = analytics
    ? Math.max(1, ...loanTypes.map((t) => analytics.by_loan_type[t] ?? 0))
    : 1;

  const monthlyTrendData = (analytics?.monthly_trend ?? []).map((entry) => ({
    label: entry.month,
    fullLabel: entry.month,
    count: entry.count,
  }));
  const monthlyAverage = monthlyTrendData.length
    ? monthlyTrendData.reduce((s, e) => s + e.count, 0) / monthlyTrendData.length
    : 0;
  const monthlyPeak = monthlyTrendData.reduce<{ count: number; fullLabel: string } | null>(
    (peak, e) => (!peak || e.count > peak.count ? { count: e.count, fullLabel: e.fullLabel } : peak),
    null,
  );

  const selectedApp = applications.find((a) => a.id === selectedAppId);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good Morning';
    if (h < 18) return 'Good Afternoon';
    return 'Good Evening';
  })();

  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col pb-8">
      {/* Header */}
      <div className="mb-8 mt-2 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="led-chip led-chip-accent">Referrer</span>
            <span className="text-[12px] text-[var(--led-muted)]">{todayLabel}</span>
          </div>
          <div>
            <h1 className="text-[26px] sm:text-[34px] font-semibold tracking-[-0.05em] text-[var(--led-ink)]">
              {greeting}, {user?.full_name?.split(' ')[0] || 'Partner'}
            </h1>
            <p className="mt-2 max-w-2xl text-[14px] leading-6 text-[var(--led-muted)]">
              {analytics
                ? `${activeApplications.length} active file${activeApplications.length !== 1 ? 's' : ''} in the pipeline. ${analytics.settled_count} settled so far.`
                : 'Loading your pipeline data…'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="led-card px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Referred</p>
            <p className="mt-1 text-[22px] font-semibold tracking-[-0.03em] led-tnum text-[var(--led-ink)]">
              {loading ? <Skeleton width={60} height={28} /> : stats.total_referred}
            </p>
          </div>
          <div className="led-card px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Applied</p>
            <p className="mt-1 text-[22px] font-semibold tracking-[-0.03em] led-tnum text-[var(--led-ink)]">
              {loading ? <Skeleton width={60} height={28} /> : stats.applied}
            </p>
          </div>
          <Link to="/referrer/add-lead">
            <Button size="lg" className="h-11 px-5">+ Add Lead</Button>
          </Link>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 items-start gap-5 lg:grid-cols-12">
        {/* Main column */}
        <div className="flex flex-col gap-5 lg:col-span-8">
          {/* Metric cards */}
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <DeskMetricCard
              label="Total Deals"
              value={analytics?.total_applications ?? 0}
              detail={`${activeApplications.length} currently active`}
              loading={loading}
              tone="accent"
            />
            <DeskMetricCard
              label="Pipeline Value"
              value={formatVolume(analytics?.total_value ?? 0)}
              detail="Total across all applications"
              loading={loading}
              tone="neutral"
            />
            <DeskMetricCard
              label="Approvals"
              value={analytics?.approval_count ?? 0}
              detail="Pending final settlement"
              loading={loading}
              tone="success"
            />
            <DeskMetricCard
              label="Settlements"
              value={analytics?.settled_count ?? 0}
              detail={`${Math.round(settlementRate)}% of total book settled`}
              loading={loading}
              tone="success"
            />
          </div>

          {/* Referral funnel */}
          <GlassCard padding="none" className="flex flex-col">
            <div className="border-b border-[var(--led-line)] px-6 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Referral Pipeline</p>
              <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Funnel Overview</h2>
            </div>
            <div className="grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-y-0 sm:divide-x divide-[var(--led-line)]">
              {[
                { label: 'Total Referred', value: stats.total_referred, detail: 'Clients you have introduced' },
                { label: 'Signed Up', value: stats.signed_up, detail: 'Completed registration' },
                { label: 'Applied', value: stats.applied, detail: 'Submitted a loan application' },
              ].map((item) => (
                <div key={item.label} className="p-6">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">{item.label}</p>
                  <p className="mt-3 text-[28px] font-semibold tracking-[-0.04em] led-tnum text-[var(--led-ink)]">
                    {loading ? <Skeleton width={60} height={36} /> : item.value}
                  </p>
                  <p className="mt-2 text-[12px] text-[var(--led-muted)]">{loading ? <Skeleton width={140} height={14} /> : item.detail}</p>
                </div>
              ))}
            </div>
          </GlassCard>

          {/* Charts row */}
          <div className="grid gap-5 xl:grid-cols-2">
            {/* Pipeline by status */}
            <GlassCard padding="none" className="flex flex-col">
              <div className="border-b border-[var(--led-line)] px-6 py-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Pipeline Staging</p>
                <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Stage Allocation</h2>
              </div>
              <div className="space-y-4 p-6">
                {loading
                  ? [1, 2, 3, 4].map((i) => (
                      <div key={i} className="grid grid-cols-[minmax(120px,160px)_1fr_auto] items-center gap-4">
                        <Skeleton width={100} height={20} />
                        <Skeleton height={8} />
                        <Skeleton width={32} height={16} />
                      </div>
                    ))
                  : analytics && STATUS_ORDER.map((status) => {
                      const count = analytics.by_status[status] ?? 0;
                      if (count === 0) return null;
                      const pct = maxStatusCount > 0 ? (count / maxStatusCount) * 100 : 0;
                      return (
                        <div key={status} className="grid grid-cols-[minmax(120px,160px)_1fr_auto] items-center gap-4">
                          <div className="min-w-0">
                            <Badge value={status} className="truncate" />
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-[var(--led-bg-2)]">
                            <div className="h-full rounded-full bg-[var(--led-accent)]" style={{ width: `${pct}%` }} />
                          </div>
                          <p className="text-[14px] font-semibold led-tnum text-[var(--led-ink)]">{count}</p>
                        </div>
                      );
                    })}
                {!loading && (!analytics || Object.values(analytics.by_status).every((v) => v === 0)) && (
                  <EmptyState title="No pipeline data" description="Stage allocation will appear here once applications are submitted." />
                )}
              </div>
            </GlassCard>

            {/* Volume by loan type */}
            <GlassCard padding="none" className="flex flex-col">
              <div className="border-b border-[var(--led-line)] px-6 py-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Portfolio Mix</p>
                <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Volume by Product</h2>
              </div>
              <div className="space-y-4 p-6">
                {loading
                  ? [1, 2, 3, 4].map((i) => (
                      <div key={i}>
                        <div className="mb-2 flex items-center gap-3">
                          <Skeleton width={36} height={36} circle />
                          <div className="space-y-1.5">
                            <Skeleton width={80} height={16} />
                            <Skeleton width={50} height={12} />
                          </div>
                        </div>
                        <Skeleton height={8} />
                      </div>
                    ))
                  : loanTypes.map((type) => {
                      const count = analytics?.by_loan_type[type] ?? 0;
                      const pct = maxLoanTypeCount > 0 ? (count / maxLoanTypeCount) * 100 : 0;
                      return (
                        <div key={type}>
                          <div className="mb-2 flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-[var(--led-line)] bg-[var(--led-surface-2)] text-[var(--led-muted)]">
                                <LoanTypeIcon type={type} className="h-5 w-5" />
                              </div>
                              <div>
                                <p className="text-[14px] font-medium capitalize text-[var(--led-ink)]">{type}</p>
                                <p className="text-[12px] text-[var(--led-muted)]">{count} files</p>
                              </div>
                            </div>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-[var(--led-bg-2)]">
                            <div
                              className="h-full rounded-full bg-[var(--led-accent)]"
                              style={{ width: `${Math.max(pct, count > 0 ? 3 : 0)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                {!loading && (!analytics || loanTypes.every((t) => !(analytics.by_loan_type[t] ?? 0))) && (
                  <EmptyState title="No product data" description="Loan type breakdown will appear here once applications are submitted." />
                )}
              </div>
            </GlassCard>
          </div>

          {/* Monthly trend chart */}
          <GlassCard padding="none" className="flex flex-col">
            <div className="border-b border-[var(--led-line)] px-6 py-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Origination</p>
                  <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Monthly Booking Trend</h2>
                </div>
                <div className="flex gap-6">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Peak Month</p>
                    <p className="mt-1 text-[20px] font-semibold led-tnum text-[var(--led-ink)]">
                      {loading ? <Skeleton width={50} height={28} /> : monthlyPeak?.count ?? 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Avg / Month</p>
                    <p className="mt-1 text-[20px] font-semibold led-tnum text-[var(--led-ink)]">
                      {loading ? <Skeleton width={50} height={28} /> : monthlyAverage.toFixed(1)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="h-[260px] px-4 py-4">
              {loading ? (
                <div className="flex h-full flex-col justify-center gap-4 px-6">
                  <Skeleton height={180} />
                  <div className="flex gap-4">
                    <Skeleton height={32} className="flex-1" />
                    <Skeleton height={32} className="flex-1" />
                  </div>
                </div>
              ) : monthlyTrendData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={monthlyTrendData} margin={{ top: 12, right: 12, left: -18, bottom: 0 }}>
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
                <div className="flex h-full items-center justify-center">
                  <EmptyState title="No trend data" description="Monthly booking trends will appear here once applications are submitted." />
                </div>
              )}
            </div>
          </GlassCard>

          {/* Applications table */}
          <GlassCard padding="none" className="flex min-h-[400px] flex-col overflow-hidden">
            <div className="border-b border-[var(--led-line)] px-6 py-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Active Files</p>
                  <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Live Application Book</h2>
                </div>
                <p className="text-[13px] text-[var(--led-muted)]">{activeApplications.length} live files</p>
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
                    <th className="px-6 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Stage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--led-line)]">
                  {loading
                    ? [1, 2, 3, 4].map((i) => (
                        <tr key={i}>
                          <td className="px-6 py-4 align-top space-y-2">
                            <Skeleton width={80} height={14} />
                            <Skeleton width={60} height={12} />
                          </td>
                          <td className="px-6 py-4 align-top space-y-2">
                            <Skeleton width={120} height={14} />
                            <Skeleton width={100} height={12} />
                          </td>
                          <td className="px-6 py-4 align-top">
                            <div className="flex items-center gap-2">
                              <Skeleton width={28} height={28} circle />
                              <Skeleton width={60} height={14} />
                            </div>
                          </td>
                          <td className="px-6 py-4 align-top">
                            <Skeleton width={80} height={16} />
                          </td>
                          <td className="px-6 py-4 align-top">
                            <Skeleton width={80} height={24} />
                          </td>
                        </tr>
                      ))
                    : activeApplications.map((app) => (
                        <tr
                          key={app.id}
                          className={`cursor-pointer transition-colors hover:bg-[var(--led-surface-2)] ${selectedAppId === app.id ? 'bg-[var(--led-accent-tint)]' : ''}`}
                          onClick={() => setSelectedAppId(app.id)}
                        >
                          <td className="px-6 py-4 align-top">
                            <div className="text-[13px] font-semibold led-tnum text-[var(--led-ink)]">{app.id.substring(0, 8)}</div>
                            <div className="mt-1 text-[12px] text-[var(--led-muted)]">
                              {formatShortDate(app.updated_at)}
                            </div>
                          </td>
                          <td className="px-6 py-4 align-top">
                            <div className="font-medium text-[var(--led-ink)]">{app.user_name || 'Unknown client'}</div>
                            <div className="mt-1 text-[12px] text-[var(--led-muted)]">{app.user_email || 'No email on file'}</div>
                          </td>
                          <td className="px-6 py-4 align-top">
                            <div className="flex items-center gap-2">
                              <div className="flex h-7 w-7 items-center justify-center rounded-[10px] border border-[var(--led-line)] bg-[var(--led-surface-2)] text-[var(--led-muted)]">
                                <LoanTypeIcon type={app.loan_type} className="h-4 w-4" />
                              </div>
                              <span className="capitalize text-[var(--led-ink)]">{app.loan_type}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 align-top">
                            <div className="text-[14px] font-semibold led-tnum text-[var(--led-ink)]">${Number(app.amount).toLocaleString()}</div>
                          </td>
                          <td className="px-6 py-4 align-top">
                            <Badge value={app.status} className="py-1 px-3" />
                          </td>
                        </tr>
                      ))}
                  {!loading && activeApplications.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-10">
                        <EmptyState title="No active files" description="Applications in progress will appear here once submitted." />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-5 lg:col-span-4">
          {/* Conversion summary */}
          <GlassCard padding="none" className="flex flex-col">
            <div className="border-b border-[var(--led-line)] px-6 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Conversion</p>
              <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Referral Funnel</h2>
            </div>
            <div className="space-y-3 p-4">
              {[
                {
                  label: 'Refer → Sign Up',
                  value: stats.total_referred > 0
                    ? `${Math.round((stats.signed_up / stats.total_referred) * 100)}%`
                    : '—',
                  detail: `${stats.signed_up} of ${stats.total_referred} referred`,
                },
                {
                  label: 'Sign Up → Apply',
                  value: stats.signed_up > 0
                    ? `${Math.round((stats.applied / stats.signed_up) * 100)}%`
                    : '—',
                  detail: `${stats.applied} of ${stats.signed_up} signed up`,
                },
                {
                  label: 'Apply → Settle',
                  value: analytics && analytics.total_applications > 0
                    ? `${Math.round(settlementRate)}%`
                    : '—',
                  detail: `${analytics?.settled_count ?? 0} settled from applications`,
                },
              ].map((row) => (
                <div key={row.label} className="rounded-[16px] border border-[var(--led-line)] bg-[var(--led-surface-2)] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">{row.label}</p>
                  <p className="mt-3 text-[26px] font-semibold tracking-[-0.04em] led-tnum text-[var(--led-ink)]">{loading ? '--' : row.value}</p>
                  <p className="mt-3 text-[13px] leading-6 text-[var(--led-muted)]">{row.detail}</p>
                </div>
              ))}
            </div>
          </GlassCard>

          {/* Settled value */}
          <GlassCard padding="none" className="flex flex-col">
            <div className="border-b border-[var(--led-line)] px-6 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Settled</p>
              <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Settlement Summary</h2>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Total Settled Value</p>
                <p className="mt-2 text-[30px] font-semibold tracking-[-0.05em] led-tnum text-[var(--led-ink)]">
                  {loading ? '--' : formatVolume(analytics?.settled_value ?? 0)}
                </p>
              </div>
              <div className="h-px bg-[var(--led-line)]" />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Files Settled</p>
                  <p className="mt-2 text-[22px] font-semibold led-tnum text-[var(--led-ink)]">
                    {loading ? '--' : analytics?.settled_count ?? 0}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Settle Rate</p>
                  <p className="mt-2 text-[22px] font-semibold led-tnum text-[var(--led-ink)]">
                    {loading ? '--' : `${Math.round(settlementRate)}%`}
                  </p>
                </div>
              </div>
            </div>
          </GlassCard>

          {/* Quick links */}
          <GlassCard padding="none" className="flex flex-col">
            <div className="border-b border-[var(--led-line)] px-6 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Quick Access</p>
              <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Navigation</h2>
            </div>
            <div className="p-4 space-y-2">
              {[
                { label: 'All Applications', to: '/referrer/applications', icon: <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg> },
                { label: 'Add New Lead', to: '/referrer/add-lead', icon: <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg> },
                { label: 'Messages', to: '/referrer/messages', icon: <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" /></svg> },
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

      {/* Slide-over detail panel */}
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
                  <div className="flex h-7 w-7 items-center justify-center rounded-[10px] border border-[var(--led-line)] bg-[var(--led-surface-2)] text-[var(--led-muted)]">
                    <LoanTypeIcon type={selectedApp.loan_type} className="h-4 w-4" />
                  </div>
                  <span className="capitalize">{selectedApp.loan_type} loan</span>
                  <span>&middot;</span>
                  <span className="font-semibold led-tnum text-[var(--led-ink)]">${Number(selectedApp.amount).toLocaleString()}</span>
                </div>
              </div>

              <div className="space-y-5 rounded-[18px] border border-[var(--led-line)] bg-[var(--led-surface-2)] p-5">
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Created</label>
                  <div className="mt-2 text-[14px] font-medium text-[var(--led-ink)]">
                    {formatDateTime(selectedApp.created_at)}
                  </div>
                </div>
                <div className="h-px bg-[var(--led-line)]" />
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Last Updated</label>
                  <div className="mt-2 text-[14px] font-medium text-[var(--led-ink)]">
                    {formatDateTime(selectedApp.updated_at)}
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-[var(--led-line)] p-6">
              <Link to={`/referrer/applications/${selectedApp.id}`} className="block">
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
