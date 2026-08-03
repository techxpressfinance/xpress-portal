import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import DuplicateReviewModal from '../../components/DuplicateReviewModal';
import { DuplicateWarning } from '../../components/DuplicateWarning';
import { useContactDuplicateCheck } from '../../hooks/useDuplicateCheck';
import { GlassCard, PageHeader, Button, Badge, Input, Select, DatePicker, EmptyState, TableSkeleton } from '../../components/ui';
import { LOAN_CATEGORIES, findLoanSubType, subTypeToLoanType } from '../../lib/constants';
import { formatDate } from '../../lib/utils';
import type { Contact, KanbanBoard, KanbanBoardListItem, PaginatedResponse } from '../../types';

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
  const possibleDuplicates = useContactDuplicateCheck(form);

  // Pipeline quick-add: creates a draft application card for the new contact.
  const [addToPipeline, setAddToPipeline] = useState(false);
  const [subType, setSubType] = useState('');
  const [amount, setAmount] = useState('');
  const [boards, setBoards] = useState<KanbanBoardListItem[]>([]);
  const [boardId, setBoardId] = useState('');
  const [columns, setColumns] = useState<KanbanBoard['columns']>([]);
  const [columnId, setColumnId] = useState('');

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Boards are only needed once the tick is on — load them lazily, then select
  // the default board (or the first one) so the card has a landing place.
  useEffect(() => {
    if (!addToPipeline || boards.length) return;
    let cancelled = false;
    api.get<KanbanBoardListItem[]>('/kanban/boards')
      .then(({ data }) => {
        if (cancelled) return;
        setBoards(data);
        setBoardId(prev => prev || data.find(b => b.is_default)?.id || data[0]?.id || '');
      })
      .catch(() => { if (!cancelled) toast('Failed to load boards', 'error'); });
    return () => { cancelled = true; };
  }, [addToPipeline, boards.length, toast]);

  // Columns of the selected board; the first (leftmost) stage is the default.
  useEffect(() => {
    if (!boardId) { setColumns([]); setColumnId(''); return; }
    let cancelled = false;
    api.get<KanbanBoard>(`/kanban/boards/${boardId}`)
      .then(({ data }) => {
        if (cancelled) return;
        setColumns(data.columns);
        setColumnId(data.columns[0]?.id || '');
      })
      .catch(() => { if (!cancelled) { setColumns([]); setColumnId(''); } });
    return () => { cancelled = true; };
  }, [boardId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.first_name.trim() || !form.last_name.trim()) return;
    if (addToPipeline && !subType) { toast('Choose a loan type for the pipeline card', 'error'); return; }
    setSaving(true);
    try {
      const { data: contact } = await api.post<Contact>('/contacts', {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        date_of_birth: form.date_of_birth.trim() || undefined,
      });
      if (!addToPipeline) {
        toast('Contact created', 'success');
        onCreated();
        return;
      }
      // The contact already exists at this point — a failure here must not read
      // as a failed creation.
      try {
        await api.post(`/contacts/${contact.id}/pipeline`, {
          loan_type: subTypeToLoanType(subType),
          amount: parseFloat(amount) || 0,
          sub_type: subType,
          sub_type_label: findLoanSubType(subType)?.label ?? null,
          board_id: boardId || null,
          column_id: columnId || null,
        });
        toast('Contact created and added to the pipeline', 'success');
      } catch {
        toast('Contact created, but adding it to the pipeline failed', 'error');
      }
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            <DatePicker
              label="Date of Birth"
              value={form.date_of_birth}
              onChange={(v) => setForm(f => ({ ...f, date_of_birth: v }))}
            />
          </div>
          <DuplicateWarning matches={possibleDuplicates} />

          <label className="flex items-start gap-2.5 cursor-pointer rounded-xl border border-border p-3 hover:bg-secondary/30 transition-colors">
            <input
              type="checkbox"
              checked={addToPipeline}
              onChange={e => setAddToPipeline(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
            />
            <span>
              <span className="block text-sm font-medium text-foreground">Add to pipeline</span>
              <span className="block text-xs text-muted-foreground">
                Creates a draft application card on the board. No client account is created and no email is sent.
              </span>
            </span>
          </label>

          {addToPipeline && (
            <div className="space-y-3 rounded-xl border border-border bg-secondary/30 p-3">
              <Select label="Loan Type *" value={subType} onChange={e => setSubType(e.target.value)}>
                <option value="">Select a loan type…</option>
                {LOAN_CATEGORIES.map(cat => (
                  <optgroup key={cat.value} label={cat.label}>
                    {cat.types.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </optgroup>
                ))}
              </Select>
              <Input
                label="Amount"
                type="number"
                min="0"
                step="any"
                placeholder="0"
                value={amount}
                onChange={e => setAmount(e.target.value)}
              />
              {boards.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Select label="Board" value={boardId} onChange={e => setBoardId(e.target.value)}>
                    {boards.map(b => (
                      <option key={b.id} value={b.id}>{b.name}{b.is_default ? ' (default)' : ''}</option>
                    ))}
                  </Select>
                  <Select label="Stage" value={columnId} onChange={e => setColumnId(e.target.value)} disabled={!columns.length}>
                    {columns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </Select>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No boards yet — the card will appear on the first board you create.
                </p>
              )}
            </div>
          )}

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
  const [showDedupe, setShowDedupe] = useState(false);
  const [showNewContact, setShowNewContact] = useState(false);
  const navigate = useNavigate();
  const perPage = 20;
  const firstRender = useRef(true);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchContacts = (p = page, q = search) => {
    if (fetchTimerRef.current) { clearTimeout(fetchTimerRef.current); fetchTimerRef.current = null; }
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

  // Live debounced search: refetch ~250ms after typing stops so we don't hit
  // the API on every keystroke. Also fires once on mount for the initial page.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      fetchContacts(1, search);
      return;
    }
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    fetchTimerRef.current = setTimeout(() => {
      fetchTimerRef.current = null;
      setPage(1);
      fetchContacts(1, search);
    }, 250);
    return () => { if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const goToPage = (newPage: number) => {
    if (fetchTimerRef.current) { clearTimeout(fetchTimerRef.current); fetchTimerRef.current = null; }
    setPage(newPage);
    fetchContacts(newPage, search);
  };

  const handleSearch = (e: React.FormEvent) => {
    // Instant fetch on Enter / Search button — cancels any pending debounce.
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

  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contacts"
        subtitle={`${total} contacts`}
        action={
          <div className="flex gap-2">
            <Button onClick={() => setShowDedupe(true)} variant="secondary" size="sm">
              Find Duplicates
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
            placeholder="Search name, email, phone, licence, suburb…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1"
          />
          <Button type="submit" size="sm">Search</Button>
        </form>

        {loading ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                <TableSkeleton rows={8} widths={[140, 180, 110, 90, 40, 90, 16]} />
              </tbody>
            </table>
          </div>
        ) : contacts.length === 0 ? (
          search ? (
            <p className="text-center py-12 text-muted-foreground">No contacts match your search.</p>
          ) : (
            <EmptyState
              title="No contacts yet"
              description='Click "Auto-Create from Applications" to generate contacts from existing loan applications.'
            />
          )
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
                  <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
                    Previous
                  </Button>
                  <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </GlassCard>

      {showDedupe && (
        <DuplicateReviewModal
          kind="contacts"
          onClose={() => setShowDedupe(false)}
          onChanged={() => fetchContacts(1, search)}
        />
      )}

      {showNewContact && (
        <NewContactModal
          onClose={() => setShowNewContact(false)}
          onCreated={() => { setShowNewContact(false); fetchContacts(1, search); }}
        />
      )}
    </div>
  );
}
