import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

/** Catch-all route. Without it an unknown URL rendered an empty page. */
export default function NotFound() {
  const { user } = useAuth();
  const home =
    !user ? '/login' :
    user.role === 'super_admin' ? '/platform' :
    user.role === 'referrer' ? '/referrer/applications' :
    user.role === 'client' ? '/dashboard' :
    '/admin';

  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-6" style={{ background: 'var(--led-bg)', color: 'var(--led-ink)' }}>
      <div className="max-w-md text-center">
        <p className="text-[13px] font-medium uppercase tracking-wider" style={{ color: 'var(--led-muted)' }}>404</p>
        <h1 className="mt-2 text-[22px] font-semibold">Page not found</h1>
        <p className="mt-2 text-[15px]" style={{ color: 'var(--led-ink-2)' }}>
          The link may be out of date, or you may not have access to this page.
        </p>
        <Link
          to={home}
          className="mt-6 inline-flex items-center justify-center rounded-xl px-5 py-2.5 text-[14px] font-medium"
          style={{ background: 'var(--led-accent)', color: '#fff' }}
        >
          {user ? 'Back to your dashboard' : 'Go to sign in'}
        </Link>
      </div>
    </div>
  );
}
