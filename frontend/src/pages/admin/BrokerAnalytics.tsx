import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import api from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/Toast';
import { Card, StatCard, DatePicker, Select, EmptyState } from '../../components/ui';
import { STATUS_LABEL, STATUS_BADGE, LOAN_TYPE_LABELS } from '../../lib/constants';
import { fmtMoneyK, relativeTime } from '../../lib/utils';
import type { ApplicationStatus, BrokerAnalytics, BrokerAnalyticsDeal } from '../../types';
import { ArrowTrendingUpIcon, CheckCircleIcon, CurrencyDollarIcon, FolderIcon } from '@heroicons/react/24/outline';

// App-wide status colors (same hues as the applications list chips)
const STATUS_COLORS: Record<ApplicationStatus, string> = {
  draft: 'oklch(0.62 0.02 0)',
  application_received: 'oklch(0.62 0.12 230)',
  application_assessed: 'oklch(0.55 0.19 300)',
  submitted: 'oklch(0.55 0.22 268)',
  approval: 'oklch(0.72 0.15 65)',
  settled: 'oklch(0.62 0.15 155)',
  rejected: 'oklch(0.58 0.20 20)',
  not_proceeding: 'oklch(0.50 0.08 40)',
};

const STATUS_ORDER: ApplicationStatus[] = [
  'draft', 'application_received', 'application_assessed', 'submitted',
  'approval', 'settled', 'rejected', 'not_proceeding',
];

const TOOLTIP_STYLE = {
  backgroundColor: 'oklch(0.98 0 0)',
  border: '1px solid oklch(0.9 0 0)',
  borderRadius: '12px',
  fontSize: '13px',
} as const;

function fmtMonth(m: string): string {
  return new Date(m + '-02').toLocaleDateString('en-AU', { month: 'short', year: '2-digit' });
}

