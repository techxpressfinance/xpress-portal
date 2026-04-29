import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getErrorMessage } from '../lib/utils';
import { Button, Input } from '../components/ui';

interface LoginForm {
  email: string;
  password: string;
}

const easing = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';

export default function PlatformLogin() {
  const { superAdminLogin, user } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<LoginForm>();

  if (user?.role === 'super_admin') {
    return <Navigate to="/platform" replace />;
  }

  const onSubmit = async (data: LoginForm) => {
    setError('');
    try {
      await superAdminLogin(data.email, data.password);
      navigate('/platform');
    } catch (err: any) {
      setError(getErrorMessage(err, 'Invalid credentials'));
    }
  };

  return (
    <div className="flex min-h-screen" style={{ fontFamily: "'Outfit', sans-serif" }}>
      {/* Left - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-secondary relative overflow-hidden items-center justify-center">
        <div
          className="relative z-10 px-20 max-w-lg"
          style={{ animation: `fadeInUp 0.7s ${easing} both` }}
        >
          <div className="flex items-center gap-3 mb-16">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-foreground">
              <span className="text-[18px] font-semibold text-background">X</span>
            </div>
            <span className="text-[22px] font-semibold text-foreground tracking-tight">Xpress Finance</span>
          </div>

          <h2 className="text-[34px] font-semibold text-foreground leading-[1.15] mb-4">
            Platform{' '}
            <span className="text-[#0071e3]">Administration</span>
          </h2>
          <p className="text-[15px] text-muted-foreground leading-relaxed max-w-sm">
            Manage tenants, provision new brokerages, and oversee the entire platform.
          </p>
        </div>
      </div>

      {/* Right - Form */}
      <div className="flex w-full lg:w-1/2 items-center justify-center bg-background px-6">
        <div
          className="w-full max-w-[380px]"
          style={{ animation: `fadeInUp 0.6s ${easing} 0.1s both` }}
        >
          <div className="flex items-center gap-3 mb-12 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-foreground">
              <span className="text-[16px] font-semibold text-background">X</span>
            </div>
            <span className="text-[20px] font-semibold text-foreground tracking-tight">Xpress Finance</span>
          </div>

          <h1 className="text-[28px] font-semibold text-foreground mb-2 tracking-tight">
            Platform Login
          </h1>
          <p className="text-[15px] text-muted-foreground mb-8">
            Sign in with your super admin credentials
          </p>

          {error && (
            <div
              className="mb-6 flex items-center gap-3 rounded-xl bg-[#ff3b30]/8 px-4 py-3"
              style={{ animation: `fadeInUp 0.3s ${easing} both` }}
            >
              <svg className="h-4 w-4 text-[#ff3b30] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
              <span className="text-[13px] text-[#ff3b30]">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <Input
              label="Email"
              type="email"
              placeholder="admin@xpresstech.com"
              {...register('email', { required: true })}
            />
            <Input
              label="Password"
              type="password"
              placeholder="Enter your password"
              {...register('password', { required: true })}
            />
            <div className="pt-1">
              <Button type="submit" loading={isSubmitting} size="lg" className="w-full">
                {isSubmitting ? 'Signing in...' : 'Sign in'}
              </Button>
            </div>
          </form>

          <p className="mt-8 text-center text-[13px] text-muted-foreground">
            <Link
              to="/login"
              className="font-medium text-[#0071e3] hover:text-[#0071e3]/70 transition-colors duration-200"
            >
              Back to tenant login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
