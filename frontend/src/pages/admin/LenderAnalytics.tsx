import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
  LineChart, Line,
} from 'recharts';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { GlassCard, StatCard, PageHeader } from '../../components/ui';
import type { LenderAnalytics } from '../../types';

const STATUS_COLORS: Record<string, string> = {
  approved: 'oklch(0.72 0.19 150)',
  declined: 'oklch(0.65 0.16 25)',
  conditional: 'oklch(0.75 0.15 75)',
  pending: 'oklch(0.65 0.19 250)',
  withdrawn: 'oklch(0.60 0.05 250)',
};

export default function LenderAnalyticsPage() {
  const { toast } = useToast();
  const [data, setData] = useState<LenderAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('all');

  useEffect(() => {
    setLoading(true);
    api.get(`/lenders/analytics?period=${period}`)
      .then(({ data }) => setData(data))
      .catch(() => toast('Failed to load analytics', 'error'))
      .finally(() => setLoading(false));
  }, [period]);

  const periods = [
    { value: '30d', label: '30 Days' },
    { value: '90d', label: '90 Days' },
    { value: '6m', label: '6 Months' },
    { value: '1y', label: '1 Year' },
    { value: 'all', label: 'All Time' },
  ];

  // Prepare pie chart data from totals
  const pieData = data ? [
    { name: 'Approved', value: data.totals.total_approved },
    { name: 'Declined', value: data.totals.total_declined },
    { name: 'Conditional', value: data.by_lender.reduce((sum, l) => sum + l.conditional, 0) },
    { name: 'Pending', value: data.by_lender.reduce((sum, l) => sum + l.pending, 0) },
    { name: 'Withdrawn', value: data.by_lender.reduce((sum, l) => sum + l.withdrawn, 0) },
  ].filter(d => d.value > 0) : [];

  const pieColors = ['oklch(0.72 0.19 150)', 'oklch(0.65 0.16 25)', 'oklch(0.75 0.15 75)', 'oklch(0.65 0.19 250)', 'oklch(0.60 0.05 250)'];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Lender Analytics"
        subtitle="Submission performance across lenders"
        action={
          <div className="flex items-center gap-1 rounded-xl bg-secondary p-1">
            {periods.map(p => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all ${
                  period === p.value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />

      {/* Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Total Submissions"
          value={data?.totals.total_submissions ?? 0}
          loading={loading}
          gradient="from-primary to-primary"
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" /></svg>}
        />
        <StatCard
          label="Approval Rate"
          value={data ? `${data.totals.overall_approval_rate}%` : '0%'}
          loading={loading}
          gradient="from-success to-success"
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>}
        />
        <StatCard
          label="Avg Turnaround"
          value={data?.totals.avg_turnaround_days != null ? `${data.totals.avg_turnaround_days}d` : 'N/A'}
          loading={loading}
          gradient="from-chart-4 to-chart-4"
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>}
        />
      </div>

      {/* Charts Row 1 */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Bar Chart - Submissions by Lender */}
        <GlassCard>
          <h3 className="text-[15px] font-semibold text-foreground mb-4">Submissions by Lender</h3>
          {!loading && data && data.by_lender.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.by_lender} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.5 0 0 / 0.1)" />
                <XAxis type="number" tick={{ fontSize: 12, fill: 'oklch(0.55 0 0)' }} />
                <YAxis dataKey="lender_name" type="category" width={100} tick={{ fontSize: 12, fill: 'oklch(0.55 0 0)' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'oklch(0.98 0 0)', border: '1px solid oklch(0.9 0 0)', borderRadius: '12px', fontSize: '13px' }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Bar dataKey="approved" stackId="a" fill={STATUS_COLORS.approved} name="Approved" radius={[0, 0, 0, 0]} />
                <Bar dataKey="declined" stackId="a" fill={STATUS_COLORS.declined} name="Declined" />
                <Bar dataKey="conditional" stackId="a" fill={STATUS_COLORS.conditional} name="Conditional" />
                <Bar dataKey="pending" stackId="a" fill={STATUS_COLORS.pending} name="Pending" />
                <Bar dataKey="withdrawn" stackId="a" fill={STATUS_COLORS.withdrawn} name="Withdrawn" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground text-[14px]">
              {loading ? 'Loading...' : 'No submission data yet'}
            </div>
          )}
        </GlassCard>

        {/* Pie Chart - Outcome Breakdown */}
        <GlassCard>
          <h3 className="text-[15px] font-semibold text-foreground mb-4">Outcome Breakdown</h3>
          {!loading && pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={110}
                  paddingAngle={3}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                >
                  {pieData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={pieColors[index % pieColors.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: 'oklch(0.98 0 0)', border: '1px solid oklch(0.9 0 0)', borderRadius: '12px', fontSize: '13px' }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground text-[14px]">
              {loading ? 'Loading...' : 'No submission data yet'}
            </div>
          )}
        </GlassCard>
      </div>

      {/* Charts Row 2 */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Line Chart - Monthly Trend */}
        <GlassCard>
          <h3 className="text-[15px] font-semibold text-foreground mb-4">Monthly Trend</h3>
          {!loading && data && data.monthly_trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data.monthly_trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.5 0 0 / 0.1)" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: 'oklch(0.55 0 0)' }} />
                <YAxis tick={{ fontSize: 12, fill: 'oklch(0.55 0 0)' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'oklch(0.98 0 0)', border: '1px solid oklch(0.9 0 0)', borderRadius: '12px', fontSize: '13px' }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Line type="monotone" dataKey="submissions" stroke="oklch(0.65 0.19 250)" strokeWidth={2} name="Submissions" dot={{ r: 4 }} />
                <Line type="monotone" dataKey="approvals" stroke="oklch(0.72 0.19 150)" strokeWidth={2} name="Approvals" dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground text-[14px]">
              {loading ? 'Loading...' : 'No monthly data yet'}
            </div>
          )}
        </GlassCard>

        {/* Bar Chart - Approval Rate by Lender */}
        <GlassCard>
          <h3 className="text-[15px] font-semibold text-foreground mb-4">Approval Rate by Lender</h3>
          {!loading && data && data.by_lender.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.by_lender} margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.5 0 0 / 0.1)" />
                <XAxis dataKey="lender_name" tick={{ fontSize: 12, fill: 'oklch(0.55 0 0)' }} />
                <YAxis tick={{ fontSize: 12, fill: 'oklch(0.55 0 0)' }} domain={[0, 100]} unit="%" />
                <Tooltip
                  contentStyle={{ backgroundColor: 'oklch(0.98 0 0)', border: '1px solid oklch(0.9 0 0)', borderRadius: '12px', fontSize: '13px' }}
                  formatter={(value) => [`${value}%`, 'Approval Rate']}
                />
                <Bar dataKey="approval_rate" fill="oklch(0.72 0.19 150)" radius={[8, 8, 0, 0]} name="Approval Rate" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground text-[14px]">
              {loading ? 'Loading...' : 'No submission data yet'}
            </div>
          )}
        </GlassCard>
      </div>

      {/* Summary Table */}
      {!loading && data && data.by_lender.length > 0 && (
        <GlassCard padding="none">
          <div className="px-5 py-3 border-b border-border/60">
            <h3 className="text-[15px] font-semibold text-foreground">Lender Summary</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border/60">
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Lender</th>
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Total</th>
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Approved</th>
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Declined</th>
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Conditional</th>
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Pending</th>
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Approval Rate</th>
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Avg Days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {data.by_lender.map(l => (
                  <tr key={l.lender_id} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-5 py-3 text-[14px] font-medium text-foreground">{l.lender_name}</td>
                    <td className="px-5 py-3 text-[14px] text-muted-foreground text-right">{l.total_submissions}</td>
                    <td className="px-5 py-3 text-[14px] text-success text-right font-medium">{l.approved}</td>
                    <td className="px-5 py-3 text-[14px] text-destructive text-right font-medium">{l.declined}</td>
                    <td className="px-5 py-3 text-[14px] text-warning text-right">{l.conditional}</td>
                    <td className="px-5 py-3 text-[14px] text-muted-foreground text-right">{l.pending}</td>
                    <td className="px-5 py-3 text-[14px] text-foreground text-right font-semibold">{l.approval_rate}%</td>
                    <td className="px-5 py-3 text-[14px] text-muted-foreground text-right">{l.avg_turnaround_days ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}
    </div>
  );
}
