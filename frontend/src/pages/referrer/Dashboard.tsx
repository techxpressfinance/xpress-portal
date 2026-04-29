import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { GlassCard, PageHeader } from '../../components/ui';
import type { ExternalReferrerStats } from '../../types';

const STATUS_PIPELINE = [
  { key: 'draft', label: 'Draft', color: 'bg-muted-foreground/30' },
  { key: 'application_received', label: 'Received', color: 'bg-chart-4/60' },
  { key: 'application_assessed', label: 'Assessed', color: 'bg-chart-2/60' },
  { key: 'submitted', label: 'Submitted', color: 'bg-primary/60' },
  { key: 'approval', label: 'Approval', color: 'bg-chart-3/60' },
  { key: 'settled', label: 'Settled', color: 'bg-success/70' },
  { key: 'rejected', label: 'Rejected', color: 'bg-destructive/50' },
];

const LOAN_TYPE_COLORS: Record<string, string> = {
  personal: 'bg-primary',
  home: 'bg-chart-2',
  business: 'bg-chart-4',
  vehicle: 'bg-chart-3',
};

interface AppAnalytics {
  total_applications: number;
  total_value: number;
  settled_count: number;
  settled_value: number;
  approval_count: number;
  active_count: number;
  by_status: Record<string, number>;
  by_loan_type: Record<string, number>;
}

export default function ReferrerDashboard() {
  const { toast } = useToast();
  const [stats, setStats] = useState<ExternalReferrerStats>({ total_referred: 0, signed_up: 0, applied: 0 });
  const [analytics, setAnalytics] = useState<AppAnalytics | null>(null);

  const fetchData = () => {
    Promise.all([
      api.get('/external-referrers/stats'),
      api.get('/applications/analytics'),
    ])
      .then(([statsRes, analyticsRes]) => {
        setStats(statsRes.data);
        setAnalytics(analyticsRes.data);
      })
      .catch(() => toast('Failed to load dashboard', 'error'));
  };

  useEffect(() => { fetchData(); }, []);

  const fmt = (n: number) =>
    n >= 1_000_000
      ? `$${(n / 1_000_000).toFixed(1)}M`
      : n >= 1_000
        ? `$${(n / 1_000).toFixed(0)}K`
        : `$${n.toLocaleString()}`;

  const maxStatusCount = analytics
    ? Math.max(1, ...Object.values(analytics.by_status))
    : 1;
  const totalLoanTypeCount = analytics
    ? Math.max(1, Object.values(analytics.by_loan_type).reduce((a, b) => a + b, 0))
    : 1;

  return (
    <div>
      <PageHeader title="Referrer Dashboard" subtitle="Track your referred clients and deal analytics" />

      {/* Referral funnel stats */}
      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        {[
          {
            label: 'Total Referred', value: stats.total_referred, icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" /></svg>
            ), color: 'text-primary bg-primary/10'
          },
          {
            label: 'Signed Up', value: stats.signed_up, icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" /></svg>
            ), color: 'text-chart-2 bg-chart-2/10'
          },
          {
            label: 'Applied', value: stats.applied, icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
            ), color: 'text-success bg-success/10'
          },
        ].map((stat) => (
          <GlassCard key={stat.label}>
            <div className="flex items-center gap-4">
              <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${stat.color}`}>
                {stat.icon}
              </div>
              <div>
                <p className="text-[13px] text-muted-foreground">{stat.label}</p>
                <p className="text-2xl font-bold text-foreground">{stat.value}</p>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>

      {/* Deal analytics */}
      {analytics && analytics.total_applications > 0 && (
        <>
          {/* Deal KPIs */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
            {[
              {
                label: 'Total Deals',
                value: analytics.total_applications,
                sub: `${analytics.active_count} active`,
                color: 'text-primary bg-primary/10',
                icon: <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>,
              },
              {
                label: 'Total Value',
                value: fmt(analytics.total_value),
                sub: 'across all deals',
                color: 'text-chart-2 bg-chart-2/10',
                icon: <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>,
              },
              {
                label: 'Approvals',
                value: analytics.approval_count,
                sub: 'pending settlement',
                color: 'text-chart-3 bg-chart-3/10',
                icon: <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M11.35 3.836c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m8.9-4.414c.376.023.75.05 1.124.08 1.131.094 1.976 1.057 1.976 2.192V16.5A2.25 2.25 0 0 1 18 18.75h-2.25m-7.5-10.5H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V18.75m-7.5-10.5h6.375c.621 0 1.125.504 1.125 1.125v9.375m-8.25-3 1.5 1.5 3-3.75" /></svg>,
              },
              {
                label: 'Settled',
                value: analytics.settled_count,
                sub: fmt(analytics.settled_value),
                color: 'text-success bg-success/10',
                icon: <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>,
              },
            ].map((kpi) => (
              <GlassCard key={kpi.label}>
                <div className="flex items-start gap-3">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${kpi.color}`}>
                    {kpi.icon}
                  </div>
                  <div>
                    <p className="text-[12px] text-muted-foreground">{kpi.label}</p>
                    <p className="text-[22px] font-bold text-foreground leading-tight">{kpi.value}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{kpi.sub}</p>
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-2 mb-6">
            {/* Pipeline by status */}
            <GlassCard>
              <h3 className="text-[14px] font-semibold text-foreground mb-4">Deal Pipeline</h3>
              <div className="space-y-2.5">
                {STATUS_PIPELINE.map(({ key, label, color }) => {
                  const count = analytics.by_status[key] ?? 0;
                  if (count === 0) return null;
                  const pct = Math.round((count / maxStatusCount) * 100);
                  return (
                    <div key={key} className="flex items-center gap-3">
                      <span className="w-24 shrink-0 text-[12px] text-muted-foreground text-right">{label}</span>
                      <div className="flex-1 h-6 rounded-lg bg-secondary overflow-hidden">
                        <div
                          className={`h-full rounded-lg ${color} transition-all duration-500`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-6 shrink-0 text-[13px] font-semibold text-foreground">{count}</span>
                    </div>
                  );
                })}
              </div>
            </GlassCard>

            {/* Loan type breakdown */}
            <GlassCard>
              <h3 className="text-[14px] font-semibold text-foreground mb-4">By Loan Type</h3>
              <div className="space-y-3">
                {Object.entries(analytics.by_loan_type)
                  .sort(([, a], [, b]) => b - a)
                  .map(([type, count]) => {
                    const pct = Math.round((count / totalLoanTypeCount) * 100);
                    return (
                      <div key={type}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[13px] font-medium text-foreground capitalize">{type}</span>
                          <span className="text-[12px] text-muted-foreground">{count} deal{count !== 1 ? 's' : ''} &middot; {pct}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-secondary overflow-hidden">
                          <div
                            className={`h-full rounded-full ${LOAN_TYPE_COLORS[type] ?? 'bg-primary'} transition-all duration-500`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </GlassCard>
          </div>
        </>
      )}

    </div>
  );
}
