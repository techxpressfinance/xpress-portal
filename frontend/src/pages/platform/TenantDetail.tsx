import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import api from '../../api/client';
import { getErrorMessage, formatDateTime } from '../../lib/utils';
import { PageHeader, Badge, Button, Input } from '../../components/ui';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  primary_color: string | null;
  support_email: string | null;
  is_active: boolean;
  created_at: string;
}

interface TenantUpdateForm {
  name: string;
  logo_url: string;
  primary_color: string;
  support_email: string;
}

export default function TenantDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<TenantUpdateForm>();

  useEffect(() => {
    api
      .get(`/super-admin/tenants/${id}`)
      .then(({ data }) => {
        setTenant(data);
        reset({
          name: data.name,
          logo_url: data.logo_url || '',
          primary_color: data.primary_color || '',
          support_email: data.support_email || '',
        });
      })
      .catch(() => setError('Tenant not found'))
      .finally(() => setLoading(false));
  }, [id, reset]);

  const onSubmit = async (data: TenantUpdateForm) => {
    setError('');
    setSuccess('');
    try {
      const { data: updated } = await api.patch(`/super-admin/tenants/${id}`, {
        name: data.name,
        logo_url: data.logo_url || null,
        primary_color: data.primary_color || null,
        support_email: data.support_email || null,
      });
      setTenant(updated);
      setSuccess('Tenant updated');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to update'));
    }
  };

  const toggleActive = async () => {
    if (!tenant) return;
    try {
      const { data: updated } = await api.patch(`/super-admin/tenants/${id}`, {
        is_active: !tenant.is_active,
      });
      setTenant(updated);
    } catch {
      // silently fail
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="p-4 sm:p-8 max-w-2xl mx-auto text-center text-muted-foreground">
        Tenant not found
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 max-w-2xl mx-auto">
      <PageHeader
        title={tenant.name}
        subtitle={`${tenant.slug}.xpresstech.com`}
        action={
          <div className="flex items-center gap-2">
            <Badge type="custom" value={tenant.is_active ? 'Active' : 'Inactive'} className={tenant.is_active ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'} />
            <Button variant="secondary" size="sm" onClick={toggleActive}>
              {tenant.is_active ? 'Deactivate' : 'Activate'}
            </Button>
          </div>
        }
      />

      {error && (
        <div className="mb-6 flex items-center gap-3 rounded-xl bg-[#ff3b30]/8 px-4 py-3">
          <svg className="h-4 w-4 text-[#ff3b30] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          <span className="text-[13px] text-[#ff3b30]">{error}</span>
        </div>
      )}

      {success && (
        <div className="mb-6 flex items-center gap-3 rounded-xl bg-[#34c759]/8 px-4 py-3">
          <svg className="h-4 w-4 text-[#34c759] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <span className="text-[13px] text-[#34c759]">{success}</span>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <div className="rounded-2xl bg-card text-card-foreground shadow-[0_0_0_1px_var(--border),0_1px_3px_0_rgba(0,0,0,0.04)] overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-secondary/30">
            <h3 className="text-[14px] font-medium text-foreground">Settings</h3>
          </div>
          <div className="p-5 space-y-4">
            <Input label="Name" {...register('name')} />
            <Input label="Logo URL" {...register('logo_url')} placeholder="https://..." />
            <Input label="Primary color" type="color" {...register('primary_color')} />
            <Input label="Support email" type="email" {...register('support_email')} placeholder="support@..." />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" loading={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save Changes'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate('/platform/tenants')}>
            Back
          </Button>
        </div>
      </form>

      <div className="mt-8 rounded-2xl bg-card text-card-foreground shadow-[0_0_0_1px_var(--border),0_1px_3px_0_rgba(0,0,0,0.04)] overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-secondary/30">
          <h3 className="text-[14px] font-medium text-foreground">Info</h3>
        </div>
        <div className="p-5 space-y-2 text-[13px] text-muted-foreground">
          <p><span className="font-medium text-foreground">ID:</span> {tenant.id}</p>
          <p><span className="font-medium text-foreground">Slug:</span> {tenant.slug}</p>
          <p><span className="font-medium text-foreground">Created:</span> {formatDateTime(tenant.created_at)}</p>
        </div>
      </div>
    </div>
  );
}
