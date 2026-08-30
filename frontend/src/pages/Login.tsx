import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useTenant } from '../contexts/TenantContext';
import { useTheme } from '../hooks/useTheme';
import { Button, Input } from '../components/ui';
import { CheckCircleIcon, EnvelopeIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';

interface LoginForm {
  email: string;
  password: string;
}

const easing = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';

export default function Login() {
  const { login, user } = useAuth();
  const { tenant } = useTenant();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const brandName = tenant?.name || 'Xpress Finance';
  const defaultLogo = theme === 'dark' ? '/xpress-dark.svg' : '/xpress-light.svg';
  const [searchParams] = useSearchParams();
  const [error, setError] = useState('');
  const [showResend, setShowResend] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<LoginForm>();

  const registered = searchParams.get('registered') === 'true';
  const verified = searchParams.get('verified') === 'true';

  if (user && !window.location.search.includes('preview')) {
    const target =
      user.role === 'super_admin' ? '/platform' :
      user.role === 'client' ? '/dashboard' :
      user.role === 'referrer' ? '/referrer/applications' :
      '/admin';
    return <Navigate to={target} replace />;
  }

  const onSubmit = async (data: LoginForm) => {
    setError('');
    setShowResend(false);
    try {
      await login(data.email, data.password);
      navigate('/');
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      if (detail === 'Email not verified') {
        setError('Your email has not been verified yet.');
        setShowResend(true);
      } else if (detail === 'Account temporarily locked. Try again later.') {
        setError('Account temporarily locked due to too many failed attempts. Try again later.');
      } else if (detail === 'Account disabled') {
        setError('This account is disabled. Contact your administrator for help.');
      } else {
        setError('Invalid email or password.');
      }
    }
  };

  return (
    <div
      className="ledger-theme min-h-[100dvh] lg:grid lg:grid-cols-2"
      style={{ background: 'var(--led-bg)' }}
    >
      {/* Form column. Below lg this is the whole page. */}
      <div className="flex min-h-[100dvh] lg:min-h-0 flex-col justify-center px-5 py-10 sm:px-8 lg:px-12 xl:px-20">
        <div className="w-full max-w-[400px] mx-auto led-fade-up">
          <img
            src={tenant?.logo_url || defaultLogo}
            alt={brandName}
            className="h-24 sm:h-28 lg:h-32 w-auto max-w-[300px] object-contain object-left mb-10"
            onError={(e) => { (e.target as HTMLImageElement).src = defaultLogo; }}
          />

          <h1 className="text-[26px] sm:text-[28px] font-semibold text-foreground tracking-tight">
            Welcome back
          </h1>
          <p className="text-[15px] text-muted-foreground mt-2">
            Enter your credentials to access your account.
          </p>

          {/* Post-registration alert */}
          {registered && (
            <div
              className="mt-6 flex items-center gap-3 rounded-[10px] bg-[#0071e3]/8 px-4 py-3 w-full text-left"
              style={{ animation: `fadeInUp 0.3s ${easing} both` }}
            >
              <EnvelopeIcon className="h-4 w-4 text-[#0071e3] shrink-0" />
              <span className="text-[13px] text-[#0071e3]">Check your email to verify your account before signing in.</span>
            </div>
          )}

          {/* Email verified alert */}
          {verified && (
            <div
              className="mt-6 flex items-center gap-3 rounded-[10px] bg-[#34c759]/8 px-4 py-3 w-full text-left"
              style={{ animation: `fadeInUp 0.3s ${easing} both` }}
            >
              <CheckCircleIcon className="h-4 w-4 text-[#34c759] shrink-0" />
              <span className="text-[13px] text-[#34c759]">Email verified! You can now sign in.</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div
              className="mt-6 flex items-start gap-3 rounded-[10px] bg-destructive/10 px-4 py-3 w-full border border-destructive/20 text-left"
              style={{ animation: `fadeInUp 0.3s ${easing} both` }}
              role="alert"
            >
              <ExclamationCircleIcon className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="text-[13px] text-destructive leading-tight block">{error}</span>
                {showResend && (
                  <Link
                    to="/resend-verification"
                    className="block mt-1.5 text-[13px] font-medium text-destructive/80 hover:text-destructive transition-colors duration-200"
                  >
                    Resend verification email &rarr;
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-4 w-full">
            <Input
              label="Email Address"
              id="email"
              type="email"
              placeholder="name@example.com"
              autoComplete="email"
              error={errors.email?.message}
              {...register('email', { required: 'Email address is required' })}
            />
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label htmlFor="password" className="text-[13px] font-medium text-foreground">Password</label>
                <Link
                  to="/forgot-password"
                  className="text-[13px] text-primary hover:text-primary/70 transition-colors duration-200"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                autoComplete="current-password"
                error={errors.password?.message}
                {...register('password', { required: 'Password is required' })}
              />
            </div>
            <div className="pt-2">
              <Button
                type="submit"
                loading={isSubmitting}
                size="lg"
                className="w-full h-12 text-[15px]"
              >
                {isSubmitting ? 'Signing in...' : 'Sign In'}
              </Button>
            </div>
          </form>

          <p className="mt-8 text-[13px] text-muted-foreground font-medium">
            Don't have an account?{' '}
            <Link
              to="/register"
              className="text-primary hover:text-primary/70 transition-colors duration-200"
            >
              Create one
            </Link>
          </p>
        </div>
      </div>

      {/* Image column. Decorative, so it carries no text and no alt.
          Painted as a background rather than an <img> so browsers skip the
          download entirely at the widths where the column is not rendered. */}
      <div
        className="hidden lg:block bg-cover bg-center"
        style={{ backgroundImage: "url('/login-panel.png')", backgroundColor: '#1b9aaa' }}
      />
    </div>
  );
}
