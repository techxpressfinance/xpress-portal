import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { Card, StatCard, DatePicker, Select, EmptyState, ChartSkeleton } from '../../components/ui';
import { LOAN_CATEGORIES } from '../../lib/constants';
import { LOAN_TYPE_LABELS } from '../../lib/constants';
import { fmtMoneyK, relativeTime } from '../../lib/utils';
import type { LoanCategory, SettledDealsOverview, SettledDealSnapshotOut } from '../../types';
import { ArrowTrendingUpIcon, CheckCircleIcon, CurrencyDollarIcon } from '@heroicons/react/24/outline';

const CATEGORY_COLORS: Record<string, string> = {
  asset_finance: 'oklch(0.55 0.22 268)',
  home_loan: 'oklch(0.72 0.15 65)',
  commercial: 'oklch(0.62 0.15 155)',
  uncategorized: 'oklch(0.62 0.02 0)',
};

const CATEGORY_LABEL: Record<string, string> = {
  ...Object.fromEntries(LOAN_CATEGORIES.map((c) => [c.value, c.label])),
  uncategorized: 'Uncategorized',
};

const TOOLTIP_STYLE = {
  backgroundColor: 'oklch(0.98 0 0)',
  border: '1px solid oklch(0.9 0 0)',
  borderRadius: '12px',
  fontSize: '13px',
} as const;

function fmtMonth(m: string): string {
  return new Date(m + '-02').toLocaleDateString('en-AU', { month: 'short', year: '2-digit' });
}

