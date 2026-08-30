import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { Card, Button, ListSkeleton } from '../../components/ui';
import { getErrorMessage } from '../../lib/utils';
import type { BrokerGroup, User } from '../../types';

interface GroupFormState {
  name: string;
  description: string;
  member_ids: string[];
}

const EMPTY_FORM: GroupFormState = { name: '', description: '', member_ids: [] };

export default function BrokerGroups() {
  const { toast } = useToast();
  const [groups, setGroups] = useState<BrokerGroup[]>([]);
  const [brokers, setBrokers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<BrokerGroup | null>(null);
  const [form, setForm] = useState<GroupFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addingMemberId, setAddingMemberId] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get('/broker-groups'),
      api.get('/users'),
    ])
      .then(([groupsRes, usersRes]) => {
        setGroups(groupsRes.data);
        setBrokers(usersRes.data.filter((u: User) => u.role === 'broker' && u.is_active));
      })
      .catch(() => toast('Failed to load broker groups', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const openCreate = () => {
    setEditingGroup(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (group: BrokerGroup) => {
    setEditingGroup(group);
    setForm({
      name: group.name,
      description: group.description ?? '',
      member_ids: group.members.map((m) => m.id),
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editingGroup) {
        const { data } = await api.patch(`/broker-groups/${editingGroup.id}`, {
          name: form.name.trim(),
          description: form.description.trim() || null,
        });
        setGroups((prev) => prev.map((g) => (g.id === editingGroup.id ? data : g)));
        toast('Group updated', 'success');
      } else {
        const { data } = await api.post('/broker-groups', {
          name: form.name.trim(),
          description: form.description.trim() || null,
          member_ids: form.member_ids,
        });
        setGroups((prev) => [...prev, data]);
        toast('Group created', 'success');
      }
      setShowForm(false);
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to save group'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (groupId: string) => {
    setDeletingId(groupId);
    try {
      await api.delete(`/broker-groups/${groupId}`);
      setGroups((prev) => prev.filter((g) => g.id !== groupId));
      toast('Group deleted', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to delete group'), 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const handleAddMember = async (groupId: string, brokerId: string) => {
    setAddingMemberId(brokerId);
    try {
      const { data } = await api.post(`/broker-groups/${groupId}/members?broker_id=${brokerId}`);
      setGroups((prev) => prev.map((g) => (g.id === groupId ? data : g)));
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to add member'), 'error');
    } finally {
      setAddingMemberId(null);
    }
  };

  const handleRemoveMember = async (groupId: string, brokerId: string) => {
    setRemovingMemberId(brokerId);
    try {
      const { data } = await api.delete(`/broker-groups/${groupId}/members?broker_id=${brokerId}`);
      setGroups((prev) => prev.map((g) => (g.id === groupId ? data : g)));
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to remove member'), 'error');
    } finally {
      setRemovingMemberId(null);
    }
  };

  const toggleMemberInForm = (brokerId: string) => {
    setForm((prev) => ({
      ...prev,
      member_ids: prev.member_ids.includes(brokerId)
        ? prev.member_ids.filter((id) => id !== brokerId)
        : [...prev.member_ids, brokerId],
    }));
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <h1 className="text-[28px] font-semibold tracking-tight text-foreground">Broker Groups</h1>
          <p className="mt-1 text-[14px] text-muted-foreground">
            Organise brokers into groups for bulk application assignment.
          </p>
        </div>
        <ListSkeleton rows={3} rowHeight={72} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight text-foreground">Broker Groups</h1>
          <p className="mt-1 text-[14px] text-muted-foreground">
            Organise brokers into groups for bulk application assignment.
          </p>
        </div>
        <Button onClick={openCreate}>
          <svg className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Group
        </Button>
      </div>

      {/* Create / Edit Form */}
      {showForm && (
        <Card className="mb-6 border-primary/20 bg-primary/5">
          <h2 className="text-[15px] font-semibold text-foreground mb-4">
            {editingGroup ? 'Edit Group' : 'Create Group'}
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Group Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Senior Brokers, Home Loans Team"
                className="led-input"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Description</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="Optional description"
                className="led-input"
              />
            </div>
            {!editingGroup && brokers.length > 0 && (
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">Initial Members</label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {brokers.map((broker) => (
                    <label
                      key={broker.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-all ${form.member_ids.includes(broker.id) ? 'border-primary/30 bg-primary/5' : 'border-border/50 bg-secondary/30 hover:bg-secondary/60'}`}
                    >
                      <input
                        type="checkbox"
                        checked={form.member_ids.includes(broker.id)}
                        onChange={() => toggleMemberInForm(broker.id)}
                        className="h-4 w-4 rounded border-border accent-primary"
                      />
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-foreground truncate">{broker.full_name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{broker.email}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-3 pt-1">
              <Button onClick={handleSave} loading={saving} disabled={!form.name.trim()}>
                {editingGroup ? 'Save Changes' : 'Create Group'}
              </Button>
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </div>
        </Card>
      )}

      {/* Groups List */}
      {groups.length === 0 ? (
        <Card>
          <div className="py-12 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
              <svg className="h-6 w-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
              </svg>
            </div>
            <p className="text-[14px] font-medium text-foreground">No broker groups yet</p>
            <p className="mt-1 text-[13px] text-muted-foreground">Create a group to bulk-assign brokers to applications.</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => {
            const isExpanded = expandedId === group.id;
            const groupBrokers = brokers.filter((b) => !group.members.some((m) => m.id === b.id));

            return (
              <Card key={group.id} padding="none">
                {/* Group header */}
                <div className="flex items-center justify-between p-5">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                      <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-foreground">{group.name}</p>
                      <p className="text-[12px] text-muted-foreground">
                        {group.members.length} member{group.members.length !== 1 ? 's' : ''}
                        {group.description && ` · ${group.description}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : group.id)}
                      className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                      title={isExpanded ? 'Collapse' : 'Manage members'}
                    >
                      <svg className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                      </svg>
                    </button>
                    <button
                      onClick={() => openEdit(group)}
                      className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                      title="Edit"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(group.id)}
                      disabled={deletingId === group.id}
                      className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-50"
                      title="Delete group"
                    >
                      {deletingId === group.id ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-destructive border-t-transparent" />
                      ) : (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {/* Expanded members panel */}
                {isExpanded && (
                  <div className="border-t border-border/50 p-5">
                    {/* Current members */}
                    <div className="mb-4">
                      <p className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Current Members</p>
                      {group.members.length === 0 ? (
                        <p className="text-[13px] text-muted-foreground italic">No members yet.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {group.members.map((member) => (
                            <div
                              key={member.id}
                              className="flex items-center gap-2 rounded-full bg-secondary border border-border/50 pl-3 pr-2 py-1.5"
                            >
                              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[10px] font-semibold text-primary">
                                {member.full_name.charAt(0).toUpperCase()}
                              </div>
                              <span className="text-[13px] font-medium text-foreground">{member.full_name}</span>
                              <button
                                onClick={() => handleRemoveMember(group.id, member.id)}
                                disabled={removingMemberId === member.id}
                                className="ml-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-50"
                                title="Remove"
                              >
                                {removingMemberId === member.id ? (
                                  <div className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                                ) : (
                                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                  </svg>
                                )}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Add members */}
                    {groupBrokers.length > 0 && (
                      <div>
                        <p className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Add Member</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {groupBrokers.map((broker) => (
                            <button
                              key={broker.id}
                              onClick={() => handleAddMember(group.id, broker.id)}
                              disabled={addingMemberId === broker.id}
                              className="flex items-center gap-3 rounded-xl border border-border/50 bg-secondary/30 p-3 text-left hover:bg-secondary/60 transition-colors disabled:opacity-50"
                            >
                              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-muted-foreground">
                                {broker.full_name.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-[13px] font-medium text-foreground truncate">{broker.full_name}</p>
                                <p className="text-[11px] text-muted-foreground truncate">{broker.email}</p>
                              </div>
                              {addingMemberId === broker.id ? (
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent shrink-0" />
                              ) : (
                                <svg className="h-4 w-4 shrink-0 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                                </svg>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {groupBrokers.length === 0 && group.members.length > 0 && (
                      <p className="text-[13px] text-muted-foreground italic">All active brokers are already in this group.</p>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
