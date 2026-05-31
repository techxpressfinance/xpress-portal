import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { GlassCard, PageHeader, Button, Badge, Input, Select, Breadcrumbs, DatePicker } from '../../components/ui';
import { formatDate, getErrorMessage } from '../../lib/utils';
import { LOAN_TYPES, APPLICATION_STATUSES } from '../../types';
import type { ContactDetail as ContactDetailType, ContactApplication, LendingHistoryEntry, RepaymentFrequency } from '../../types';

const REPAYMENT_FREQUENCIES: { value: RepaymentFrequency; label: string; short: string }[] = [
  { value: 'weekly', label: 'Weekly', short: 'wk' },
  { value: 'fortnightly', label: 'Fortnightly', short: 'fn' },
  { value: 'monthly', label: 'Monthly', short: 'mo' },
];

function formatRepayments(amount: number | null, freq: RepaymentFrequency | null): string {
  if (amount == null) return '—';
  const short = REPAYMENT_FREQUENCIES.find(f => f.value === freq)?.short;
  const amt = `$${Number(amount).toLocaleString()}`;
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Email</label>
              <Input type="email" placeholder="email@example.com" {...field('email')} />
            </div>
            <div>
              <label className={LABEL}>Phone</label>
              <Input type="tel" placeholder="04XX XXX XXX" {...field('phone')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Loan Type</label>
              <Select value={form.loan_type} onChange={e => setForm(f => ({ ...f, loan_type: e.target.value }))}>
                {LOAN_TYPES.map(t => (
                  <option key={t} value={t}>{t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
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

          <div className="grid grid-cols-2 gap-3">
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

function LinkCompanyModal({ contactId, excludeIds, onClose, onLinked }: {
  contactId: string;
  excludeIds: Set<string>;
  onClose: () => void;
  onLinked: (org: { id: string; name: string; abn: string | null; industry: string | null; role: string | null }) => void;
}) {
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; name: string; abn: string | null; industry: string | null }[]>([]);
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
      api.get('/organizations', { params: { search: query || undefined, page: 1, per_page: 20 } })
        .then(({ data }) => {
          if (cancelled) return;
          setResults((data.items || []).filter((o: { id: string }) => !excludeIds.has(o.id)));
        })
        .catch(() => { if (!cancelled) setResults([]); });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, excludeIds]);

  const submit = async () => {
    if (!picked) return;
    setSaving(true);
    try {
      await api.post(`/contacts/${contactId}/organizations`, {
        organization_id: picked.id,
        role: role.trim() || null,
      });
      toast('Company linked', 'success');
      onLinked({ id: picked.id, name: picked.name, abn: picked.abn, industry: picked.industry, role: role.trim() || null });
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to link company'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl bg-background border border-border p-6 shadow-xl" style={{ animation: 'fadeInUp 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}>
        <h3 className="text-[17px] font-semibold text-foreground mb-4">Link Company</h3>
        {picked ? (
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
              <Input placeholder="e.g. director, guarantor, signatory" value={role} onChange={e => setRole(e.target.value)} />
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <Button variant="secondary" size="md" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button variant="primary" size="md" loading={saving} onClick={submit}>Link Company</Button>
            </div>
          </div>
        ) : (
          <>
            <Input autoFocus placeholder="Search companies by name or ABN…" value={query} onChange={e => setQuery(e.target.value)} />
            <div className="mt-3 max-h-72 overflow-y-auto divide-y divide-border border border-border rounded-xl">
              {results.length === 0 ? (
                <p className="px-3 py-4 text-[13px] text-muted-foreground">No matches</p>
              ) : (
                results.map(o => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setPicked(o)}
                    className="w-full text-left px-3 py-2 hover:bg-secondary/50 transition-colors"
                  >
                    <div className="font-medium">{o.name}</div>
                    <div className="text-[12px] text-muted-foreground">{o.abn || 'No ABN'} {o.industry ? `· ${o.industry}` : ''}</div>
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
  const [contact, setContact] = useState<ContactDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editingApp, setEditingApp] = useState<ContactApplication | null>(null);
  const [lendingModal, setLendingModal] = useState<{ entry: LendingHistoryEntry | null } | null>(null);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  const [linkingCompany, setLinkingCompany] = useState(false);
  const [unlinkingOrgId, setUnlinkingOrgId] = useState<string | null>(null);

  const handleUnlinkCompany = async (orgId: string) => {
    if (!contact) return;
    if (!confirm('Unlink this company from the contact?')) return;
    setUnlinkingOrgId(orgId);
    try {
      await api.delete(`/contacts/${contact.id}/organizations/${orgId}`);
      setContact(prev => prev ? { ...prev, organizations: prev.organizations.filter(o => o.id !== orgId) } : prev);
      toast('Company unlinked', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to unlink'), 'error');
    } finally {
      setUnlinkingOrgId(null);
    }
  };

  const handleDeleteLendingEntry = async (entryId: string) => {
    if (!contact) return;
    if (!confirm('Delete this lending entry? This cannot be undone.')) return;
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
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
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
        <GlassCard>
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
        </GlassCard>

        <GlassCard>
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
        </GlassCard>
      </div>

      {/* Companies */}
      <GlassCard>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">
            Companies
            <span className="ml-2 text-sm font-normal text-muted-foreground">({contact.organizations.length})</span>
          </h3>
          <Button variant="primary" size="sm" onClick={() => setLinkingCompany(true)}>+ Link Company</Button>
        </div>
        {contact.organizations.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No companies linked yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-3 font-medium">Name</th>
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
      </GlassCard>

      {/* Lending History */}
      <GlassCard>
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
                        <div className="font-medium">{e.lender_name}</div>
                        {e.other_broker_name && (
                          <div className="text-[12px] text-muted-foreground">via {e.other_broker_name}</div>
                        )}
                      </td>
                      <td className="py-3">${Number(e.amount).toLocaleString()}</td>
                      <td className="py-3 text-muted-foreground">{e.balloon != null ? `$${Number(e.balloon).toLocaleString()}` : '—'}</td>
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
                      <td className="py-3 capitalize font-medium">{app.loan_type}</td>
                      <td className="py-3">${Number(app.amount).toLocaleString()}</td>
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
      </GlassCard>

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

      {linkingCompany && contact && (
        <LinkCompanyModal
          contactId={contact.id}
          excludeIds={new Set(contact.organizations.map(o => o.id))}
          onClose={() => setLinkingCompany(false)}
          onLinked={(org) => {
            setContact(prev => prev ? {
              ...prev,
              organizations: [
                ...prev.organizations,
                {
                  id: org.id,
                  name: org.name,
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
            setLinkingCompany(false);
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
