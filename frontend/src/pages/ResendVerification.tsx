import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { Button, Input } from '../components/ui';

interface ResendForm {
  email: string;
}

const easing = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';

export default function ResendVerification() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<ResendForm>();

  const onSubmit = async (data: ResendForm) => {
    setError('');
    try {
      await api.post('/auth/resend-verification', { email: data.email });
      setSent(true);
    } catch {
      setError('Something went wrong. Please try again.');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6" style={{ fontFamily: "'Outfit', sans-serif" }}>
      <div
        className="w-full max-w-[380px]"
        style={{ animation: `fadeInUp 0.6s ${easing} both` }}
      >
        <div className="flex items-center gap-3 mb-10">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-foreground">
            <span className="text-[18px] font-semibold text-background">X</span>
          </div>
          <span className="text-[22px] font-semibold text-foreground tracking-tight">Xpress</span>
        </div>

        {sent ? (
          <div style={{ animation: `fadeInUp 0.3s ${easing} both` }}>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#34c759]/10">
              <svg className="h-7 w-7 text-[#34c759]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
              </svg>
            </div>
            <h1 className="text-[22px] font-semibold text-foreground mb-2 text-center">Check your email</h1>
            <p className="text-[15px] text-muted-foreground mb-8 text-center">
              If an account exists with that email, we've sent a new verification link.
            </p>
            <Link to="/login" className="block text-center text-[13px] font-medium text-[#0071e3] hover:text-[#0071e3]/70 transition-colors duration-200">
              Back to Login
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-[28px] font-semibold text-foreground mb-2 tracking-tight">
              Resend verification
            </h1>
            <p className="text-[15px] text-muted-foreground mb-8">
              Enter your email and we'll send a new verification link.
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
                placeholder="you@company.com"
                {...register('email', { required: true })}
              />
              <div className="pt-1">
                <Button
                  type="submit"
                  loading={isSubmitting}
                  size="lg"
                  className="w-full"
                >
                  {isSubmitting ? 'Sending...' : 'Send verification link'}
                </Button>
              </div>
            </form>

            <p className="mt-8 text-center text-[13px] text-muted-foreground">
              <Link
                to="/login"
                className="font-medium text-[#0071e3] hover:text-[#0071e3]/70 transition-colors duration-200"
              >
                Back to Login
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
