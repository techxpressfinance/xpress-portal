import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import api from '../api/client';
import { useTenant } from '../contexts/TenantContext';
import { useTheme } from '../hooks/useTheme';
import { getErrorMessage } from '../lib/utils';
import { Button, Input, PasswordRequirements, passwordMeetsRequirements } from '../components/ui';
import { CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';

interface ResetForm {
  password: string;
  confirm_password: string;
}

const easing = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';

export default function ResetPassword() {
  const { tenant } = useTenant();
  const { theme } = useTheme();
  const brandName = tenant?.name || 'Xpress Finance';
  const defaultLogo = theme === 'dark' ? '/xpress-dark.svg' : '/xpress-light.svg';
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { isSubmitting, errors },
  } = useForm<ResetForm>();

  if (!token) {
    return (
      <div className="ledger-theme min-h-[100dvh] flex items-center justify-center p-4 bg-background">
        <p className="text-muted-foreground text-[15px]">
          Invalid reset link.{' '}
          <Link to="/forgot-password" className="text-primary hover:text-primary/70">
            Request a new one
          </Link>
        </p>
      </div>
    );
  }

  const onSubmit = async (data: ResetForm) => {
    setError('');
    try {
      await api.post('/auth/reset-password', { token, password: data.password });
      setDone(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Reset failed. The link may have expired.'));
    }
  };

  return (
    <div className="ledger-theme min-h-[100dvh] w-full flex flex-col items-center justify-center p-4 sm:p-6" style={{ background: 'var(--led-bg)' }}>
      <div className="w-full max-w-[420px] led-fade-up">
        <div className="led-card p-6 sm:p-10 flex flex-col">
          <div className="flex flex-col items-center mb-8">
            <div className="flex items-center mb-6">
              <img
                src={tenant?.logo_url || defaultLogo}
                alt={brandName}
                className="h-16 sm:h-24 w-auto max-w-[300px] object-contain drop-shadow-sm"
                onError={(e) => { (e.target as HTMLImageElement).src = defaultLogo; }}
              />
            </div>
            <h1 className="text-[28px] font-semibold text-foreground tracking-tight text-center">
              {done ? 'Password updated' : 'Set new password'}
            </h1>
            <p className="text-[15px] text-muted-foreground mt-2 text-center max-w-[280px]">
              {done ? 'Redirecting you to sign in...' : 'Choose a strong password for your account.'}
            </p>
          </div>

          {error && (
            <div
              className="mb-6 flex items-start gap-3 rounded-xl bg-destructive/10 px-4 py-3 w-full border border-destructive/20 text-left"
              style={{ animation: `fadeInUp 0.3s ${easing} both` }}
            >
              <ExclamationCircleIcon className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="text-[13px] text-destructive leading-tight block">{error}</span>
                <Link to="/forgot-password" className="block mt-1.5 text-[13px] font-medium text-destructive/80 hover:text-destructive transition-colors duration-200">
                  Request a new reset link &rarr;
                </Link>
              </div>
            </div>
          )}

          {done ? (
            <div
              className="flex items-center gap-3 rounded-xl bg-[#34c759]/10 px-4 py-3 border border-[#34c759]/20"
              style={{ animation: `fadeInUp 0.3s ${easing} both` }}
            >
              <CheckCircleIcon className="h-4 w-4 text-[#34c759] shrink-0" />
              <span className="text-[13px] text-[#34c759]">Password changed successfully.</span>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 w-full">
              <div>
                <Input
                  label="New Password"
                  type="password"
                  placeholder="Create a strong password"
                  error={errors.password?.message}
                  className="bg-background/50 border-border/60 focus:bg-background transition-colors"
                  {...register('password', {
                    required: 'Password is required',
                    validate: (v) => passwordMeetsRequirements(v) || 'Password does not meet the requirements below',
                  })}
                />
                <PasswordRequirements password={watch('password') || ''} alwaysShow />
              </div>
              <Input
                label="Confirm Password"
                type="password"
                placeholder="Re-enter your password"
                error={errors.confirm_password?.message}
                className="bg-background/50 border-border/60 focus:bg-background transition-colors"
                {...register('confirm_password', {
                  required: 'Please confirm your password',
                  validate: (val) => val === watch('password') || 'Passwords do not match',
                })}
              />
              <div className="pt-2">
                <Button
                  type="submit"
                  loading={isSubmitting}
                  size="lg"
                  className="w-full h-12 text-[15px] rounded-2xl shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
                >
                  {isSubmitting ? 'Updating...' : 'Update Password'}
                </Button>
              </div>
            </form>
          )}
        </div>

        <div
          className="mt-8 text-center"
          style={{ animation: `fadeInUp 0.8s ${easing} 0.2s both` }}
        >
          <p className="text-[13px] text-muted-foreground font-medium">
            <Link to="/login" className="text-primary hover:text-primary/70 transition-colors duration-200">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
