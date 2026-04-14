import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { PageHeader, StatCard, Button } from '../../components/ui';

interface TenantSummary {
  total: number;
  active: number;
  inactive: number;
}

export default function PlatformDashboard() {
  const [stats, setStats] = useState<TenantSummary>({ total: 0, active: 0, inactive: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/super-admin/tenants?per_page=1'),
      api.get('/super-admin/tenants?per_page=1&is_active=true'),
      api.get('/super-admin/tenants?per_page=1&is_active=false'),
    ])
      .then(([all, active, inactive]) => {
        setStats({
          total: all.data.total,
          active: active.data.total,
          inactive: inactive.data.total,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">
      <PageHeader
        title="Platform Overview"
        subtitle="Manage tenants and oversee the platform"
        action={
          <Link to="/platform/tenants/new">
            <Button>Create Tenant</Button>
          </Link>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <StatCard
          label="Total Tenants"
          value={stats.total}
          loading={loading}
          icon={
            <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5M3.75 3v18m16.5-18v18M5.25 3h13.5M5.25 21h13.5M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
            </svg>
          }
          gradient=""
        />
        <StatCard
          label="Active"
          value={stats.active}
          loading={loading}
          valueColor="text-[#34c759]"
          icon={
            <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          }
          gradient=""
        />
        <StatCard
          label="Inactive"
          value={stats.inactive}
          loading={loading}
          valueColor="text-muted-foreground"
          icon={
            <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          }
          gradient=""
        />
      </div>

      <div className="rounded-2xl bg-card text-card-foreground shadow-[0_0_0_1px_var(--border),0_1px_3px_0_rgba(0,0,0,0.04)] p-6">
        <h2 className="text-[17px] font-semibold text-foreground mb-3">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <Link to="/platform/tenants/new">
            <Button variant="secondary" size="sm">Create New Tenant</Button>
          </Link>
          <Link to="/platform/tenants">
            <Button variant="secondary" size="sm">View All Tenants</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
