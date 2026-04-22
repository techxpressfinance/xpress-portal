import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { GlassCard, PageHeader, Button, Input } from '../../components/ui';
import { getErrorMessage, formatDate } from '../../lib/utils';
import type { ClientEngagementModel, ExternalReferral, ExternalReferrerStats } from '../../types';

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-secondary text-muted-foreground' },
  signed_up: { label: 'Signed Up', className: 'bg-chart-2/10 text-chart-2' },
  applied: { label: 'Applied', className: 'bg-success/10 text-success' },
};

export default function ReferrerDashboard() {
  const { toast } = useToast();
  const [referrals, setReferrals] = useState<ExternalReferral[]>([]);
  const [stats, setStats] = useState<ExternalReferrerStats>({ total_referred: 0, signed_up: 0, applied: 0 });
  const [loading, setLoading] = useState(true);

  // Refer form
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [engagementModel, setEngagementModel] = useState<ClientEngagementModel | ''>('');
  const [submitting, setSubmitting] = useState(false);

  const fetchData = () => {
    setLoading(true);
    Promise.all([
      api.get('/external-referrers/my-referrals'),
      api.get('/external-referrers/stats'),
    ])
      .then(([refRes, statsRes]) => {
        setReferrals(refRes.data);
        setStats(statsRes.data);
      })
      .catch(() => toast('Failed to load referrals', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRefer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast('Email is required', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post('/external-referrers/refer', {
        email: email.trim().toLowerCase(),
        full_name: fullName.trim() || null,
        client_engagement_model: engagementModel || null,
      });
      setReferrals((prev) => [data, ...prev]);
      setStats((prev) => ({
        ...prev,
        total_referred: prev.total_referred + 1,
        signed_up: prev.signed_up + (data.status !== 'pending' ? 1 : 0),
      }));
      setEmail('');
      setFullName('');
      setEngagementModel('');
      toast('Referral sent successfully', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to send referral'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader title="Referrer Dashboard" subtitle="Refer clients and track their application progress" />

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        {[
          { label: 'Total Referred', value: stats.total_referred, icon: (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" /></svg>
          ), color: 'text-primary bg-primary/10' },
          { label: 'Signed Up', value: stats.signed_up, icon: (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" /></svg>
          ), color: 'text-chart-2 bg-chart-2/10' },
          { label: 'Applied', value: stats.applied, icon: (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
          ), color: 'text-success bg-success/10' },
        ].map((stat) => (
          <GlassCard key={stat.label}>
            <div className="flex items-center gap-4">
              <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${stat.color}`}>
                {stat.icon}
              </div>
              <div>
                <p className="text-[13px] text-muted-foreground">{stat.label}</p>
                <p className="text-2xl font-bold text-foreground">{stat.value}</p>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Refer Form */}
        <GlassCard>
          <h3 className="text-[15px] font-semibold text-foreground mb-1">Refer Someone</h3>
          <p className="text-[13px] text-muted-foreground mb-4">
            Enter the client's email to send them an invitation to start a loan application.
          </p>
          <form onSubmit={handleRefer} className="space-y-4">
            <Input
              label="Email *"
              type="email"
              placeholder="client@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              label="Full Name"
              placeholder="Optional — for new clients"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
            <div>
              <p className="text-[13px] font-medium text-foreground mb-2">Preferred Client Engagement Model *</p>
              <p className="text-[12px] text-muted-foreground mb-3">How would you like us to manage this client relationship?</p>
              <div className="space-y-2">
                <label className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${engagementModel === 'self_managed' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}>
                  <input
                    type="radio"
                    name="engagement_model"
                    value="self_managed"
                    checked={engagementModel === 'self_managed'}
                    onChange={() => setEngagementModel('self_managed')}
                    className="mt-0.5 accent-primary"
                  />
                  <div>
                    <p className="text-[13px] font-medium text-foreground">I'll manage the client relationship</p>
                    <p className="text-[12px] text-muted-foreground">I will provide all required information — no direct client contact from your side.</p>
                  </div>
                </label>
                <label className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${engagementModel === 'direct_engagement' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}>
                  <input
                    type="radio"
                    name="engagement_model"
                    value="direct_engagement"
                    checked={engagementModel === 'direct_engagement'}
                    onChange={() => setEngagementModel('direct_engagement')}
                    className="mt-0.5 accent-primary"
                  />
                  <div>
                    <p className="text-[13px] font-medium text-foreground">You may engage the client directly</p>
                    <p className="text-[12px] text-muted-foreground">I'm comfortable with you contacting and working with the client directly.</p>
                  </div>
                </label>
              </div>
            </div>
            <Button type="submit" disabled={submitting || !engagementModel}>
              {submitting ? 'Sending...' : 'Send Referral'}
            </Button>
          </form>
        </GlassCard>

        {/* Referrals List */}
        <GlassCard padding="none">
          <div className="px-5 pt-5 pb-3">
            <h3 className="text-[15px] font-semibold text-foreground">Your Referrals</h3>
          </div>
          {loading ? (
            <div className="px-5 pb-5">
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg shimmer" />
                    <div className="space-y-1.5 flex-1">
                      <div className="h-3.5 w-32 rounded-lg shimmer" />
                      <div className="h-3 w-24 rounded-lg shimmer" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : referrals.length === 0 ? (
            <div className="px-5 pb-8 pt-4 text-center">
              <p className="text-[13px] text-muted-foreground">No referrals yet. Send your first referral above.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {referrals.map((ref) => {
                const badge = STATUS_STYLES[ref.status] || STATUS_STYLES.pending;
                return (
                  <div key={ref.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
                      <span className="text-[11px] font-semibold text-muted-foreground">
                        {(ref.referred_client_name || ref.referred_email).charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-foreground truncate">
                        {ref.referred_client_name || ref.referred_email}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {ref.referred_email} &middot; {formatDate(ref.created_at)}
                      </p>
                    </div>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${badge.className}`}>
                      {badge.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
