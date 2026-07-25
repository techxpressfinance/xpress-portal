import { useAuth } from '../../hooks/useAuth';
import { useTabParam } from '../../hooks/useTabParam';
import { PageHeader } from '../../components/ui';
import BrokerAnalytics from './BrokerAnalytics';
import LenderAnalytics from './LenderAnalytics';
import SettledDealsAnalytics from './SettledDealsAnalytics';

const ALL_TABS = [
  { value: 'broker', label: 'Broker', adminOnly: false },
  { value: 'lender', label: 'Lender', adminOnly: false },
  { value: 'settled', label: 'Settled Deals', adminOnly: true },
] as const;

export default function AnalyticsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const tabs = ALL_TABS.filter((t) => !t.adminOnly || isAdmin);
  const [tab, setTab] = useTabParam('broker', ALL_TABS.map((t) => t.value));

  // A broker landing on the settled tab via a stale link falls back to Broker.
  const activeTab = tabs.some((t) => t.value === tab) ? tab : 'broker';

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Analytics"
        subtitle="Broker performance, lender submissions, and settled-deal volume"
      />

      <div className="flex items-center gap-1 rounded-xl bg-secondary p-1 w-fit">
        {tabs.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`rounded-lg px-4 py-1.5 text-[13px] font-medium transition-all ${
              activeTab === t.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'broker' && <BrokerAnalytics />}
      {activeTab === 'lender' && <LenderAnalytics />}
      {activeTab === 'settled' && isAdmin && <SettledDealsAnalytics />}
    </div>
  );
}
