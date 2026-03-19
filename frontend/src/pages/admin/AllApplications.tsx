import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useBrokerAssignment } from '../../hooks/useBrokerAssignment';
import { useToast } from '../../components/Toast';
import { formatDate, getInitials } from '../../lib/utils';
import { GlassCard, Badge, PageHeader, Button, Select, Input } from '../../components/ui';
import type { LoanApplication, User } from '../../types';

export default function AllApplications() {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const { assignBroker, unassignBroker } = useBrokerAssignment();
  const [applications, setApplications] = useState<LoanApplication[]>([]);
  const [brokers, setBrokers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [loanTypeFilter, setLoanTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const perPage = 15;

  const fetchData = () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('per_page', String(perPage));
    if (statusFilter) params.set('status', statusFilter);
    if (loanTypeFilter) params.set('loan_type', loanTypeFilter);
    if (search) params.set('search', search);

    api
      .get(`/applications?${params}`)
      .then(({ data }) => {
        setApplications(data.items);
        setTotal(data.total);
      })
      .catch(() => toast('Failed to load applications', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
  }, [page, statusFilter, loanTypeFilter]);

  useEffect(() => {
    if (currentUser?.role === 'admin') {
      api.get('/users').then(({ data }) => {
        setBrokers(data.filter((u: User) => u.role === 'broker'));
      }).catch(() => toast('Failed to load brokers', 'error'));
    }
  }, [currentUser]);

  const handleAssignBroker = async (appId: string, brokerId: string) => {
    const updated = await assignBroker(appId, brokerId);
    if (updated) setApplications((prev) => prev.map((a) => (a.id === appId ? updated : a)));
  };

  const handleUnassignBroker = async (appId: string, brokerId: string) => {
    const updated = await unassignBroker(appId, brokerId);
    if (updated) setApplications((prev) => prev.map((a) => (a.id === appId ? updated : a)));
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchData();
  };

  const totalPages = Math.ceil(total / perPage);

  return (
    <div>
      <PageHeader title="All Applications" subtitle="Manage and review all loan applications" />

      {/* Filters */}
      <GlassCard className="mb-6">
        <form onSubmit={handleSearch} className="flex flex-wrap gap-4 items-end">
          <Select
            label="Status"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="reviewing">Reviewing</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </Select>
          <Select
            label="Loan Type"
            value={loanTypeFilter}
            onChange={(e) => { setLoanTypeFilter(e.target.value); setPage(1); }}
          >
            <option value="">All Types</option>
            <option value="personal">Personal</option>
            <option value="home">Home</option>
            <option value="business">Business</option>
            <option value="vehicle">Vehicle</option>
          </Select>
          <div className="flex-1 min-w-[140px] sm:min-w-[200px]">
            <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Search Client</label>
            <div className="flex gap-2">
              <Input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name or email..."
                className="flex-1"
              />
              <Button type="submit">Search</Button>
            </div>
          </div>
        </form>
      </GlassCard>

      {/* Table */}
      <GlassCard padding="none">
        {loading ? (
          <div className="p-6">
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-lg shimmer" />
                    <div className="space-y-2">
                      <div className="h-4 w-32 rounded-lg shimmer" />
                      <div className="h-3 w-24 rounded-lg shimmer" />
                    </div>
                  </div>
                  <div className="h-6 w-20 rounded-full shimmer" />
                </div>
              ))}
            </div>
          </div>
        ) : applications.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
              <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
            </div>
            <p className="text-[14px] text-muted-foreground">No applications found</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[14px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-3 sm:px-6 py-4 text-[12px] font-medium text-muted-foreground">Client</th>
                    <th className="hidden sm:table-cell px-3 sm:px-6 py-4 text-[12px] font-medium text-muted-foreground">Type</th>
                    <th className="hidden md:table-cell px-3 sm:px-6 py-4 text-[12px] font-medium text-muted-foreground">Amount</th>
                    <th className="px-3 sm:px-6 py-4 text-[12px] font-medium text-muted-foreground">Status</th>
                    <th className="hidden lg:table-cell px-3 sm:px-6 py-4 text-[12px] font-medium text-muted-foreground">Assigned Broker</th>
                    <th className="hidden md:table-cell px-3 sm:px-6 py-4 text-[12px] font-medium text-muted-foreground">Created</th>
                    <th className="px-3 sm:px-6 py-4 text-[12px] font-medium text-muted-foreground"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {applications.map((app) => (
                    <tr key={app.id} className="transition-colors hover:bg-secondary/50" style={{ transitionTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}>
                      <td className="px-3 sm:px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
                            <span className="text-[11px] font-semibold text-muted-foreground">
                              {app.user_name
                                ? getInitials(app.user_name)
                                : app.user_id.slice(0, 2).toUpperCase()}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[14px] font-medium text-foreground truncate">{app.user_name || app.user_id.slice(0, 8) + '...'}</p>
                            {app.user_email && <p className="text-[12px] text-muted-foreground truncate">{app.user_email}</p>}
                            <p className="sm:hidden text-[12px] text-muted-foreground capitalize">{app.loan_type} &middot; ${Number(app.amount).toLocaleString()}</p>
                          </div>
                        </div>
                      </td>
                      <td className="hidden sm:table-cell px-3 sm:px-6 py-4 text-[14px] font-medium capitalize text-foreground">{app.loan_type}</td>
                      <td className="hidden md:table-cell px-3 sm:px-6 py-4 text-[14px] font-semibold text-foreground">${Number(app.amount).toLocaleString()}</td>
                      <td className="px-3 sm:px-6 py-4">
                        <Badge value={app.status} />
                      </td>
                      <td className="hidden lg:table-cell px-3 sm:px-6 py-4">
                        {currentUser?.role === 'admin' ? (
                          <div className="min-w-[160px]">
                            {app.assigned_brokers.length > 0 && (
                              <div className="flex flex-wrap gap-1 mb-1.5">
                                {app.assigned_brokers.map((ab) => (
                                  <span key={ab.id} className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                                    {ab.full_name}
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleUnassignBroker(app.id, ab.id); }}
                                      className="hover:text-destructive ml-0.5"
                                    >
                                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                                    </button>
                                  </span>
                                ))}
                              </div>
                            )}
                            <select
                              value=""
                              onChange={(e) => { if (e.target.value) handleAssignBroker(app.id, e.target.value); }}
                              className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[12px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
                              style={{ transitionTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}
                            >
                              <option value="">{app.assigned_brokers.length > 0 ? 'Add another...' : 'Assign broker...'}</option>
                              {brokers
                                .filter((b) => !app.assigned_brokers.some((ab) => ab.id === b.id))
                                .map((b) => (
                                  <option key={b.id} value={b.id}>{b.full_name}</option>
                                ))}
                            </select>
                          </div>
                        ) : app.assigned_brokers.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {app.assigned_brokers.map((ab) => (
                              <div key={ab.id} className="flex items-center gap-1.5">
                                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary">
                                  <span className="text-[9px] font-semibold text-primary-foreground">
                                    {getInitials(ab.full_name)}
                                  </span>
                                </div>
                                <span className="text-[13px] font-medium text-foreground">{ab.full_name}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[13px] text-muted-foreground italic">Unassigned</span>
                        )}
                      </td>
                      <td className="hidden md:table-cell px-3 sm:px-6 py-4 text-[13px] text-muted-foreground">
                        {formatDate(app.created_at)}
                      </td>
                      <td className="px-3 sm:px-6 py-4">
                        <Link to={`/admin/applications/${app.id}`}>
                          <Button variant="ghost" size="sm">Review</Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 sm:px-6 py-4">
                <span className="text-[13px] text-muted-foreground">
                  {(page - 1) * perPage + 1}&ndash;{Math.min(page * perPage, total)} of {total}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </GlassCard>
    </div>
  );
}
