import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { getErrorMessage, formatDate } from '../../lib/utils';
import { GlassCard, StatCard, Badge, PageHeader, Button } from '../../components/ui';
import PeopleNav from '../../components/PeopleNav';
import type { Invitation, LoanApplication, LoanType, PaginatedResponse, User } from '../../types';

type PendingAction =
  | { type: 'role'; userId: string; userName: string; from: string; to: string }
  | { type: 'toggle_active'; userId: string; userName: string; isActive: boolean }
  | { type: 'delete'; userId: string; userName: string };

const LOAN_TYPES: { value: LoanType; label: string }[] = [
  { value: 'personal', label: 'Personal' },
  { value: 'home', label: 'Home' },
  { value: 'business', label: 'Business' },
  { value: 'vehicle', label: 'Vehicle' },
];

const inputClass = 'w-full rounded-lg border border-border bg-secondary px-3 py-2 text-[14px] text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30';
const selectClass = 'rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] font-medium text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30';

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();

  // Client list
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [sendingReset, setSendingReset] = useState<string | null>(null);

  // Invite new client
  const [inviteForm, setInviteForm] = useState({ full_name: '', email: '', phone: '' });
  const [inviting, setInviting] = useState(false);

  // Start application for client
  const [startAppForm, setStartAppForm] = useState<{ client_id: string; loan_type: LoanType; amount: string; notes: string }>({
    client_id: '', loan_type: 'personal', amount: '', notes: '',
  });
  const [startingApp, setStartingApp] = useState(false);

  // Invite to complete draft
  const [draftApps, setDraftApps] = useState<LoanApplication[]>([]);
  const [selectedAppId, setSelectedAppId] = useState('');
  const [sendingComplete, setSendingComplete] = useState(false);
  const [loadingDrafts, setLoadingDrafts] = useState(true);

  // Invitation history
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const perPage = 10;

  useEffect(() => {
    api.get('/users')
      .then(({ data }) => setUsers(data.filter((u: User) => u.role === 'client')))
      .catch(() => toast('Failed to load clients', 'error'))
      .finally(() => setLoading(false));

    api.get('/applications', { params: { status: 'draft', page: 1, per_page: 100 } })
      .then(({ data }) => { const items = data.items || data; setDraftApps(Array.isArray(items) ? items : []); })
      .catch(() => {})
      .finally(() => setLoadingDrafts(false));
  }, []);

  useEffect(() => {
    setLoadingHistory(true);
    api.get('/invitations', { params: { page: historyPage, per_page: perPage, role: 'client' } })
      .then(({ data }: { data: PaginatedResponse<Invitation> }) => {
        setInvitations(data.items);
        setHistoryTotal(data.total);
      })
      .catch(() => toast('Failed to load invitation history', 'error'))
      .finally(() => setLoadingHistory(false));
  }, [historyPage]);

  const handleSendPasswordReset = async (userId: string) => {
    setSendingReset(userId);
    try {
      await api.post(`/users/${userId}/send-password-reset`);
      toast('Password reset link sent', 'success');
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to send reset link'), 'error');
    } finally {
      setSendingReset(null);
    }
  };

  const requestRoleChange = (userId: string, userName: string, currentRole: string, newRole: string) => {
    if (newRole === currentRole) return;
    setPendingAction({ type: 'role', userId, userName, from: currentRole, to: newRole });
  };

  const confirmAction = async () => {
    if (!pendingAction) return;
    try {
      if (pendingAction.type === 'role') {
        const { data } = await api.patch(`/users/${pendingAction.userId}/role`, { role: pendingAction.to });
        setUsers(prev => prev.filter(u => u.id !== pendingAction.userId || pendingAction.to === 'client')
          .map(u => u.id === pendingAction.userId ? data : u));
        toast(`Role updated to ${pendingAction.to}`, 'success');
      } else if (pendingAction.type === 'delete') {
        await api.delete(`/users/${pendingAction.userId}`);
        setUsers(prev => prev.filter(u => u.id !== pendingAction.userId));
        toast('User deleted', 'success');
      } else {
        const { data } = await api.patch(`/users/${pendingAction.userId}/active`, { is_active: !pendingAction.isActive });
        setUsers(prev => prev.map(u => u.id === pendingAction.userId ? data : u));
        toast(`User ${!pendingAction.isActive ? 'activated' : 'deactivated'}`, 'success');
      }
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to update user'), 'error');
    } finally {
      setPendingAction(null);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    try {
      await api.post('/invitations', { email: inviteForm.email, full_name: inviteForm.full_name, phone: inviteForm.phone || null });
      toast('Invitation sent to ' + inviteForm.email, 'success');
      setInviteForm({ full_name: '', email: '', phone: '' });
      setHistoryPage(1);
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to send invitation'), 'error');
    } finally {
      setInviting(false);
    }
  };

  const handleStartApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startAppForm.client_id || !startAppForm.amount) return;
    setStartingApp(true);
    try {
      const { data } = await api.post('/invitations/start-application', {
        client_id: startAppForm.client_id,
        loan_type: startAppForm.loan_type,
        amount: parseFloat(startAppForm.amount),
        notes: startAppForm.notes || null,
      });
      toast(data.detail || 'Application created and invite sent', 'success');
      setStartAppForm({ client_id: '', loan_type: 'personal', amount: '', notes: '' });
      api.get('/applications', { params: { status: 'draft', page: 1, per_page: 100 } })
        .then(({ data }) => { const items = data.items || data; setDraftApps(Array.isArray(items) ? items : []); })
        .catch(() => {});
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to create application'), 'error');
    } finally {
      setStartingApp(false);
    }
  };

  const handleCompleteInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAppId) return;
    setSendingComplete(true);
    try {
      const { data } = await api.post('/invitations/complete-application', { application_id: selectedAppId });
      toast(data.detail || 'Invitation sent', 'success');
      setSelectedAppId('');
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to send invitation'), 'error');
    } finally {
      setSendingComplete(false);
    }
  };

  const handleResendInvitation = async (inv: Invitation) => {
    try {
      await api.post('/invitations', { email: inv.email, full_name: inv.full_name, phone: inv.phone });
      toast('New code sent to ' + inv.email, 'success');
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to resend'), 'error');
    }
  };

  const totalPages = Math.ceil(historyTotal / perPage);

  return (
    <div>
      <PageHeader title="Team Management" subtitle="Manage clients, brokers, and referrers" />
      <PeopleNav />

      {/* Stats */}
      <div className="grid gap-5 sm:grid-cols-1 mb-8">
        <StatCard label="Total Clients" value={users.length} loading={loading} gradient="from-primary to-primary"
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" /></svg>}
        />
      </div>

      {/* Client table */}
      <GlassCard padding="none" className="mb-8">
        {loading ? (
          <div className="p-6 space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-xl shimmer" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 rounded-lg shimmer" />
                  <div className="h-3 w-48 rounded-lg shimmer" />
                </div>
              </div>
            ))}
          </div>
        ) : users.length === 0 ? (
          <div className="p-10 text-center text-[14px] text-muted-foreground">No clients yet. Invite clients below.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[14px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 sm:px-6 py-4 text-[12px] font-medium text-muted-foreground">Client</th>
                  <th className="px-3 sm:px-6 py-4 text-[12px] font-medium text-muted-foreground">Status</th>
                  <th className="hidden md:table-cell px-6 py-4 text-[12px] font-medium text-muted-foreground">Joined</th>
                  <th className="px-3 sm:px-6 py-4 text-[12px] font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map(user => {
                  const isSelf = user.id === currentUser?.id;
                  return (
                    <tr key={user.id} className="transition-colors hover:bg-secondary/50">
                      <td className="px-3 sm:px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary">
                            <span className="text-[13px] font-semibold text-primary-foreground">{user.full_name.charAt(0).toUpperCase()}</span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[14px] font-semibold text-foreground truncate">{user.full_name}{isSelf && <span className="ml-1.5 text-[12px] text-primary">(you)</span>}</p>
                            <p className="text-[12px] text-muted-foreground truncate">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 sm:px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium ${user.is_active ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${user.is_active ? 'bg-success' : 'bg-destructive'}`} />
                          {user.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="hidden md:table-cell px-6 py-4 text-[13px] text-muted-foreground">{formatDate(user.created_at)}</td>
                      <td className="px-3 sm:px-6 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          {currentUser?.role === 'admin' && !isSelf && (
                            <>
                              <Button variant={user.is_active ? 'danger' : 'success'} size="sm" onClick={() => setPendingAction({ type: 'toggle_active', userId: user.id, userName: user.full_name, isActive: user.is_active })}>
                                {user.is_active ? 'Deactivate' : 'Activate'}
                              </Button>
                              <Button variant="secondary" size="sm" loading={sendingReset === user.id} onClick={() => handleSendPasswordReset(user.id)}>Reset Password</Button>
                              <Button variant="danger" size="sm" onClick={() => setPendingAction({ type: 'delete', userId: user.id, userName: user.full_name })}>Delete</Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* Invite & Onboarding */}
      <h3 className="text-[15px] font-semibold text-foreground mb-4">Invite & Onboarding</h3>
      <div className="grid gap-6 lg:grid-cols-3 mb-8">
        <GlassCard>
          <h4 className="text-[14px] font-semibold text-foreground mb-1">Invite New Client</h4>
          <p className="text-[13px] text-muted-foreground mb-4">They'll receive an email with a one-time login code.</p>
          <form onSubmit={handleInvite} className="space-y-3">
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1">Full Name *</label>
              <input type="text" required value={inviteForm.full_name} onChange={e => setInviteForm(f => ({ ...f, full_name: e.target.value }))} className={inputClass} placeholder="John Smith" />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1">Email *</label>
              <input type="email" required value={inviteForm.email} onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))} className={inputClass} placeholder="john@example.com" />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1">Phone</label>
              <input type="tel" value={inviteForm.phone} onChange={e => setInviteForm(f => ({ ...f, phone: e.target.value }))} className={inputClass} placeholder="0412 345 678" />
            </div>
            <Button type="submit" size="sm" loading={inviting} className="w-full">Send Invitation</Button>
          </form>
        </GlassCard>

        <GlassCard>
          <h4 className="text-[14px] font-semibold text-foreground mb-1">Start Application for Client</h4>
          <p className="text-[13px] text-muted-foreground mb-4">Create a draft and send the client a link to complete it.</p>
          <form onSubmit={handleStartApp} className="space-y-3">
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1">Client *</label>
              {users.length === 0 ? (
                <p className="text-[13px] text-muted-foreground py-2">No clients yet. Invite one first.</p>
              ) : (
                <select required value={startAppForm.client_id} onChange={e => setStartAppForm(f => ({ ...f, client_id: e.target.value }))} className={inputClass}>
                  <option value="">Select a client...</option>
                  {users.map(c => <option key={c.id} value={c.id}>{c.full_name} ({c.email})</option>)}
                </select>
              )}
            </div>
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1">Loan Type *</label>
              <select required value={startAppForm.loan_type} onChange={e => setStartAppForm(f => ({ ...f, loan_type: e.target.value as LoanType }))} className={inputClass}>
                {LOAN_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1">Amount *</label>
              <input type="number" required min="1" step="any" value={startAppForm.amount} onChange={e => setStartAppForm(f => ({ ...f, amount: e.target.value }))} className={inputClass} placeholder="50000" />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1">Notes</label>
              <input type="text" value={startAppForm.notes} onChange={e => setStartAppForm(f => ({ ...f, notes: e.target.value }))} className={inputClass} placeholder="Optional notes" />
            </div>
            <Button type="submit" size="sm" loading={startingApp} disabled={!startAppForm.client_id || !startAppForm.amount} className="w-full">Create & Send Invite</Button>
          </form>
        </GlassCard>

        <GlassCard>
          <h4 className="text-[14px] font-semibold text-foreground mb-1">Remind to Complete Draft</h4>
          <p className="text-[13px] text-muted-foreground mb-4">Send a reminder to a client with an existing draft application.</p>
          <form onSubmit={handleCompleteInvite} className="space-y-3">
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1">Draft Application *</label>
              {loadingDrafts ? (
                <div className="h-10 rounded-lg shimmer" />
              ) : draftApps.length === 0 ? (
                <p className="text-[13px] text-muted-foreground py-2">No draft applications found.</p>
              ) : (
                <select required value={selectedAppId} onChange={e => setSelectedAppId(e.target.value)} className={inputClass}>
                  <option value="">Select an application...</option>
                  {draftApps.map(app => (
                    <option key={app.id} value={app.id}>
                      {app.user_name || app.user_email || 'Unknown'} — {app.loan_type.charAt(0).toUpperCase() + app.loan_type.slice(1)} — ${Number(app.amount).toLocaleString()}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <Button type="submit" size="sm" variant="secondary" loading={sendingComplete} disabled={!selectedAppId} className="w-full">Send Reminder</Button>
          </form>
        </GlassCard>
      </div>

      {/* Invitation History */}
      <GlassCard padding="none">
        <div className="px-4 sm:px-6 py-4 border-b border-border">
          <h4 className="text-[15px] font-semibold text-foreground">Invitation History</h4>
          <p className="text-[13px] text-muted-foreground">{historyTotal} invited client{historyTotal !== 1 ? 's' : ''}</p>
        </div>
        {loadingHistory ? (
          <div className="p-6 space-y-4">
            {[1, 2, 3].map(i => <div key={i} className="flex items-center gap-4"><div className="h-10 w-10 rounded-xl shimmer" /><div className="flex-1 space-y-2"><div className="h-4 w-32 rounded-lg shimmer" /><div className="h-3 w-48 rounded-lg shimmer" /></div></div>)}
          </div>
        ) : invitations.length === 0 ? (
          <div className="p-6 text-center text-[14px] text-muted-foreground">No invitations yet.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[14px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 sm:px-6 py-3 text-[12px] font-medium text-muted-foreground">Client</th>
                    <th className="hidden sm:table-cell px-6 py-3 text-[12px] font-medium text-muted-foreground">Invited By</th>
                    <th className="hidden md:table-cell px-6 py-3 text-[12px] font-medium text-muted-foreground">Date</th>
                    <th className="px-4 sm:px-6 py-3 text-[12px] font-medium text-muted-foreground">Status</th>
                    <th className="px-4 sm:px-6 py-3 text-[12px] font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invitations.map(inv => (
                    <tr key={inv.id} className="transition-colors hover:bg-secondary/50">
                      <td className="px-4 sm:px-6 py-3">
                        <p className="text-[14px] font-medium text-foreground">{inv.full_name}</p>
                        <p className="text-[12px] text-muted-foreground">{inv.email}</p>
                      </td>
                      <td className="hidden sm:table-cell px-6 py-3 text-[13px] text-muted-foreground">{inv.invited_by_name || '—'}</td>
                      <td className="hidden md:table-cell px-6 py-3 text-[13px] text-muted-foreground">{formatDate(inv.created_at)}</td>
                      <td className="px-4 sm:px-6 py-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium ${inv.is_active ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${inv.is_active ? 'bg-success' : 'bg-destructive'}`} />
                          {inv.is_active ? 'Active' : 'Expired'}
                        </span>
                      </td>
                      <td className="px-4 sm:px-6 py-3">
                        <Button variant="secondary" size="sm" onClick={() => handleResendInvitation(inv)}>Resend</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-t border-border">
                <p className="text-[13px] text-muted-foreground">Page {historyPage} of {totalPages}</p>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" disabled={historyPage <= 1} onClick={() => setHistoryPage(p => p - 1)}>Previous</Button>
                  <Button variant="secondary" size="sm" disabled={historyPage >= totalPages} onClick={() => setHistoryPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </>
        )}
      </GlassCard>

      {/* Confirmation modal */}
      {pendingAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-background border border-border p-6 shadow-xl">
            <h3 className="text-[16px] font-semibold text-foreground mb-2">Confirm Action</h3>
            <p className="text-[14px] text-muted-foreground mb-6">
              {pendingAction.type === 'role' ? (
                <>Change <span className="font-semibold text-foreground">{pendingAction.userName}</span>'s role from <span className="font-semibold text-foreground capitalize">{pendingAction.from}</span> to <span className="font-semibold text-foreground capitalize">{pendingAction.to}</span>?</>
              ) : pendingAction.type === 'delete' ? (
                <>Permanently delete <span className="font-semibold text-foreground">{pendingAction.userName}</span>? This cannot be undone.</>
              ) : (
                <>{pendingAction.isActive ? 'Deactivate' : 'Activate'} <span className="font-semibold text-foreground">{pendingAction.userName}</span>?{pendingAction.isActive && ' They will no longer be able to log in.'}</>
              )}
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" size="sm" onClick={() => setPendingAction(null)}>Cancel</Button>
              <Button variant={pendingAction.type === 'delete' || (pendingAction.type === 'toggle_active' && pendingAction.isActive) ? 'danger' : 'primary'} size="sm" onClick={confirmAction}>Confirm</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
