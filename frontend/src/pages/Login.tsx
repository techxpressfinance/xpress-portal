import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useTenant } from '../contexts/TenantContext';
import { useTheme } from '../hooks/useTheme';
import { Button, Input, GlassCard } from '../components/ui';

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
    formState: { isSubmitting },
  } = useForm<LoginForm>();

  const registered = searchParams.get('registered') === 'true';
  const verified = searchParams.get('verified') === 'true';

  if (user) {
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
      } else {
        setError('Invalid email or password.');
      }
    }
  };

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden bg-background"
      style={{ fontFamily: "'Outfit', sans-serif" }}
    >
      {/* Ambient background */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-15%] left-[-10%] w-[60%] h-[60%] rounded-full bg-primary/20 blur-[120px] opacity-50 animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-info/20 blur-[100px] opacity-40 animate-pulse" style={{ animationDuration: '10s', animationDelay: '2s' }} />
        <div className="absolute top-[20%] right-[10%] w-[40%] h-[40%] rounded-full bg-accent/10 blur-[100px] opacity-30 animate-pulse" style={{ animationDuration: '12s', animationDelay: '4s' }} />
      </div>

      <div
        className="relative z-10 w-full max-w-[420px]"
        style={{ animation: `fadeInUp 0.8s ${easing} both` }}
      >
        <GlassCard padding="none" className="p-8 sm:p-10 flex flex-col shadow-2xl border-white/20 bg-card/60 backdrop-blur-3xl">

          {/* Logo + heading */}
          <div className="flex flex-col items-center mb-8">
            <div className="flex items-center mb-6">
              <img
                src={tenant?.logo_url || defaultLogo}
                alt={brandName}
                className="h-24 w-auto max-w-[300px] object-contain drop-shadow-sm"
                onError={(e) => { (e.target as HTMLImageElement).src = defaultLogo; }}
              />
            </div>
            <h1 className="text-[28px] font-semibold text-foreground tracking-tight text-center">
              Welcome back
            </h1>
            <p className="text-[15px] text-muted-foreground mt-2 text-center max-w-[280px]">
              Enter your credentials to access your account.
            </p>
          </div>

          {/* Post-registration alert */}
          {registered && (
            <div
              className="mb-6 flex items-center gap-3 rounded-xl bg-[#0071e3]/8 px-4 py-3 w-full text-left"
              style={{ animation: `fadeInUp 0.3s ${easing} both` }}
            >
              <svg className="h-4 w-4 text-[#0071e3] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
              </svg>
              <span className="text-[13px] text-[#0071e3]">Check your email to verify your account before signing in.</span>
            </div>
          )}

          {/* Email verified alert */}
          {verified && (
            <div
              className="mb-6 flex items-center gap-3 rounded-xl bg-[#34c759]/8 px-4 py-3 w-full text-left"
              style={{ animation: `fadeInUp 0.3s ${easing} both` }}
            >
              <svg className="h-4 w-4 text-[#34c759] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              <span className="text-[13px] text-[#34c759]">Email verified! You can now sign in.</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div
              className="mb-6 flex items-start gap-3 rounded-xl bg-destructive/10 px-4 py-3 w-full border border-destructive/20 text-left"
              style={{ animation: `fadeInUp 0.3s ${easing} both` }}
            >
              <svg className="h-4 w-4 text-destructive shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
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
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 w-full">
            <Input
              label="Email Address"
              type="email"
              placeholder="name@example.com"
              autoComplete="email"
              className="bg-background/50 border-border/60 focus:bg-background transition-colors"
              {...register('email', { required: true })}
            />
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-[13px] font-medium text-foreground">Password</label>
                <Link
                  to="/forgot-password"
                  className="text-[13px] text-primary hover:text-primary/70 transition-colors duration-200"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                type="password"
                placeholder="Enter your password"
                autoComplete="current-password"
                className="bg-background/50 border-border/60 focus:bg-background transition-colors"
                {...register('password', { required: true })}
              />
            </div>
            <div className="pt-2">
              <Button
                type="submit"
                loading={isSubmitting}
                size="lg"
                className="w-full h-12 text-[15px] rounded-2xl shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
              >
                {isSubmitting ? 'Signing in...' : 'Sign In'}
              </Button>
            </div>
          </form>

        </GlassCard>

        {/* Footer */}
        <div
          className="mt-8 text-center space-y-3"
          style={{ animation: `fadeInUp 0.8s ${easing} 0.2s both` }}
        >
          <p className="text-[13px] text-muted-foreground font-medium">
            Don't have an account?{' '}
            <Link
              to="/register"
              className="text-primary hover:text-primary/70 transition-colors duration-200"
            >
              Create one
            </Link>
          </p>
          <p className="text-[12px] text-muted-foreground/60 font-medium">
            <Link
              to="/platform-login"
              className="hover:text-muted-foreground transition-colors duration-200"
            >
              Platform Admin
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
