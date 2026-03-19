import { useForm } from 'react-hook-form';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { getErrorMessage, formatDate } from '../../lib/utils';
import { GlassCard, Badge, Button, Input, PageHeader } from '../../components/ui';

interface FormData {
  full_name: string;
  phone: string;
}

export default function Profile() {
  const { user } = useAuth();
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormData>({
    defaultValues: {
      full_name: user?.full_name || '',
      phone: user?.phone || '',
    },
  });

  const onSubmit = async (data: FormData) => {
    try {
      await api.patch('/users/me', {
        full_name: data.full_name,
        phone: data.phone || null,
      });
      toast('Profile updated successfully', 'success');
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to update profile'), 'error');
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="My Profile" subtitle="Manage your account information" />

      <div className="space-y-6">
        {/* Profile Card */}
        <GlassCard>
          <div className="flex items-center gap-5 mb-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary">
              <span className="text-2xl font-semibold text-primary-foreground">{user?.full_name?.charAt(0).toUpperCase()}</span>
            </div>
            <div>
              <h2 className="text-[20px] font-semibold text-foreground">{user?.full_name}</h2>
              <p className="text-[14px] text-muted-foreground">{user?.email}</p>
            </div>
          </div>

          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-secondary/50 p-4">
              <dt className="text-[13px] font-medium text-muted-foreground">Role</dt>
              <dd className="mt-1 text-[15px] font-semibold text-foreground capitalize">{user?.role}</dd>
            </div>
            <div className="rounded-xl bg-secondary/50 p-4">
              <dt className="text-[13px] font-medium text-muted-foreground">KYC Status</dt>
              <dd className="mt-1">
                <Badge type="kyc" value={user?.kyc_status || 'pending'} />
              </dd>
            </div>
            <div className="rounded-xl bg-secondary/50 p-4">
              <dt className="text-[13px] font-medium text-muted-foreground">Email</dt>
              <dd className="mt-1 text-[15px] font-semibold text-foreground">{user?.email}</dd>
            </div>
            <div className="rounded-xl bg-secondary/50 p-4">
              <dt className="text-[13px] font-medium text-muted-foreground">Member Since</dt>
              <dd className="mt-1 text-[15px] font-semibold text-foreground">
                {user?.created_at ? formatDate(user.created_at) : ''}
              </dd>
            </div>
          </dl>
        </GlassCard>

        {/* Edit Profile */}
        <form onSubmit={handleSubmit(onSubmit)}>
          <GlassCard>
            <h2 className="text-[15px] font-semibold text-foreground mb-5">Edit Profile</h2>
            <div className="space-y-5">
              <Input
                label="Full Name"
                error={errors.full_name?.message}
                {...register('full_name', { required: 'Name is required' })}
              />
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">
                  Phone <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <Input placeholder="+91 98765 43210" {...register('phone')} />
              </div>
              <Button type="submit" loading={isSubmitting} disabled={!isDirty} size="lg">
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </GlassCard>
        </form>
      </div>
    </div>
  );
}
