import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/Toast';
import { getErrorMessage, formatDate } from '../../lib/utils';
import { GlassCard, StatCard, PageHeader, Button, Badge } from '../../components/ui';
import type { Lender, LenderContact } from '../../types';

type ContactDraft = { name: string; designation: string; email: string; phone: string };
const emptyDraft: ContactDraft = { name: '', designation: '', email: '', phone: '' };

export default function LenderManagement() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const isReadOnly = user?.role !== 'admin';
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', notes: '' });

  // Pending contacts (create mode — queued until lender is saved)
  const [pendingContacts, setPendingContacts] = useState<ContactDraft[]>([]);
  const [editingPendingIdx, setEditingPendingIdx] = useState<number | null>(null);

  // Contact sub-form (shared between create and edit modes)
  const [contactDraft, setContactDraft] = useState<ContactDraft>(emptyDraft);
  const [showContactForm, setShowContactForm] = useState(false);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [savingContact, setSavingContact] = useState(false);

  const fetchLenders = () => {
    api.get('/lenders')
      .then(({ data }) => setLenders(data))
      .catch(() => toast('Failed to load lenders', 'error' as const))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchLenders(); }, []);

  const resetForm = () => {
    setForm({ name: '', notes: '' });
    setEditingId(null);
    setShowForm(false);
    setShowContactForm(false);
    setContactDraft(emptyDraft);
    setEditingContactId(null);
    setPendingContacts([]);
    setEditingPendingIdx(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = { name: form.name.trim(), notes: form.notes.trim() || null };
      if (editingId) {
        const { data } = await api.patch(`/lenders/${editingId}`, payload);
        setLenders(prev => prev.map(l => l.id === editingId ? { ...l, ...data } : l));
        toast('Lender updated', 'success');
        resetForm();
      } else {
        const { data: newLender } = await api.post('/lenders', payload);
        const contacts: LenderContact[] = pendingContacts.length > 0
          ? await Promise.all(pendingContacts.map(c =>
            api.post(`/lenders/${newLender.id}/contacts`, c).then(r => r.data)
          ))
          : [];
        setLenders(prev => [...prev, { ...newLender, contacts }]);
        toast('Lender created', 'success');
        resetForm();
      }
    } catch (err) {
      toast(getErrorMessage(err, 'Operation failed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const openContactForm = (opts?: { pendingIdx?: number; existing?: LenderContact }) => {
    if (opts?.pendingIdx !== undefined) {
      const c = pendingContacts[opts.pendingIdx];
      setContactDraft({ name: c.name, designation: c.designation, email: c.email, phone: c.phone });
      setEditingPendingIdx(opts.pendingIdx);
      setEditingContactId(null);
    } else if (opts?.existing) {
      setContactDraft({
        name: opts.existing.name,
        designation: opts.existing.designation || '',
        email: opts.existing.email || '',
        phone: opts.existing.phone || '',
      });
      setEditingContactId(opts.existing.id);
      setEditingPendingIdx(null);
    } else {
      setContactDraft(emptyDraft);
      setEditingContactId(null);
      setEditingPendingIdx(null);
    }
    setShowContactForm(true);
  };

  const closeContactForm = () => {
    setShowContactForm(false);
    setContactDraft(emptyDraft);
    setEditingContactId(null);
    setEditingPendingIdx(null);
  };

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactDraft.name.trim()) return;
    const payload: ContactDraft = {
      name: contactDraft.name.trim(),
      designation: contactDraft.designation.trim(),
      email: contactDraft.email.trim(),
      phone: contactDraft.phone.trim(),
    };

    // Create mode — update local pending list, no API call yet
    if (!editingId) {
      if (editingPendingIdx !== null) {
        setPendingContacts(prev => prev.map((c, i) => i === editingPendingIdx ? payload : c));
      } else {
        setPendingContacts(prev => [...prev, payload]);
      }
      closeContactForm();
      return;
    }

    // Edit mode — live API calls
    setSavingContact(true);
    try {
      const apiPayload = {
        name: payload.name,
        designation: payload.designation || null,
        email: payload.email || null,
        phone: payload.phone || null,
      };
      if (editingContactId) {
        const { data } = await api.patch(`/lenders/${editingId}/contacts/${editingContactId}`, apiPayload);
        setLenders(prev => prev.map(l =>
          l.id === editingId
            ? { ...l, contacts: l.contacts.map(c => c.id === editingContactId ? data : c) }
            : l
        ));
        toast('Contact updated', 'success');
      } else {
        const { data } = await api.post(`/lenders/${editingId}/contacts`, apiPayload);
        setLenders(prev => prev.map(l =>
          l.id === editingId ? { ...l, contacts: [...l.contacts, data] } : l
        ));
        toast('Contact added', 'success');
      }
      closeContactForm();
    } catch (err) {
      toast(getErrorMessage(err, 'Operation failed'), 'error');
    } finally {
      setSavingContact(false);
    }
  };

  const removeContact = async (contact: LenderContact) => {
    if (!editingId) return;
    try {
      await api.delete(`/lenders/${editingId}/contacts/${contact.id}`);
      setLenders(prev => prev.map(l =>
        l.id === editingId ? { ...l, contacts: l.contacts.filter(c => c.id !== contact.id) } : l
      ));
      toast('Contact removed', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Operation failed'), 'error');
    }
  };

  const editingLender = editingId ? lenders.find(l => l.id === editingId) : null;

  // Contacts to display in the form panel
  const displayContacts = editingId
    ? (editingLender?.contacts ?? [])
    : pendingContacts.map((c, i) => ({ ...c, id: String(i), created_at: '' }) as LenderContact);

  const activeLenders = lenders.filter(l => l.is_active);
  const inactiveLenders = lenders.filter(l => !l.is_active);

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <PageHeader title="Lender Management" subtitle="Manage lenders for loan submissions" />
        <div className="grid gap-4 sm:grid-cols-3">
          {[1, 2, 3].map(i => <StatCard key={i} label="" value="" loading gradient="from-primary to-primary" icon={<span />} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Lenders"
        subtitle={isReadOnly ? 'View lenders and their contact details' : 'Manage lenders for loan submissions'}
        action={
          !isReadOnly ? (
            <Button onClick={() => { resetForm(); setShowForm(true); }}>
              + Add Lender
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total Lenders" value={lenders.length} gradient="from-primary to-primary" icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0 0 12 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75Z" /></svg>} />
        <StatCard label="Active" value={activeLenders.length} gradient="from-success to-success" icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>} />
        <StatCard label="Inactive" value={inactiveLenders.length} gradient="from-muted-foreground to-muted-foreground" icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" /></svg>} />
      </div>

      {showForm && (
        <GlassCard>
          <h3 className="text-[15px] font-semibold text-foreground mb-4">
            {editingId ? 'Edit Lender' : 'Add New Lender'}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  required
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1">Notes</label>
                <input
                  type="text"
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" loading={saving}>{editingId ? 'Save Changes' : 'Create Lender'}</Button>
              <Button variant="ghost" type="button" onClick={resetForm}>Cancel</Button>
            </div>
          </form>

          {/* Points of Contact — shown in both create and edit modes */}
          <div className="mt-6 pt-6 border-t border-border/60">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-[14px] font-semibold text-foreground">Points of Contact</h4>
              {!showContactForm && (
                <Button size="sm" variant="ghost" type="button" onClick={() => openContactForm()}>
                  + Add Contact
                </Button>
              )}
            </div>

            {displayContacts.length > 0 && (
              <div className="space-y-2 mb-4">
                {displayContacts.map((contact, idx) => (
                  <div key={contact.id || idx} className="flex items-start justify-between rounded-xl border border-border/60 bg-secondary/20 px-4 py-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-medium text-foreground">{contact.name}</span>
                        {contact.designation && (
                          <span className="text-[12px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">{contact.designation}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-[13px] text-muted-foreground">
                        {contact.email && <span>{contact.email}</span>}
                        {contact.phone && <span>{contact.phone}</span>}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0 ml-4">
                      <Button
                        size="sm"
                        variant="ghost"
                        type="button"
                        onClick={() => editingId
                          ? openContactForm({ existing: contact })
                          : openContactForm({ pendingIdx: idx })
                        }
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        type="button"
                        onClick={() => editingId
                          ? removeContact(contact)
                          : setPendingContacts(prev => prev.filter((_, i) => i !== idx))
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {displayContacts.length === 0 && !showContactForm && (
              <p className="text-[13px] text-muted-foreground mb-4">No contacts yet. Add the first point of contact.</p>
            )}

            {showContactForm && (
              <form onSubmit={handleContactSubmit} className="rounded-xl border border-border/60 bg-secondary/10 p-4 space-y-3">
                <p className="text-[13px] font-medium text-foreground">
                  {editingContactId || editingPendingIdx !== null ? 'Edit Contact' : 'New Contact'}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-[12px] font-medium text-muted-foreground mb-1">Name *</label>
                    <input
                      type="text"
                      value={contactDraft.name}
                      onChange={e => setContactDraft(f => ({ ...f, name: e.target.value }))}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium text-muted-foreground mb-1">Designation</label>
                    <input
                      type="text"
                      value={contactDraft.designation}
                      onChange={e => setContactDraft(f => ({ ...f, designation: e.target.value }))}
                      placeholder="e.g. Account Manager"
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium text-muted-foreground mb-1">Email</label>
                    <input
                      type="email"
                      value={contactDraft.email}
                      onChange={e => setContactDraft(f => ({ ...f, email: e.target.value }))}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium text-muted-foreground mb-1">Phone</label>
                    <input
                      type="text"
                      value={contactDraft.phone}
                      onChange={e => setContactDraft(f => ({ ...f, phone: e.target.value }))}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" type="submit" loading={savingContact}>
                    {editingContactId || editingPendingIdx !== null ? 'Save Contact' : 'Add Contact'}
                  </Button>
                  <Button size="sm" variant="ghost" type="button" onClick={closeContactForm}>Cancel</Button>
                </div>
              </form>
            )}
          </div>
        </GlassCard>
      )}

      <GlassCard padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border/60">
                <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Name</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Contacts</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Notes</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {lenders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-muted-foreground text-[14px]">
                    No lenders yet. Add your first lender to get started.
                  </td>
                </tr>
              ) : (
                lenders.map(lender => (
                  <tr key={lender.id} onClick={() => navigate(`/admin/lenders/${lender.id}`)} className="hover:bg-secondary/30 transition-colors cursor-pointer">
                    <td className="px-5 py-3 text-[14px] font-medium text-foreground">{lender.name}</td>
                    <td className="px-5 py-3 text-[13px] text-muted-foreground">
                      {lender.contacts.length === 0 ? (
                        <span className="text-muted-foreground/50">-</span>
                      ) : (
                        <span className="text-foreground">{lender.contacts.length} {lender.contacts.length === 1 ? 'contact' : 'contacts'}</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-[13px] text-muted-foreground max-w-[200px] truncate">{lender.notes || '-'}</td>
                    <td className="px-5 py-3">
                      <Badge type="custom" value={lender.is_active ? 'Active' : 'Inactive'} className={lender.is_active ? 'bg-success/10 text-success' : 'bg-secondary text-muted-foreground'} />
                    </td>
                    <td className="px-5 py-3 text-[13px] text-muted-foreground">{formatDate(lender.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  );
}
