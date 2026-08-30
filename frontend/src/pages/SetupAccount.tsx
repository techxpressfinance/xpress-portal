import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useTenant } from '../contexts/TenantContext';
import { getErrorMessage } from '../lib/utils';
import { Button, Input } from '../components/ui';
import api from '../api/client';
import { CheckIcon, ExclamationCircleIcon, LockOpenIcon } from '@heroicons/react/24/outline';

interface TokenInfo {
  valid: boolean;
  reason?: string;
  full_name?: string;
  email?: string;
  role?: string;
}

const easing = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';

const REQUIREMENTS = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One number', test: (p: string) => /[0-9]/.test(p) },
];

const ROLE_LABEL: Record<string, string> = {
  client: 'Client',
  broker: 'Broker',
  referrer: 'Referrer',
  admin: 'Admin',
};

function StrengthBar({ password }: { password: string }) {
  const met = REQUIREMENTS.filter(r => r.test(password)).length;
  if (!password) return null;

  const bars = [
    met >= 1 ? (met === 1 ? 'bg-destructive' : met === 2 ? 'bg-warning' : 'bg-success') : 'bg-border',
    met >= 2 ? (met === 2 ? 'bg-warning' : 'bg-success') : 'bg-border',
    met >= 3 ? 'bg-success' : 'bg-border',
  ];
  const label = met === 0 ? '' : met === 1 ? 'Weak' : met === 2 ? 'Fair' : 'Strong';
  const labelColor = met === 1 ? 'text-destructive' : met === 2 ? 'text-warning' : 'text-success';

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex gap-1">
        {bars.map((cls, i) => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${cls}`} />
        ))}
      </div>
      {label && <p className={`text-[11px] font-medium ${labelColor}`}>{label}</p>}
    </div>
  );
}

function PasswordInput({
  label,
  placeholder,
  value,
  onChange,
  error,
  autoComplete,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  autoComplete?: string;
}) {
  return (
    <Input
      label={label}
      type="password"
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
      autoComplete={autoComplete}
      error={error}
    />
  );
}

export default function SetupAccount() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, setupAccount } = useAuth();
  const { tenant } = useTenant();
  const token = searchParams.get('token') || '';

  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [validating, setValidating] = useState(true);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const brandName = tenant?.name || 'Xpress Finance';

  useEffect(() => {
    if (!token) {
      setTokenInfo({ valid: false, reason: 'No setup token found in this link.' });
      setValidating(false);
      return;
    }
    api.get(`/auth/validate-setup-token?token=${encodeURIComponent(token)}`)
      .then(({ data }) => setTokenInfo(data))
      .catch(() => setTokenInfo({ valid: false, reason: 'Failed to validate link. Please try again.' }))
      .finally(() => setValidating(false));
  }, [token]);

  if (user) {
    const redirect = searchParams.get('redirect');
    const target = redirect || (user.role === 'super_admin' ? '/platform' : user.role === 'client' ? '/dashboard' : user.role === 'referrer' ? '/referrer/applications' : '/admin');
    return <Navigate to={target} replace />;
  }

  const metCount = REQUIREMENTS.filter(r => r.test(password)).length;
  const passwordMet = metCount === REQUIREMENTS.length;
  const canSubmit = passwordMet && password === confirm && !done;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError('');
    setSubmitting(true);
    try {
      await setupAccount(token, password);
      setDone(true);
      // New referrers go straight to their billing details — we can't invoice them without it.
      const defaultTarget = tokenInfo?.role === 'referrer' ? '/referrer/business-details?welcome=1' : '/';
      const redirectTarget = searchParams.get('redirect') || defaultTarget;
      setTimeout(() => navigate(redirectTarget), 1200);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to set up account. The link may have expired.'));
      setSubmitting(false);
    }
  };

  return (
    <div className="ledger-theme flex min-h-[100dvh] bg-background">
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-[45%] bg-secondary relative overflow-hidden items-center justify-center">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-20%] right-[-10%] w-[70%] h-[70%] rounded-full bg-primary/10 blur-[100px]" />
          <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-info/10 blur-[80px]" />
        </div>
        <div className="relative z-10 px-16 max-w-md" style={{ animation: `fadeInUp 0.7s ${easing} both` }}>
          <div className="flex items-center gap-3 mb-14">
            {tenant?.logo_url ? (
              <img src={tenant.logo_url} alt={brandName} className="h-10 w-auto max-w-[160px] object-contain" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-foreground">
                <span className="text-[16px] font-semibold text-background">{brandName.charAt(0).toUpperCase()}</span>
              </div>
            )}
            <span className="text-[20px] font-semibold text-foreground tracking-tight">{brandName}</span>
          </div>

          <h2 className="text-[34px] font-semibold text-foreground leading-[1.15] mb-4">
            You've been{' '}
            <span className="text-primary">invited.</span>
          </h2>
          <p className="text-[15px] text-muted-foreground leading-relaxed mb-10">
            Set a password to secure your account and get instant access to {brandName}.
          </p>

          {/* Steps */}
          <div className="space-y-4">
            {[
              { n: '1', label: 'Set your password', done: passwordMet },
              { n: '2', label: 'Sign in automatically', done: done },
              // Referrers finish by telling us how to invoice and pay them.
              ...(tokenInfo?.role === 'referrer'
                ? [{ n: '3', label: 'Add your business & payment details', done: false }]
                : []),
            ].map(step => (
              <div key={step.n} className="flex items-center gap-3">
                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold transition-all duration-300 ${step.done ? 'bg-success text-white' : 'bg-secondary border border-border text-muted-foreground'}`}>
                  {step.done
                    ? <CheckIcon className="h-3.5 w-3.5" strokeWidth={3} />
                    : step.n}
                </div>
                <span className={`text-[14px] transition-colors duration-300 ${step.done ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{step.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex w-full lg:w-[55%] items-center justify-center bg-background px-6 py-10">
        <div className="w-full max-w-[400px]" style={{ animation: `fadeInUp 0.6s ${easing} 0.1s both` }}>

          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-10 lg:hidden">
            {tenant?.logo_url ? (
              <img src={tenant.logo_url} alt={brandName} className="h-9 w-auto object-contain" />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-foreground">
                <span className="text-[15px] font-semibold text-background">{brandName.charAt(0).toUpperCase()}</span>
              </div>
            )}
            <span className="text-[18px] font-semibold text-foreground tracking-tight">{brandName}</span>
          </div>

          {validating ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-primary border-t-transparent" />
              <p className="text-[14px] text-muted-foreground">Validating your invitation…</p>
            </div>
          ) : !tokenInfo?.valid ? (
            /* Invalid / expired state */
            <div style={{ animation: `fadeInUp 0.4s ${easing} both` }}>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 mb-6">
                <LockOpenIcon className="h-7 w-7 text-destructive" />
              </div>
              <h1 className="text-[26px] font-semibold text-foreground mb-2 tracking-tight">Link unavailable</h1>
              <p className="text-[15px] text-muted-foreground mb-6 leading-relaxed">
                {tokenInfo?.reason || 'This setup link is invalid or has expired.'}
              </p>
              <div className="rounded-xl bg-secondary border border-border px-4 py-3.5 text-[13px] text-muted-foreground">
                Contact your administrator to request a new invitation link.
              </div>
            </div>
          ) : done ? (
            /* Success state */
            <div className="flex flex-col items-center text-center py-8" style={{ animation: `fadeInUp 0.4s ${easing} both` }}>
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10 mb-5">
                <CheckIcon className="h-8 w-8 text-success" strokeWidth={2} />
              </div>
              <h2 className="text-[24px] font-semibold text-foreground mb-2">All set!</h2>
              <p className="text-[15px] text-muted-foreground">Signing you in…</p>
            </div>
          ) : (
            /* Form state */
            <>
              <h1 className="text-[28px] font-semibold text-foreground mb-1 tracking-tight">Set up your account</h1>
              <p className="text-[15px] text-muted-foreground mb-6">Choose a password to access your account.</p>

              {/* Context block */}
              {(tokenInfo.full_name || tokenInfo.email) && (
                <div className="flex items-center gap-3 rounded-xl bg-secondary border border-border px-4 py-3 mb-6" style={{ animation: `fadeInUp 0.3s ${easing} both` }}>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <span className="text-[13px] font-semibold text-primary">
                      {tokenInfo.full_name?.charAt(0).toUpperCase() ?? '?'}
                    </span>
                  </div>
                  <div className="min-w-0">
                    {tokenInfo.full_name && <p className="text-[14px] font-semibold text-foreground truncate">{tokenInfo.full_name}</p>}
                    {tokenInfo.email && <p className="text-[12px] text-muted-foreground truncate">{tokenInfo.email}</p>}
                  </div>
                  {tokenInfo.role && (
                    <span className="ml-auto shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                      {ROLE_LABEL[tokenInfo.role] ?? tokenInfo.role}
                    </span>
                  )}
                </div>
              )}

              {error && (
                <div className="mb-5 flex items-start gap-3 rounded-xl bg-destructive/10 px-4 py-3 border border-destructive/20" style={{ animation: `fadeInUp 0.3s ${easing} both` }}>
                  <ExclamationCircleIcon className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <span className="text-[13px] text-destructive">{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <PasswordInput
                    label="Password"
                    placeholder="Create a strong password"
                    value={password}
                    onChange={setPassword}
                    autoComplete="new-password"
                  />
                  <StrengthBar password={password} />
                  {password && (
                    <ul className="mt-2.5 space-y-1">
                      {REQUIREMENTS.map(r => {
                        const ok = r.test(password);
                        return (
                          <li key={r.label} className={`flex items-center gap-1.5 text-[12px] transition-colors duration-200 ${ok ? 'text-success' : 'text-muted-foreground'}`}>
                            <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={ok ? 3 : 1.5} stroke="currentColor">
                              {ok
                                ? <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                                : <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />}
                            </svg>
                            {r.label}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <PasswordInput
                  label="Confirm password"
                  placeholder="Re-enter your password"
                  value={confirm}
                  onChange={setConfirm}
                  autoComplete="new-password"
                  error={confirm && password !== confirm ? 'Passwords do not match' : undefined}
                />

                <div className="pt-1">
                  <Button
                    type="submit"
                    loading={submitting}
                    disabled={!canSubmit}
                    size="lg"
                    className="w-full h-12 text-[15px] rounded-2xl shadow-sm transition-transform hover:scale-[1.01] active:scale-[0.99]"
                  >
                    {submitting ? 'Setting up…' : 'Set Password & Sign In'}
                  </Button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
