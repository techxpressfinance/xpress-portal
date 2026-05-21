import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { PageHeader, Badge, Button } from '../../components/ui';
import { formatDate } from '../../lib/utils';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  primary_color: string | null;
  support_email: string | null;
  is_active: boolean;
  created_at: string;
}

export default function TenantManagement() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const perPage = 25;

  const fetchTenants = (p: number) => {
    setLoading(true);
    api
      .get(`/super-admin/tenants?page=${p}&per_page=${perPage}`)
      .then(({ data }) => {
        setTenants(data.items);
        setTotal(data.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchTenants(page);
  }, [page]);

  const toggleActive = async (tenant: Tenant) => {
    setToggling(tenant.id);
    try {
      await api.patch(`/super-admin/tenants/${tenant.id}`, {
        is_active: !tenant.is_active,
      });
      fetchTenants(page);
    } catch {
      // silently fail
    } finally {
      setToggling(null);
    }
  };

  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">
      <PageHeader
        title="Tenants"
        subtitle={`${total} tenant${total !== 1 ? 's' : ''}`}
        action={
          <Link to="/platform/tenants/new">
            <Button>Create Tenant</Button>
          </Link>
        }
      />

      <div className="rounded-2xl bg-card text-card-foreground shadow-[0_0_0_1px_var(--border),0_1px_3px_0_rgba(0,0,0,0.04)] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : tenants.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <p className="text-[15px]">No tenants yet</p>
            <Link to="/platform/tenants/new" className="text-[#0071e3] text-[14px] mt-2 inline-block">
              Create your first tenant
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border text-[13px] text-muted-foreground">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Slug</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Created</th>
                <th className="px-5 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0 hover:bg-secondary/30 transition-colors">
                  <td className="px-5 py-3.5">
                    <Link to={`/platform/tenants/${t.id}`} className="text-[14px] font-medium text-foreground hover:text-[#0071e3] transition-colors">
                      {t.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-[13px] text-muted-foreground font-mono">
                    {t.slug}
                  </td>
                  <td className="px-5 py-3.5">
                    <Badge type="custom" value={t.is_active ? 'Active' : 'Inactive'} className={t.is_active ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'} />
                  </td>
                  <td className="px-5 py-3.5 text-[13px] text-muted-foreground">
                    {formatDate(t.created_at)}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link to={`/platform/tenants/${t.id}`}>
                        <Button variant="secondary" size="sm">Edit</Button>
                      </Link>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => toggleActive(t)}
                        disabled={toggling === t.id}
                      >
                        {toggling === t.id ? '...' : t.is_active ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="text-[13px] text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
