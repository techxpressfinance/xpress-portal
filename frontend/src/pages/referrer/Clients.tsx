import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { GlassCard, PageHeader, Button, Input } from '../../components/ui';
import { getErrorMessage } from '../../lib/utils';

interface ReferrerClient {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  mobile: string;
  company_name: string;
  source: 'direct' | 'referred';
}

interface NewContactForm {
  first_name: string;
  last_name: string;
  email: string;
  mobile: string;
  company_name: string;
}

const LABEL = 'block text-sm font-medium text-foreground mb-1';

function NewContactModal({ onClose, onCreated }: { onClose: () => void; onCreated: (c: ReferrerClient) => void }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<NewContactForm>({ first_name: '', last_name: '', email: '', mobile: '', company_name: '' });
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const field = (key: keyof NewContactForm) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [key]: e.target.value })),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.first_name.trim() || !form.last_name.trim() || !form.email.trim()) return;
    setSaving(true);
    try {
      const { data } = await api.post('/referrer/clients', {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim(),
        mobile: form.mobile.trim() || undefined,
        company_name: form.company_name.trim() || undefined,
      });
      toast('Contact added', 'success');
      onCreated(data as ReferrerClient);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to create contact'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl bg-background border border-border p-6 shadow-xl">
        <h3 className="text-[17px] font-semibold text-foreground mb-4">New Contact</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>First Name *</label>
              <Input ref={firstRef} placeholder="First name" required {...field('first_name')} />
            </div>
            <div>
              <label className={LABEL}>Last Name *</label>
              <Input placeholder="Last name" required {...field('last_name')} />
            </div>
          </div>
          <div>
            <label className={LABEL}>Email *</label>
            <Input type="email" placeholder="email@example.com" required {...field('email')} />
          </div>
          <div>
            <label className={LABEL}>Mobile <span className="font-normal text-muted-foreground">(optional)</span></label>
            <Input type="tel" placeholder="04XX XXX XXX" {...field('mobile')} />
          </div>
          <div>
            <label className={LABEL}>Company Name <span className="font-normal text-muted-foreground">(optional)</span></label>
            <Input placeholder="Acme Pty Ltd" {...field('company_name')} />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="secondary" size="md" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" variant="primary" size="md" loading={saving}>Add Contact</Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

export default function ReferrerClients() {
  const { toast } = useToast();
  const [clients, setClients] = useState<ReferrerClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    api.get('/referrer/clients')
      .then(({ data }) => setClients(data))
      .catch(() => toast('Failed to load clients', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = clients.filter(c => {
    const q = search.toLowerCase();
    if (!q) return true;
    const name = `${c.first_name} ${c.last_name}`.toLowerCase();
    return name.includes(q) || c.email.toLowerCase().includes(q) || c.company_name.toLowerCase().includes(q);
  });

  return (
    <div>
      <PageHeader
        title="My Clients"
        subtitle="Clients you've referred or submitted leads for"
        action={
          <Button onClick={() => setShowModal(true)} variant="primary" size="sm">
            New Contact
          </Button>
        }
      />

      <GlassCard padding="none">
        <div className="px-4 sm:px-6 py-4 border-b border-border">
          <Input
            placeholder="Search by name, email or company..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="max-w-sm"
          />
        </div>

        {loading ? (
          <div className="p-6 space-y-4">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-lg shimmer" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 w-36 rounded-lg shimmer" />
                  <div className="h-3 w-52 rounded-lg shimmer" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
              <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
              </svg>
            </div>
            <p className="text-[15px] font-medium text-foreground mb-1">
              {search ? 'No contacts match your search' : 'No clients yet'}
            </p>
            <p className="text-[13px] text-muted-foreground">
              {search ? 'Try a different name, email, or company.' : 'Add a lead or create a new contact to get started.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-6 py-4 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Client</th>
                  <th className="hidden sm:table-cell px-6 py-4 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Email</th>
                  <th className="hidden md:table-cell px-6 py-4 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Company</th>
                  <th className="hidden sm:table-cell px-6 py-4 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Mobile</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(c => {
                  const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
                  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                  return (
                    <tr key={c.id} className="hover:bg-secondary/40 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
                            <span className="text-[11px] font-semibold text-muted-foreground">{initials}</span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[14px] font-medium text-foreground">{name}</p>
                            <p className="sm:hidden text-[12px] text-muted-foreground truncate">{c.email || '—'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="hidden sm:table-cell px-6 py-4 text-[13px] text-muted-foreground">{c.email || '—'}</td>
                      <td className="hidden md:table-cell px-6 py-4 text-[13px] text-foreground">{c.company_name || <span className="text-muted-foreground">—</span>}</td>
                      <td className="hidden sm:table-cell px-6 py-4 text-[13px] text-muted-foreground">{c.mobile || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {showModal && (
        <NewContactModal
          onClose={() => setShowModal(false)}
          onCreated={c => { setClients(prev => [c, ...prev]); setShowModal(false); }}
        />
      )}
    </div>
  );
}
