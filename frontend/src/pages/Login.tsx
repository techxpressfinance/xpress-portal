import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getErrorMessage } from '../lib/utils';
import { Button, Input } from '../components/ui';

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
  const navigate = useNavigate();
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
    const target = user.role === 'client' ? '/dashboard' : '/admin';
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
      className={`mb-6 flex items-center gap-3 rounded-xl bg-[${color}]/8 px-4 py-3`}
      style={{ animation: `fadeInUp 0.3s ${easing} both` }}
    >
      {icon}
      <span className={`text-[13px] text-[${color}]`}>{message}</span>
    </div>
  );

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
            Smarter loans,{' '}
            <span className="text-[#0071e3]">faster approvals.</span>
          </h2>
          <p className="text-[15px] text-muted-foreground leading-relaxed max-w-sm">
            The modern way to manage loan applications. Upload documents, track progress, and get approved faster.
          </p>
        </div>
      </div>

      {/* Right - Form */}
      <div className="flex w-full lg:w-1/2 items-center justify-center bg-background px-6">
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
            Welcome back
          </h1>
          <p className="text-[15px] text-muted-foreground mb-8">
            {codeMode ? 'Sign in with your one-time code' : 'Sign in to your account to continue'}
          </p>

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
              className="mb-6 flex items-center gap-3 rounded-xl bg-[#ff3b30]/8 px-4 py-3"
              style={{ animation: `fadeInUp 0.3s ${easing} both` }}
            >
              <svg className="h-4 w-4 text-[#ff3b30] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
              <div>
                <span className="text-[13px] text-[#ff3b30]">{error}</span>
                {showResend && (
                  <Link
                    to="/resend-verification"
                    className="block mt-1 text-[13px] font-medium text-[#0071e3] hover:text-[#0071e3]/70 transition-colors duration-200"
                  >
                    Resend verification email
                  </Link>
                )}
              </div>
            </div>
          )}

          {!codeMode ? (
            /* Password login */
            <>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                <Input
                  label="Email"
                  type="email"
                  placeholder="you@company.com"
                  {...registerField('email', { required: true })}
                />
                <Input
                  label="Password"
                  type="password"
                  placeholder="Enter your password"
                  {...registerField('password', { required: true })}
                />
                <div className="pt-1">
                  <Button
                    type="submit"
                    loading={isSubmitting}
                    size="lg"
                    className="w-full"
                  >
                    {isSubmitting ? 'Signing in...' : 'Sign in'}
                  </Button>
                </div>
              </form>

              <button
                type="button"
                onClick={() => { setCodeMode(true); setError(''); }}
                className="mt-5 w-full text-center text-[13px] font-medium text-[#0071e3] hover:text-[#0071e3]/70 transition-colors duration-200"
              >
                Invited user? Sign in with a code
              </button>
            </>
          ) : !codeSent ? (
            /* Code mode — Step 1: request code */
            <>
              <form onSubmit={handleRequestCode} className="space-y-5">
                <Input
                  label="Email"
                  type="email"
                  name="request_email"
                  placeholder="you@company.com"
                  required
                />
                <div className="pt-1">
                  <Button
                    type="submit"
                    loading={sendingCode}
                    size="lg"
                    className="w-full"
                  >
                    {sendingCode ? 'Sending...' : 'Send login code'}
                  </Button>
                </div>
              </form>

              <button
                type="button"
                onClick={() => { setCodeMode(false); setError(''); }}
                className="mt-5 w-full text-center text-[13px] font-medium text-[#0071e3] hover:text-[#0071e3]/70 transition-colors duration-200"
              >
                Sign in with password instead
              </button>
            </>
          ) : (
            /* Code mode — Step 2: enter code */
            <>
              <div
                className="mb-6 flex items-center gap-3 rounded-xl bg-[#0071e3]/8 px-4 py-3"
                style={{ animation: `fadeInUp 0.3s ${easing} both` }}
              >
                <svg className="h-4 w-4 text-[#0071e3] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                </svg>
                <span className="text-[13px] text-[#0071e3]">Code sent to {codeEmail}. Check your inbox.</span>
              </div>

              <form onSubmit={handleCodeSubmit(onCodeSubmit)} className="space-y-5">
                <Input
                  label="Login code"
                  type="text"
                  placeholder="ABCD1234"
                  maxLength={8}
                  autoComplete="one-time-code"
                  className="text-center text-[20px] tracking-[0.3em] font-mono uppercase"
                  {...registerCode('code', { required: true, pattern: /^[A-Z0-9]{8}$/i })}
                />
                <div className="pt-1">
                  <Button
                    type="submit"
                    loading={isCodeSubmitting}
                    size="lg"
                    className="w-full"
                  >
                    {isCodeSubmitting ? 'Verifying...' : 'Verify & sign in'}
                  </Button>
                </div>
              </form>

              <button
                type="button"
                onClick={() => { setCodeSent(false); setError(''); }}
                className="mt-5 w-full text-center text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors duration-200"
              >
                Didn't receive it? Send a new code
              </button>
            </>
          )}

          <p className="mt-8 text-center text-[13px] text-muted-foreground">
            Don't have an account?{' '}
            <Link
              to="/register"
              className="font-medium text-[#0071e3] hover:text-[#0071e3]/70 transition-colors duration-200"
            >
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
