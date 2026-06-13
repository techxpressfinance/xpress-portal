import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { GlassCard, PageHeader, Button, Badge, Input, AbrResultCard, Breadcrumbs } from '../../components/ui';
import { formatDate, getErrorMessage } from '../../lib/utils';
import { useAbrLookup } from '../../hooks/useAbrLookup';
import type { OrganizationDetail, OrganizationContactLite } from '../../types';

interface EditForm {
  name: string;
  abn: string;
  industry: string;
  address: string;
  notes: string;
}

function EditCompanyModal({ company, onClose, onSaved }: {
  company: OrganizationDetail;
  onClose: () => void;
  onSaved: (c: OrganizationDetail) => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<EditForm>({
    name: company.name,
    abn: company.abn ?? '',
    industry: company.industry ?? '',
    address: company.address ?? '',
    notes: company.notes ?? '',
  });
  const nameRef = useRef<HTMLInputElement>(null);
  const abr = useAbrLookup(form.abn);

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const { data } = await api.patch(`/organizations/${company.id}`, {
        name: form.name.trim(),
        abn: form.abn.trim() || null,
        industry: form.industry.trim() || null,
        address: form.address.trim() || null,
        notes: form.notes.trim() || null,
      });
      toast('Company updated', 'success');
      onSaved({ ...company, ...data });
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to update company'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const field = (k: keyof EditForm) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value })),
  });

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl bg-background border border-border p-6 shadow-xl" style={{ animation: 'fadeInUp 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}>
        <h3 className="text-[17px] font-semibold text-foreground mb-4">Edit Company</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Name *</label>
            <Input ref={nameRef} required {...field('name')} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">ABN</label>
              <Input placeholder="12 345 678 901" {...field('abn')} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Industry</label>
              <Input {...field('industry')} />
            </div>
          </div>
          {abr.enabled && (
            <AbrResultCard
              record={abr.record}
              loading={abr.loading}
              onApply={(r) => setForm(f => ({ ...f, name: r.name, abn: r.abn }))}
            />
          )}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Address</label>
            <Input {...field('address')} />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Notes</label>
            <textarea className="led-input w-full min-h-[60px] resize-y text-sm" {...field('notes')} />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="secondary" size="md" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" variant="primary" size="md" loading={saving}>Save Changes</Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

