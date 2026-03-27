import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { getErrorMessage, getInitials } from '../../lib/utils';
import { GlassCard, PageHeader, Button, Input } from '../../components/ui';
import type { User } from '../../types';

interface ReferrerForm {
  full_name: string;
  email: string;
  phone: string;
  organization_name: string;
}

const INITIAL_FORM: ReferrerForm = {
  full_name: '',
  email: '',
  phone: '',
  organization_name: '',
};

export default function CreateReferrer() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState<ReferrerForm>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof ReferrerForm, string>>>({});
  const [referrers, setReferrers] = useState<User[]>([]);

  useEffect(() => {
    api.get('/external-referrers')
      .then(({ data }) => setReferrers(data))
      .catch(() => {});
  }, []);

  const validate = (): boolean => {
    const errs: Partial<Record<keyof ReferrerForm, string>> = {};
    if (!form.full_name.trim()) errs.full_name = 'Full name is required';
    if (!form.email.trim()) errs.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Invalid email address';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const { data } = await api.post('/external-referrers', {
        full_name: form.full_name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim() || null,
        organization_name: form.organization_name.trim() || null,
      });
      toast('Referrer created successfully. Login credentials sent via email.', 'success');
      setForm(INITIAL_FORM);
      setErrors({});
      setReferrers((prev) => [data, ...prev]);
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to create referrer'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const update = (field: keyof ReferrerForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  return (
    <div>
      <PageHeader
        title="External Referrers"
        subtitle="Create referrer accounts for external partners and institutions who refer clients."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Create Referrer Form */}
        <GlassCard>
          <form onSubmit={handleSubmit} className="space-y-5">
            <h3 className="text-[15px] font-semibold text-foreground mb-1">Create Referrer</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Full Name *"
                placeholder="John Smith"
                value={form.full_name}
                onChange={(e) => update('full_name', e.target.value)}
                error={errors.full_name}
              />
              <Input
                label="Email *"
                type="email"
                placeholder="referrer@example.com"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                error={errors.email}
              />
              <Input
                label="Phone"
                type="tel"
                placeholder="+61 400 000 000"
                value={form.phone}
                onChange={(e) => update('phone', e.target.value)}
              />
              <Input
                label="Organization"
                placeholder="Company or institution name"
                value={form.organization_name}
                onChange={(e) => update('organization_name', e.target.value)}
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Creating...' : 'Create Referrer'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => navigate('/admin/users')}>
                Cancel
              </Button>
            </div>
          </form>
        </GlassCard>

        {/* Existing Referrers */}
        <GlassCard padding="none">
          <div className="px-5 pt-5 pb-3">
            <h3 className="text-[15px] font-semibold text-foreground">Existing Referrers</h3>
            <p className="text-[13px] text-muted-foreground mt-0.5">{referrers.length} referrer{referrers.length !== 1 ? 's' : ''}</p>
          </div>
          {referrers.length === 0 ? (
            <div className="px-5 pb-8 pt-2 text-center">
              <p className="text-[13px] text-muted-foreground">No referrers created yet</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {referrers.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-chart-4/10">
                    <span className="text-[11px] font-semibold text-chart-4">
                      {getInitials(r.full_name)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-foreground truncate">{r.full_name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {r.email}
                      {r.organization_name && ` \u00b7 ${r.organization_name}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${r.is_active ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                      {r.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
