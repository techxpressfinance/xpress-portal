import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { getErrorMessage } from '../lib/utils';
import { Button } from '../components/ui';

const easing = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('No verification token provided.');
      return;
    }

    api.get(`/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(({ data }) => {
        setStatus('success');
        setMessage(data.message);
      })
      .catch((err) => {
        setStatus('error');
        setMessage(getErrorMessage(err, 'Verification failed.'));
      });
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6" style={{ fontFamily: "'Outfit', sans-serif" }}>
      <div
        className="w-full max-w-[400px] text-center"
        style={{ animation: `fadeInUp 0.6s ${easing} both` }}
      >
        <div className="flex items-center justify-center gap-3 mb-10">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-foreground">
            <span className="text-[18px] font-semibold text-background">X</span>
          </div>
          <span className="text-[22px] font-semibold text-foreground tracking-tight">Xpress</span>
        </div>

        {status === 'loading' && (
          <div>
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-foreground mb-4" />
            <p className="text-[15px] text-muted-foreground">Verifying your email...</p>
          </div>
        )}

        {status === 'success' && (
          <div>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#34c759]/10">
              <svg className="h-7 w-7 text-[#34c759]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>
            <h1 className="text-[22px] font-semibold text-foreground mb-2">{message}</h1>
            <p className="text-[15px] text-muted-foreground mb-8">You can now sign in to your account.</p>
            <Link to="/login?verified=true">
              <Button size="lg" className="w-full">Go to Login</Button>
            </Link>
          </div>
        )}

        {status === 'error' && (
          <div>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#ff3b30]/10">
              <svg className="h-7 w-7 text-[#ff3b30]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
            </div>
            <h1 className="text-[22px] font-semibold text-foreground mb-2">Verification Failed</h1>
            <p className="text-[15px] text-muted-foreground mb-8">{message}</p>
            <div className="space-y-3">
              <Link to="/resend-verification">
                <Button size="lg" className="w-full">Resend Verification Email</Button>
              </Link>
              <Link to="/login" className="block text-[13px] font-medium text-[#0071e3] hover:text-[#0071e3]/70 transition-colors duration-200">
                Back to Login
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
