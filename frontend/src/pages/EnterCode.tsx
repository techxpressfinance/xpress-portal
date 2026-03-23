import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getErrorMessage } from '../lib/utils';
import { Button, Input } from '../components/ui';

interface CodeForm {
  code: string;
}

const easing = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';

export default function EnterCode() {
  const { loginWithCode, requestCode, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const paramEmail = searchParams.get('email') || '';
  const [error, setError] = useState('');
  const [codeSent, setCodeSent] = useState(!!paramEmail);
  const [codeEmail, setCodeEmail] = useState(paramEmail);
  const [sendingCode, setSendingCode] = useState(false);
  const [resent, setResent] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<CodeForm>();

  if (user) {
    const target = user.role === 'client' ? '/dashboard' : '/admin';
    return <Navigate to={target} replace />;
  }

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

  const handleResendCode = async () => {
    if (!codeEmail) return;
    setError('');
    setSendingCode(true);
    try {
      await requestCode(codeEmail);
      setResent(true);
      setTimeout(() => setResent(false), 3000);
    } catch {
      setError('Failed to resend code. Please try again.');
    } finally {
      setSendingCode(false);
    }
  };

  const onCodeSubmit = async (data: CodeForm) => {
    setError('');
    try {
      await loginWithCode(codeEmail, data.code);
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

          <h2 className="text-[34px] font-semibold text-foreground leading-[1.15] mb-4">
            Welcome to{' '}
            <span className="text-[#0071e3]">Xpress Tech Portal.</span>
          </h2>
          <p className="text-[15px] text-muted-foreground leading-relaxed max-w-sm">
            You've been invited to manage your loan application. Enter your code to get started.
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
            Enter your code
          </h1>
          <p className="text-[15px] text-muted-foreground mb-8">
            {codeSent
              ? `We sent a one-time code to ${codeEmail}. Enter it below to access your account.`
              : 'Enter your email to receive a login code.'}
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

          {!codeSent ? (
            /* Step 1: request code */
            <form onSubmit={handleRequestCode} className="space-y-5">
              <Input
                label="Email"
                type="email"
                name="request_email"
                placeholder="you@company.com"
                defaultValue={paramEmail}
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
          ) : (
            /* Step 2: enter code */
            <>
              <form onSubmit={handleSubmit(onCodeSubmit)} className="space-y-5">
                <Input
                  label="Login code"
                  type="text"
                  placeholder="ABCD1234"
                  maxLength={8}
                  autoComplete="one-time-code"
                  className="text-center text-[20px] tracking-[0.3em] font-mono uppercase"
                  {...register('code', { required: true, pattern: /^[A-Z0-9]{8}$/i })}
                />
                <p className="text-[12px] text-muted-foreground -mt-2">
                  This code expires in 10 minutes.
                </p>
                <div className="pt-1">
                  <Button
                    type="submit"
                    loading={isSubmitting}
                    size="lg"
                    className="w-full"
                  >
                    {isSubmitting ? 'Verifying...' : 'Verify & sign in'}
                  </Button>
                </div>
              </form>

              <button
                type="button"
                onClick={handleResendCode}
                disabled={sendingCode}
                className="mt-5 w-full text-center text-[13px] font-medium text-[#0071e3] hover:text-[#0071e3]/70 transition-colors duration-200 disabled:opacity-50"
              >
                {resent ? 'Code resent!' : sendingCode ? 'Sending...' : "Didn't receive it? Send a new code"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
