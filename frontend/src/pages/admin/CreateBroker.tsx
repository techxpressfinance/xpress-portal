import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { getErrorMessage, getInitials } from '../../lib/utils';
import { GlassCard, PageHeader, Button, Input } from '../../components/ui';
import type { BrokerGroup, User } from '../../types';

interface BrokerForm {
  full_name: string;
  email: string;
  phone: string;
  employee_id: string;
  department: string;
  license_number: string;
}

const INITIAL_FORM: BrokerForm = {
  full_name: '',
  email: '',
  phone: '',
  employee_id: '',
  department: '',
  license_number: '',
};

interface GroupForm {
  name: string;
  description: string;
}

const INITIAL_GROUP_FORM: GroupForm = { name: '', description: '' };

export default function CreateBroker() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState<BrokerForm>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof BrokerForm, string>>>({});

  // Broker groups state
  const [groups, setGroups] = useState<BrokerGroup[]>([]);
  const [brokers, setBrokers] = useState<User[]>([]);
  const [groupForm, setGroupForm] = useState<GroupForm>(INITIAL_GROUP_FORM);
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([]);
  const [groupErrors, setGroupErrors] = useState<Partial<Record<keyof GroupForm, string>>>({});
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState('');
  const [editGroupDesc, setEditGroupDesc] = useState('');
  const [savingGroupEdit, setSavingGroupEdit] = useState(false);

  useEffect(() => {
    api.get('/broker-groups').then(({ data }) => setGroups(data)).catch(() => {});
    api.get('/users').then(({ data }) => {
      setBrokers(data.filter((u: User) => u.role === 'broker'));
    }).catch(() => {});
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
      toast('Broker created successfully. Login credentials sent via email.', 'success');
      setForm(INITIAL_FORM);
      setErrors({});
      setBrokers((prev) => [data, ...prev]);
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to create broker'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const update = (field: keyof BrokerForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  // --- Broker Group handlers ---

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Partial<Record<keyof GroupForm, string>> = {};
    if (!groupForm.name.trim()) errs.name = 'Group name is required';
    setGroupErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setCreatingGroup(true);
    try {
      const { data } = await api.post('/broker-groups', {
        name: groupForm.name.trim(),
        description: groupForm.description.trim() || null,
        member_ids: groupMemberIds,
      });
      setGroups((prev) => [...prev, data]);
      setGroupForm(INITIAL_GROUP_FORM);
      setGroupMemberIds([]);
      setGroupErrors({});
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
      setGroups((prev) => prev.filter((g) => g.id !== groupId));
      if (selectedGroupId === groupId) setSelectedGroupId(null);
      toast('Group deleted', 'success');
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to delete group'), 'error');
    }
  };

  const handleAddMember = async (groupId: string, brokerId: string) => {
    try {
      const { data } = await api.post(`/broker-groups/${groupId}/members?broker_id=${brokerId}`);
      setGroups((prev) => prev.map((g) => (g.id === groupId ? data : g)));
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to add member'), 'error');
    }
  };

  const handleRemoveMember = async (groupId: string, brokerId: string) => {
    try {
      const { data } = await api.delete(`/broker-groups/${groupId}/members?broker_id=${brokerId}`);
      setGroups((prev) => prev.map((g) => (g.id === groupId ? data : g)));
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to remove member'), 'error');
    }
  };

  const startEditGroup = (group: BrokerGroup) => {
    setEditingGroup(group.id);
    setEditGroupName(group.name);
    setEditGroupDesc(group.description || '');
  };

  const handleSaveGroupEdit = async () => {
    if (!editingGroup || !editGroupName.trim()) return;
    setSavingGroupEdit(true);
    try {
      const { data } = await api.patch(`/broker-groups/${editingGroup}`, {
        name: editGroupName.trim(),
        description: editGroupDesc.trim() || null,
      });
      setGroups((prev) => prev.map((g) => (g.id === editingGroup ? data : g)));
      setEditingGroup(null);
      toast('Group updated', 'success');
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to update group'), 'error');
    } finally {
      setSavingGroupEdit(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Brokers & Groups"
        subtitle="Create broker accounts and manage broker groups for team-based application assignment."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Create Broker */}
        <GlassCard>
          <form onSubmit={handleSubmit} className="space-y-5">
            <h3 className="text-[15px] font-semibold text-foreground mb-1">Create Broker</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Full Name *"
                placeholder="John Smith"
                value={form.full_name}
                onChange={(e) => update('full_name', e.target.value)}
                error={errors.full_name}
              />
              <Input
                label="Email *"
                type="email"
                placeholder="broker@example.com"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                error={errors.email}
              />
              <Input
                label="Phone"
                type="tel"
                placeholder="+61 400 000 000"
                value={form.phone}
                onChange={(e) => update('phone', e.target.value)}
              />
              <Input
                label="Employee ID *"
                placeholder="EMP-001"
                value={form.employee_id}
                onChange={(e) => update('employee_id', e.target.value)}
                error={errors.employee_id}
              />
              <Input
                label="Department"
                placeholder="Lending"
                value={form.department}
                onChange={(e) => update('department', e.target.value)}
              />
              <Input
                label="License Number"
                placeholder="ACR-123456"
                value={form.license_number}
                onChange={(e) => update('license_number', e.target.value)}
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Creating...' : 'Create Broker'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => navigate('/admin/users')}>
                Cancel
              </Button>
            </div>
          </form>
        </GlassCard>

        {/* Broker Groups */}
        <div className="space-y-6">
          {/* Create Group */}
          <GlassCard>
            <form onSubmit={handleCreateGroup} className="space-y-4">
              <h3 className="text-[15px] font-semibold text-foreground mb-1">Create Broker Group</h3>
              <p className="text-[13px] text-muted-foreground">Groups let you assign multiple brokers to applications at once.</p>
              <Input
                label="Group Name *"
                placeholder="e.g. Commercial Team"
                value={groupForm.name}
                onChange={(e) => {
                  setGroupForm((prev) => ({ ...prev, name: e.target.value }));
                  if (groupErrors.name) setGroupErrors((prev) => ({ ...prev, name: undefined }));
                }}
                error={groupErrors.name}
              />
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">Description</label>
                <textarea
                  value={groupForm.description}
                  onChange={(e) => setGroupForm((prev) => ({ ...prev, description: e.target.value }))}
                  rows={2}
                  className="w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground"
                  placeholder="Optional description..."
                />
              </div>

              {/* Broker member picker */}
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">Members</label>
                {groupMemberIds.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {groupMemberIds.map((bid) => {
                      const b = brokers.find((br) => br.id === bid);
                      if (!b) return null;
                      return (
                        <span key={bid} className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1.5 text-[12px] font-medium text-primary">
                          {b.full_name}
                          <button
                            type="button"
                            onClick={() => setGroupMemberIds((prev) => prev.filter((id) => id !== bid))}
                            className="hover:text-destructive transition-colors"
                          >
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
                {brokers.filter((b) => !groupMemberIds.includes(b.id)).length > 0 ? (
                  <select
                    value=""
                    onChange={(e) => { if (e.target.value) setGroupMemberIds((prev) => [...prev, e.target.value]); }}
                    className="w-full rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground h-10 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    <option value="">Add broker...</option>
                    {brokers
                      .filter((b) => !groupMemberIds.includes(b.id))
                      .map((b) => (
                        <option key={b.id} value={b.id}>{b.full_name}</option>
                      ))}
                  </select>
                ) : brokers.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground">No brokers available. Create a broker first.</p>
                ) : (
                  <p className="text-[12px] text-muted-foreground">All brokers added.</p>
                )}
              </div>

              <Button type="submit" disabled={creatingGroup}>
                {creatingGroup ? 'Creating...' : 'Create Group'}
              </Button>
            </form>
          </GlassCard>

          {/* Existing Groups */}
          {groups.length > 0 && (
            <GlassCard>
              <h3 className="text-[15px] font-semibold text-foreground mb-4">Broker Groups</h3>
              <div className="space-y-2">
                {groups.map((group) => (
                  <div key={group.id}>
                    <div
                      className={`flex items-center gap-3 rounded-xl p-3 cursor-pointer transition-all ${
                        selectedGroupId === group.id ? 'bg-primary/10 border border-primary/20' : 'bg-secondary/50 hover:bg-secondary'
                      }`}
                      onClick={() => setSelectedGroupId(selectedGroupId === group.id ? null : group.id)}
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-chart-2/15">
                        <svg className="h-4 w-4 text-chart-2" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        {editingGroup === group.id ? (
                          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              value={editGroupName}
                              onChange={(e) => setEditGroupName(e.target.value)}
                              className="flex-1 rounded-lg bg-background px-2 py-1 text-[13px] text-foreground border border-border focus:outline-none focus:ring-2 focus:ring-primary/30"
                            />
                            <Button size="sm" onClick={handleSaveGroupEdit} loading={savingGroupEdit}>Save</Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingGroup(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <>
                            <p className="text-[13px] font-semibold text-foreground truncate">{group.name}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {group.members.length} member{group.members.length !== 1 ? 's' : ''}
                              {group.description && ` · ${group.description}`}
                            </p>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        {editingGroup !== group.id && (
                          <button
                            onClick={() => startEditGroup(group)}
                            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                            title="Edit group"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" /></svg>
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteGroup(group.id)}
                          className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                          title="Delete group"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                        </button>
                      </div>
                      <svg className={`h-4 w-4 text-muted-foreground transition-transform ${selectedGroupId === group.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
                    </div>

                    {/* Expanded member management */}
                    {selectedGroupId === group.id && (
                      <div className="mt-2 ml-12 space-y-2">
                        {/* Current members */}
                        {group.members.length > 0 ? (
                          <div className="space-y-1.5">
                            {group.members.map((m) => (
                              <div key={m.id} className="flex items-center gap-2.5 rounded-lg bg-secondary/30 px-3 py-2">
                                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
                                  <span className="text-[10px] font-semibold text-primary">{getInitials(m.full_name)}</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[12px] font-medium text-foreground truncate">{m.full_name}</p>
                                  <p className="text-[11px] text-muted-foreground truncate">{m.email}</p>
                                </div>
                                <button
                                  onClick={() => handleRemoveMember(group.id, m.id)}
                                  className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                                  title="Remove from group"
                                >
                                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[12px] text-muted-foreground py-1">No members yet</p>
                        )}

                        {/* Add member dropdown */}
                        {brokers.filter((b) => !group.members.some((m) => m.id === b.id)).length > 0 && (
                          <select
                            value=""
                            onChange={(e) => { if (e.target.value) handleAddMember(group.id, e.target.value); }}
                            className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[12px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
                          >
                            <option value="">Add broker to group...</option>
                            {brokers
                              .filter((b) => !group.members.some((m) => m.id === b.id))
                              .map((b) => (
                                <option key={b.id} value={b.id}>{b.full_name}</option>
                              ))}
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
      </div>
    </div>
  );
}
