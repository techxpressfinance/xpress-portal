import { useForm } from 'react-hook-form';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { getErrorMessage, formatDate } from '../../lib/utils';
import { GlassCard, Button } from '../../components/ui';

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

  const inputClass = "w-full rounded-xl border border-[var(--led-line)] bg-[var(--led-surface-2)] px-4 py-2.5 text-[14px] text-[var(--led-ink)] placeholder:text-[var(--led-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--led-accent)]/30 transition-all";

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col pb-8">
      <div className="mb-8 mt-2">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="led-chip led-chip-accent">Profile</span>
        </div>
        <h1 className="text-[34px] font-semibold tracking-[-0.05em] text-[var(--led-ink)]">My Profile</h1>
        <p className="mt-2 text-[14px] leading-6 text-[var(--led-muted)]">Manage your account information</p>
      </div>

      <div className="max-w-2xl space-y-6">
        <GlassCard padding="none">
          <div className="border-b border-[var(--led-line)] px-6 py-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Account</p>
            <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Profile Overview</h2>
          </div>
          <div className="p-6">
            <div className="flex items-center gap-5 mb-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--led-accent)]">
                <span className="text-2xl font-semibold text-[var(--led-accent-ink)]">{user?.full_name?.charAt(0).toUpperCase()}</span>
              </div>
              <div>
                <h2 className="text-[20px] font-semibold text-[var(--led-ink)]">{user?.full_name}</h2>
                <p className="text-[14px] text-[var(--led-muted)]">{user?.email}</p>
              </div>
            </div>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl bg-[var(--led-surface-2)] p-4">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Role</dt>
                <dd className="mt-1 text-[15px] font-semibold text-[var(--led-ink)] capitalize">{user?.role}</dd>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)] p-4">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Email</dt>
                <dd className="mt-1 text-[15px] font-semibold text-[var(--led-ink)]">{user?.email}</dd>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)] p-4">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Member Since</dt>
                <dd className="mt-1 text-[15px] font-semibold text-[var(--led-ink)]">
                  {user?.created_at ? formatDate(user.created_at) : ''}
                </dd>
              </div>
            </dl>
          </div>
        </GlassCard>

        <GlassCard padding="none">
          <div className="border-b border-[var(--led-line)] px-6 py-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Settings</p>
            <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Edit Profile</h2>
          </div>
          <form onSubmit={handleSubmit(onSubmit)}>
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-[13px] font-medium text-[var(--led-ink)] mb-1.5">Full Name</label>
                <input
                  className={inputClass}
                  {...register('full_name', { required: 'Name is required' })}
                />
                {errors.full_name && <p className="mt-1 text-[12px] text-red-500">{errors.full_name.message}</p>}
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[var(--led-ink)] mb-1.5">Phone <span className="text-[var(--led-muted)] font-normal">(optional)</span></label>
                <input
                  className={inputClass}
                  placeholder="+61 412 345 678"
                  {...register('phone')}
                />
              </div>
              <Button type="submit" loading={isSubmitting} disabled={!isDirty} size="lg">
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </form>
        </GlassCard>

        <GlassCard padding="none">
          <div className="border-b border-[var(--led-line)] px-6 py-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Security</p>
            <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Change Password</h2>
          </div>
          <form onSubmit={handleSubmitPw(onChangePassword)}>
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-[13px] font-medium text-[var(--led-ink)] mb-1.5">Current Password</label>
                <input
                  type="password"
                  className={inputClass}
                  {...registerPw('current_password', { required: 'Current password is required' })}
                />
                {pwErrors.current_password && <p className="mt-1 text-[12px] text-red-500">{pwErrors.current_password.message}</p>}
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[var(--led-ink)] mb-1.5">New Password</label>
                <input
                  type="password"
                  className={inputClass}
                  {...registerPw('new_password', { required: 'New password is required', minLength: { value: 8, message: 'Must be at least 8 characters' } })}
                />
                {pwErrors.new_password && <p className="mt-1 text-[12px] text-red-500">{pwErrors.new_password.message}</p>}
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[var(--led-ink)] mb-1.5">Confirm New Password</label>
                <input
                  type="password"
                  className={inputClass}
                  {...registerPw('confirm_password', {
                    required: 'Please confirm your new password',
                    validate: (v) => v === watch('new_password') || 'Passwords do not match',
                  })}
                />
                {pwErrors.confirm_password && <p className="mt-1 text-[12px] text-red-500">{pwErrors.confirm_password.message}</p>}
              </div>
              <p className="text-[12px] text-[var(--led-muted)]">You will be signed out after changing your password.</p>
              <Button type="submit" loading={pwSubmitting} size="lg">
                {pwSubmitting ? 'Changing...' : 'Change Password'}
              </Button>
            </div>
          </form>
        </GlassCard>
      </div>
    </div>
  );
}
