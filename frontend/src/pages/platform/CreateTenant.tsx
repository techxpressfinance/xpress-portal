import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { getErrorMessage } from '../../lib/utils';
import { PageHeader, Button, Input } from '../../components/ui';

interface TenantForm {
  tenant_name: string;
  slug: string;
  admin_full_name: string;
  admin_email: string;
  admin_phone: string;
  admin_password: string;
}

export default function CreateTenant() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const {
    register,
    handleSubmit,
    watch,
    formState: { isSubmitting, errors },
  } = useForm<TenantForm>();

  const onSubmit = async (data: TenantForm) => {
    setError('');
    try {
      await api.post('/super-admin/tenants', {
        tenant_name: data.tenant_name,
        slug: data.slug,
        admin_email: data.admin_email,
        admin_password: data.admin_password,
        admin_full_name: data.admin_full_name,
        admin_phone: data.admin_phone || null,
      });
      navigate('/platform/tenants');
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to create tenant'));
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-2xl mx-auto">
      <PageHeader title="Create Tenant" subtitle="Provision a new brokerage" />

      {error && (
        <div className="mb-6 flex items-center gap-3 rounded-xl bg-[#ff3b30]/8 px-4 py-3">
          <svg className="h-4 w-4 text-[#ff3b30] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          <span className="text-[13px] text-[#ff3b30]">{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <div className="rounded-2xl bg-card text-card-foreground shadow-[0_0_0_1px_var(--border),0_1px_3px_0_rgba(0,0,0,0.04)] overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-secondary/30">
            <h3 className="text-[14px] font-medium text-foreground">Organization</h3>
          </div>
          <div className="p-5 space-y-4">
            <Input
              label="Organization name"
              {...register('tenant_name', { required: 'Required' })}
              placeholder="Acme Finance"
              error={errors.tenant_name?.message}
            />
            <div>
              <Input
                label="Subdomain slug"
                {...register('slug', {
                  required: 'Required',
                  pattern: {
                    value: /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/,
                    message: '3-50 chars, lowercase alphanumeric and hyphens',
                  },
                })}
                placeholder="acme-finance"
                error={errors.slug?.message}
              />
              <p className="mt-1.5 text-[12px] text-muted-foreground">
                Portal URL: <strong>{watch('slug') || 'slug'}.xpresstech.com</strong>
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-card text-card-foreground shadow-[0_0_0_1px_var(--border),0_1px_3px_0_rgba(0,0,0,0.04)] overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-secondary/30">
            <h3 className="text-[14px] font-medium text-foreground">Tenant Admin Account</h3>
          </div>
          <div className="p-5 space-y-4">
            <Input
              label="Full name"
              {...register('admin_full_name', { required: 'Required' })}
              placeholder="Jane Smith"
              error={errors.admin_full_name?.message}
            />
            <Input
              label="Email"
              type="email"
              {...register('admin_email', { required: 'Required' })}
              placeholder="jane@acmefinance.com"
              error={errors.admin_email?.message}
            />
            <Input
              label="Phone (optional)"
              type="tel"
              {...register('admin_phone')}
              placeholder="0400 000 000"
            />
            <Input
              label="Password"
              type="password"
              {...register('admin_password', {
                required: 'Required',
                minLength: { value: 8, message: 'At least 8 characters' },
              })}
              placeholder="Min. 8 characters, 1 uppercase, 1 digit"
              error={errors.admin_password?.message}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" loading={isSubmitting}>
            {isSubmitting ? 'Creating...' : 'Create Tenant'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate('/platform/tenants')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
