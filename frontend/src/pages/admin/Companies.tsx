import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Building2, X } from 'lucide-react';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import DuplicateReviewModal from '../../components/DuplicateReviewModal';
import { DuplicateWarning } from '../../components/DuplicateWarning';
import { useOrganizationDuplicateCheck } from '../../hooks/useDuplicateCheck';
import { GlassCard, PageHeader, Button, Badge, Input, AbrResultCard, EmptyState, TableSkeleton } from '../../components/ui';
import { formatDate, getErrorMessage } from '../../lib/utils';
import { useAbrLookup } from '../../hooks/useAbrLookup';
import type { Organization, PaginatedResponse } from '../../types';

interface NewCompanyForm {
  name: string;
  abn: string;
  industry: string;
  address: string;
  notes: string;
}

const EMPTY: NewCompanyForm = { name: '', abn: '', industry: '', address: '', notes: '' };

function NewCompanyModal({ onClose, onCreated }: { onClose: () => void; onCreated: (company: Organization) => void }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<NewCompanyForm>(EMPTY);
  const nameRef = useRef<HTMLInputElement>(null);
  const abr = useAbrLookup(form.abn);
  const possibleDuplicates = useOrganizationDuplicateCheck(form);

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
      const { data } = await api.post<Organization>('/organizations', {
        name: form.name.trim(),
        abn: form.abn.trim() || null,
        industry: form.industry.trim() || null,
        address: form.address.trim() || null,
        notes: form.notes.trim() || null,
      });
      toast('Company created', 'success');
      onCreated(data);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to create company'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const field = (k: keyof NewCompanyForm) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value })),
  });

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm"
        style={{ animation: 'fadeIn 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-lg rounded-2xl bg-background border border-border shadow-xl overflow-hidden"
        style={{ animation: 'fadeInUp 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-[17px] font-semibold leading-tight text-foreground">New Company</h3>
              <p className="text-[13px] text-muted-foreground">Add a business to your portfolio</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1.5 -mt-1 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Name *</label>
            <Input ref={nameRef} placeholder="Acme Pty Ltd" required {...field('name')} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">ABN</label>
              <Input placeholder="12 345 678 901" {...field('abn')} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Industry</label>
              <Input placeholder="Construction" {...field('industry')} />
            </div>
          </div>
          <DuplicateWarning matches={possibleDuplicates} />
          {abr.enabled && (
            <AbrResultCard
              record={abr.record}
              loading={abr.loading}
              onApply={(r) => setForm(f => ({
                ...f,
                name: f.name.trim() ? f.name : r.name,
                abn: r.abn,
              }))}
            />
          )}
          <div className="flex items-center gap-3 pt-1">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Additional details</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Address</label>
            <Input placeholder="123 Example St, Suburb, NSW 2000" {...field('address')} />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Notes</label>
            <textarea className="led-input w-full min-h-[60px] resize-y text-sm" placeholder="Internal notes…" {...field('notes')} />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="secondary" size="md" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" variant="primary" size="md" loading={saving}>Create Company</Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

export default function Companies() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [companies, setCompanies] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showNew, setShowNew] = useState(false);
  const [showDedupe, setShowDedupe] = useState(false);
  const perPage = 20;

  const fetchCompanies = (p = page, q = search) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), per_page: String(perPage) });
    if (q.trim()) params.set('search', q.trim());
    api.get<PaginatedResponse<Organization>>(`/organizations?${params}`)
      .then(({ data }) => {
        setCompanies(data.items);
        setTotal(data.total);
      })
      .catch(() => toast('Failed to load companies', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchCompanies(); }, [page]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchCompanies(1, search);
  };

  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Companies"
        subtitle={`${total} compan${total === 1 ? 'y' : 'ies'}`}
        action={
          <div className="flex gap-2">
            <Button onClick={() => setShowDedupe(true)} variant="secondary" size="sm">Find Duplicates</Button>
            <Button onClick={() => setShowNew(true)} variant="primary" size="sm">New Company</Button>
          </div>
        }
      />

      <GlassCard>
        <form onSubmit={handleSearch} className="flex items-center gap-3 mb-4">
          <Input
            placeholder="Search by name or ABN…"
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
                <TableSkeleton rows={8} widths={[160, 110, 100, 40, 40, 90]} />
              </tbody>
            </table>
          </div>
        ) : companies.length === 0 ? (
          search ? (
            <p className="text-center py-12 text-muted-foreground">No companies match your search.</p>
          ) : (
            <EmptyState title="No companies yet" description='Click "New Company" to add one.' />
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-3 font-medium">Name</th>
                    <th className="pb-3 font-medium">ABN</th>
                    <th className="pb-3 font-medium">Industry</th>
                    <th className="pb-3 font-medium">Contacts</th>
                    <th className="pb-3 font-medium">Applications</th>
                    <th className="pb-3 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map(c => (
                    <tr
                      key={c.id}
                      className="border-b border-border/50 hover:bg-secondary/30 transition-colors cursor-pointer"
                      onClick={() => navigate(`/admin/companies/${c.id}`)}
                    >
                      <td className="py-3 font-medium">{c.name}</td>
                      <td className="py-3 text-muted-foreground">{c.abn || '—'}</td>
                      <td className="py-3 text-muted-foreground">{c.industry || '—'}</td>
                      <td className="py-3">
                        <Badge type="custom" value={String(c.contact_count)} className="bg-chart-2/10 text-chart-2" />
                      </td>
                      <td className="py-3">
                        <Badge type="custom" value={String(c.application_count)} className="bg-blue-500/10 text-blue-600 dark:text-blue-400" />
                      </td>
                      <td className="py-3 text-muted-foreground">{formatDate(c.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">Page {page} of {totalPages}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                  <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </>
        )}
      </GlassCard>

      {showDedupe && (
        <DuplicateReviewModal
          kind="organizations"
          onClose={() => setShowDedupe(false)}
          onChanged={() => fetchCompanies(1, search)}
        />
      )}

      {showNew && (
        <NewCompanyModal
          onClose={() => setShowNew(false)}
          onCreated={(company) => { setShowNew(false); navigate(`/admin/companies/${company.id}`); }}
        />
      )}
    </div>
  );
}
