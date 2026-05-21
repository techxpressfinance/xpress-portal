import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useTenant } from '../contexts/TenantContext';
import { useTheme } from '../hooks/useTheme';
import { Button, Input, GlassCard } from '../components/ui';

const easing = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';

export default function ForgotPassword() {
  const { tenant } = useTenant();
  const { theme } = useTheme();
  const brandName = tenant?.name || 'Xpress Finance';
  const defaultLogo = theme === 'dark' ? '/xpress-dark.svg' : '/xpress-light.svg';
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSubmitted(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden bg-background"
      style={{ fontFamily: "'Outfit', sans-serif" }}
    >
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-15%] left-[-10%] w-[60%] h-[60%] rounded-full bg-primary/20 blur-[120px] opacity-50 animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-info/20 blur-[100px] opacity-40 animate-pulse" style={{ animationDuration: '10s', animationDelay: '2s' }} />
      </div>

      <div
        className="relative z-10 w-full max-w-[420px]"
        style={{ animation: `fadeInUp 0.8s ${easing} both` }}
      >
        <GlassCard padding="none" className="p-6 sm:p-10 flex flex-col shadow-2xl border-white/20 bg-card/60 backdrop-blur-3xl">
          <div className="flex flex-col items-center mb-8">
            <div className="flex items-center mb-6">
              <img
                src={tenant?.logo_url || defaultLogo}
                alt={brandName}
                className="h-16 sm:h-24 w-auto max-w-[300px] object-contain drop-shadow-sm"
                onError={(e) => { (e.target as HTMLImageElement).src = defaultLogo; }}
              />
            </div>
            <h1 className="text-[28px] font-semibold text-foreground tracking-tight text-center">
              Reset password
            </h1>
            <p className="text-[15px] text-muted-foreground mt-2 text-center max-w-[280px]">
              {submitted
                ? "If an account exists for that email, we've sent a reset link."
                : "Enter your email and we'll send you a reset link."}
            </p>
          </div>

          {error && (
            <div
              className="mb-6 flex items-start gap-3 rounded-xl bg-destructive/10 px-4 py-3 w-full border border-destructive/20 text-left"
              style={{ animation: `fadeInUp 0.3s ${easing} both` }}
            >
              <svg className="h-4 w-4 text-destructive shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
              <span className="text-[13px] text-destructive leading-tight">{error}</span>
            </div>
          )}

          {submitted ? (
            <div
              className="flex items-center gap-3 rounded-xl bg-[#34c759]/10 px-4 py-3 border border-[#34c759]/20"
              style={{ animation: `fadeInUp 0.3s ${easing} both` }}
            >
              <svg className="h-4 w-4 text-[#34c759] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
              </svg>
              <span className="text-[13px] text-[#34c759]">Check your inbox for the reset link.</span>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 w-full">
              <Input
                label="Email Address"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-background/50 border-border/60 focus:bg-background transition-colors"
                required
              />
              <div className="pt-2">
                <Button
                  type="submit"
                  loading={loading}
                  size="lg"
                  className="w-full h-12 text-[15px] rounded-2xl shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
                >
                  {loading ? 'Sending...' : 'Send Reset Link'}
                </Button>
              </div>
            </form>
          )}
        </GlassCard>

        <div
          className="mt-8 text-center"
          style={{ animation: `fadeInUp 0.8s ${easing} 0.2s both` }}
        >
          <p className="text-[13px] text-muted-foreground font-medium">
            <Link to="/login" className="text-primary hover:text-primary/70 transition-colors duration-200">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
