import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { formatDate, getErrorMessage } from '../../lib/utils';
import { GlassCard, Badge, Button, Input } from '../../components/ui';
import type { Lender, LenderContact } from '../../types';

type ContactDraft = { name: string; designation: string; email: string; phone: string };
const emptyDraft: ContactDraft = { name: '', designation: '', email: '', phone: '' };

export default function LenderDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [lender, setLender] = useState<Lender | null>(null);
  const [loading, setLoading] = useState(true);

  // Lender edit state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Contact form state
  const [showContactForm, setShowContactForm] = useState(false);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [contactDraft, setContactDraft] = useState<ContactDraft>(emptyDraft);
  const [savingContact, setSavingContact] = useState(false);

  const fetchLender = () => {
    if (!id) return;
    api.get(`/lenders/${id}`)
      .then(({ data }) => setLender(data))
      .catch(() => toast('Failed to load lender', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchLender(); }, [id]);

  const startEdit = () => {
    if (!lender) return;
    setEditName(lender.name);
    setEditNotes(lender.notes || '');
    setEditing(true);
  };

  const handleSave = async () => {
    if (!id || !lender) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      if (editName.trim() !== lender.name) payload.name = editName.trim();
      const newNotes = editNotes.trim() || null;
      if (newNotes !== lender.notes) payload.notes = newNotes;
      if (Object.keys(payload).length > 0) {
        const { data } = await api.patch(`/lenders/${id}`, payload);
        setLender(data);
        toast('Lender updated', 'success');
      }
      setEditing(false);
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to update lender'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async () => {
    if (!id || !lender) return;
    try {
      if (lender.is_active) {
        await api.delete(`/lenders/${id}`);
        setLender((prev) => prev ? { ...prev, is_active: false } : prev);
        toast('Lender deactivated', 'success');
      } else {
        const { data } = await api.patch(`/lenders/${id}`, { is_active: true });
        setLender(data);
        toast('Lender reactivated', 'success');
      }
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Operation failed'), 'error');
    }
  };

  const openAddContact = () => {
    setContactDraft(emptyDraft);
    setEditingContactId(null);
    setShowContactForm(true);
  };

  const openEditContact = (contact: LenderContact) => {
    setContactDraft({
      name: contact.name,
      designation: contact.designation || '',
      email: contact.email || '',
      phone: contact.phone || '',
    });
    setEditingContactId(contact.id);
    setShowContactForm(true);
  };

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !contactDraft.name.trim()) return;
    setSavingContact(true);
    try {
      const payload = {
        name: contactDraft.name.trim(),
        designation: contactDraft.designation.trim() || null,
        email: contactDraft.email.trim() || null,
        phone: contactDraft.phone.trim() || null,
      };
      if (editingContactId) {
        await api.patch(`/lenders/${id}/contacts/${editingContactId}`, payload);
        toast('Contact updated', 'success');
      } else {
        await api.post(`/lenders/${id}/contacts`, payload);
        toast('Contact added', 'success');
      }
      setShowContactForm(false);
      setContactDraft(emptyDraft);
      setEditingContactId(null);
      fetchLender();
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to save contact'), 'error');
    } finally {
      setSavingContact(false);
    }
  };

  const handleDeleteContact = async (contactId: string) => {
    if (!id || !confirm('Delete this contact?')) return;
    try {
      await api.delete(`/lenders/${id}/contacts/${contactId}`);
      setLender((prev) => prev ? { ...prev, contacts: prev.contacts.filter((c) => c.id !== contactId) } : prev);
      toast('Contact deleted', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to delete contact'), 'error');
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl">
        <GlassCard>
          <div className="space-y-4">
            <div className="h-6 w-48 rounded-lg shimmer" />
            <div className="h-4 w-32 rounded-lg shimmer" />
            <div className="h-4 w-64 rounded-lg shimmer" />
          </div>
        </GlassCard>
      </div>
    );
  }

  if (!lender) {
    return (
      <div className="mx-auto max-w-2xl">
        <GlassCard>
          <p className="text-[14px] text-muted-foreground">Lender not found or has been removed.</p>
          <Link to="/admin/lenders">
            <Button variant="secondary" className="mt-4">Back to Lenders</Button>
          </Link>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/admin/lenders" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors mb-5">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
        Lenders
      </Link>

      {/* Lender info */}
      <GlassCard className="mb-4">
        {editing ? (
          <div className="space-y-4">
            <Input label="Name *" value={editName} onChange={(e) => setEditName(e.target.value)} />
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Notes</label>
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={3}
                placeholder="Optional notes..."
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <Button onClick={handleSave} disabled={saving || !editName.trim()}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
              <Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h1 className="text-[20px] font-semibold text-foreground">{lender.name}</h1>
                <p className="text-[13px] text-muted-foreground mt-0.5">Added {formatDate(lender.created_at)}</p>
              </div>
              <Badge
                type="custom"
                value={lender.is_active ? 'Active' : 'Inactive'}
                className={lender.is_active ? 'bg-success/10 text-success' : 'bg-secondary text-muted-foreground'}
              />
            </div>
            {lender.notes && (
              <p className="text-[14px] text-muted-foreground mb-4">{lender.notes}</p>
            )}
            <div className="flex gap-2 pt-3 border-t border-border">
              <Button variant="secondary" size="sm" onClick={startEdit}>Edit</Button>
              <Button
                variant={lender.is_active ? 'danger' : 'success'}
                size="sm"
                onClick={handleToggleActive}
              >
                {lender.is_active ? 'Deactivate' : 'Activate'}
              </Button>
            </div>
          </>
        )}
      </GlassCard>

      {/* Contacts */}
      <GlassCard>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[15px] font-semibold text-foreground">
            Contacts · {lender.contacts.length}
          </h2>
          {!showContactForm && (
            <Button variant="secondary" size="sm" onClick={openAddContact}>+ Add</Button>
          )}
        </div>

        {/* Contact form */}
        {showContactForm && (
          <form onSubmit={handleContactSubmit} className="mb-4 rounded-xl border border-border p-4 space-y-3">
            <p className="text-[13px] font-medium text-foreground">
              {editingContactId ? 'Edit contact' : 'New contact'}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Name *"
                value={contactDraft.name}
                onChange={(e) => setContactDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Full name"
              />
              <Input
                label="Designation"
                value={contactDraft.designation}
                onChange={(e) => setContactDraft((d) => ({ ...d, designation: e.target.value }))}
                placeholder="e.g. BDM"
              />
              <Input
                label="Email"
                type="email"
                value={contactDraft.email}
                onChange={(e) => setContactDraft((d) => ({ ...d, email: e.target.value }))}
                placeholder="email@example.com"
              />
              <Input
                label="Phone"
                value={contactDraft.phone}
                onChange={(e) => setContactDraft((d) => ({ ...d, phone: e.target.value }))}
                placeholder="04xx xxx xxx"
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={savingContact || !contactDraft.name.trim()}>
                {savingContact ? 'Saving...' : editingContactId ? 'Update' : 'Add'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => { setShowContactForm(false); setContactDraft(emptyDraft); setEditingContactId(null); }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        {lender.contacts.length === 0 && !showContactForm ? (
          <p className="text-[13px] text-muted-foreground italic">No contacts added yet.</p>
        ) : (
          <div className="space-y-3">
            {lender.contacts.map((contact) => (
              <div key={contact.id} className="rounded-xl bg-secondary/40 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[14px] font-medium text-foreground">{contact.name}</p>
                    {contact.designation && (
                      <p className="text-[12px] text-muted-foreground">{contact.designation}</p>
                    )}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground mt-1">
                      {contact.email && (
                        <a href={`mailto:${contact.email}`} className="hover:text-foreground transition-colors">
                          {contact.email}
                        </a>
                      )}
                      {contact.phone && (
                        <a href={`tel:${contact.phone}`} className="hover:text-foreground transition-colors">
                          {contact.phone}
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => openEditContact(contact)}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDeleteContact(contact.id)}>Delete</Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