export default function BrokerAnalyticsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [data, setData] = useState<BrokerAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('12m');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [brokerId, setBrokerId] = useState('');
  const [brokerOptions, setBrokerOptions] = useState<{ id: string; name: string }[]>([]);

  // Drill-down selection
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<ApplicationStatus | null>(null);
  const [deals, setDeals] = useState<BrokerAnalyticsDeal[]>([]);
  const [dealsLoading, setDealsLoading] = useState(true);

  const isAdmin = user?.role === 'admin';

  const rangeParams = useMemo(() => {
    const params = new URLSearchParams({ period });
    if (period === 'custom') {
      if (!dateFrom || !dateTo) return null;
      params.set('date_from', dateFrom);
      params.set('date_to', dateTo);
    }
    if (brokerId) params.set('broker_id', brokerId);
    return params;
  }, [period, dateFrom, dateTo, brokerId]);

  useEffect(() => {
    if (!rangeParams) return;
    setLoading(true);
    api.get(`/broker-analytics/overview?${rangeParams}`)
      .then(({ data }) => {
        setData(data);
        if (!brokerId) {
          setBrokerOptions(
            (data as BrokerAnalytics).by_broker
              .filter((b) => b.broker_id)
              .map((b) => ({ id: b.broker_id as string, name: b.broker_name })),
          );
        }
      })
      .catch(() => toast('Failed to load broker analytics', 'error'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeParams]);

  useEffect(() => {
    if (!rangeParams) return;
    const params = new URLSearchParams(rangeParams);
    if (selectedMonth) params.set('month', selectedMonth);
    if (selectedStatus) params.set('status', selectedStatus);
    setDealsLoading(true);
    api.get(`/broker-analytics/applications?${params}`)
      .then(({ data }) => setDeals(data))
      .catch(() => toast('Failed to load deals', 'error'))
      .finally(() => setDealsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeParams, selectedMonth, selectedStatus]);

  const drillInto = (month: string | undefined, status: ApplicationStatus | null) => {
    if (!month) return;
    if (selectedMonth === month && selectedStatus === status) {
      setSelectedMonth(null);
      setSelectedStatus(null);
    } else {
      setSelectedMonth(month);
      setSelectedStatus(status);
    }
  };

  const monthlyRows = useMemo(
    () => (data?.monthly ?? []).map((m) => ({
      month: m.month,
      label: fmtMonth(m.month),
      volume: m.volume,
      settled_volume: m.settled_volume,
      ...Object.fromEntries(STATUS_ORDER.map((s) => [s, m.statuses[s] ?? 0])),
    })),
    [data],
  );

  const activeStatuses = useMemo(
    () => STATUS_ORDER.filter((s) => (data?.by_status[s]?.count ?? 0) > 0),
    [data],
  );

  const periods = [
    { value: '6m', label: '6M' },
    { value: '12m', label: '12M' },
    { value: 'ytd', label: 'YTD' },
    { value: 'all', label: 'All' },
    { value: 'custom', label: 'Custom' },
  ];

  const dealsTitle = [
    selectedStatus ? STATUS_LABEL[selectedStatus] : null,
    'Deals',
    selectedMonth ? `— ${fmtMonth(selectedMonth)}` : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {isAdmin && (
          <Select
            value={brokerId}
            onChange={(e) => { setBrokerId(e.target.value); setSelectedMonth(null); setSelectedStatus(null); }}
            className="!h-9 min-w-[160px]"
          >
            <option value="">All brokers</option>
            {brokerOptions.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
        )}
        <div className="flex items-center gap-1 rounded-xl bg-secondary p-1">
          {periods.map((p) => (
            <button
              key={p.value}
              onClick={() => { setPeriod(p.value); setSelectedMonth(null); setSelectedStatus(null); }}
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Deals"
          value={data?.totals.total_deals ?? 0}
          loading={loading}
          gradient="from-primary to-primary"
          icon={<FolderIcon className="h-5 w-5" />}
        />
        <StatCard
          label="Total Volume"
          value={fmtMoneyK(data?.totals.total_volume ?? 0)}
          loading={loading}
          gradient="from-chart-4 to-chart-4"
          icon={<CurrencyDollarIcon className="h-5 w-5" />}
        />
        <StatCard
          label="Settled Volume"
          value={fmtMoneyK(data?.totals.settled_volume ?? 0)}
          loading={loading}
          gradient="from-success to-success"
          icon={<CheckCircleIcon className="h-5 w-5" />}
        />
        <StatCard
          label="Conversion Rate"
          value={data?.totals.conversion_rate != null ? `${data.totals.conversion_rate}%` : 'N/A'}
          loading={loading}
          gradient="from-chart-2 to-chart-2"
          icon={<ArrowTrendingUpIcon className="h-5 w-5" />}
        />
      </div>

      {/* Monthly deals by status — click a segment to drill down */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[15px] font-semibold text-foreground">Deals per Month by Status</h3>
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
              {activeStatuses.map((s) => (
                <Bar
                  key={s}
                  dataKey={s}
                  stackId="deals"
                  fill={STATUS_COLORS[s]}
                  name={STATUS_LABEL[s]}
                  cursor="pointer"
                  onClick={((d: { payload?: { month?: string } }) => drillInto(d?.payload?.month, s)) as never}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-[320px] text-muted-foreground text-[14px]">
            {loading ? 'Loading...' : 'No deals in this period'}
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
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Bar
                dataKey="volume"
                fill="oklch(0.55 0.22 268)"
                name="Total Volume"
                radius={[4, 4, 0, 0]}
                cursor="pointer"
                onClick={((d: { payload?: { month?: string } }) => drillInto(d?.payload?.month, null)) as never}
              />
              <Bar
                dataKey="settled_volume"
                fill="oklch(0.62 0.15 155)"
                name="Settled Volume"
                radius={[4, 4, 0, 0]}
                cursor="pointer"
                onClick={((d: { payload?: { month?: string } }) => drillInto(d?.payload?.month, 'settled')) as never}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-[280px] text-muted-foreground text-[14px]">
            {loading ? 'Loading...' : 'No deals in this period'}
          </div>
        )}
      </Card>

      {/* Broker leaderboard */}
      {!loading && data && data.by_broker.length > 0 && (
        <Card padding="none">
          <div className="px-5 py-3 border-b border-border/60">
            <h3 className="text-[15px] font-semibold text-foreground">Broker Performance</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border/60">
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Broker</th>
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Deals</th>
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Volume</th>
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Active</th>
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Settled</th>
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Settled Volume</th>
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Conversion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {data.by_broker.map((b) => (
                  <tr
                    key={b.broker_id ?? 'unassigned'}
                    className={`transition-colors ${b.broker_id && isAdmin ? 'cursor-pointer hover:bg-secondary/30' : ''} ${brokerId && brokerId === b.broker_id ? 'bg-secondary/40' : ''}`}
                    onClick={() => {
                      if (!b.broker_id || !isAdmin) return;
                      setBrokerId(brokerId === b.broker_id ? '' : b.broker_id);
                      setSelectedMonth(null);
                      setSelectedStatus(null);
                    }}
                  >
                    <td className="px-5 py-3 text-[14px] font-medium text-foreground">{b.broker_name}</td>
                    <td className="px-5 py-3 text-[14px] text-muted-foreground text-right">{b.total}</td>
                    <td className="px-5 py-3 text-[14px] text-foreground text-right font-medium">{fmtMoneyK(b.volume)}</td>
                    <td className="px-5 py-3 text-[14px] text-muted-foreground text-right">{b.active}</td>
                    <td className="px-5 py-3 text-[14px] text-success text-right font-medium">{b.settled}</td>
                    <td className="px-5 py-3 text-[14px] text-success text-right">{fmtMoneyK(b.settled_volume)}</td>
                    <td className="px-5 py-3 text-[14px] text-foreground text-right font-semibold">{b.conversion_rate != null ? `${b.conversion_rate}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Drill-down: deals list */}
      <Card padding="none">
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-border/60">
          <h3 className="text-[15px] font-semibold text-foreground">{dealsTitle}</h3>
          {(selectedMonth || selectedStatus) && (
            <button
              onClick={() => { setSelectedMonth(null); setSelectedStatus(null); }}
              className="ml-auto rounded-lg bg-secondary px-2.5 py-1 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear selection ✕
            </button>
          )}
        </div>
        {dealsLoading ? (
          <div className="flex items-center justify-center h-[120px] text-muted-foreground text-[14px]">Loading...</div>
        ) : deals.length === 0 ? (
          <div className="py-8"><EmptyState title="No deals" description="No applications match the current selection." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border/60">
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Client</th>
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Type</th>
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Amount</th>
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Broker</th>
                  <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {deals.map((d) => (
                  <tr
                    key={d.id}
                    className="cursor-pointer hover:bg-secondary/30 transition-colors"
                    onClick={() => navigate(`/admin/applications/${d.id}`)}
                  >
                    <td className="px-5 py-3">
                      <p className="text-[14px] font-medium text-foreground">{d.client_name}</p>
                      {d.business_name && <p className="text-[12px] text-muted-foreground">{d.business_name}</p>}
                    </td>
                    <td className="px-5 py-3 text-[14px] text-muted-foreground">{LOAN_TYPE_LABELS[d.loan_type] ?? d.loan_type}</td>
                    <td className="px-5 py-3 text-[14px] text-foreground text-right font-medium">{fmtMoneyK(d.amount)}</td>
                    <td className="px-5 py-3">
                      <span className={`led-chip ${STATUS_BADGE[d.status] ?? ''}`}>{STATUS_LABEL[d.status] ?? d.status}</span>
                    </td>
                    <td className="px-5 py-3 text-[14px] text-muted-foreground">{d.brokers.length > 0 ? d.brokers.join(', ') : '—'}</td>
                    <td className="px-5 py-3 text-[13px] text-muted-foreground text-right">{relativeTime(d.created_at)}</td>
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
