import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { GlassCard, Badge, PageHeader, Button } from '../../components/ui';
import { formatDate } from '../../lib/utils';
import { LOAN_TYPE_ICONS } from '../../lib/constants';
import type { LoanApplication } from '../../types';

export default function Applications() {
  const [applications, setApplications] = useState<LoanApplication[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/applications')
      .then(({ data }) => setApplications(data.items))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader
        title="My Applications"
        subtitle="Track and manage all your loan applications"
        action={
          <Link to="/applications/new">
            <Button>+ New Application</Button>
          </Link>
        }
      />

      {loading ? (
        <GlassCard>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center justify-between rounded-xl bg-secondary/50 p-4">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-xl shimmer" />
                  <div className="space-y-2">
                    <div className="h-4 w-32 rounded shimmer" />
                    <div className="h-3 w-24 rounded shimmer" />
                  </div>
                </div>
                <div className="h-6 w-20 rounded-full shimmer" />
              </div>
            ))}
          </div>
        </GlassCard>
      ) : applications.length === 0 ? (
        <GlassCard className="px-6 py-16 text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
            <svg className="h-10 w-10 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
          </div>
          <h3 className="text-[15px] font-semibold text-foreground mb-1">No applications yet</h3>
          <p className="text-[14px] text-muted-foreground mb-5">Get started by creating your first loan application</p>
          <Link to="/applications/new">
            <Button>Create Application</Button>
          </Link>
        </GlassCard>
      ) : (
        <div className="space-y-3">
          {applications.map((app) => (
            <Link
              key={app.id}
              to={`/applications/${app.id}`}
              className="rounded-2xl bg-card shadow-[0_0_0_1px_var(--border),0_1px_3px_0_rgba(0,0,0,0.04),0_2px_8px_0_rgba(0,0,0,0.02)] flex items-center justify-between p-5 transition-all duration-200 hover:bg-secondary/40"
              style={{ transitionTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}
            >
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary text-xl">
                  {LOAN_TYPE_ICONS[app.loan_type] || '\u{1F4C4}'}
                </div>
                <div>
                  <p className="text-[14px] font-semibold text-foreground capitalize">
                    {app.loan_type} Loan
                  </p>
                  <p className="text-[13px] text-muted-foreground mt-0.5">
                    ${Number(app.amount).toLocaleString()} &middot; {formatDate(app.created_at)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge value={app.status} />
                <svg className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
