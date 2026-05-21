import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { getErrorMessage, formatDate, getInitials } from '../../lib/utils';
import { GlassCard, StatCard, PageHeader, Button, Input } from '../../components/ui';
import PeopleNav from '../../components/PeopleNav';
import type { Invitation, PaginatedResponse, User } from '../../types';

const LABEL = 'block text-[13px] font-medium text-foreground mb-1';

function EditReferrerModal({ referrer, onClose, onSaved }: { referrer: User; onClose: () => void; onSaved: (u: User) => void }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    full_name: referrer.full_name ?? '',
    phone: referrer.phone ?? '',
    organization_name: referrer.organization_name ?? '',
  });
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_name.trim()) return;
    setSaving(true);
    try {
      const { data } = await api.patch<User>(`/users/${referrer.id}`, {
        full_name: form.full_name.trim(),
        phone: form.phone.trim() || null,
        organization_name: form.organization_name.trim() || null,
      });
      toast('Referrer updated', 'success');
      onSaved(data);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to update referrer'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-background border border-border p-6 shadow-xl" style={{ animation: 'fadeInUp 0.25s cubic-bezier(0.25,0.46,0.45,0.94) both' }}>
        <h3 className="text-[17px] font-semibold text-foreground mb-1">Edit Referrer</h3>
        <p className="text-[13px] text-muted-foreground mb-4">{referrer.email}</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={LABEL}>Full Name *</label>
            <Input ref={ref} placeholder="Full name" required value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
          </div>
          <div>
            <label className={LABEL}>Phone</label>
            <Input type="tel" placeholder="+61 400 000 000" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          </div>
          <div>
            <label className={LABEL}>Organization</label>
            <Input placeholder="Company or institution" value={form.organization_name} onChange={e => setForm(f => ({ ...f, organization_name: e.target.value }))} />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="secondary" size="md" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" variant="primary" size="md" loading={saving}>Save Changes</Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

interface ReferrerForm {
  full_name: string;
  email: string;
  phone: string;
  organization_name: string;
}

const INITIAL_FORM: ReferrerForm = { full_name: '', email: '', phone: '', organization_name: '' };

type PendingAction =
  | { type: 'toggle_active'; userId: string; userName: string; isActive: boolean }
  | { type: 'delete'; userId: string; userName: string };

type SendingReset = string | null;

export default function ReferrerManagement() {
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ReferrerForm>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof ReferrerForm, string>>>({});
  const [referrers, setReferrers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [sendingReset, setSendingReset] = useState<SendingReset>(null);
  const [editingReferrer, setEditingReferrer] = useState<User | null>(null);

  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const perPage = 10;

  useEffect(() => {
    api.get('/external-referrers')
      .then(({ data }) => setReferrers(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setLoadingHistory(true);
    api.get('/invitations', { params: { page: historyPage, per_page: perPage, role: 'referrer' } })
      .then(({ data }: { data: PaginatedResponse<Invitation> }) => {
        setInvitations(data.items);
        setHistoryTotal(data.total);
      })
      .catch(() => toast('Failed to load invitation history', 'error'))
      .finally(() => setLoadingHistory(false));
  }, [historyPage]);

  const validate = (): boolean => {
    const errs: Partial<Record<keyof ReferrerForm, string>> = {};
    if (!form.full_name.trim()) errs.full_name = 'Full name is required';
    if (!form.email.trim()) errs.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Invalid email address';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const { data } = await api.post('/external-referrers', {
        full_name: form.full_name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim() || null,
        organization_name: form.organization_name.trim() || null,
      });
      toast('Referrer created. Login credentials sent via email.', 'success');
      setForm(INITIAL_FORM);
      setErrors({});
      setShowForm(false);
      setReferrers(prev => [data, ...prev]);
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to create referrer'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const update = (field: keyof ReferrerForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: undefined }));
  };

  const confirmAction = async () => {
    if (!pendingAction) return;
    try {
      if (pendingAction.type === 'delete') {
        await api.delete(`/users/${pendingAction.userId}`);
        setReferrers(prev => prev.filter(u => u.id !== pendingAction.userId));
        toast('Referrer deleted', 'success');
      } else {
        const { data } = await api.patch(`/users/${pendingAction.userId}/active`, { is_active: !pendingAction.isActive });
        setReferrers(prev => prev.map(u => u.id === pendingAction.userId ? data : u));
        toast(`Referrer ${!pendingAction.isActive ? 'activated' : 'deactivated'}`, 'success');
      }
    } catch (err: any) {
      toast(getErrorMessage(err, 'Action failed'), 'error');
    } finally {
      setPendingAction(null);
    }
  };

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

  const handleResendReferrerInvitation = async (inv: Invitation) => {
    try {
      await api.post(`/users/${inv.id}/send-password-reset`);
      toast('Setup link resent to ' + inv.email, 'success');
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to resend'), 'error');
    }
  };

  const totalPages = Math.ceil(historyTotal / perPage);
  const activeReferrers = referrers.filter(r => r.is_active);

  return (
    <div>
      <PageHeader
        title="Team Management"
        subtitle="Manage clients, brokers, and referrers"
        action={<Button onClick={() => setShowForm(f => !f)}>+ Add Referrer</Button>}
      />
      <PeopleNav />

      {/* Stats */}
      <div className="grid gap-5 sm:grid-cols-2 mb-8">
        <StatCard label="Total Referrers" value={referrers.length} loading={loading} gradient="from-chart-4 to-chart-4"
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" /></svg>}
        />
        <StatCard label="Active" value={activeReferrers.length} loading={loading} gradient="from-success to-success" valueColor="text-success"
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>}
        />
      </div>

      {/* Create referrer form */}
      {showForm && (
        <GlassCard className="mb-6">
          <h3 className="text-[15px] font-semibold text-foreground mb-4">New Referrer</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Full Name *" placeholder="John Smith" value={form.full_name} onChange={e => update('full_name', e.target.value)} error={errors.full_name} />
              <Input label="Email *" type="email" placeholder="referrer@example.com" value={form.email} onChange={e => update('email', e.target.value)} error={errors.email} />
              <Input label="Phone" type="tel" placeholder="+61 400 000 000" value={form.phone} onChange={e => update('phone', e.target.value)} />
              <Input label="Organization" placeholder="Company or institution name" value={form.organization_name} onChange={e => update('organization_name', e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" loading={submitting}>Create Referrer</Button>
              <Button type="button" variant="secondary" onClick={() => { setShowForm(false); setForm(INITIAL_FORM); setErrors({}); }}>Cancel</Button>
            </div>
          </form>
        </GlassCard>
      )}

      {/* Referrer table */}
      <GlassCard padding="none">
        {loading ? (
          <div className="p-6 space-y-4">{[1, 2, 3].map(i => <div key={i} className="flex items-center gap-4"><div className="h-10 w-10 rounded-xl shimmer" /><div className="flex-1 space-y-2"><div className="h-4 w-32 rounded-lg shimmer" /><div className="h-3 w-48 rounded-lg shimmer" /></div></div>)}</div>
        ) : referrers.length === 0 ? (
          <div className="p-10 text-center text-[14px] text-muted-foreground">No referrers yet. Add one to get started.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[14px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-6 py-4 text-[12px] font-medium text-muted-foreground">Referrer</th>
                  <th className="hidden sm:table-cell px-6 py-4 text-[12px] font-medium text-muted-foreground">Organization</th>
                  <th className="px-6 py-4 text-[12px] font-medium text-muted-foreground">Status</th>
                  <th className="hidden md:table-cell px-6 py-4 text-[12px] font-medium text-muted-foreground">Joined</th>
                  {isAdmin && <th className="px-6 py-4 text-[12px] font-medium text-muted-foreground">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {referrers.map(referrer => (
                  <tr key={referrer.id} className="transition-colors hover:bg-secondary/50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-chart-4/10">
                          <span className="text-[11px] font-semibold text-chart-4">{getInitials(referrer.full_name)}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold text-foreground truncate">{referrer.full_name}</p>
                          <p className="text-[12px] text-muted-foreground truncate">{referrer.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden sm:table-cell px-6 py-4 text-[13px] text-muted-foreground">{referrer.organization_name || '—'}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium ${referrer.is_active ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${referrer.is_active ? 'bg-success' : 'bg-destructive'}`} />
                        {referrer.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="hidden md:table-cell px-6 py-4 text-[13px] text-muted-foreground">{formatDate(referrer.created_at)}</td>
                    <td className="px-6 py-4">
                      {isAdmin && (
                        <div className="flex gap-2">
                          <Button size="sm" variant="secondary" onClick={() => setEditingReferrer(referrer)}>Edit</Button>
                          <Button size="sm" variant={referrer.is_active ? 'danger' : 'success'} onClick={() => setPendingAction({ type: 'toggle_active', userId: referrer.id, userName: referrer.full_name, isActive: referrer.is_active })}>
                            {referrer.is_active ? 'Deactivate' : 'Activate'}
                          </Button>
                          <Button size="sm" variant="secondary" loading={sendingReset === referrer.id} onClick={() => handleSendPasswordReset(referrer.id)}>Reset Password</Button>
                          <Button size="sm" variant="danger" onClick={() => setPendingAction({ type: 'delete', userId: referrer.id, userName: referrer.full_name })}>Delete</Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* Invitation History */}
      <GlassCard padding="none" className="mt-8">
        <div className="px-4 sm:px-6 py-4 border-b border-border">
          <h4 className="text-[15px] font-semibold text-foreground">Invitation History</h4>
          <p className="text-[13px] text-muted-foreground">{historyTotal} invited referrer{historyTotal !== 1 ? 's' : ''}</p>
        </div>
        {loadingHistory ? (
          <div className="p-6 space-y-4">
            {[1, 2, 3].map(i => <div key={i} className="flex items-center gap-4"><div className="h-10 w-10 rounded-xl shimmer" /><div className="flex-1 space-y-2"><div className="h-4 w-32 rounded-lg shimmer" /><div className="h-3 w-48 rounded-lg shimmer" /></div></div>)}
          </div>
        ) : invitations.length === 0 ? (
          <div className="p-6 text-center text-[14px] text-muted-foreground">No referrers invited yet.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[14px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 sm:px-6 py-3 text-[12px] font-medium text-muted-foreground">Referrer</th>
                    <th className="hidden sm:table-cell px-6 py-3 text-[12px] font-medium text-muted-foreground">Invited By</th>
                    <th className="hidden md:table-cell px-6 py-3 text-[12px] font-medium text-muted-foreground">Date</th>
                    <th className="px-4 sm:px-6 py-3 text-[12px] font-medium text-muted-foreground">Status</th>
                    {isAdmin && <th className="px-4 sm:px-6 py-3 text-[12px] font-medium text-muted-foreground">Actions</th>}
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
                      {isAdmin && (
                        <td className="px-4 sm:px-6 py-3">
                          <Button variant="secondary" size="sm" onClick={() => handleResendReferrerInvitation(inv)}>Resend</Button>
                        </td>
                      )}
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

      {editingReferrer && (
        <EditReferrerModal
          referrer={editingReferrer}
          onClose={() => setEditingReferrer(null)}
          onSaved={updated => { setReferrers(prev => prev.map(r => r.id === updated.id ? updated : r)); setEditingReferrer(null); }}
        />
      )}

      {/* Confirmation modal */}
      {pendingAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-background border border-border p-6 shadow-xl">
            <h3 className="text-[16px] font-semibold text-foreground mb-2">Confirm Action</h3>
            <p className="text-[14px] text-muted-foreground mb-6">
              {pendingAction.type === 'delete' ? (
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
