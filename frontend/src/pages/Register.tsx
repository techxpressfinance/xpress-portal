import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { getErrorMessage } from '../lib/utils';
import { Button, Input } from '../components/ui';

interface RegisterForm {
  full_name: string;
  email: string;
  phone: string;
  password: string;
  confirm_password: string;
}

const easing = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';

export default function Register() {
  const { register: registerUser, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get('ref') || '';
  const [error, setError] = useState('');
  const [referrerName, setReferrerName] = useState('');
  const {
    register,
    handleSubmit,
    watch,
    formState: { isSubmitting, errors },
  } = useForm<RegisterForm>();

  useEffect(() => {
    if (refCode) {
      api.get(`/referrals/validate/${encodeURIComponent(refCode)}`)
        .then(({ data }) => setReferrerName(data.referrer_name))
        .catch(() => {});
    }
  }, [refCode]);

  if (user) {
    return <Navigate to="/" replace />;
  }

  const onSubmit = async (data: RegisterForm) => {
    setError('');
    try {
      const user = await registerUser(data.full_name, data.email, data.phone, data.password, refCode || undefined);
      if (user.email_verified) {
        navigate('/login?verified=true');
      } else {
        navigate('/login?registered=true');
      }
    } catch (err: any) {
      setError(getErrorMessage(err, 'Registration failed'));
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
            <span className="text-[22px] font-semibold text-foreground tracking-tight">Xpress</span>
          </div>

          <h2
            className="text-[34px] font-semibold text-foreground leading-[1.15] mb-4"
          >
            Join the future{' '}
            <span className="text-[#0071e3]">of lending.</span>
          </h2>
          <p className="text-[15px] text-muted-foreground leading-relaxed max-w-sm">
            Create your account and start your loan application in minutes. Fast, secure, and transparent.
          </p>
        </div>
      </div>

      {/* Right - Form */}
      <div className="flex w-full lg:w-1/2 items-center justify-center bg-background px-6 py-6 sm:py-12">
        <div
          className="w-full max-w-[380px]"
          style={{ animation: `fadeInUp 0.6s ${easing} 0.1s both` }}
        >
          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-12 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-foreground">
              <span className="text-[16px] font-semibold text-background">X</span>
            </div>
            <span className="text-[20px] font-semibold text-foreground tracking-tight">Xpress</span>
          </div>

          <h1 className="text-[28px] font-semibold text-foreground mb-2 tracking-tight">
            Create account
          </h1>
          <p className="text-[15px] text-muted-foreground mb-8">
            Get started with your loan application
          </p>

          {referrerName && (
            <div
              className="mb-6 flex items-center gap-3 rounded-xl bg-primary/8 px-4 py-3"
              style={{ animation: `fadeInUp 0.3s ${easing} both` }}
            >
              <svg className="h-4 w-4 text-primary shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
              </svg>
              <span className="text-[13px] text-primary">Referred by <strong>{referrerName}</strong></span>
            </div>
          )}

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

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input
              label="Full name"
              placeholder="John Doe"
              error={errors.full_name?.message}
              {...register('full_name', { required: 'Name is required' })}
            />
            <Input
              label="Email"
              type="email"
              placeholder="you@company.com"
              error={errors.email?.message}
              {...register('email', { required: 'Email is required' })}
            />
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1.5">
                Phone <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Input placeholder="+61 412 345 678" {...register('phone')} />
            </div>
            <Input
              label="Password"
              type="password"
              placeholder="Min 8 chars, 1 uppercase, 1 digit"
              error={errors.password?.message}
              {...register('password', { required: 'Password is required', minLength: { value: 8, message: 'Min 8 characters' } })}
            />
            <Input
              label="Confirm password"
              type="password"
              placeholder="Re-enter your password"
              error={errors.confirm_password?.message}
              {...register('confirm_password', {
                required: 'Please confirm password',
                validate: (val) => val === watch('password') || 'Passwords do not match',
              })}
            />
            <div className="pt-1">
              <Button
                type="submit"
                loading={isSubmitting}
                size="lg"
                className="w-full"
              >
                {isSubmitting ? 'Creating account...' : 'Create account'}
              </Button>
            </div>
          </form>

          <p className="mt-8 text-center text-[13px] text-muted-foreground">
            Already have an account?{' '}
            <Link
              to="/login"
              className="font-medium text-[#0071e3] hover:text-[#0071e3]/70 transition-colors duration-200"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
