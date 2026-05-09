import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useTenant } from '../contexts/TenantContext';
import { useTheme } from '../hooks/useTheme';
import { getErrorMessage } from '../lib/utils';
import { Button, Input, GlassCard } from '../components/ui';

interface LoginForm {
  email: string;
  password: string;
}

interface CodeForm {
  email: string;
  code: string;
}

const easing = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';

export default function Login() {
  const { login, loginWithCode, requestCode, user } = useAuth();
  const { tenant } = useTenant();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const brandName = tenant?.name || 'Xpress Finance';
  const defaultLogo = theme === 'dark' ? '/xpress-dark.svg' : '/xpress-light.svg';
  const [searchParams] = useSearchParams();
  const [error, setError] = useState('');
  const [showResend, setShowResend] = useState(false);
  const paramEmail = searchParams.get('email') || '';
  const [codeMode, setCodeMode] = useState(searchParams.get('method') === 'code');
  const [codeSent, setCodeSent] = useState(!!paramEmail);
  const [codeEmail, setCodeEmail] = useState(paramEmail);
  const [sendingCode, setSendingCode] = useState(false);

  const {
    register: registerField,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<LoginForm>();

  const {
    register: registerCode,
    handleSubmit: handleCodeSubmit,
    formState: { isSubmitting: isCodeSubmitting },
  } = useForm<CodeForm>();

  const registered = searchParams.get('registered') === 'true';
  const verified = searchParams.get('verified') === 'true';

  if (user) {
    const target = user.role === 'super_admin' ? '/platform' : user.role === 'client' ? '/dashboard' : '/admin';
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
      } else if (detail === 'This account uses code-based login') {
        setError('This account uses code-based login. Switching you now...');
        setTimeout(() => { setCodeMode(true); setError(''); }, 1500);
      } else {
        setError('Invalid email or password');
      }
    }
  };

  const handleRequestCode = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = form.get('request_email') as string;
    if (!email) return;
    setError('');
    setSendingCode(true);
    try {
      await requestCode(email);
      setCodeEmail(email);
      setCodeSent(true);
    } catch {
      setError('Failed to send code. Please try again.');
    } finally {
      setSendingCode(false);
    }
  };

  const onCodeSubmit = async (data: CodeForm) => {
    setError('');
    try {
      await loginWithCode(codeEmail || data.email, data.code);
      navigate('/');
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      if (detail === 'Code expired. Request a new one.') {
        setError('Code expired. Please request a new one.');
        setCodeSent(false);
      } else if (detail === 'Too many attempts. Request a new code.') {
        setError('Too many attempts. Please request a new code.');
        setCodeSent(false);
      } else {
        setError(getErrorMessage(err, 'Invalid code'));
      }
    }
  };

  const renderAlert = (message: string, color: string, icon: React.ReactNode) => (
    <div
      className={`mb-6 flex items-center gap-3 rounded-xl bg-[${color}]/8 px-4 py-3 w-full text-left`}
      style={{ animation: `fadeInUp 0.3s ${easing} both` }}
    >
      {icon}
      <span className={`text-[13px] text-[${color}]`}>{message}</span>
    </div>
  );

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden bg-background"
      style={{ fontFamily: "'Outfit', sans-serif" }}
    >
      {/* Dynamic Ambient Background */}
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
              {codeMode ? 'Enter Code' : 'Welcome back'}
            </h1>
            <p className="text-[15px] text-muted-foreground mt-2 text-center max-w-[280px]">
              {codeMode ? 'Check your email for the code to securely sign in.' : 'Enter your credentials to securely access your account.'}
            </p>
          </div>

          {registered && renderAlert(
            'Check your email to verify your account before signing in.',
            '#0071e3',
            <svg className="h-4 w-4 text-[#0071e3] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
            </svg>
          )}

          {verified && renderAlert(
            'Email verified! You can now sign in.',
            '#34c759',
            <svg className="h-4 w-4 text-[#34c759] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          )}

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

          {!codeMode ? (
            /* Password login */
            <div className="w-full">
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <Input
                    label="Email Address"
                    type="email"
                    placeholder="name@example.com"
                    className="bg-background/50 border-border/60 focus:bg-background transition-colors"
                    {...registerField('email', { required: true })}
                  />
                </div>
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-[13px] font-medium text-foreground">Password</label>
                  </div>
                  <Input
                    type="password"
                    placeholder="Enter your password"
                    className="bg-background/50 border-border/60 focus:bg-background transition-colors"
                    {...registerField('password', { required: true })}
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

              <div className="mt-6 pt-6 border-t border-border/40 text-center space-y-4">
                <button
                  type="button"
                  onClick={() => { setCodeMode(true); setError(''); }}
                  className="w-full text-center text-[13px] font-medium text-primary hover:text-primary/70 transition-colors duration-200"
                >
                  Invited user? Sign in with a code
                </button>
              </div>
            </div>
          ) : !codeSent ? (
            /* Code mode — Step 1: request code */
            <div className="w-full">
              <form onSubmit={handleRequestCode} className="space-y-4">
                <Input
                  label="Email Address"
                  type="email"
                  name="request_email"
                  placeholder="name@example.com"
                  className="bg-background/50 border-border/60 focus:bg-background transition-colors"
                  required
                />
                <div className="pt-2">
                  <Button
                    type="submit"
                    loading={sendingCode}
                    size="lg"
                    className="w-full h-12 text-[15px] rounded-2xl shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
                  >
                    {sendingCode ? 'Sending...' : 'Send Login Code'}
                  </Button>
                </div>
              </form>

              <div className="mt-6 pt-6 border-t border-border/40 text-center">
                <button
                  type="button"
                  onClick={() => { setCodeMode(false); setError(''); }}
                  className="w-full text-center text-[13px] font-medium text-primary hover:text-primary/70 transition-colors duration-200"
                >
                  Sign in with password instead
                </button>
              </div>
            </div>
          ) : (
            /* Code mode — Step 2: enter code */
            <div className="w-full">
              <div
                className="mb-6 flex items-center gap-3 rounded-xl bg-info/10 px-4 py-3 border border-info/20 text-left"
                style={{ animation: `fadeInUp 0.3s ${easing} both` }}
              >
                <svg className="h-4 w-4 text-info shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                </svg>
                <span className="text-[13px] text-info">Code sent to <span className="font-semibold">{codeEmail}</span>.</span>
              </div>

              <form onSubmit={handleCodeSubmit(onCodeSubmit)} className="space-y-4">
                <Input
                  label="Login Code"
                  type="text"
                  placeholder="ABCD1234"
                  maxLength={8}
                  autoComplete="one-time-code"
                  className="text-center text-[22px] tracking-[0.4em] font-mono uppercase bg-background/50 border-border/60 focus:bg-background transition-colors h-14"
                  {...registerCode('code', { required: true, pattern: /^[A-Z0-9]{8}$/i })}
                />
                <div className="pt-2">
                  <Button
                    type="submit"
                    loading={isCodeSubmitting}
                    size="lg"
                    className="w-full h-12 text-[15px] rounded-2xl shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
                  >
                    {isCodeSubmitting ? 'Verifying...' : 'Verify & Sign In'}
                  </Button>
                </div>
              </form>

              <div className="mt-6 pt-6 border-t border-border/40 text-center">
                <button
                  type="button"
                  onClick={() => { setCodeSent(false); setError(''); }}
                  className="w-full text-center text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors duration-200"
                >
                  Didn't receive it? Send a new code
                </button>
              </div>
            </div>
          )}

        </GlassCard>

        {/* Footer Links */}
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
