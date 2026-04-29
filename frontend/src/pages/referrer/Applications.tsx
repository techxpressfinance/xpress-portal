import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { formatDate, getInitials } from '../../lib/utils';
import { GlassCard, Badge, PageHeader, Button, Select, Input } from '../../components/ui';
import { LOAN_TYPE_LABELS } from '../../lib/constants';

import type { LoanApplication } from '../../types';

export default function ReferrerApplications() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const [applications, setApplications] = useState<LoanApplication[]>([]);
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

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchData();
  };

  const totalPages = Math.ceil(total / perPage);

  return (
    <div>
      <PageHeader
        title="Referred Applications"
        subtitle="View applications from clients you've referred"
        action={
          <Link to="/referrer/add-lead">
            <Button size="sm">+ Add Lead</Button>
          </Link>
        }
      />

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
            <option value="application_received">Application Received</option>
            <option value="application_assessed">Application Assessed</option>
            <option value="submitted">Submitted</option>
            <option value="approval">Approval</option>
            <option value="settled">Settled</option>
            <option value="rejected">Rejected</option>
          </Select>
          <Select
            label="Loan Type"
            value={loanTypeFilter}
            onChange={(e) => { setLoanTypeFilter(e.target.value); setPage(1); }}
          >
            <option value="">All Types</option>
            {Object.entries(LOAN_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
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
            <p className="text-[14px] text-muted-foreground">No applications found from your referred clients</p>
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
                    <th className="hidden md:table-cell px-3 sm:px-6 py-4 text-[12px] font-medium text-muted-foreground">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {applications.map((app) => (
                    <tr
                      key={app.id}
                      className="transition-colors hover:bg-secondary/50 cursor-pointer"
                      onClick={() => navigate(`/referrer/applications/${app.id}`)}
                    >
                      <td className="px-3 sm:px-6 py-4">
                        {(() => {
                          const isDirectLead = app.user_id === currentUser?.id;
                          const displayName = isDirectLead
                            ? [app.applicant_first_name, app.applicant_last_name].filter(Boolean).join(' ') || null
                            : app.user_name;
                          const displayEmail = isDirectLead
                            ? (() => { try { return JSON.parse(app.lend_extra_data || '{}').applicant_email ?? null; } catch { return null; } })()
                            : app.user_email;
                          return (
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
                                <span className="text-[11px] font-semibold text-muted-foreground">
                                  {displayName ? getInitials(displayName) : app.user_id.slice(0, 2).toUpperCase()}
                                </span>
                              </div>
                              <div className="min-w-0">
                                <p className="text-[14px] font-medium text-foreground truncate">{displayName || app.user_id.slice(0, 8) + '...'}</p>
                                {displayEmail && <p className="text-[12px] text-muted-foreground truncate">{displayEmail}</p>}
                                <p className="sm:hidden text-[12px] text-muted-foreground">{LOAN_TYPE_LABELS[app.loan_type] || app.loan_type} &middot; ${Number(app.amount).toLocaleString()}</p>
                              </div>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="hidden sm:table-cell px-3 sm:px-6 py-4 text-[14px] font-medium text-foreground">{LOAN_TYPE_LABELS[app.loan_type] || app.loan_type}</td>
                      <td className="hidden md:table-cell px-3 sm:px-6 py-4 text-[14px] font-semibold text-foreground">${Number(app.amount).toLocaleString()}</td>
                      <td className="px-3 sm:px-6 py-4">
                        <Badge value={app.status} />
                      </td>
                      <td className="hidden md:table-cell px-3 sm:px-6 py-4 text-[13px] text-muted-foreground">
                        {formatDate(app.created_at)}
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