function LinkContactModal({ companyId, excludeIds, onClose, onLinked }: {
  companyId: string;
  excludeIds: Set<string>;
  onClose: () => void;
  onLinked: (contact: OrganizationContactLite) => void;
}) {
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; first_name: string; last_name: string; email: string | null; phone: string | null }[]>([]);
  const [role, setRole] = useState('');
  const [picked, setPicked] = useState<typeof results[number] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      api.get('/contacts', { params: { search: query || undefined, page: 1, per_page: 20 } })
        .then(({ data }) => {
          if (cancelled) return;
          setResults((data.items || []).filter((c: { id: string }) => !excludeIds.has(c.id)));
        })
        .catch(() => { if (!cancelled) setResults([]); });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, excludeIds]);

  const submit = async () => {
    if (!picked) return;
    setSaving(true);
    try {
      const { data } = await api.post(`/organizations/${companyId}/contacts`, {
        contact_id: picked.id,
        role: role.trim() || null,
      });
      toast('Contact linked', 'success');
      onLinked(data);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to link contact'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl bg-background border border-border p-6 shadow-xl" style={{ animation: 'fadeInUp 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}>
        <h3 className="text-[17px] font-semibold text-foreground mb-4">Link Contact</h3>
        {picked ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-secondary/40 px-4 py-3 flex items-center justify-between">
              <div>
                <div className="font-medium">{picked.first_name} {picked.last_name}</div>
                <div className="text-[12px] text-muted-foreground">{picked.email || '—'}</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>Change</Button>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Role (optional)</label>
              <Input placeholder="e.g. director, guarantor, signatory" value={role} onChange={e => setRole(e.target.value)} />
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <Button variant="secondary" size="md" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button variant="primary" size="md" loading={saving} onClick={submit}>Link Contact</Button>
            </div>
          </div>
        ) : (
          <>
            <Input
              autoFocus
              placeholder="Search contacts…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            <div className="mt-3 max-h-72 overflow-y-auto divide-y divide-border border border-border rounded-xl">
              {results.length === 0 ? (
                <p className="px-3 py-4 text-[13px] text-muted-foreground">No matches</p>
              ) : (
                results.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setPicked(c)}
                    className="w-full text-left px-3 py-2 hover:bg-secondary/50 transition-colors"
                  >
                    <div className="font-medium">{c.first_name} {c.last_name}</div>
                    <div className="text-[12px] text-muted-foreground">{c.email || '—'}</div>
                  </button>
                ))
              )}
            </div>
            <div className="flex gap-3 justify-end pt-4">
              <Button variant="secondary" size="md" onClick={onClose}>Cancel</Button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default function CompanyDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [company, setCompany] = useState<OrganizationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [linkingContact, setLinkingContact] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.get<OrganizationDetail>(`/organizations/${id}`)
      .then(({ data }) => setCompany(data))
      .catch(() => toast('Failed to load company', 'error'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleUnlink = async (contactId: string) => {
    if (!company) return;
    if (!confirm('Unlink this contact from the company?')) return;
    setUnlinkingId(contactId);
    try {
      await api.delete(`/organizations/${company.id}/contacts/${contactId}`);
      setCompany(prev => prev ? {
        ...prev,
        contacts: prev.contacts.filter(c => c.id !== contactId),
        contact_count: Math.max(0, prev.contact_count - 1),
      } : prev);
      toast('Contact unlinked', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to unlink'), 'error');
    } finally {
      setUnlinkingId(null);
    }
  };

  const handleDelete = async () => {
    if (!company) return;
    if (!confirm(`Delete ${company.name}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.delete(`/organizations/${company.id}`);
      toast('Company deleted', 'success');
      navigate('/admin/companies');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to delete company'), 'error');
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!company) return <p className="text-center py-20 text-muted-foreground">Company not found.</p>;

  const excludeIds = new Set(company.contacts.map(c => c.id));

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Companies', href: '/admin/companies' },
        { label: company.name },
      ]} />
      <PageHeader
        title={company.name}
        subtitle={company.abn ? `ABN ${company.abn}` : 'Company'}
        action={
          <div className="flex gap-2">
            <Button variant="primary" size="sm" onClick={() => setEditing(true)}>Edit</Button>
            <Button variant="danger" size="sm" loading={deleting} onClick={handleDelete}>Delete</Button>
          </div>
        }
      />

      <div className="grid gap-6 md:grid-cols-2">
        <GlassCard>
          <h3 className="text-lg font-semibold mb-4">Company Information</h3>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Name</dt><dd className="font-medium">{company.name}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">ABN</dt><dd>{company.abn || '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Industry</dt><dd>{company.industry || '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Address</dt><dd className="text-right">{company.address || '—'}</dd></div>
          </dl>
          {company.notes && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-sm text-muted-foreground">Notes</p>
              <p className="text-sm mt-1 whitespace-pre-wrap">{company.notes}</p>
            </div>
          )}
        </GlassCard>

        <GlassCard>
          <h3 className="text-lg font-semibold mb-4">Activity</h3>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Contacts</dt><dd>{company.contact_count}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Applications</dt><dd>{company.application_count}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Created</dt><dd>{formatDate(company.created_at)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Last updated</dt><dd>{formatDate(company.updated_at)}</dd></div>
          </dl>
        </GlassCard>
      </div>

      {/* Linked contacts */}
      <GlassCard>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">
            Linked Contacts
            <span className="ml-2 text-sm font-normal text-muted-foreground">({company.contacts.length})</span>
          </h3>
          <Button variant="primary" size="sm" onClick={() => setLinkingContact(true)}>+ Link Contact</Button>
        </div>
        {company.contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No contacts linked yet. Add a director, guarantor or signatory above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-3 font-medium">Name</th>
                  <th className="pb-3 font-medium">Email</th>
                  <th className="pb-3 font-medium">Phone</th>
                  <th className="pb-3 font-medium">Role</th>
                  <th className="pb-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {company.contacts.map(c => (
                  <tr key={c.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                    <td className="py-3 font-medium">
                      <Link to={`/admin/contacts/${c.id}`} className="hover:underline">{c.first_name} {c.last_name}</Link>
                    </td>
                    <td className="py-3 text-muted-foreground">{c.email || '—'}</td>
                    <td className="py-3 text-muted-foreground">{c.phone || '—'}</td>
                    <td className="py-3">{c.role ? <Badge type="custom" value={c.role} className="bg-chart-2/10 text-chart-2" /> : '—'}</td>
                    <td className="py-3">
                      <Button variant="ghost" size="sm" loading={unlinkingId === c.id} onClick={() => handleUnlink(c.id)}>Unlink</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* Linked applications */}
      <GlassCard>
        <h3 className="text-lg font-semibold mb-4">
          Applications
          <span className="ml-2 text-sm font-normal text-muted-foreground">({company.applications.length})</span>
        </h3>
        {company.applications.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No applications linked to this company yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-3 font-medium">Type</th>
                  <th className="pb-3 font-medium">Amount</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium">Client</th>
                  <th className="pb-3 font-medium">Created</th>
                  <th className="pb-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {company.applications.map(a => (
                  <tr key={a.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                    <td className="py-3 capitalize font-medium">{a.loan_type.replace(/_/g, ' ')}</td>
                    <td className="py-3">${Number(a.amount).toLocaleString('en-AU')}</td>
                    <td className="py-3"><Badge value={a.status} /></td>
                    <td className="py-3 text-muted-foreground">{a.user_name || '—'}</td>
                    <td className="py-3 text-muted-foreground">{formatDate(a.created_at)}</td>
                    <td className="py-3">
                      <Link to={`/admin/applications/${a.id}`}>
                        <Button variant="ghost" size="sm">Review</Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {editing && (
        <EditCompanyModal
          company={company}
          onClose={() => setEditing(false)}
          onSaved={updated => { setCompany(updated); setEditing(false); }}
        />
      )}

      {linkingContact && (
        <LinkContactModal
          companyId={company.id}
          excludeIds={excludeIds}
          onClose={() => setLinkingContact(false)}
          onLinked={(contact) => {
            setCompany(prev => prev ? {
              ...prev,
              contacts: [...prev.contacts, contact],
              contact_count: prev.contact_count + 1,
            } : prev);
            setLinkingContact(false);
          }}
        />
      )}
    </div>
  );
}
