import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../hooks/useConfirm';
import { Card, PageHeader, Button, Badge, Input, Select, Breadcrumbs, DatePicker, DetailSkeleton, AssetHoverIcon } from '../../components/ui';
import { formatDate, getErrorMessage } from '../../lib/utils';
import { APPLICATION_STATUSES } from '../../types';
import TrustNoAbnDialog from '../../components/TrustNoAbnDialog';
import ArrearsSection from '../../components/arrears/ArrearsSection';
import { loanTypeOptions, LOAN_TYPE_LABELS, ENTITY_TYPES, ENTITY_TYPE_CONFIG, TRUST_TYPES } from '../../lib/constants';
import type { ContactDetail as ContactDetailType, ContactApplication, EntityType, LendingHistoryEntry, RepaymentFrequency, TrustType } from '../../types';

const REPAYMENT_FREQUENCIES: { value: RepaymentFrequency; label: string; short: string }[] = [
  { value: 'weekly', label: 'Weekly', short: 'wk' },
  { value: 'fortnightly', label: 'Fortnightly', short: 'fn' },
  { value: 'monthly', label: 'Monthly', short: 'mo' },
];

function formatRepayments(amount: number | null, freq: RepaymentFrequency | null): string {
  if (amount == null) return '—';
  const short = REPAYMENT_FREQUENCIES.find(f => f.value === freq)?.short;
  const amt = `$${Number(amount).toLocaleString('en-AU')}`;
  return short ? `${amt}/${short}` : amt;
}

const AU_STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];
const LABEL = 'block text-sm font-medium text-foreground mb-1';

interface EditForm {
  first_name: string;
  last_name: string;
  middle_name: string;
  email: string;
  phone: string;
  date_of_birth: string;
  drivers_license_number: string;
  address: string;
  suburb: string;
  state: string;
  postcode: string;
  notes: string;
}

