import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { getErrorMessage, formatDate } from '../../lib/utils';
import { GlassCard, StatCard, Badge, PageHeader, Button } from '../../components/ui';
import type { User } from '../../types';

type PendingAction =
  | { type: 'role'; userId: string; userName: string; from: string; to: string }
  | { type: 'toggle_active'; userId: string; userName: string; isActive: boolean };

const ALLOWED_ROLE_OPTIONS: Record<string, { value: string; label: string }[]> = {
  client: [
    { value: 'client', label: 'Client' },
    { value: 'broker', label: 'Broker' },
  ],
  broker: [
    { value: 'client', label: 'Client' },
    { value: 'broker', label: 'Broker' },
    { value: 'admin', label: 'Admin' },
  ],
  admin: [
    { value: 'broker', label: 'Broker' },
    { value: 'admin', label: 'Admin' },
  ],
};

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  useEffect(() => {
    api
      .get('/users')
      .then(({ data }) => setUsers(data))
      .catch(() => toast('Failed to load users', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const requestRoleChange = (userId: string, userName: string, currentRole: string, newRole: string) => {
    if (newRole === currentRole) return;
    setPendingAction({ type: 'role', userId, userName, from: currentRole, to: newRole });
  };

  const confirmAction = async () => {
    if (!pendingAction) return;
    try {
      if (pendingAction.type === 'role') {
        const { data } = await api.patch(`/users/${pendingAction.userId}/role`, { role: pendingAction.to });
        setUsers((prev) => prev.map((u) => (u.id === pendingAction.userId ? data : u)));
        toast(`Role updated to ${pendingAction.to}`, 'success');
      } else {
        const { data } = await api.patch(`/users/${pendingAction.userId}/active`, { is_active: !pendingAction.isActive });
        setUsers((prev) => prev.map((u) => (u.id === pendingAction.userId ? data : u)));
        toast(`User ${!pendingAction.isActive ? 'activated' : 'deactivated'}`, 'success');
      }
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to update user'), 'error');
    } finally {
      setPendingAction(null);
    }
  };

  const cancelAction = () => setPendingAction(null);

  const handleKycChange = async (userId: string, kyc_status: string) => {
    try {
      const { data } = await api.patch(`/users/${userId}/kyc`, { kyc_status });
      setUsers((prev) => prev.map((u) => (u.id === userId ? data : u)));
      toast(`KYC status updated to ${kyc_status}`, 'success');
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to update KYC'), 'error');
    }
  };

  const requestToggleActive = (userId: string, userName: string, isActive: boolean) => {
    setPendingAction({ type: 'toggle_active', userId, userName, isActive });
  };

  const handleResendCode = async (user: User) => {
    try {
      await api.post('/invitations', {
        email: user.email,
        full_name: user.full_name,
        phone: user.phone,
      });
      toast('New code sent to ' + user.email, 'success');
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to resend code'), 'error');
    }
  };

  const selectClass = 'rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] font-medium text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30';

  return (
    <div>
      <PageHeader title="User Management" subtitle="Manage roles, KYC status, and user access" />

      {/* Stats */}
      <div className="grid gap-5 sm:grid-cols-3 mb-8">
        <StatCard
          label="Total Users"
          value={users.length}
          loading={loading}
          gradient="from-primary to-primary"
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" /></svg>}
        />
        <StatCard
          label="KYC Verified"
          value={users.filter(u => u.kyc_status === 'verified').length}
          loading={loading}
          gradient="from-success to-success"
          valueColor="text-success"
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>}
        />
        <StatCard
          label="KYC Pending"
          value={users.filter(u => u.kyc_status === 'pending').length}
          loading={loading}
          gradient="from-chart-4 to-chart-4"
          valueColor="text-chart-4"
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>}
        />
      </div>

      <GlassCard padding="none">
        {loading ? (
          <div className="p-6">
            <div className="space-y-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-xl shimmer" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-32 rounded-lg shimmer" />
                    <div className="h-3 w-48 rounded-lg shimmer" />
                  </div>
                  <div className="h-6 w-16 rounded-full shimmer" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[14px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 sm:px-6 py-4 text-[12px] font-medium text-muted-foreground">User</th>
                  <th className="hidden sm:table-cell px-3 sm:px-6 py-4 text-[12px] font-medium text-muted-foreground">Auth</th>
                  <th className="px-3 sm:px-6 py-4 text-[12px] font-medium text-muted-foreground">Role</th>
                  <th className="hidden md:table-cell px-3 sm:px-6 py-4 text-[12px] font-medium text-muted-foreground">KYC</th>
                  <th className="px-3 sm:px-6 py-4 text-[12px] font-medium text-muted-foreground">Status</th>
                  <th className="hidden md:table-cell px-3 sm:px-6 py-4 text-[12px] font-medium text-muted-foreground">Joined</th>
                  <th className="px-3 sm:px-6 py-4 text-[12px] font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((user) => {
                  const isSelf = user.id === currentUser?.id;
                  return (
                    <tr key={user.id} className="transition-colors hover:bg-secondary/50" style={{ transitionTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}>
                      <td className="px-3 sm:px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary">
                            <span className="text-[13px] font-semibold text-primary-foreground">{user.full_name.charAt(0).toUpperCase()}</span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[14px] font-semibold text-foreground truncate">
                              {user.full_name}
                              {isSelf && <span className="ml-1.5 text-[12px] text-primary">(you)</span>}
                            </p>
                            <p className="text-[12px] text-muted-foreground truncate">{user.email}</p>
                            {user.auth_method === 'code' && (
                              <span className="sm:hidden inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[#0071e3]/10 text-[#0071e3] mt-0.5">Invited</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="hidden sm:table-cell px-3 sm:px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium ${user.auth_method === 'code' ? 'bg-[#0071e3]/10 text-[#0071e3]' : 'bg-secondary text-muted-foreground'}`}>
                          {user.auth_method === 'code' ? 'Invited' : 'Password'}
                        </span>
                      </td>
                      <td className="px-3 sm:px-6 py-4">
                        {currentUser?.role === 'admin' && !isSelf ? (
                          <select value={user.role} onChange={(e) => requestRoleChange(user.id, user.full_name, user.role, e.target.value)} className={selectClass}>
                            {(ALLOWED_ROLE_OPTIONS[user.role] || []).map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        ) : (
                          <Badge type="role" value={user.role} />
                        )}
                      </td>
                      <td className="hidden md:table-cell px-3 sm:px-6 py-4">
                        {currentUser?.role === 'admin' ? (
                          <select value={user.kyc_status} onChange={(e) => handleKycChange(user.id, e.target.value)} className={selectClass}>
                            <option value="pending">Pending</option>
                            <option value="verified">Verified</option>
                            <option value="rejected">Rejected</option>
                          </select>
                        ) : (
                          <Badge type="kyc" value={user.kyc_status} />
                        )}
                      </td>
                      <td className="px-3 sm:px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium ${user.is_active ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${user.is_active ? 'bg-success' : 'bg-destructive'}`} />
                          {user.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="hidden md:table-cell px-3 sm:px-6 py-4 text-[13px] text-muted-foreground">
                        {formatDate(user.created_at)}
                      </td>
                      <td className="px-3 sm:px-6 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          {user.auth_method === 'code' && !isSelf && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleResendCode(user)}
                            >
                              Resend Code
                            </Button>
                          )}
                          {currentUser?.role === 'admin' && !isSelf && (
                            <Button
                              variant={user.is_active ? 'danger' : 'success'}
                              size="sm"
                              onClick={() => requestToggleActive(user.id, user.full_name, user.is_active)}
                            >
                              {user.is_active ? 'Deactivate' : 'Activate'}
                            </Button>
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

      {/* Confirmation Modal */}
      {pendingAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-background border border-border p-6 shadow-xl">
            <h3 className="text-[16px] font-semibold text-foreground mb-2">Confirm Action</h3>
            <p className="text-[14px] text-muted-foreground mb-6">
              {pendingAction.type === 'role' ? (
                <>
                  Change <span className="font-semibold text-foreground">{pendingAction.userName}</span>'s role from{' '}
                  <span className="font-semibold text-foreground capitalize">{pendingAction.from}</span> to{' '}
                  <span className="font-semibold text-foreground capitalize">{pendingAction.to}</span>?
                </>
              ) : (
                <>
                  {pendingAction.isActive ? 'Deactivate' : 'Activate'}{' '}
                  <span className="font-semibold text-foreground">{pendingAction.userName}</span>?
                  {pendingAction.isActive && ' They will no longer be able to log in.'}
                </>
              )}
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" size="sm" onClick={cancelAction}>Cancel</Button>
              <Button
                variant={pendingAction.type === 'toggle_active' && pendingAction.isActive ? 'danger' : 'primary'}
                size="sm"
                onClick={confirmAction}
              >
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
