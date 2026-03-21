import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { formatDate, getInitials } from '../../lib/utils';
import { PageHeader, Input } from '../../components/ui';
import type { ApplicationStatus, LoanApplication } from '../../types';

const COLUMNS: { status: ApplicationStatus; label: string }[] = [
  { status: 'draft', label: 'Draft' },
  { status: 'submitted', label: 'Submitted' },
  { status: 'reviewing', label: 'Reviewing' },
  { status: 'approved', label: 'Approved' },
  { status: 'rejected', label: 'Rejected' },
];

const COLUMN_COLORS: Record<ApplicationStatus, string> = {
  draft: 'bg-muted-foreground',
  submitted: 'bg-primary',
  reviewing: 'bg-chart-4',
  approved: 'bg-success',
  rejected: 'bg-destructive',
};

export default function KanbanBoard() {
  const { toast } = useToast();
  const [applications, setApplications] = useState<LoanApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    const fetchAll = async () => {
      let page = 1;
      let all: LoanApplication[] = [];
      while (true) {
        const { data } = await api.get(`/applications?page=${page}&per_page=100`);
        all = all.concat(data.items);
        if (all.length >= data.total) break;
        page++;
      }
      return all;
    };
    fetchAll()
      .then(setApplications)
      .catch(() => toast('Failed to load applications', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = applications.filter((app) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (app.user_name || '').toLowerCase().includes(q) ||
      (app.user_email || '').toLowerCase().includes(q) ||
      app.loan_type.toLowerCase().includes(q)
    );
  });

  const grouped = COLUMNS.map((col) => ({
    ...col,
    items: filtered.filter((app) => app.status === col.status),
  }));

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
        <PageHeader title="Application Board" subtitle="Kanban view of all loan applications" />
        <div className="flex items-center gap-3">
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients..."
            className="w-48"
          />
          <Link
            to="/admin/applications"
            className="text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
          >
            List view
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {COLUMNS.map((col) => (
            <div key={col.status} className="min-w-[280px] flex-1">
              <div className="h-8 w-24 rounded-lg shimmer mb-3" />
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-28 rounded-xl shimmer" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {grouped.map((col) => (
            <div key={col.status} className="min-w-[260px] flex-1">
              {/* Column header */}
              <div className="flex items-center gap-2.5 mb-3 px-1">
                <div className={`h-2.5 w-2.5 rounded-full ${COLUMN_COLORS[col.status]}`} />
                <span className="text-[13px] font-semibold text-foreground">{col.label}</span>
                <span className="ml-auto rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {col.items.length}
                </span>
              </div>

              {/* Column body */}
              <div className="space-y-2.5 rounded-xl bg-secondary/30 p-2.5 min-h-[200px]">
                {col.items.length === 0 ? (
                  <div className="flex items-center justify-center py-8">
                    <p className="text-[12px] text-muted-foreground">No applications</p>
                  </div>
                ) : (
                  col.items.map((app) => (
                    <Link
                      key={app.id}
                      to={`/admin/applications/${app.id}`}
                      className="block rounded-xl bg-background border border-border p-3.5 transition-all duration-200 hover:border-primary/30 hover:shadow-sm"
                    >
                      {/* Client info */}
                      <div className="flex items-center gap-2.5 mb-2.5">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary">
                          <span className="text-[10px] font-semibold text-muted-foreground">
                            {app.user_name ? getInitials(app.user_name) : '??'}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-foreground truncate">
                            {app.user_name || 'Unknown'}
                          </p>
                          {app.user_email && (
                            <p className="text-[11px] text-muted-foreground truncate">{app.user_email}</p>
                          )}
                        </div>
                      </div>

                      {/* Loan details */}
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[12px] font-medium text-muted-foreground capitalize">{app.loan_type}</span>
                        <span className="text-[13px] font-semibold text-foreground">
                          ${Number(app.amount).toLocaleString()}
                        </span>
                      </div>

                      {/* Footer */}
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-muted-foreground">{formatDate(app.created_at)}</span>
                        {app.assigned_brokers.length > 0 && (
                          <div className="flex -space-x-1.5">
                            {app.assigned_brokers.slice(0, 3).map((ab) => (
                              <div
                                key={ab.id}
                                className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[8px] font-semibold text-primary-foreground border-2 border-background"
                                title={ab.full_name}
                              >
                                {getInitials(ab.full_name)}
                              </div>
                            ))}
                            {app.assigned_brokers.length > 3 && (
                              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-secondary text-[8px] font-medium text-muted-foreground border-2 border-background">
                                +{app.assigned_brokers.length - 3}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