export default function SettledDealsAnalyticsPage() {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [data, setData] = useState<SettledDealsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('12m');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [category, setCategory] = useState<LoanCategory | ''>('');

  // Drill-down selection
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [deals, setDeals] = useState<SettledDealSnapshotOut[]>([]);
  const [dealsLoading, setDealsLoading] = useState(true);

  const rangeParams = useMemo(() => {
    const params = new URLSearchParams({ period });
    if (period === 'custom') {
      if (!dateFrom || !dateTo) return null;
      params.set('date_from', dateFrom);
      params.set('date_to', dateTo);
    }
    if (category) params.set('category', category);
    return params;
  }, [period, dateFrom, dateTo, category]);

  useEffect(() => {
    if (!rangeParams) return;
    setLoading(true);
    api.get(`/settled-deals/overview?${rangeParams}`)
      .then(({ data }) => setData(data))
      .catch(() => toast('Failed to load settled deals analytics', 'error'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeParams]);

  useEffect(() => {
    if (!rangeParams) return;
    const params = new URLSearchParams(rangeParams);
    if (selectedMonth) params.set('month', selectedMonth);
    if (selectedCategory) params.set('category', selectedCategory);
    setDealsLoading(true);
    api.get(`/settled-deals/deals?${params}`)
      .then(({ data }) => setDeals(data))
      .catch(() => toast('Failed to load deals', 'error'))
      .finally(() => setDealsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeParams, selectedMonth, selectedCategory]);

  const drillInto = (month: string | undefined, cat: string | null) => {
    if (!month) return;
    if (selectedMonth === month && selectedCategory === cat) {
      setSelectedMonth(null);
      setSelectedCategory(null);
    } else {
      setSelectedMonth(month);
      setSelectedCategory(cat);
    }
  };

  const activeCategories = useMemo(() => {
    const present = new Set<string>();
    (data?.monthly ?? []).forEach((m) => Object.keys(m.categories).forEach((c) => present.add(c)));
    return Array.from(present);
  }, [data]);

  const monthlyRows = useMemo(
    () => (data?.monthly ?? []).map((m) => ({
      month: m.month,
      label: fmtMonth(m.month),
      volume: m.volume,
      ...Object.fromEntries(activeCategories.map((c) => [c, m.categories[c as LoanCategory] ?? 0])),
    })),
    [data, activeCategories],
  );

  const periods = [
    { value: '6m', label: '6M' },
    { value: '12m', label: '12M' },
    { value: 'ytd', label: 'YTD' },
    { value: 'all', label: 'All' },
    { value: 'custom', label: 'Custom' },
  ];

  const dealsTitle = [
    selectedCategory ? CATEGORY_LABEL[selectedCategory] ?? selectedCategory : null,
    'Settled Deals',
    selectedMonth ? `— ${fmtMonth(selectedMonth)}` : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Select
          value={category}
          onChange={(e) => { setCategory(e.target.value as LoanCategory | ''); setSelectedMonth(null); setSelectedCategory(null); }}
          className="!h-9 min-w-[160px]"
        >
          <option value="">All categories</option>
          {LOAN_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </Select>
        <div className="flex items-center gap-1 rounded-xl bg-secondary p-1">
          {periods.map((p) => (
            <button
              key={p.value}
              onClick={() => { setPeriod(p.value); setSelectedMonth(null); setSelectedCategory(null); }}
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
        {period === 'custom' && (
          <div className="flex items-center gap-2">
            <DatePicker value={dateFrom} onChange={(v) => setDateFrom(v)} placeholder="From" className="text-[13px] h-8 py-1.5" />
            <span className="text-[13px] text-muted-foreground">to</span>
            <DatePicker value={dateTo} onChange={(v) => setDateTo(v)} placeholder="To" className="text-[13px] h-8 py-1.5" />
          </div>
        )}
      </div>

      {/* Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Total Settlements"
          value={data?.totals.total_settlements ?? 0}
          loading={loading}
          gradient="from-primary to-primary"
          icon={<CheckCircleIcon className="h-5 w-5" />}
        />
        <StatCard
          label="Total Volume"
          value={fmtMoneyK(data?.totals.total_volume ?? 0)}
          loading={loading}
          gradient="from-chart-4 to-chart-4"
          icon={<CurrencyDollarIcon className="h-5 w-5" />}
        />
        <StatCard
          label="Avg Loan Size"
          value={fmtMoneyK(data?.totals.avg_loan_size ?? 0)}
          loading={loading}
          gradient="from-chart-2 to-chart-2"
          icon={<ArrowTrendingUpIcon className="h-5 w-5" />}
        />
      </div>

      {/* Monthly settlements by category — click a segment to drill down */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[15px] font-semibold text-foreground">Settlements per Month by Category</h3>
          <p className="text-[12px] text-muted-foreground">Click a bar segment to see the deals behind it</p>
        </div>
        {!loading && monthlyRows.length > 0 ? (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={monthlyRows}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.5 0 0 / 0.1)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'oklch(0.55 0 0)' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'oklch(0.55 0 0)' }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              {activeCategories.map((c) => (
                <Bar
                  key={c}
                  dataKey={c}
                  stackId="deals"
                  fill={CATEGORY_COLORS[c] ?? 'oklch(0.55 0.22 268)'}
                  name={CATEGORY_LABEL[c] ?? c}
                  cursor="pointer"
                  onClick={((d: { payload?: { month?: string } }) => drillInto(d?.payload?.month, c)) as never}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : loading ? (
          <ChartSkeleton height={320} />
        ) : (
          <div className="flex items-center justify-center h-[320px] text-muted-foreground text-[14px]">
            No settled deals in this period
          </div>
        )}
      </Card>

      {/* Monthly volume */}
      <Card>
        <h3 className="text-[15px] font-semibold text-foreground mb-4">Monthly Volume</h3>
        {!loading && monthlyRows.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthlyRows} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.5 0 0 / 0.1)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'oklch(0.55 0 0)' }} />
              <YAxis tickFormatter={((v: number) => fmtMoneyK(v)) as never} width={90} tick={{ fontSize: 12, fill: 'oklch(0.55 0 0)' }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={((v: number) => fmtMoneyK(v)) as never} />
              <Bar
                dataKey="volume"
                fill="oklch(0.55 0.22 268)"
                name="Settled Volume"
                radius={[4, 4, 0, 0]}
                cursor="pointer"
                onClick={((d: { payload?: { month?: string } }) => drillInto(d?.payload?.month, null)) as never}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : loading ? (
          <ChartSkeleton height={280} />
        ) : (
          <div className="flex items-center justify-center h-[280px] text-muted-foreground text-[14px]">
            No settled deals in this period
          </div>
        )}
      </Card>

      {/* By lender / by referrer */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card padding="none">
          <div className="px-5 py-3 border-b border-border/60">
            <h3 className="text-[15px] font-semibold text-foreground">By Lender</h3>
          </div>
          {!loading && data && data.by_lender.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border/60">
                    <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Lender</th>
                    <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Deals</th>
                    <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Volume</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {data.by_lender.map((l) => (
                    <tr key={l.lender_id ?? 'none'}>
                      <td className="px-5 py-3 text-[14px] font-medium text-foreground">{l.lender_name}</td>
                      <td className="px-5 py-3 text-[14px] text-muted-foreground text-right">{l.count}</td>
                      <td className="px-5 py-3 text-[14px] text-foreground text-right font-medium">{fmtMoneyK(l.volume)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-8"><EmptyState title="No lender data" description="No settled deals in this period." /></div>
          )}
        </Card>

        <Card padding="none">
          <div className="px-5 py-3 border-b border-border/60">
            <h3 className="text-[15px] font-semibold text-foreground">By Referrer</h3>
          </div>
          {!loading && data && data.by_referrer.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border/60">
                    <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Referrer</th>
                    <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Deals</th>
                    <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Volume</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {data.by_referrer.map((r) => (
                    <tr key={r.referrer_id ?? 'none'}>
                      <td className="px-5 py-3 text-[14px] font-medium text-foreground">{r.referrer_name}</td>
                      <td className="px-5 py-3 text-[14px] text-muted-foreground text-right">{r.count}</td>
                      <td className="px-5 py-3 text-[14px] text-foreground text-right font-medium">{fmtMoneyK(r.volume)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-8"><EmptyState title="No referrer data" description="No settled deals in this period." /></div>
          )}
        </Card>
      </div>

      {/* Drill-down: settled deals list */}
      <Card padding="none">
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-border/60">
          <h3 className="text-[15px] font-semibold text-foreground">{dealsTitle}</h3>
          {(selectedMonth || selectedCategory) && (
            <button
              onClick={() => { setSelectedMonth(null); setSelectedCategory(null); }}
              className="ml-auto rounded-lg bg-secondary px-2.5 py-1 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear selection ✕
            </button>
          )}
        </div>
        {dealsLoading ? (
          <div className="flex items-center justify-center h-[120px] text-muted-foreground text-[14px]">Loading...</div>
        ) : deals.length === 0 ? (
          <div className="py-8"><EmptyState title="No deals" description="No settled deals match the current selection." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border/60">
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Client</th>
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Type</th>
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Amount</th>
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Broker</th>
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Lender</th>
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Referrer</th>
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Settled</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {deals.map((d) => (
                  <tr
                    key={d.id}
                    className="cursor-pointer hover:bg-secondary/30 transition-colors"
                    onClick={() => navigate(`/admin/applications/${d.application_id}`)}
                  >
                    <td className="px-5 py-3 text-[14px] font-medium text-foreground">{d.client_name}</td>
                    <td className="px-5 py-3 text-[14px] text-muted-foreground">{LOAN_TYPE_LABELS[d.loan_type] ?? d.loan_type}</td>
                    <td className="px-5 py-3 text-[14px] text-foreground text-right font-medium">{fmtMoneyK(d.amount)}</td>
                    <td className="px-5 py-3 text-[14px] text-muted-foreground">{d.broker_name}</td>
                    <td className="px-5 py-3 text-[14px] text-muted-foreground">{d.lender_name}</td>
                    <td className="px-5 py-3 text-[14px] text-muted-foreground">{d.referrer_name}</td>
                    <td className="px-5 py-3 text-[13px] text-muted-foreground text-right">{relativeTime(d.snapshot_month)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
