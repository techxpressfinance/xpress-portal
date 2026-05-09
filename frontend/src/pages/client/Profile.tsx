import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { getErrorMessage, formatDate } from '../../lib/utils';
import { GlassCard, Button, Input, PageHeader } from '../../components/ui';
import type { ServiceRequest, ServiceRequestStatus } from '../../types';

interface FormData {
  full_name: string;
  phone: string;
}

interface PasswordFormData {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

const DONE_STATUSES: ServiceRequestStatus[] = ['resolved', 'closed'];

const STATUS_COLOR: Record<ServiceRequestStatus, string> = {
  pending: 'text-amber-600 bg-amber-50 border-amber-200',
  in_progress: 'text-blue-600 bg-blue-50 border-blue-200',
  resolved: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  closed: 'text-muted-foreground bg-secondary border-border',
};

const STATUS_LABEL: Record<ServiceRequestStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

export default function Profile() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(true);

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

  useEffect(() => {
    api.get('/service-requests?per_page=10')
      .then(({ data }) => setRequests(data.items))
      .catch(() => {})
      .finally(() => setRequestsLoading(false));
  }, []);

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

        {/* Service Requests */}
        <GlassCard padding="none">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="text-[15px] font-semibold text-foreground">Service Requests</h2>
              <p className="text-[13px] text-muted-foreground mt-0.5">Your recent requests</p>
            </div>
            {requests.length > 0 && (
              <a href="/service-requests" className="text-[13px] font-medium text-primary hover:underline">View all</a>
            )}
          </div>

          {requestsLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2].map((i) => <div key={i} className="h-10 rounded-lg shimmer" />)}
            </div>
          ) : requests.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-[13px] text-muted-foreground">No service requests yet</p>
              <a href="/service-requests" className="mt-2 inline-block text-[13px] font-medium text-primary hover:underline">Submit a request</a>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {requests.map((req) => {
                const isDone = DONE_STATUSES.includes(req.status);
                const label = req.request_type === 'Other' && req.custom_request ? req.custom_request : req.request_type;
                return (
                  <div key={req.id} className="flex items-center gap-3 px-5 py-3">
                    <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                      isDone ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-primary/40'
                    }`}>
                      {isDone && (
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className={`text-[13px] font-medium ${isDone ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                        {label}
                      </span>
                      <span className="ml-2 text-[11px] text-muted-foreground">{formatDate(req.created_at)}</span>
                    </div>
                    <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border shrink-0 ${STATUS_COLOR[req.status]}`}>
                      {STATUS_LABEL[req.status]}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
