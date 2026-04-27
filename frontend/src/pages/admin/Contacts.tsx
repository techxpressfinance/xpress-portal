import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { GlassCard, PageHeader, Button, Badge, Input } from '../../components/ui';
import { formatDate } from '../../lib/utils';
import type { Contact, PaginatedResponse } from '../../types';

interface NewContactForm {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  date_of_birth: string;
}

function NewContactModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<NewContactForm>({ first_name: '', last_name: '', email: '', phone: '', date_of_birth: '' });
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.first_name.trim() || !form.last_name.trim()) return;
    setSaving(true);
    try {
      await api.post('/contacts', {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        date_of_birth: form.date_of_birth.trim() || undefined,
      });
      toast('Contact created', 'success');
      onCreated();
    } catch {
      toast('Failed to create contact', 'error');
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof NewContactForm) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [key]: e.target.value })),
  });

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm"
        style={{ animation: 'fadeIn 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-lg rounded-2xl bg-background border border-border p-6 shadow-xl"
        style={{ animation: 'fadeInUp 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
      >
        <h3 className="text-[17px] font-semibold text-foreground mb-4">New Contact</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">First Name *</label>
              <Input ref={firstRef} placeholder="First name" required {...field('first_name')} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Last Name *</label>
              <Input placeholder="Last name" required {...field('last_name')} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Email</label>
            <Input type="email" placeholder="email@example.com" {...field('email')} />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Phone</label>
            <Input type="tel" placeholder="04XX XXX XXX" {...field('phone')} />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Date of Birth</label>
            <Input type="date" {...field('date_of_birth')} />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="secondary" size="md" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" variant="primary" size="md" loading={saving}>Create Contact</Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

export default function Contacts() {
  const { toast } = useToast();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [deduping, setDeduping] = useState(false);
  const [showNewContact, setShowNewContact] = useState(false);
  const navigate = useNavigate();
  const perPage = 20;

  const fetchContacts = (p = page, q = search) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), per_page: String(perPage) });
    if (q.trim()) params.set('search', q.trim());
    api.get<PaginatedResponse<Contact>>(`/contacts?${params}`)
      .then(({ data }) => {
        setContacts(data.items);
        setTotal(data.total);
      })
      .catch(() => toast('Failed to load contacts', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchContacts(); }, [page]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchContacts(1, search);
  };

  const handleAutoCreate = async () => {
    setSyncing(true);
    try {
      const { data } = await api.post('/contacts/auto-create');
      toast(
        `Created ${data.contacts_created} contacts, linked ${data.applications_linked} applications, ${data.organizations_created} organizations`,
        'success'
      );
      fetchContacts(1, search);
    } catch {
      toast('Failed to auto-create contacts', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handleDeduplicate = async () => {
    setDeduping(true);
    try {
      const { data } = await api.post('/contacts/deduplicate');
      toast(
        `Merged ${data.groups_merged} groups, removed ${data.duplicates_removed} duplicates. ${data.contacts_remaining} contacts remaining.`,
        'success'
      );
      fetchContacts(1, search);
    } catch {
      toast('Failed to deduplicate contacts', 'error');
    } finally {
      setDeduping(false);
    }
  };

  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contacts"
        subtitle={`${total} contacts`}
        action={
          <div className="flex gap-2">
            <Button onClick={handleDeduplicate} disabled={deduping} variant="secondary" size="sm">
              {deduping ? 'Merging...' : 'Deduplicate'}
            </Button>
            <Button onClick={handleAutoCreate} disabled={syncing} variant="secondary" size="sm">
              {syncing ? 'Syncing...' : 'Auto-Create from Applications'}
            </Button>
            <Button onClick={() => setShowNewContact(true)} variant="primary" size="sm">
              New Contact
            </Button>
          </div>
        }
      />

      <GlassCard>
        <form onSubmit={handleSearch} className="flex items-center gap-3 mb-4">
          <Input
            placeholder="Search by name, email, or phone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1"
          />
          <Button type="submit" size="sm">Search</Button>
        </form>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : contacts.length === 0 ? (
          <p className="text-center py-12 text-muted-foreground">
            {search ? 'No contacts match your search.' : 'No contacts yet. Click "Auto-Create from Applications" to generate contacts from existing loan applications.'}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-3 font-medium">Name</th>
                    <th className="pb-3 font-medium">Email</th>
                    <th className="pb-3 font-medium">Phone</th>
                    <th className="pb-3 font-medium">DOB</th>
                    <th className="pb-3 font-medium">Applications</th>
                    <th className="pb-3 font-medium">Created</th>
                    <th className="pb-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map(contact => (
                    <tr
                      key={contact.id}
                      className="border-b border-border/50 hover:bg-secondary/30 transition-colors cursor-pointer"
                      onClick={() => navigate(`/admin/contacts/${contact.id}`)}
                    >
                      <td className="py-3 font-medium">{contact.first_name} {contact.last_name}</td>
                      <td className="py-3 text-muted-foreground">{contact.email || '—'}</td>
                      <td className="py-3 text-muted-foreground">{contact.phone || '—'}</td>
                      <td className="py-3 text-muted-foreground">{contact.date_of_birth || '—'}</td>
                      <td className="py-3">
                        <Badge type="custom" value={String(contact.application_count)} className="bg-blue-500/10 text-blue-600 dark:text-blue-400" />
                      </td>
                      <td className="py-3 text-muted-foreground">{formatDate(contact.created_at)}</td>
                      <td className="py-3" />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                    Previous
                  </Button>
                  <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </GlassCard>

      {showNewContact && (
        <NewContactModal
          onClose={() => setShowNewContact(false)}
          onCreated={() => { setShowNewContact(false); fetchContacts(1, search); }}
        />
      )}
    </div>
  );
}
