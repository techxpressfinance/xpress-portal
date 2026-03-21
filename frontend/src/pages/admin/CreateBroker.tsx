import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { getErrorMessage } from '../../lib/utils';
import { GlassCard, PageHeader, Button, Input } from '../../components/ui';

interface BrokerForm {
  full_name: string;
  email: string;
  phone: string;
  employee_id: string;
  department: string;
  license_number: string;
}

const INITIAL_FORM: BrokerForm = {
  full_name: '',
  email: '',
  phone: '',
  employee_id: '',
  department: '',
  license_number: '',
};

export default function CreateBroker() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState<BrokerForm>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof BrokerForm, string>>>({});

  const validate = (): boolean => {
    const errs: Partial<Record<keyof BrokerForm, string>> = {};
    if (!form.full_name.trim()) errs.full_name = 'Full name is required';
    if (!form.email.trim()) errs.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Invalid email address';
    if (!form.employee_id.trim()) errs.employee_id = 'Employee ID is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      await api.post('/users/brokers', {
        full_name: form.full_name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim() || null,
        employee_id: form.employee_id.trim(),
        department: form.department.trim() || null,
        license_number: form.license_number.trim() || null,
      });
      toast('Broker created successfully. Login credentials sent via email.', 'success');
      setForm(INITIAL_FORM);
      setErrors({});
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to create broker'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const update = (field: keyof BrokerForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  return (
    <div>
      <PageHeader
        title="Create Broker"
        subtitle="Create a new broker account. Login credentials will be emailed automatically."
      />

      <div className="max-w-2xl">
        <GlassCard>
          <form onSubmit={handleSubmit} className="space-y-5">
            <h3 className="text-[15px] font-semibold text-foreground mb-1">Personal Information</h3>
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
                placeholder="broker@example.com"
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
            </div>

            <hr className="border-border" />

            <h3 className="text-[15px] font-semibold text-foreground mb-1">Employment Details</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Employee ID *"
                placeholder="EMP-001"
                value={form.employee_id}
                onChange={(e) => update('employee_id', e.target.value)}
                error={errors.employee_id}
              />
              <Input
                label="Department"
                placeholder="Lending"
                value={form.department}
                onChange={(e) => update('department', e.target.value)}
              />
              <Input
                label="License Number"
                placeholder="ACR-123456"
                value={form.license_number}
                onChange={(e) => update('license_number', e.target.value)}
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Creating...' : 'Create Broker'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => navigate('/admin/users')}>
                Cancel
              </Button>
            </div>
          </form>
        </GlassCard>
      </div>
    </div>
  );
}
