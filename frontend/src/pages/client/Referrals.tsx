import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { useClipboard } from '../../hooks/useClipboard';
import { getErrorMessage, formatDate } from '../../lib/utils';
import { Button, Card } from '../../components/ui';
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

  const statusDot = (s: string) => {
    const map: Record<string, string> = {
      pending: 'bg-amber-500',
      signed_up: 'bg-emerald-500',
      applied: 'bg-blue-500',
    };
    return map[s] || 'bg-gray-400';
  };

  if (loading) {
    return (
      <div>
        <div className="space-y-4">
          <div className="h-6 w-40 rounded shimmer" />
          <div className="grid gap-5 sm:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-2xl shimmer" />
            ))}
          </div>
          <div className="h-40 rounded-2xl shimmer" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col pb-8">
      <div className="mb-8 mt-2">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="led-chip led-chip-accent">Referrals</span>
        </div>
        <h1 className="text-[26px] sm:text-[34px] font-semibold tracking-[-0.05em] text-[var(--led-ink)]">Referrals</h1>
        <p className="mt-2 text-[14px] leading-6 text-[var(--led-muted)]">Invite friends and track your referrals</p>
      </div>

      {stats && (
        <div className="grid gap-5 sm:grid-cols-3 mb-8">
          <Card padding="none" className="h-full">
            <div className="h-1 bg-[var(--led-accent)]" />
            <div className="p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Total Referred</p>
              <p className="mt-3 text-[32px] font-semibold tracking-[-0.05em] led-tnum text-[var(--led-ink)]">{stats.total_referred}</p>
            </div>
          </Card>
          <Card padding="none" className="h-full">
            <div className="h-1 bg-[var(--led-success)]" />
            <div className="p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Signed Up</p>
              <p className="mt-3 text-[32px] font-semibold tracking-[-0.05em] led-tnum text-[var(--led-ink)]">{stats.signed_up}</p>
            </div>
          </Card>
          <Card padding="none" className="h-full">
            <div className="h-1 bg-[var(--led-warning)]" />
            <div className="p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Applied</p>
              <p className="mt-3 text-[32px] font-semibold tracking-[-0.05em] led-tnum text-[var(--led-ink)]">{stats.applied}</p>
            </div>
          </Card>
        </div>
      )}

      <Card padding="none" className="mb-6">
        <div className="border-b border-[var(--led-line)] px-6 py-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Share</p>
          <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Your Referral Link</h2>
        </div>
        <div className="p-6">
          <div className="flex items-center gap-3">
            <div className="flex-1 rounded-xl bg-[var(--led-surface-2)] px-4 py-2.5">
              <p className="text-[13px] text-[var(--led-ink)] font-mono truncate">{referralLink}</p>
            </div>
            <Button
              variant={copied ? 'secondary' : 'primary'}
              size="sm"
              onClick={handleCopy}
            >
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
        </div>
      </Card>

      <Card padding="none" className="mb-8">
        <div className="border-b border-[var(--led-line)] px-6 py-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Invite</p>
          <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Invite by Email</h2>
        </div>
        <div className="p-6">
          <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <input
                placeholder="friend@email.com"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
                className="w-full rounded-xl border border-[var(--led-line)] bg-[var(--led-surface-2)] px-4 py-2.5 text-[14px] text-[var(--led-ink)] placeholder:text-[var(--led-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--led-accent)]/30 transition-all"
              />
            </div>
            <div className="sm:w-48">
              <input
                placeholder="Name (optional)"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                className="w-full rounded-xl border border-[var(--led-line)] bg-[var(--led-surface-2)] px-4 py-2.5 text-[14px] text-[var(--led-ink)] placeholder:text-[var(--led-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--led-accent)]/30 transition-all"
              />
            </div>
            <Button type="submit" loading={sending} size="md">
              {sending ? 'Sending...' : 'Send Invite'}
            </Button>
          </form>
        </div>
      </Card>

      <Card padding="none">
        <div className="border-b border-[var(--led-line)] px-6 py-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">History</p>
              <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Your Referrals</h2>
            </div>
            <span className="text-[13px] text-[var(--led-muted)]">{referrals.length} total</span>
          </div>
        </div>
        {referrals.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--led-surface-2)]">
              <svg className="h-8 w-8 text-[var(--led-muted)]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" /></svg>
            </div>
            <p className="text-[14px] font-medium text-[var(--led-ink)] mb-1">No referrals yet</p>
            <p className="text-[13px] text-[var(--led-muted)]">Share your link or send an email invite to get started</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--led-line)]">
            {referrals.map((ref) => (
              <div
                key={ref.id}
                className="flex items-center justify-between px-6 py-4 transition-colors hover:bg-[var(--led-surface-2)]"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--led-surface-2)]">
                    <span className="text-[14px] font-semibold text-[var(--led-muted)]">
                      {(ref.referred_user_name || ref.referred_email || '?').charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-[var(--led-ink)] truncate">
                      {ref.referred_user_name || ref.referred_email || 'Unknown'}
                    </p>
                    <p className="text-[12px] text-[var(--led-muted)]">
                      {formatDate(ref.created_at)}
                      {ref.converted_at && (
                        <> &middot; Converted {formatDate(ref.converted_at)}</>
                      )}
                    </p>
                  </div>
                </div>
                <span className={`flex items-center gap-1.5 text-[12px] font-medium`}>
                  <span className={`h-2 w-2 rounded-full ${statusDot(ref.status)}`} />
                  <span className="text-[var(--led-muted)] capitalize">{ref.status.replace('_', ' ')}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
