import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { getErrorMessage, formatDate, getInitials } from '../../lib/utils';
import { Card, StatCard, PageHeader, Button, Input, InviteLinkBox } from '../../components/ui';
import PeopleNav from '../../components/PeopleNav';
import { CopyButton } from '../../components/ui/CopyButton';
import type { Invitation, PaginatedResponse, User } from '../../types';
import { CheckCircleIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';

const LABEL = 'block text-[13px] font-medium text-foreground mb-1';

function EditAdminModal({ admin, onClose, onSaved }: { admin: User; onClose: () => void; onSaved: (u: User) => void }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    full_name: admin.full_name ?? '',
    phone: admin.phone ?? '',
  });
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const f = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [key]: e.target.value })),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_name.trim()) return;
    setSaving(true);
    try {
      const { data } = await api.patch<User>(`/users/${admin.id}`, {
        full_name: form.full_name.trim(),
        phone: form.phone.trim() || null,
      });
      toast('Admin updated', 'success');
      onSaved(data);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to update admin'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl bg-background border border-border p-6 shadow-xl" style={{ animation: 'fadeInUp 0.25s cubic-bezier(0.25,0.46,0.45,0.94) both' }}>
        <h3 className="text-[17px] font-semibold text-foreground mb-1">Edit Admin</h3>
        <p className="text-[13px] text-muted-foreground mb-4">{admin.email}</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={LABEL}>Full Name *</label>
            <Input ref={ref} placeholder="Full name" required {...f('full_name')} />
          </div>
          <div>
            <label className={LABEL}>Phone</label>
            <Input type="tel" placeholder="+61 400 000 000" {...f('phone')} />
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

interface AdminForm {
  full_name: string;
  email: string;
  phone: string;
}

const INITIAL_FORM: AdminForm = { full_name: '', email: '', phone: '' };

type PendingAction =
  | { type: 'toggle_active'; userId: string; userName: string; isActive: boolean }
  | { type: 'delete'; userId: string; userName: string };

export default function AdminManagement() {
  const { toast } = useToast();
  const { user: currentUser, impersonate } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<AdminForm>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof AdminForm, string>>>({});
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [sendingReset, setSendingReset] = useState<string | null>(null);
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);

  const handleImpersonate = async (userId: string) => {
    setImpersonatingId(userId);
    try {
      await impersonate(userId);
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to start view-as session'), 'error');
      setImpersonatingId(null);
    }
  };
  const [editingAdmin, setEditingAdmin] = useState<User | null>(null);

  const [admins, setAdmins] = useState<User[]>([]);
  const [loadingAdmins, setLoadingAdmins] = useState(true);

  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const perPage = 10;

  useEffect(() => {
    api.get('/users', { params: { role: 'admin' } })
      .then(({ data }) => setAdmins(data.filter((u: User) => u.role === 'admin' && !u.email.endsWith('@deleted.invalid'))))
      .catch(() => { })
      .finally(() => setLoadingAdmins(false));
  }, []);

  useEffect(() => {
    setLoadingHistory(true);
    api.get('/invitations', { params: { page: historyPage, per_page: perPage, role: 'admin' } })
      .then(({ data }: { data: PaginatedResponse<Invitation> }) => {
        setInvitations(data.items);
        setHistoryTotal(data.total);
      })
      .catch(() => toast('Failed to load invitation history', 'error'))
      .finally(() => setLoadingHistory(false));
  }, [historyPage]);

  const validate = (): boolean => {
    const errs: Partial<Record<keyof AdminForm, string>> = {};
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
      const { data } = await api.post('/users/admins', {
        full_name: form.full_name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim() || null,
      });
      toast('Admin created. Setup link sent via email.', 'success');
      setInviteLink(data.invite_url || null);
      setForm(INITIAL_FORM);
      setErrors({});
      setShowForm(false);
      setAdmins(prev => [data, ...prev]);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to create admin'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const update = (field: keyof AdminForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: undefined }));
  };

  const confirmAction = async () => {
    if (!pendingAction) return;
    try {
      if (pendingAction.type === 'delete') {
        await api.delete(`/users/${pendingAction.userId}`);
        setAdmins(prev => prev.filter(u => u.id !== pendingAction.userId));
        toast('Admin deleted', 'success');
      } else {
        const { data } = await api.patch(`/users/${pendingAction.userId}/active`, { is_active: !pendingAction.isActive });
        setAdmins(prev => prev.map(u => u.id === pendingAction.userId ? data : u));
        toast(`Admin ${!pendingAction.isActive ? 'activated' : 'deactivated'}`, 'success');
      }
    } catch (err) {
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
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to send reset link'), 'error');
    } finally {
      setSendingReset(null);
    }
  };

  const handleResendInvitation = async (inv: Invitation) => {
    try {
      await api.post(`/users/${inv.id}/send-password-reset`);
      toast('Setup link resent to ' + inv.email, 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to resend'), 'error');
    }
  };

  const totalPages = Math.ceil(historyTotal / perPage);
  const activeAdmins = admins.filter(a => a.is_active);

  return (
    <div>
      <PageHeader
        title="Team Management"
        subtitle="Manage clients, brokers, referrers, and admins"
        action={<Button onClick={() => setShowForm(f => !f)}>+ Add Admin</Button>}
      />
      <PeopleNav />

      {inviteLink && <div className="mb-6"><InviteLinkBox url={inviteLink} label="Account setup link" onDismiss={() => setInviteLink(null)} /></div>}

      {/* Stats */}
      <div className="grid gap-5 sm:grid-cols-2 mb-8">
        <StatCard label="Total Admins" value={admins.length} loading={loadingAdmins} gradient="from-primary to-primary"
          icon={<ShieldCheckIcon className="h-5 w-5" />}
        />
        <StatCard label="Active" value={activeAdmins.length} loading={loadingAdmins} gradient="from-success to-success" valueColor="text-success"
          icon={<CheckCircleIcon className="h-5 w-5" />}
        />
      </div>

      {/* Create admin form */}
      {showForm && (
        <Card className="mb-6">
          <h3 className="text-[15px] font-semibold text-foreground mb-4">New Admin</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Input label="Full Name *" placeholder="John Smith" value={form.full_name} onChange={e => update('full_name', e.target.value)} error={errors.full_name} />
              <Input label="Email *" type="email" placeholder="admin@example.com" value={form.email} onChange={e => update('email', e.target.value)} error={errors.email} />
              <Input label="Phone" type="tel" placeholder="+61 400 000 000" value={form.phone} onChange={e => update('phone', e.target.value)} />
            </div>
            <p className="text-[13px] text-muted-foreground">Admins have full access to the portal. They'll receive an email to set up their account.</p>
            <div className="flex gap-2">
              <Button type="submit" loading={submitting}>Create Admin</Button>
              <Button type="button" variant="secondary" onClick={() => { setShowForm(false); setForm(INITIAL_FORM); setErrors({}); }}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      {/* Admin table */}
      <Card padding="none" className="mb-8">
        {loadingAdmins ? (
          <div className="p-6 space-y-4">{[1, 2, 3].map(i => <div key={i} className="flex items-center gap-4"><div className="h-10 w-10 rounded-xl shimmer" /><div className="flex-1 space-y-2"><div className="h-4 w-32 rounded-lg shimmer" /><div className="h-3 w-48 rounded-lg shimmer" /></div></div>)}</div>
        ) : admins.length === 0 ? (
          <div className="p-10 text-center text-[14px] text-muted-foreground">No admins yet. Add one to get started.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[14px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-6 py-4 text-[12px] font-medium text-muted-foreground">Admin</th>
                  <th className="hidden sm:table-cell px-6 py-4 text-[12px] font-medium text-muted-foreground">Phone</th>
                  <th className="px-6 py-4 text-[12px] font-medium text-muted-foreground">Status</th>
                  <th className="hidden md:table-cell px-6 py-4 text-[12px] font-medium text-muted-foreground">Joined</th>
                  <th className="px-6 py-4 text-[12px] font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {admins.map(admin => {
                  const isSelf = admin.id === currentUser?.id;
                  return (
                    <tr key={admin.id} className="transition-colors hover:bg-secondary/50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15">
                            <span className="text-[11px] font-semibold text-primary">{getInitials(admin.full_name)}</span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[14px] font-semibold text-foreground truncate">{admin.full_name}{isSelf && <span className="ml-2 text-[11px] font-normal text-muted-foreground">(you)</span>}</p>
                            <p className="text-[12px] text-muted-foreground truncate">{admin.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="hidden sm:table-cell px-6 py-4 text-[13px] text-muted-foreground">{admin.phone || '—'}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium ${admin.is_active ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${admin.is_active ? 'bg-success' : 'bg-destructive'}`} />
                          {admin.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="hidden md:table-cell px-6 py-4 text-[13px] text-muted-foreground">{formatDate(admin.created_at)}</td>
                      <td className="px-6 py-4">
                        <div className="flex gap-2">
                          <Button size="sm" variant="secondary" onClick={() => setEditingAdmin(admin)}>Edit</Button>
                          {!isSelf && (
                            <>
                              {admin.is_active && (
                                <Button size="sm" variant="secondary" loading={impersonatingId === admin.id} onClick={() => handleImpersonate(admin.id)}>Login as</Button>
                              )}
                              <Button size="sm" variant={admin.is_active ? 'danger' : 'success'} onClick={() => setPendingAction({ type: 'toggle_active', userId: admin.id, userName: admin.full_name, isActive: admin.is_active })}>
                                {admin.is_active ? 'Deactivate' : 'Activate'}
                              </Button>
                              <Button size="sm" variant="secondary" loading={sendingReset === admin.id} onClick={() => handleSendPasswordReset(admin.id)}>Reset Password</Button>
                              <Button size="sm" variant="danger" onClick={() => setPendingAction({ type: 'delete', userId: admin.id, userName: admin.full_name })}>Delete</Button>
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
      </Card>

      {/* Invitation History */}
      <Card padding="none" className="mt-8">
        <div className="px-4 sm:px-6 py-4 border-b border-border">
          <h4 className="text-[15px] font-semibold text-foreground">Invitation History</h4>
          <p className="text-[13px] text-muted-foreground">{historyTotal} invited admin{historyTotal !== 1 ? 's' : ''}</p>
        </div>
        {loadingHistory ? (
          <div className="p-6 space-y-4">
            {[1, 2, 3].map(i => <div key={i} className="flex items-center gap-4"><div className="h-10 w-10 rounded-xl shimmer" /><div className="flex-1 space-y-2"><div className="h-4 w-32 rounded-lg shimmer" /><div className="h-3 w-48 rounded-lg shimmer" /></div></div>)}
          </div>
        ) : invitations.length === 0 ? (
          <div className="p-6 text-center text-[14px] text-muted-foreground">No admins invited yet.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[14px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 sm:px-6 py-3 text-[12px] font-medium text-muted-foreground">Admin</th>
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
                        <div className="flex items-center gap-2">
                          <Button variant="secondary" size="sm" onClick={() => handleResendInvitation(inv)}>Resend</Button>
                          {inv.invite_url && <CopyButton text={inv.invite_url} size="sm" />}
                        </div>
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
      </Card>

      {editingAdmin && (
        <EditAdminModal
          admin={editingAdmin}
          onClose={() => setEditingAdmin(null)}
          onSaved={updated => { setAdmins(prev => prev.map(a => a.id === updated.id ? updated : a)); setEditingAdmin(null); }}
        />
      )}

      {/* Confirmation modal */}
      {pendingAction && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setPendingAction(null)} />
          <div className="relative w-full max-w-md rounded-2xl bg-background border border-border p-6 shadow-xl" style={{ animation: 'fadeInUp 0.25s cubic-bezier(0.25,0.46,0.45,0.94) both' }}>
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
        </div>,
        document.body,
      )}
    </div>
  );
}
