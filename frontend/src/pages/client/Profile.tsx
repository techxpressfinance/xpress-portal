import { useForm } from 'react-hook-form';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { getErrorMessage, formatDate } from '../../lib/utils';
import { GlassCard, Button, Input, PageHeader } from '../../components/ui';

interface FormData {
  full_name: string;
  phone: string;
}

interface PasswordFormData {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

export default function Profile() {
  const { user, logout } = useAuth();
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

  const {
    register: registerPw,
    handleSubmit: handleSubmitPw,
    formState: { errors: pwErrors, isSubmitting: pwSubmitting },
    reset: resetPw,
    watch,
  } = useForm<PasswordFormData>();

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

  const onChangePassword = async (data: PasswordFormData) => {
    try {
      await api.post('/auth/change-password', {
        current_password: data.current_password,
        new_password: data.new_password,
      });
      toast('Password changed. Please sign in again.', 'success');
      resetPw();
      setTimeout(() => logout(), 1500);
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to change password'), 'error');
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
                <Input placeholder="+61 412 345 678" {...register('phone')} />
              </div>
              <Button type="submit" loading={isSubmitting} disabled={!isDirty} size="lg">
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </GlassCard>
        </form>

        {/* Change Password */}
        <form onSubmit={handleSubmitPw(onChangePassword)}>
          <GlassCard>
            <h2 className="text-[15px] font-semibold text-foreground mb-5">Change Password</h2>
            <div className="space-y-5">
              <Input
                label="Current Password"
                type="password"
                error={pwErrors.current_password?.message}
                {...registerPw('current_password', { required: 'Current password is required' })}
              />
              <Input
                label="New Password"
                type="password"
                error={pwErrors.new_password?.message}
                {...registerPw('new_password', { required: 'New password is required', minLength: { value: 8, message: 'Must be at least 8 characters' } })}
              />
              <Input
                label="Confirm New Password"
                type="password"
                error={pwErrors.confirm_password?.message}
                {...registerPw('confirm_password', {
                  required: 'Please confirm your new password',
                  validate: (v) => v === watch('new_password') || 'Passwords do not match',
                })}
              />
              <p className="text-[12px] text-muted-foreground">You will be signed out after changing your password.</p>
              <Button type="submit" loading={pwSubmitting} size="lg">
                {pwSubmitting ? 'Changing...' : 'Change Password'}
              </Button>
            </div>
          </GlassCard>
        </form>

      </div>
    </div>
  );
}
