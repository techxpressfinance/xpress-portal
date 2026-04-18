import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { getErrorMessage, formatDate, getInitials } from '../../lib/utils';
import { GlassCard, StatCard, PageHeader, Button, Input } from '../../components/ui';
import PeopleNav from '../../components/PeopleNav';
import type { BrokerGroup, User } from '../../types';

interface BrokerForm {
  full_name: string;
  email: string;
  phone: string;
  employee_id: string;
  department: string;
  license_number: string;
}

const INITIAL_FORM: BrokerForm = { full_name: '', email: '', phone: '', employee_id: '', department: '', license_number: '' };

type PendingAction =
  | { type: 'toggle_active'; userId: string; userName: string; isActive: boolean }
  | { type: 'delete'; userId: string; userName: string };

export default function BrokerManagement() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<BrokerForm>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof BrokerForm, string>>>({});
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const [brokers, setBrokers] = useState<User[]>([]);
  const [loadingBrokers, setLoadingBrokers] = useState(true);

  const [groups, setGroups] = useState<BrokerGroup[]>([]);
  const [groupForm, setGroupForm] = useState({ name: '', description: '' });
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([]);
  const [groupErrors, setGroupErrors] = useState<{ name?: string }>({});
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState('');
  const [editGroupDesc, setEditGroupDesc] = useState('');
  const [savingGroupEdit, setSavingGroupEdit] = useState(false);

  useEffect(() => {
    api.get('/users').then(({ data }) => setBrokers(data.filter((u: User) => u.role === 'broker'))).catch(() => { }).finally(() => setLoadingBrokers(false));
    api.get('/broker-groups').then(({ data }) => setGroups(data)).catch(() => { });
  }, []);

  const validate = (): boolean => {
    const errs: Partial<Record<keyof BrokerForm, string>> = {};
    if (!form.full_name.trim()) errs.full_name = 'Full name is required';
    if (!form.email.trim()) errs.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Invalid email address';
    if (!form.employee_id.trim()) errs.employee_id = 'Employee ID is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const { data } = await api.post('/users/brokers', {
        full_name: form.full_name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim() || null,
        employee_id: form.employee_id.trim(),
        department: form.department.trim() || null,
        license_number: form.license_number.trim() || null,
      });
      toast('Broker created. Login credentials sent via email.', 'success');
      setForm(INITIAL_FORM);
      setErrors({});
      setShowForm(false);
      setBrokers(prev => [data, ...prev]);
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to create broker'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const update = (field: keyof BrokerForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: undefined }));
  };

  const confirmAction = async () => {
    if (!pendingAction) return;
    try {
      if (pendingAction.type === 'delete') {
        await api.delete(`/users/${pendingAction.userId}`);
        setBrokers(prev => prev.filter(u => u.id !== pendingAction.userId));
        toast('Broker deleted', 'success');
      } else {
        const { data } = await api.patch(`/users/${pendingAction.userId}/active`, { is_active: !pendingAction.isActive });
        setBrokers(prev => prev.map(u => u.id === pendingAction.userId ? data : u));
        toast(`Broker ${!pendingAction.isActive ? 'activated' : 'deactivated'}`, 'success');
      }
    } catch (err: any) {
      toast(getErrorMessage(err, 'Action failed'), 'error');
    } finally {
      setPendingAction(null);
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupForm.name.trim()) { setGroupErrors({ name: 'Group name is required' }); return; }
    setGroupErrors({});
    setCreatingGroup(true);
    try {
      const { data } = await api.post('/broker-groups', { name: groupForm.name.trim(), description: groupForm.description.trim() || null, member_ids: groupMemberIds });
      setGroups(prev => [...prev, data]);
      setGroupForm({ name: '', description: '' });
      setGroupMemberIds([]);
      toast('Broker group created', 'success');
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to create group'), 'error');
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    try {
      await api.delete(`/broker-groups/${groupId}`);
      setGroups(prev => prev.filter(g => g.id !== groupId));
      if (selectedGroupId === groupId) setSelectedGroupId(null);
      toast('Group deleted', 'success');
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to delete group'), 'error');
    }
  };

  const handleAddMember = async (groupId: string, brokerId: string) => {
    try {
      const { data } = await api.post(`/broker-groups/${groupId}/members?broker_id=${brokerId}`);
      setGroups(prev => prev.map(g => g.id === groupId ? data : g));
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to add member'), 'error');
    }
  };

  const handleRemoveMember = async (groupId: string, brokerId: string) => {
    try {
      const { data } = await api.delete(`/broker-groups/${groupId}/members?broker_id=${brokerId}`);
      setGroups(prev => prev.map(g => g.id === groupId ? data : g));
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to remove member'), 'error');
    }
  };

  const handleSaveGroupEdit = async () => {
    if (!editingGroup || !editGroupName.trim()) return;
    setSavingGroupEdit(true);
    try {
      const { data } = await api.patch(`/broker-groups/${editingGroup}`, { name: editGroupName.trim(), description: editGroupDesc.trim() || null });
      setGroups(prev => prev.map(g => g.id === editingGroup ? data : g));
      setEditingGroup(null);
      toast('Group updated', 'success');
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to update group'), 'error');
    } finally {
      setSavingGroupEdit(false);
    }
  };

  const activeBrokers = brokers.filter(b => b.is_active);

  return (
    <div>
      <PageHeader
        title="Team Management"
        subtitle="Manage clients, brokers, and referrers"
        action={<Button onClick={() => setShowForm(f => !f)}>+ Add Broker</Button>}
      />
      <PeopleNav />

      {/* Stats */}
      <div className="grid gap-5 sm:grid-cols-3 mb-8">
        <StatCard label="Total Brokers" value={brokers.length} loading={loadingBrokers} gradient="from-primary to-primary"
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0 1 12 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 0 1-.673-.38m0 0A2.18 2.18 0 0 1 3 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>}
        />
        <StatCard label="Active" value={activeBrokers.length} loading={loadingBrokers} gradient="from-success to-success" valueColor="text-success"
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>}
        />
        <StatCard label="Groups" value={groups.length} gradient="from-chart-2 to-chart-2"
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" /></svg>}
        />
      </div>

      {/* Create broker form */}
      {showForm && (
        <GlassCard className="mb-6">
          <h3 className="text-[15px] font-semibold text-foreground mb-4">New Broker</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Input label="Full Name *" placeholder="John Smith" value={form.full_name} onChange={e => update('full_name', e.target.value)} error={errors.full_name} />
              <Input label="Email *" type="email" placeholder="broker@example.com" value={form.email} onChange={e => update('email', e.target.value)} error={errors.email} />
              <Input label="Phone" type="tel" placeholder="+61 400 000 000" value={form.phone} onChange={e => update('phone', e.target.value)} />
              <Input label="Employee ID *" placeholder="EMP-001" value={form.employee_id} onChange={e => update('employee_id', e.target.value)} error={errors.employee_id} />
              <Input label="Department" placeholder="Lending" value={form.department} onChange={e => update('department', e.target.value)} />
              <Input label="License Number" placeholder="ACR-123456" value={form.license_number} onChange={e => update('license_number', e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" loading={submitting}>Create Broker</Button>
              <Button type="button" variant="secondary" onClick={() => { setShowForm(false); setForm(INITIAL_FORM); setErrors({}); }}>Cancel</Button>
            </div>
          </form>
        </GlassCard>
      )}

      {/* Broker table */}
      <GlassCard padding="none" className="mb-8">
        {loadingBrokers ? (
          <div className="p-6 space-y-4">{[1, 2, 3].map(i => <div key={i} className="flex items-center gap-4"><div className="h-10 w-10 rounded-xl shimmer" /><div className="flex-1 space-y-2"><div className="h-4 w-32 rounded-lg shimmer" /><div className="h-3 w-48 rounded-lg shimmer" /></div></div>)}</div>
        ) : brokers.length === 0 ? (
          <div className="p-10 text-center text-[14px] text-muted-foreground">No brokers yet. Add one to get started.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[14px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-6 py-4 text-[12px] font-medium text-muted-foreground">Broker</th>
                  <th className="hidden sm:table-cell px-6 py-4 text-[12px] font-medium text-muted-foreground">Employee ID</th>
                  <th className="hidden md:table-cell px-6 py-4 text-[12px] font-medium text-muted-foreground">Department</th>
                  <th className="px-6 py-4 text-[12px] font-medium text-muted-foreground">Status</th>
                  <th className="hidden md:table-cell px-6 py-4 text-[12px] font-medium text-muted-foreground">Joined</th>
                  <th className="px-6 py-4 text-[12px] font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {brokers.map(broker => (
                  <tr key={broker.id} className="transition-colors hover:bg-secondary/50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-chart-2/15">
                          <span className="text-[11px] font-semibold text-chart-2">{getInitials(broker.full_name)}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold text-foreground truncate">{broker.full_name}</p>
                          <p className="text-[12px] text-muted-foreground truncate">{broker.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden sm:table-cell px-6 py-4 text-[13px] text-muted-foreground">{broker.employee_id || '—'}</td>
                    <td className="hidden md:table-cell px-6 py-4 text-[13px] text-muted-foreground">{broker.department || '—'}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium ${broker.is_active ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${broker.is_active ? 'bg-success' : 'bg-destructive'}`} />
                        {broker.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="hidden md:table-cell px-6 py-4 text-[13px] text-muted-foreground">{formatDate(broker.created_at)}</td>
                    <td className="px-6 py-4">
                      <div className="flex gap-2">
                        <Button size="sm" variant={broker.is_active ? 'danger' : 'success'} onClick={() => setPendingAction({ type: 'toggle_active', userId: broker.id, userName: broker.full_name, isActive: broker.is_active })}>
                          {broker.is_active ? 'Deactivate' : 'Activate'}
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setPendingAction({ type: 'delete', userId: broker.id, userName: broker.full_name })}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* Broker Groups */}
      <h3 className="text-[15px] font-semibold text-foreground mb-4">Broker Groups</h3>
      <div className="grid gap-6 lg:grid-cols-2">
        <GlassCard>
          <form onSubmit={handleCreateGroup} className="space-y-4">
            <h4 className="text-[14px] font-semibold text-foreground">New Group</h4>
            <p className="text-[13px] text-muted-foreground">Groups let you assign multiple brokers to applications at once.</p>
            <Input label="Group Name *" placeholder="e.g. Commercial Team" value={groupForm.name}
              onChange={e => { setGroupForm(p => ({ ...p, name: e.target.value })); if (groupErrors.name) setGroupErrors({}); }}
              error={groupErrors.name}
            />
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-2">Description</label>
              <textarea value={groupForm.description} onChange={e => setGroupForm(p => ({ ...p, description: e.target.value }))} rows={2}
                className="w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground"
                placeholder="Optional description..." />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-2">Members</label>
              {groupMemberIds.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {groupMemberIds.map(bid => {
                    const b = brokers.find(br => br.id === bid);
                    if (!b) return null;
                    return (
                      <span key={bid} className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1.5 text-[12px] font-medium text-primary">
                        {b.full_name}
                        <button type="button" onClick={() => setGroupMemberIds(p => p.filter(id => id !== bid))} className="hover:text-destructive transition-colors">
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
              {brokers.filter(b => !groupMemberIds.includes(b.id)).length > 0 ? (
                <select value="" onChange={e => { if (e.target.value) setGroupMemberIds(p => [...p, e.target.value]); }}
                  className="w-full rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground h-10 border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value="">Add broker...</option>
                  {brokers.filter(b => !groupMemberIds.includes(b.id)).map(b => <option key={b.id} value={b.id}>{b.full_name}</option>)}
                </select>
              ) : (
                <p className="text-[12px] text-muted-foreground">{brokers.length === 0 ? 'No brokers available yet.' : 'All brokers added.'}</p>
              )}
            </div>
            <Button type="submit" loading={creatingGroup}>Create Group</Button>
          </form>
        </GlassCard>

        {groups.length > 0 && (
          <GlassCard>
            <h4 className="text-[14px] font-semibold text-foreground mb-4">Existing Groups</h4>
            <div className="space-y-2">
              {groups.map(group => (
                <div key={group.id}>
                  <div
                    className={`flex items-center gap-3 rounded-xl p-3 cursor-pointer transition-all ${selectedGroupId === group.id ? 'bg-primary/10 border border-primary/20' : 'bg-secondary/50 hover:bg-secondary'}`}
                    onClick={() => setSelectedGroupId(selectedGroupId === group.id ? null : group.id)}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-chart-2/15">
                      <svg className="h-4 w-4 text-chart-2" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" /></svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      {editingGroup === group.id ? (
                        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                          <input type="text" value={editGroupName} onChange={e => setEditGroupName(e.target.value)}
                            className="flex-1 rounded-lg bg-background px-2 py-1 text-[13px] text-foreground border border-border focus:outline-none focus:ring-2 focus:ring-primary/30" />
                          <Button size="sm" onClick={handleSaveGroupEdit} loading={savingGroupEdit}>Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingGroup(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <>
                          <p className="text-[13px] font-semibold text-foreground truncate">{group.name}</p>
                          <p className="text-[11px] text-muted-foreground">{group.members.length} member{group.members.length !== 1 ? 's' : ''}{group.description && ` · ${group.description}`}</p>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      {editingGroup !== group.id && (
                        <button onClick={() => { setEditingGroup(group.id); setEditGroupName(group.name); setEditGroupDesc(group.description || ''); }}
                          className="p-1 text-muted-foreground hover:text-foreground transition-colors">
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" /></svg>
                        </button>
                      )}
                      <button onClick={() => handleDeleteGroup(group.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors">
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                      </button>
                    </div>
                    <svg className={`h-4 w-4 text-muted-foreground transition-transform ${selectedGroupId === group.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
                  </div>

                  {selectedGroupId === group.id && (
                    <div className="mt-2 ml-12 space-y-2">
                      {group.members.length > 0 ? (
                        <div className="space-y-1.5">
                          {group.members.map(m => (
                            <div key={m.id} className="flex items-center gap-2.5 rounded-lg bg-secondary/30 px-3 py-2">
                              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
                                <span className="text-[10px] font-semibold text-primary">{getInitials(m.full_name)}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[12px] font-medium text-foreground truncate">{m.full_name}</p>
                                <p className="text-[11px] text-muted-foreground truncate">{m.email}</p>
                              </div>
                              <button onClick={() => handleRemoveMember(group.id, m.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors">
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[12px] text-muted-foreground py-1">No members yet</p>
                      )}
                      {brokers.filter(b => !group.members.some(m => m.id === b.id)).length > 0 && (
                        <select value="" onChange={e => { if (e.target.value) handleAddMember(group.id, e.target.value); }}
                          className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[12px] text-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30">
                          <option value="">Add broker to group...</option>
                          {brokers.filter(b => !group.members.some(m => m.id === b.id)).map(b => <option key={b.id} value={b.id}>{b.full_name}</option>)}
                        </select>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </GlassCard>
        )}
      </div>

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
