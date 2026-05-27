import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { GlassCard, PageHeader, Button, Badge, Input, Select } from '../../components/ui';
import { formatDate, getErrorMessage } from '../../lib/utils';
import { LOAN_TYPES, APPLICATION_STATUSES } from '../../types';
import type { ContactDetail as ContactDetailType, ContactApplication } from '../../types';

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
              <label className={LABEL}>Date of Birth</label>
              <Input type="date" {...field('date_of_birth')} />
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

export default function ContactDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [contact, setContact] = useState<ContactDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editingApp, setEditingApp] = useState<ContactApplication | null>(null);

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
      <PageHeader
        title={`${contact.first_name} ${contact.last_name}`}
        subtitle="Contact Details"
        action={
          <div className="flex gap-2">
            <Button variant="primary" size="sm" onClick={() => setEditing(true)}>Edit Contact</Button>
            <Link to="/admin/contacts">
              <Button variant="secondary" size="sm">Back to Contacts</Button>
            </Link>
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

      {/* Organizations */}
      <GlassCard>
        <h3 className="text-lg font-semibold mb-4">
          Organizations
          <span className="ml-2 text-sm font-normal text-muted-foreground">({contact.organizations.length})</span>
        </h3>
        {contact.organizations.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No organizations linked to this contact.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-3 font-medium">Name</th>
                  <th className="pb-3 font-medium">ABN</th>
                  <th className="pb-3 font-medium">Industry</th>
                  <th className="pb-3 font-medium">Role</th>
                </tr>
              </thead>
              <tbody>
                {contact.organizations.map(org => (
                  <tr key={org.id} className="border-b border-border/50">
                    <td className="py-3 font-medium">{org.name}</td>
                    <td className="py-3 text-muted-foreground">{org.abn || '—'}</td>
                    <td className="py-3 text-muted-foreground">{org.industry || '—'}</td>
                    <td className="py-3">
                      {org.role ? (
                        <Badge type="custom" value={org.role} className="bg-chart-2/10 text-chart-2" />
                      ) : '—'}
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
        <h3 className="text-lg font-semibold mb-4">
          Lending History
          <span className="ml-2 text-sm font-normal text-muted-foreground">({contact.applications.length})</span>
        </h3>
        {contact.applications.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No loan applications linked to this contact.</p>
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
    </div>
  );
}
