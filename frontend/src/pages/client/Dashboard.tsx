import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/Toast';
import { formatDate } from '../../lib/utils';
import { useClipboard } from '../../hooks/useClipboard';
import { GlassCard, StatCard, Badge, PageHeader, Button } from '../../components/ui';
import { KYC_CONFIG } from '../../lib/constants';
import type { LoanApplication, ReferralStats } from '../../types';

export default function ClientDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [applications, setApplications] = useState<LoanApplication[]>([]);
  const [referralStats, setReferralStats] = useState<ReferralStats | null>(null);
  const [referralLink, setReferralLink] = useState('');
  const [loading, setLoading] = useState(true);
  const { copied, copy } = useClipboard();

  useEffect(() => {
    api
      .get('/applications')
      .then(({ data }) => setApplications(data.items))
      .catch(() => toast('Failed to load applications', 'error'))
      .finally(() => setLoading(false));
    // Load referral stats
    Promise.all([
      api.get('/referrals/stats'),
      api.get('/referrals/my-code'),
    ])
      .then(([statsRes, codeRes]) => {
        setReferralStats(statsRes.data);
        setReferralLink(codeRes.data.link);
      })
      .catch(() => {});
  }, []);

  const handleCopyLink = () => copy(referralLink);

  const activeCount = applications.filter((a) => !['approved', 'rejected'].includes(a.status)).length;
  const kyc = KYC_CONFIG[user?.kyc_status || 'pending'];

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${user?.full_name?.split(' ')[0]}`}
        subtitle="Here's an overview of your loan applications"
        action={
          <Link to="/applications/new">
            <Button>+ New Application</Button>
          </Link>
        }
      />

      {/* Stats */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 mb-8">
        <StatCard
          label="Total Applications"
          value={applications.length}
          loading={loading}
          gradient="from-primary to-primary"
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>}
        />
        <StatCard
          label="Active"
          value={activeCount}
          loading={loading}
          gradient="from-success to-success"
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>}
        />
        <StatCard
          label="KYC Status"
          value={user?.kyc_status || 'pending'}
          loading={false}
          gradient={kyc.gradient}
          valueColor={kyc.color}
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" /></svg>}
        />
      </div>

      {/* Referral Card */}
      {referralStats && (
        <GlassCard className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" /></svg>
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-foreground">Refer & Earn</h3>
                <p className="text-[13px] text-muted-foreground">
                  {referralStats.total_referred} referred &middot; {referralStats.signed_up} signed up &middot; {referralStats.applied} applied
                </p>
              </div>
            </div>
            <Link to="/referrals" className="text-[13px] font-medium text-primary hover:text-primary/80 transition-colors">
              View all
            </Link>
          </div>
          {referralLink && (
            <div className="flex items-center gap-3">
              <div className="flex-1 rounded-xl bg-secondary px-4 py-2.5">
                <p className="text-[13px] text-foreground font-mono truncate">{referralLink}</p>
              </div>
              <button
                onClick={handleCopyLink}
                className="shrink-0 rounded-xl bg-primary px-4 py-2.5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                {copied ? 'Copied!' : 'Copy Link'}
              </button>
            </div>
          )}
        </GlassCard>
      )}

      {/* Recent Applications */}
      <GlassCard padding="none">
        <div className="flex items-center justify-between border-b border-border px-6 py-5">
          <h2 className="text-[15px] font-semibold text-foreground">Recent Applications</h2>
          <Link to="/applications" className="text-[13px] font-medium text-primary hover:text-primary/80 transition-colors">
            View all
          </Link>
        </div>
        {loading ? (
          <div className="p-6">
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-xl shimmer" />
                    <div className="space-y-2">
                      <div className="h-4 w-24 rounded shimmer" />
                      <div className="h-3 w-16 rounded shimmer" />
                    </div>
                  </div>
                  <div className="h-6 w-16 rounded-full shimmer" />
                </div>
              ))}
            </div>
          </div>
        ) : applications.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
              <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
            </div>
            <p className="text-[15px] text-muted-foreground mb-3">No applications yet</p>
            <Link to="/applications/new" className="text-[13px] font-medium text-primary hover:text-primary/80 transition-colors">
              Create your first application
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {applications.slice(0, 5).map((app) => (
              <Link
                key={app.id}
                to={`/applications/${app.id}`}
                className="flex items-center justify-between px-6 py-4 transition-all duration-200 hover:bg-secondary/50"
                style={{ transitionTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary">
                    <span className="text-[14px] font-semibold text-muted-foreground capitalize">
                      {app.loan_type.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="text-[14px] font-semibold text-foreground capitalize">
                      {app.loan_type} Loan
                    </p>
                    <p className="text-[13px] text-muted-foreground">
                      ${Number(app.amount).toLocaleString()} &middot; {formatDate(app.created_at)}
                    </p>
                  </div>
                </div>
                <Badge value={app.status} />
              </Link>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
