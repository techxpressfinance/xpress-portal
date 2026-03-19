import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { useClipboard } from '../../hooks/useClipboard';
import { getErrorMessage, formatDate } from '../../lib/utils';
import { Button, GlassCard, Input, PageHeader, StatCard } from '../../components/ui';
import type { Referral, ReferralStats } from '../../types';

export default function Referrals() {
  const { toast } = useToast();
  const [referralLink, setReferralLink] = useState('');
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [sending, setSending] = useState(false);
  const { copied, copy } = useClipboard();

  useEffect(() => {
    Promise.all([
      api.get('/referrals/my-code'),
      api.get('/referrals/my-referrals'),
      api.get('/referrals/stats'),
    ])
      .then(([codeRes, referralsRes, statsRes]) => {
        setReferralLink(codeRes.data.link);
        setReferrals(referralsRes.data);
        setStats(statsRes.data);
      })
      .catch(() => toast('Failed to load referrals', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const handleCopy = async () => {
    const ok = await copy(referralLink);
    if (ok) toast('Referral link copied!', 'success');
    else toast('Failed to copy link', 'error');
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setSending(true);
    try {
      const { data } = await api.post('/referrals/invite', {
        email: inviteEmail.trim(),
        name: inviteName.trim() || null,
      });
      setReferrals((prev) => [data, ...prev]);
      setStats((prev) =>
        prev ? { ...prev, total_referred: prev.total_referred + 1 } : prev
      );
      setInviteEmail('');
      setInviteName('');
      toast('Invite sent!', 'success');
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to send invite'), 'error');
    } finally {
      setSending(false);
    }
  };

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      pending: 'bg-warning/10 text-warning',
      signed_up: 'bg-success/10 text-success',
      applied: 'bg-primary/10 text-primary',
    };
    return map[s] || 'bg-secondary text-muted-foreground';
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Referrals" subtitle="Invite friends and track your referrals" />
        <div className="grid gap-5 sm:grid-cols-3 mb-8">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-2xl shimmer" />
          ))}
        </div>
        <div className="h-40 rounded-2xl shimmer" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Referrals" subtitle="Invite friends and track your referrals" />

      {/* Stats */}
      {stats && (
        <div className="grid gap-5 sm:grid-cols-3 mb-8">
          <StatCard
            label="Total Referred"
            value={stats.total_referred}
            loading={false}
            gradient="from-primary to-primary"
            icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" /></svg>}
          />
          <StatCard
            label="Signed Up"
            value={stats.signed_up}
            loading={false}
            gradient="from-success to-success"
            icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>}
          />
          <StatCard
            label="Applied"
            value={stats.applied}
            loading={false}
            gradient="from-warning to-warning"
            icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>}
          />
        </div>
      )}

      {/* Referral Link */}
      <GlassCard className="mb-6">
        <h3 className="text-[15px] font-semibold text-foreground mb-4">Your Referral Link</h3>
        <div className="flex items-center gap-3">
          <div className="flex-1 rounded-xl bg-secondary px-4 py-2.5">
            <p className="text-[13px] text-foreground font-mono truncate">{referralLink}</p>
          </div>
          <Button
            variant={copied ? 'ghost' : 'primary'}
            size="sm"
            onClick={handleCopy}
          >
            {copied ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      </GlassCard>

      {/* Invite Form */}
      <GlassCard className="mb-8">
        <h3 className="text-[15px] font-semibold text-foreground mb-4">Invite by Email</h3>
        <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <Input
              placeholder="friend@email.com"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
            />
          </div>
          <div className="sm:w-48">
            <Input
              placeholder="Name (optional)"
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
            />
          </div>
          <Button type="submit" loading={sending} size="md">
            {sending ? 'Sending...' : 'Send Invite'}
          </Button>
        </form>
      </GlassCard>

      {/* Referral List */}
      <GlassCard padding="none">
        <div className="flex items-center justify-between border-b border-border px-6 py-5">
          <h3 className="text-[15px] font-semibold text-foreground">Your Referrals</h3>
          <span className="text-[13px] text-muted-foreground">{referrals.length} total</span>
        </div>
        {referrals.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
              <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" /></svg>
            </div>
            <p className="text-[15px] font-medium text-muted-foreground">No referrals yet</p>
            <p className="text-[13px] text-muted-foreground mt-1">Share your link or send an email invite to get started</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {referrals.map((ref) => (
              <div
                key={ref.id}
                className="flex items-center justify-between px-6 py-4 transition-all duration-200 hover:bg-secondary/50"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary">
                    <span className="text-[14px] font-semibold text-muted-foreground">
                      {(ref.referred_user_name || ref.referred_email || '?').charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-foreground truncate">
                      {ref.referred_user_name || ref.referred_email || 'Unknown'}
                    </p>
                    <p className="text-[12px] text-muted-foreground">
                      {formatDate(ref.created_at)}
                      {ref.converted_at && (
                        <> &middot; Converted {formatDate(ref.converted_at)}</>
                      )}
                    </p>
                  </div>
                </div>
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium capitalize ${statusBadge(ref.status)}`}>
                  {ref.status.replace('_', ' ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