function EditContactModal({ contact, onClose, onSaved }: {
  contact: ContactDetailType;
  onClose: () => void;
  onSaved: (c: ContactDetailType) => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<EditForm>({
    first_name: contact.first_name ?? '',
    last_name: contact.last_name ?? '',
    middle_name: contact.middle_name ?? '',
    email: contact.email ?? '',
    phone: contact.phone ?? '',
    date_of_birth: contact.date_of_birth ?? '',
    drivers_license_number: contact.drivers_license_number ?? '',
    address: contact.address ?? '',
    suburb: contact.suburb ?? '',
    state: contact.state ?? '',
    postcode: contact.postcode ?? '',
    notes: contact.notes ?? '',
  });

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const field = (key: keyof EditForm) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [key]: e.target.value })),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.first_name.trim() || !form.last_name.trim()) return;
    setSaving(true);
    try {
      const payload: Record<string, string | null> = {};
      (Object.keys(form) as (keyof EditForm)[]).forEach(k => {
        payload[k] = form[k].trim() || null;
      });
      const { data } = await api.patch<ContactDetailType>(`/contacts/${contact.id}`, payload);
      toast('Contact updated', 'success');
      onSaved({ ...contact, ...data });
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to update contact'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-background border border-border p-6 shadow-xl"
        style={{ animation: 'fadeInUp 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
      >
        <h3 className="text-[17px] font-semibold text-foreground mb-5">Edit Contact</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={LABEL}>First Name *</label>
              <Input ref={firstRef} placeholder="First name" required {...field('first_name')} />
            </div>
            <div>
              <label className={LABEL}>Middle Name</label>
              <Input placeholder="Middle name" {...field('middle_name')} />
            </div>
            <div>
              <label className={LABEL}>Last Name *</label>
              <Input placeholder="Last name" required {...field('last_name')} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Email</label>
              <Input type="email" placeholder="email@example.com" {...field('email')} />
            </div>
            <div>
              <label className={LABEL}>Phone</label>
              <Input type="tel" placeholder="04XX XXX XXX" {...field('phone')} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <DatePicker label="Date of Birth" value={form.date_of_birth} onChange={(v) => setForm(f => ({ ...f, date_of_birth: v }))} />
            </div>
            <div>
              <label className={LABEL}>Driver's License</label>
              <Input placeholder="License number" {...field('drivers_license_number')} />
            </div>
          </div>

          <div>
            <label className={LABEL}>Street Address</label>
            <Input placeholder="123 Example St" {...field('address')} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={LABEL}>Suburb</label>
              <Input placeholder="Suburb" {...field('suburb')} />
            </div>
            <div>
              <label className={LABEL}>State</label>
              <Select {...field('state')}>
                <option value="">— Select —</option>
                {AU_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
            <div>
              <label className={LABEL}>Postcode</label>
              <Input placeholder="0000" {...field('postcode')} />
            </div>
          </div>

          <div>
            <label className={LABEL}>Notes</label>
            <textarea
              className="led-input w-full min-h-[80px] resize-y text-sm"
              placeholder="Internal notes..."
              {...field('notes')}
            />
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

interface EditLendingForm {
  loan_type: string;
  amount: string;
  status: string;
  business_name: string;
  business_abn: string;
}

function EditLendingEntryModal({ app, onClose, onSaved }: {
  app: ContactApplication;
  onClose: () => void;
  onSaved: (updated: ContactApplication) => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<EditLendingForm>({
    loan_type: app.loan_type,
    amount: String(app.amount),
    status: app.status,
    business_name: app.business_name ?? '',
    business_abn: app.business_abn ?? '',
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (form.status !== app.status) {
        await api.patch(`/applications/${app.id}/status`, null, { params: { status: form.status } });
      }
      await api.patch(`/applications/${app.id}`, {
        loan_type: form.loan_type,
        amount: parseFloat(form.amount),
        business_name: form.business_name.trim() || null,
        business_abn: form.business_abn.trim() || null,
      });
      toast('Application updated', 'success');
      onSaved({
        ...app,
        loan_type: form.loan_type as ContactApplication['loan_type'],
        amount: parseFloat(form.amount),
        status: form.status as ContactApplication['status'],
        business_name: form.business_name.trim() || null,
        business_abn: form.business_abn.trim() || null,
      });
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to update application'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-lg rounded-2xl bg-background border border-border p-6 shadow-xl"
        style={{ animation: 'fadeInUp 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
      >
        <h3 className="text-[17px] font-semibold text-foreground mb-5">Edit Lending Entry</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Loan Type</label>
              <Select value={form.loan_type} onChange={e => setForm(f => ({ ...f, loan_type: e.target.value }))}>
                {loanTypeOptions(app.loan_type).map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className={LABEL}>Amount ($)</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                required
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              />
            </div>
          </div>

          <div>
            <label className={LABEL}>Status</label>
            <Select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              {APPLICATION_STATUSES.map(s => (
                <option key={s} value={s}>{s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Business Name</label>
              <Input
                placeholder="Business name"
                value={form.business_name}
                onChange={e => setForm(f => ({ ...f, business_name: e.target.value }))}
              />
            </div>
            <div>
              <label className={LABEL}>Business ABN</label>
              <Input
                placeholder="ABN"
                value={form.business_abn}
                onChange={e => setForm(f => ({ ...f, business_abn: e.target.value }))}
              />
            </div>
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

type EntityCandidate = { id: string; name: string; entity_type: EntityType | null; abn: string | null; industry: string | null };

/** Add an entity to a contact: pick a legal structure, then link an existing
 *  entity or create a new one of that type. */
function AddEntityModal({ contactId, excludeIds, onClose, onLinked }: {
  contactId: string;
  excludeIds: Set<string>;
  onClose: () => void;
  onLinked: (org: EntityCandidate & { role: string | null }) => void;
}) {
  const { toast } = useToast();
  const [entityType, setEntityType] = useState<EntityType | null>(null);
  const [mode, setMode] = useState<'search' | 'create'>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EntityCandidate[]>([]);
  const [role, setRole] = useState('');
  const [picked, setPicked] = useState<EntityCandidate | null>(null);
  const [form, setForm] = useState<{ name: string; abn: string; industry: string; address: string; trust_type: TrustType | '' }>(
    { name: '', abn: '', industry: '', address: '', trust_type: '' },
  );
  const [saving, setSaving] = useState(false);
  const [confirmingNoAbn, setConfirmingNoAbn] = useState(false);

  const typeLabel = entityType ? ENTITY_TYPE_CONFIG[entityType].label : 'Entity';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Search across all entities regardless of stored type — entities created
  // before typing existed have entity_type null and must stay linkable. The
  // chosen type is surfaced by sorting its matches first.
  useEffect(() => {
    if (!entityType || mode !== 'search' || picked) return;
    let cancelled = false;
    const t = setTimeout(() => {
      api.get('/organizations', { params: { search: query || undefined, page: 1, per_page: 20 } })
        .then(({ data }) => {
          if (cancelled) return;
          const items: EntityCandidate[] = (data.items || []).filter((o: { id: string }) => !excludeIds.has(o.id));
          setResults(items.sort((a, b) => Number(b.entity_type === entityType) - Number(a.entity_type === entityType)));
        })
        .catch(() => { if (!cancelled) setResults([]); });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, excludeIds, entityType, mode, picked]);

  const linkExisting = async () => {
    if (!picked) return;
    setSaving(true);
    try {
      await api.post(`/contacts/${contactId}/organizations`, {
        organization_id: picked.id,
        role: role.trim() || null,
      });
      toast('Entity linked', 'success');
      onLinked({ ...picked, role: role.trim() || null });
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to link entity'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const createAndLink = async (noAbnConfirmed = false) => {
    if (!form.name.trim() || !entityType) return;
    // A trust may genuinely have no ABN — confirm before creating one without.
    if (entityType === 'trust' && !form.abn.trim() && !noAbnConfirmed) {
      setConfirmingNoAbn(true);
      return;
    }
    setSaving(true);
    try {
      const { data: org } = await api.post('/organizations', {
        name: form.name.trim(),
        entity_type: entityType,
        trust_type: entityType === 'trust' ? form.trust_type || null : null,
        abn: form.abn.trim() || null,
        industry: form.industry.trim() || null,
        address: form.address.trim() || null,
        no_abn_confirmed: noAbnConfirmed,
      });
      await api.post(`/contacts/${contactId}/organizations`, {
        organization_id: org.id,
        role: role.trim() || null,
      });
      toast(`${typeLabel} created and linked`, 'success');
      onLinked({
        id: org.id,
        name: org.name,
        entity_type: org.entity_type,
        abn: org.abn,
        industry: org.industry,
        role: role.trim() || null,
      });
    } catch (err) {
      toast(getErrorMessage(err, `Failed to create ${typeLabel.toLowerCase()}`), 'error');
    } finally {
      setSaving(false);
      setConfirmingNoAbn(false);
    }
  };

  const back = () => {
    if (picked) { setPicked(null); return; }
    if (mode === 'create') { setMode('search'); return; }
    setEntityType(null);
    setQuery('');
    setResults([]);
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl bg-background border border-border p-6 shadow-xl" style={{ animation: 'fadeInUp 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}>
        <div className="flex items-center gap-2 mb-4">
          {entityType && (
            <button type="button" onClick={back} className="text-muted-foreground hover:text-foreground transition-colors text-[13px]" aria-label="Back">←</button>
          )}
          <h3 className="text-[17px] font-semibold text-foreground">
            {entityType ? `Add ${typeLabel}` : 'Add an Entity'}
          </h3>
        </div>

        {/* Step 1 — pick the legal structure */}
        {!entityType && (
          <>
            <p className="text-[13px] text-muted-foreground mb-3">What kind of entity are you adding?</p>
            <div className="space-y-2">
              {ENTITY_TYPES.map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setEntityType(t.value)}
                  className="w-full text-left px-4 py-3 rounded-xl border border-border hover:bg-secondary/50 hover:border-primary/40 transition-colors"
                >
                  <div className="font-medium">{t.label}</div>
                  <div className="text-[12px] text-muted-foreground">{t.description}</div>
                </button>
              ))}
            </div>
            <div className="flex gap-3 justify-end pt-4">
              <Button variant="secondary" size="md" onClick={onClose}>Cancel</Button>
            </div>
          </>
        )}

        {/* Step 3 — confirm role on the entity picked from search */}
        {entityType && picked && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-secondary/40 px-4 py-3 flex items-center justify-between">
              <div>
                <div className="font-medium">{picked.name}</div>
                <div className="text-[12px] text-muted-foreground">{picked.abn || 'No ABN on file'}</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>Change</Button>
            </div>
            <div>
              <label className={LABEL}>Role (optional)</label>
              <Input placeholder="e.g. director, trustee, guarantor" value={role} onChange={e => setRole(e.target.value)} />
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <Button variant="secondary" size="md" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button variant="primary" size="md" loading={saving} onClick={linkExisting}>Link Entity</Button>
            </div>
          </div>
        )}

        {/* Step 2a — search existing entities */}
        {entityType && !picked && mode === 'search' && (
          <>
            <Input autoFocus placeholder={`Search entities by name or ABN…`} value={query} onChange={e => setQuery(e.target.value)} />
            <div className="mt-3 max-h-64 overflow-y-auto divide-y divide-border border border-border rounded-xl">
              {results.length === 0 ? (
                <p className="px-3 py-4 text-[13px] text-muted-foreground">
                  {query ? 'No matches — create a new one below.' : 'No entities yet — create one below.'}
                </p>
              ) : (
                results.map(o => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setPicked(o)}
                    className="w-full text-left px-3 py-2 hover:bg-secondary/50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{o.name}</span>
                      {o.entity_type && (
                        <Badge type="custom" value={ENTITY_TYPE_CONFIG[o.entity_type].label} className={ENTITY_TYPE_CONFIG[o.entity_type].className} />
                      )}
                    </div>
                    <div className="text-[12px] text-muted-foreground">{o.abn || 'No ABN'} {o.industry ? `· ${o.industry}` : ''}</div>
                  </button>
                ))
              )}
            </div>
            <div className="flex gap-3 justify-between pt-4">
              <Button variant="secondary" size="md" onClick={() => { setForm(f => ({ ...f, name: query })); setMode('create'); }}>
                + Create new {typeLabel.toLowerCase()}
              </Button>
              <Button variant="secondary" size="md" onClick={onClose}>Cancel</Button>
            </div>
          </>
        )}

        {/* Step 2b — create a new entity of the chosen type */}
        {entityType && !picked && mode === 'create' && (
          <div className="space-y-4">
            <div>
              <label className={LABEL}>{typeLabel} name</label>
              <Input autoFocus placeholder={entityType === 'trust' ? 'e.g. Smith Family Trust' : 'Registered name'} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL}>ABN (optional)</label>
                <Input placeholder="11 222 333 444" value={form.abn} onChange={e => setForm({ ...form, abn: e.target.value })} />
              </div>
              <div>
                <label className={LABEL}>Industry (optional)</label>
                <Input placeholder="e.g. Construction" value={form.industry} onChange={e => setForm({ ...form, industry: e.target.value })} />
              </div>
            </div>
            {entityType === 'trust' && (
              <div>
                <label className={LABEL}>Trust type (optional)</label>
                <Select value={form.trust_type} onChange={e => setForm({ ...form, trust_type: e.target.value as TrustType | '' })}>
                  <option value="">Not specified</option>
                  {TRUST_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </div>
            )}
            <div>
              <label className={LABEL}>Address (optional)</label>
              <Input placeholder="Registered address" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
            </div>
            <div>
              <label className={LABEL}>Role (optional)</label>
              <Input placeholder="e.g. director, trustee, guarantor" value={role} onChange={e => setRole(e.target.value)} />
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <Button variant="secondary" size="md" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button variant="primary" size="md" loading={saving} disabled={!form.name.trim()} onClick={() => createAndLink()}>
                Create &amp; Link
              </Button>
            </div>
          </div>
        )}
      </div>

      <TrustNoAbnDialog
        open={confirmingNoAbn}
        name={form.name}
        loading={saving}
        onConfirm={() => createAndLink(true)}
        onCancel={() => setConfirmingNoAbn(false)}
      />
    </div>,
    document.body,
  );
}

interface LendingEntryForm {
  lender_name: string;
  amount: string;
  balloon: string;
  other_broker_name: string;
  repayment_amount: string;
  repayment_frequency: '' | RepaymentFrequency;
  start_date: string;
  identifier: string;
  guaranteed_by_contact_id: string;
  guaranteed_by_name: string;
  notes: string;
}

const EMPTY_LENDING_FORM: LendingEntryForm = {
  lender_name: '', amount: '', balloon: '', other_broker_name: '',
  repayment_amount: '', repayment_frequency: '', start_date: '',
  identifier: '', guaranteed_by_contact_id: '', guaranteed_by_name: '', notes: '',
};

function GuarantorPicker({
  value, name, onPick, excludeContactId,
}: {
  value: string;
  name: string;
  onPick: (id: string, label: string) => void;
  excludeContactId?: string;
}) {
  const [query, setQuery] = useState(name);
  const [results, setResults] = useState<{ id: string; first_name: string; last_name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => { setQuery(name); }, [name]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      api.get('/contacts', { params: { search: query || undefined, page: 1, per_page: 20 } })
        .then(({ data }) => {
          if (cancelled) return;
          const items = (data.items || []).filter((c: { id: string }) => c.id !== excludeContactId);
          setResults(items);
        })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, open, excludeContactId]);

  return (
    <div className="relative">
      <Input
        placeholder="Search contacts…"
        value={query}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
      />
      {value && (
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground hover:text-foreground"
          onClick={() => { onPick('', ''); setQuery(''); }}
        >
          Clear
        </button>
      )}
      {open && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-background shadow-lg max-h-60 overflow-y-auto">
          {searching ? (
            <div className="px-3 py-2 text-[13px] text-muted-foreground">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-[13px] text-muted-foreground">No matches</div>
          ) : (
            results.map(c => {
              const label = `${c.first_name} ${c.last_name}`.trim();
              return (
                <button
                  key={c.id}
                  type="button"
                  className="block w-full text-left px-3 py-2 text-[13px] hover:bg-secondary/50"
                  onMouseDown={() => { onPick(c.id, label); setQuery(label); setOpen(false); }}
                >
                  {label}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function LendingEntryModal({ contactId, entry, onClose, onSaved }: {
  contactId: string;
  entry: LendingHistoryEntry | null;
  onClose: () => void;
  onSaved: (entry: LendingHistoryEntry, mode: 'create' | 'update') => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const isEdit = !!entry;
  const [form, setForm] = useState<LendingEntryForm>(() => entry ? {
    lender_name: entry.lender_name,
    amount: String(entry.amount),
    balloon: entry.balloon != null ? String(entry.balloon) : '',
    other_broker_name: entry.other_broker_name ?? '',
    repayment_amount: entry.repayment_amount != null ? String(entry.repayment_amount) : '',
    repayment_frequency: entry.repayment_frequency ?? '',
    start_date: entry.start_date ?? '',
    identifier: entry.identifier ?? '',
    guaranteed_by_contact_id: entry.guaranteed_by_contact_id ?? '',
    guaranteed_by_name: entry.guaranteed_by_name ?? '',
    notes: entry.notes ?? '',
  } : EMPTY_LENDING_FORM);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = <K extends keyof LendingEntryForm>(key: K, value: LendingEntryForm[K]) =>
    setForm(f => ({ ...f, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.lender_name.trim() || !form.amount) return;
    setSaving(true);
    try {
      const payload = {
        lender_name: form.lender_name.trim(),
        amount: parseFloat(form.amount),
        balloon: form.balloon ? parseFloat(form.balloon) : null,
        other_broker_name: form.other_broker_name.trim() || null,
        repayment_amount: form.repayment_amount ? parseFloat(form.repayment_amount) : null,
        repayment_frequency: form.repayment_frequency || null,
        start_date: form.start_date || null,
        identifier: form.identifier.trim() || null,
        guaranteed_by_contact_id: form.guaranteed_by_contact_id || null,
        notes: form.notes.trim() || null,
      };
      const { data } = isEdit && entry
        ? await api.patch<LendingHistoryEntry>(`/contacts/${contactId}/lending-history/${entry.id}`, payload)
        : await api.post<LendingHistoryEntry>(`/contacts/${contactId}/lending-history`, payload);
      toast(isEdit ? 'Lending entry updated' : 'Lending entry added', 'success');
      onSaved(data, isEdit ? 'update' : 'create');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to save lending entry'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-background border border-border p-6 shadow-xl"
        style={{ animation: 'fadeInUp 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
      >
        <h3 className="text-[17px] font-semibold text-foreground mb-5">{isEdit ? 'Edit Lending Entry' : 'Add Lending Entry'}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Lender Name *</label>
              <Input placeholder="e.g. Westpac" required value={form.lender_name} onChange={e => update('lender_name', e.target.value)} />
            </div>
            <div>
              <label className={LABEL}>Amount ($) *</label>
              <Input type="number" min="0" step="0.01" required value={form.amount} onChange={e => update('amount', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Balloon ($)</label>
              <Input type="number" min="0" step="0.01" value={form.balloon} onChange={e => update('balloon', e.target.value)} />
            </div>
            <div>
              <label className={LABEL}>Other Broker (if any)</label>
              <Input placeholder="Other broker's name" value={form.other_broker_name} onChange={e => update('other_broker_name', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={LABEL}>Repayment Amount ($)</label>
              <Input type="number" min="0" step="0.01" value={form.repayment_amount} onChange={e => update('repayment_amount', e.target.value)} />
            </div>
            <div>
              <label className={LABEL}>Frequency</label>
              <Select value={form.repayment_frequency} onChange={e => update('repayment_frequency', e.target.value as LendingEntryForm['repayment_frequency'])}>
                <option value="">—</option>
                {REPAYMENT_FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </Select>
            </div>
            <div>
              <DatePicker label="Start Date" value={form.start_date} onChange={(v) => update('start_date', v)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Identifier</label>
              <Input placeholder="Contract / account number" value={form.identifier} onChange={e => update('identifier', e.target.value)} />
            </div>
            <div>
              <label className={LABEL}>Guaranteed By</label>
              <GuarantorPicker
                value={form.guaranteed_by_contact_id}
                name={form.guaranteed_by_name}
                excludeContactId={contactId}
                onPick={(id, label) => setForm(f => ({ ...f, guaranteed_by_contact_id: id, guaranteed_by_name: label }))}
              />
            </div>
          </div>

          <div>
            <label className={LABEL}>Notes</label>
            <textarea
              className="led-input w-full min-h-[70px] resize-y text-sm"
              placeholder="Optional notes"
              value={form.notes}
              onChange={e => update('notes', e.target.value)}
            />
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="secondary" size="md" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" variant="primary" size="md" loading={saving}>{isEdit ? 'Save Changes' : 'Add Entry'}</Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

export default function ContactDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [contact, setContact] = useState<ContactDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editingApp, setEditingApp] = useState<ContactApplication | null>(null);
  const [lendingModal, setLendingModal] = useState<{ entry: LendingHistoryEntry | null } | null>(null);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  const [addingEntity, setAddingEntity] = useState(false);
  const [unlinkingOrgId, setUnlinkingOrgId] = useState<string | null>(null);

  const handleUnlinkCompany = async (orgId: string) => {
    if (!contact) return;
    if (!(await confirm({
      title: 'Unlink this company from the contact?',
      confirmText: 'Unlink',
    }))) return;
    setUnlinkingOrgId(orgId);
    try {
      await api.delete(`/contacts/${contact.id}/organizations/${orgId}`);
      setContact(prev => prev ? { ...prev, organizations: prev.organizations.filter(o => o.id !== orgId) } : prev);
      toast('Entity unlinked', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to unlink'), 'error');
    } finally {
      setUnlinkingOrgId(null);
    }
  };

  const handleDeleteLendingEntry = async (entryId: string) => {
    if (!contact) return;
    if (!(await confirm({
      title: 'Delete this lending entry?',
      message: 'This cannot be undone.',
      confirmText: 'Delete',
      variant: 'danger',
    }))) return;
    setDeletingEntryId(entryId);
    try {
      await api.delete(`/contacts/${contact.id}/lending-history/${entryId}`);
      setContact(prev => prev ? { ...prev, lending_history: prev.lending_history.filter(e => e.id !== entryId) } : prev);
      toast('Lending entry deleted', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to delete entry'), 'error');
    } finally {
      setDeletingEntryId(null);
    }
  };

  useEffect(() => {
    api.get<ContactDetailType>(`/contacts/${id}`)
      .then(({ data }) => setContact(data))
      .catch(() => toast('Failed to load contact', 'error'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <DetailSkeleton blocks={3} />;
  }

  if (!contact) {
    return <p className="text-center py-20 text-muted-foreground">Contact not found.</p>;
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Contacts', href: '/admin/contacts' },
        { label: `${contact.first_name} ${contact.last_name}` },
      ]} />
      <PageHeader
        title={`${contact.first_name} ${contact.last_name}`}
        subtitle="Contact Details"
        action={
          <div className="flex gap-2">
            <Button variant="primary" size="sm" onClick={() => setEditing(true)}>Edit Contact</Button>
          </div>
        }
      />

      {/* Contact Info */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h3 className="text-lg font-semibold mb-4">Personal Information</h3>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Full Name</dt>
              <dd className="font-medium">
                {contact.first_name} {contact.middle_name ? `${contact.middle_name} ` : ''}{contact.last_name}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Email</dt>
              <dd>{contact.email || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Phone</dt>
              <dd>{contact.phone || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Date of Birth</dt>
              <dd>{contact.date_of_birth || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Driver's License</dt>
              <dd>{contact.drivers_license_number || '—'}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <h3 className="text-lg font-semibold mb-4">Address</h3>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Street</dt>
              <dd>{contact.address || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Suburb</dt>
              <dd>{contact.suburb || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">State</dt>
              <dd>{contact.state || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Postcode</dt>
              <dd>{contact.postcode || '—'}</dd>
            </div>
          </dl>
          {contact.notes && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-sm text-muted-foreground">Notes</p>
              <p className="text-sm mt-1">{contact.notes}</p>
            </div>
          )}
        </Card>
      </div>

      {/* Companies */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">
            Entities
            <span className="ml-2 text-sm font-normal text-muted-foreground">({contact.organizations.length})</span>
          </h3>
          <Button variant="primary" size="sm" onClick={() => setAddingEntity(true)}>+ Add Entity</Button>
        </div>
        {contact.organizations.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No entities linked yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-3 font-medium">Name</th>
                  <th className="pb-3 font-medium">Type</th>
                  <th className="pb-3 font-medium">ABN</th>
                  <th className="pb-3 font-medium">Industry</th>
                  <th className="pb-3 font-medium">Role</th>
                  <th className="pb-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {contact.organizations.map(org => (
                  <tr key={org.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                    <td className="py-3 font-medium">
                      <Link to={`/admin/companies/${org.id}`} className="hover:underline">{org.name}</Link>
                    </td>
                    <td className="py-3">
                      {org.entity_type ? (
                        <Badge type="custom" value={ENTITY_TYPE_CONFIG[org.entity_type].label} className={ENTITY_TYPE_CONFIG[org.entity_type].className} />
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-3 text-muted-foreground">{org.abn || '—'}</td>
                    <td className="py-3 text-muted-foreground">{org.industry || '—'}</td>
                    <td className="py-3">
                      {org.role ? (
                        <Badge type="custom" value={org.role} className="bg-chart-2/10 text-chart-2" />
                      ) : '—'}
                    </td>
                    <td className="py-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={unlinkingOrgId === org.id}
                        onClick={() => handleUnlinkCompany(org.id)}
                      >
                        Unlink
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Lending History */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">
            Lending History
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({contact.lending_history.length + contact.applications.length})
            </span>
          </h3>
          <Button variant="primary" size="sm" onClick={() => setLendingModal({ entry: null })}>+ Add Entry</Button>
        </div>

        {/* Manual entries */}
        <div className="mb-6">
          <h4 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Loans on Record</h4>
          {contact.lending_history.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No external loan records yet. Add one to start building this contact's lending history.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-3 font-medium">Lender</th>
                    <th className="pb-3 font-medium">Amount</th>
                    <th className="pb-3 font-medium">Balloon</th>
                    <th className="pb-3 font-medium">Repayments</th>
                    <th className="pb-3 font-medium">Start Date</th>
                    <th className="pb-3 font-medium">Identifier</th>
                    <th className="pb-3 font-medium">Guarantor</th>
                    <th className="pb-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {contact.lending_history.map(e => (
                    <tr key={e.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <AssetHoverIcon
                            heading={e.lender_name}
                            rows={[
                              { label: 'Amount', value: `$${Number(e.amount).toLocaleString('en-AU')}` },
                              { label: 'Balloon', value: e.balloon != null ? `$${Number(e.balloon).toLocaleString('en-AU')}` : null },
                              { label: 'Repayments', value: formatRepayments(e.repayment_amount, e.repayment_frequency) },
                              { label: 'Start date', value: e.start_date ? formatDate(e.start_date) : null },
                              { label: 'Identifier', value: e.identifier },
                              { label: 'Guarantor', value: e.guaranteed_by_name },
                              { label: 'Via broker', value: e.other_broker_name },
                            ]}
                          />
                          <div>
                            <div className="font-medium">{e.lender_name}</div>
                            {e.other_broker_name && (
                              <div className="text-[12px] text-muted-foreground">via {e.other_broker_name}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3">${Number(e.amount).toLocaleString('en-AU')}</td>
                      <td className="py-3 text-muted-foreground">{e.balloon != null ? `$${Number(e.balloon).toLocaleString('en-AU')}` : '—'}</td>
                      <td className="py-3 text-muted-foreground">{formatRepayments(e.repayment_amount, e.repayment_frequency)}</td>
                      <td className="py-3 text-muted-foreground">{e.start_date ? formatDate(e.start_date) : '—'}</td>
                      <td className="py-3 text-muted-foreground">{e.identifier || '—'}</td>
                      <td className="py-3 text-muted-foreground">{e.guaranteed_by_name || '—'}</td>
                      <td className="py-3">
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setLendingModal({ entry: e })}>Edit</Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={deletingEntryId === e.id}
                            onClick={() => handleDeleteLendingEntry(e.id)}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Portal applications */}
        <div>
          <h4 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Portal Applications</h4>
          {contact.applications.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No loan applications linked to this contact.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-3 font-medium">Type</th>
                    <th className="pb-3 font-medium">Amount</th>
                    <th className="pb-3 font-medium">Status</th>
                    <th className="pb-3 font-medium">Business</th>
                    <th className="pb-3 font-medium">Created</th>
                    <th className="pb-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {contact.applications.map(app => (
                    <tr key={app.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                      <td className="py-3 font-medium">
                        <div className="flex items-center gap-2">
                          <AssetHoverIcon
                            loanType={app.loan_type}
                            heading={LOAN_TYPE_LABELS[app.loan_type] ?? app.loan_type}
                            rows={[
                              { label: 'Amount', value: `$${Number(app.amount).toLocaleString('en-AU')}` },
                              { label: 'Business', value: app.business_name || app.business_abn },
                              { label: 'Created', value: formatDate(app.created_at) },
                            ]}
                          />
                          <span className="capitalize">{app.loan_type.replace(/_/g, ' ')}</span>
                        </div>
                      </td>
                      <td className="py-3">${Number(app.amount).toLocaleString('en-AU')}</td>
                      <td className="py-3">
                        <Badge value={app.status} />
                      </td>
                      <td className="py-3 text-muted-foreground">
                        {app.business_name || app.business_abn || '—'}
                      </td>
                      <td className="py-3 text-muted-foreground">{formatDate(app.created_at)}</td>
                      <td className="py-3">
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setEditingApp(app)}>Edit</Button>
                          <Link to={`/admin/applications/${app.id}`}>
                            <Button variant="ghost" size="sm">Review</Button>
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      <ArrearsSection contact={{ id: contact.id, name: [contact.first_name, contact.last_name].filter(Boolean).join(' ') }} />

      {editing && (
        <EditContactModal
          contact={contact}
          onClose={() => setEditing(false)}
          onSaved={updated => { setContact(updated); setEditing(false); }}
        />
      )}

      {editingApp && (
        <EditLendingEntryModal
          app={editingApp}
          onClose={() => setEditingApp(null)}
          onSaved={updated => {
            setContact(prev => prev ? {
              ...prev,
              applications: prev.applications.map(a => a.id === updated.id ? updated : a),
            } : prev);
            setEditingApp(null);
          }}
        />
      )}

      {addingEntity && contact && (
        <AddEntityModal
          contactId={contact.id}
          excludeIds={new Set(contact.organizations.map(o => o.id))}
          onClose={() => setAddingEntity(false)}
          onLinked={(org) => {
            setContact(prev => prev ? {
              ...prev,
              organizations: [
                ...prev.organizations,
                {
                  id: org.id,
                  name: org.name,
                  entity_type: org.entity_type,
                  abn: org.abn,
                  industry: org.industry,
                  address: null,
                  notes: null,
                  role: org.role,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                },
              ],
            } : prev);
            setAddingEntity(false);
          }}
        />
      )}

      {lendingModal && contact && (
        <LendingEntryModal
          contactId={contact.id}
          entry={lendingModal.entry}
          onClose={() => setLendingModal(null)}
          onSaved={(saved, mode) => {
            setContact(prev => prev ? {
              ...prev,
              lending_history: mode === 'create'
                ? [saved, ...prev.lending_history]
                : prev.lending_history.map(e => e.id === saved.id ? saved : e),
            } : prev);
            setLendingModal(null);
          }}
        />
      )}
    </div>
  );
}
