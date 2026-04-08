import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { GlassCard, PageHeader, Button, Badge, Input } from '../../components/ui';
import { formatDate } from '../../lib/utils';
import type { Contact, PaginatedResponse } from '../../types';

export default function Contacts() {
  const { toast } = useToast();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [deduping, setDeduping] = useState(false);
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
          </div>
        }
      />

      <GlassCard>
        <form onSubmit={handleSearch} className="flex gap-3 mb-4">
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
                    <tr key={contact.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                      <td className="py-3 font-medium">
                        <Link to={`/admin/contacts/${contact.id}`} className="text-primary hover:underline">
                          {contact.first_name} {contact.last_name}
                        </Link>
                      </td>
                      <td className="py-3 text-muted-foreground">{contact.email || '—'}</td>
                      <td className="py-3 text-muted-foreground">{contact.phone || '—'}</td>
                      <td className="py-3 text-muted-foreground">{contact.date_of_birth || '—'}</td>
                      <td className="py-3">
                        <Badge type="custom" value={String(contact.application_count)} className="bg-blue-500/10 text-blue-600 dark:text-blue-400" />
                      </td>
                      <td className="py-3 text-muted-foreground">{formatDate(contact.created_at)}</td>
                      <td className="py-3">
                        <Link to={`/admin/contacts/${contact.id}`}>
                          <Button variant="ghost" size="sm">View</Button>
                        </Link>
                      </td>
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
    </div>
  );
}
