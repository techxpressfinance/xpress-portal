import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../api/client';
import JourneyTracker from '../components/JourneyTracker';
import { useTenant } from '../contexts/TenantContext';
import { getErrorMessage } from '../lib/utils';
import type { TrackedDeal, TrackingPage } from '../types';
import {
  ArrowRightOnRectangleIcon,
  CheckBadgeIcon,
  DocumentTextIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  PhoneIcon,
} from '@heroicons/react/24/outline';

/**
 * The no-login progress page behind a tracking link (/track/:token).
 *
 * Two shapes from one route: a referrer's standing link lists every deal they
 * sent us; a borrower's link shows their one deal. Read-only by design — the
 * token is the only credential, so nothing here changes anything, and the page
 * shows only the loan basics and where it is up to.
 */

const money = (n: number | null) =>
  n == null ? null : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n);

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

/** Keep the page out of search indexes — the URL is a credential. */
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, []);
}

function Detail({ label, value }: { label: string; value: string | number | null }) {
  if (value == null || value === '') return null;
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="text-[14px] font-medium text-foreground break-words">{value}</dd>
    </div>
  );
}

function DealDetails({ deal }: { deal: TrackedDeal }) {
  const type = [deal.category, deal.loan_type].filter(Boolean).join(' · ');
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
      <Detail label="Loan" value={type || null} />
      <Detail label="Amount" value={money(deal.amount)} />
      <Detail label="Term" value={deal.term_months ? `${deal.term_months} months` : null} />
      <Detail label="Asset" value={deal.asset} />
      <Detail label="Business" value={deal.business_name} />
      <Detail label={deal.type === 'lead' ? 'Inquiry made' : 'Started'} value={shortDate(deal.created_at)} />
      <Detail label="Reference" value={deal.reference} />
    </dl>
  );
}

function OutstandingDocuments({ items, forClient }: { items: string[]; forClient: boolean }) {
  if (!items.length) return null;
  return (
    <div className="rounded-xl border border-border px-4 py-3">
      <p className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
        <DocumentTextIcon className="h-4 w-4 text-muted-foreground" strokeWidth={2} />
        {forClient ? 'What we still need from you' : 'Documents we are still waiting on'}
      </p>
      <ul className="mt-2 space-y-1 pl-6 text-[13px] text-muted-foreground list-disc">
        {items.map((d, i) => <li key={i}>{d}</li>)}
      </ul>
    </div>
  );
}

function DealCard({ deal, audience }: { deal: TrackedDeal; audience: 'referrer' | 'client' }) {
  const heading = audience === 'referrer' ? (deal.client_name || deal.business_name || 'Your client') : null;
  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-5">
      {heading && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[17px] font-semibold text-foreground">{heading}</h2>
          {deal.settled && (
            <span className="inline-flex items-center gap-1 text-[12px] font-medium text-success">
              <CheckBadgeIcon className="h-4 w-4" strokeWidth={2} /> Settled
            </span>
          )}
        </div>
      )}
      <JourneyTracker journey={deal.journey} audience={audience} />
      <OutstandingDocuments items={deal.outstanding_documents} forClient={audience === 'client'} />
      <DealDetails deal={deal} />
    </section>
  );
}

/**
 * The way from the progress page into the portal. This page's link is a bearer
 * credential that gets forwarded, so it never logs anyone in: the button only
 * asks for a setup/reset link to be emailed to the referrer's own inbox, and
 * all that comes back is the masked address it went to.
 */
function PortalLogin({ token, hasLogin }: { token: string; hasLogin: boolean }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const request = async () => {
    setState('sending');
    setError(null);
    try {
      const { data } = await api.post<{ sent_to: string }>(`/public/track/${encodeURIComponent(token)}/login-link`);
      setSentTo(data.sent_to);
      setState('sent');
    } catch (err) {
      setError(getErrorMessage(err, "We couldn't send that just now. Please try again later."));
      setState('idle');
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <p className="flex items-center gap-2 text-[15px] font-semibold">
        <ArrowRightOnRectangleIcon className="h-5 w-5 text-muted-foreground" strokeWidth={2} />
        {hasLogin ? 'Log in to your portal' : 'Set up your portal login'}
      </p>
      <p className="mt-1 text-[14px] text-muted-foreground">
        {hasLogin
          ? 'Refer new clients, upload documents and manage your business and payment details.'
          : "You haven't set a password yet. We'll email you a link to set one up — then you can refer clients and manage your payment details."}
      </p>
      {state === 'sent' ? (
        <p className="mt-3 text-[14px] text-foreground">
          Sent to <strong>{sentTo}</strong>. Check your inbox — the link {hasLogin ? 'expires in 1 hour' : 'expires in 48 hours'}.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {hasLogin && (
            <Link to="/login" className="led-btn led-btn-primary led-btn-sm">Log in</Link>
          )}
          <button
            type="button"
            onClick={request}
            disabled={state === 'sending'}
            className={`led-btn ${hasLogin ? 'led-btn-ghost' : 'led-btn-primary'} led-btn-sm`}
          >
            {state === 'sending' ? 'Sending…' : hasLogin ? 'Forgot your password? Email me a reset link' : 'Email me a setup link'}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-[13px] text-destructive">{error}</p>}
    </section>
  );
}

export default function TrackProgress() {
  const { token } = useParams<{ token: string }>();
  const { tenant } = useTenant();
  const [page, setPage] = useState<TrackingPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  useNoIndex();

  useEffect(() => {
    if (!token) return;
    api.get<TrackingPage>(`/public/track/${encodeURIComponent(token)}`)
      .then(({ data }) => setPage(data))
      .catch((err) => setError(getErrorMessage(err, 'This link is no longer active. Please contact us for a new one.')));
  }, [token]);

  const brand = tenant?.name || 'Xpress Finance';

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          {tenant?.logo_url
            ? <img src={tenant.logo_url} alt={brand} className="h-8 w-auto" />
            : <span className="text-[16px] font-bold tracking-tight">{brand}</span>}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 space-y-6">
        {!page && !error && (
          <div className="space-y-4">
            <div className="h-8 w-2/3 rounded-lg shimmer" />
            <div className="h-48 rounded-2xl shimmer" />
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <ExclamationTriangleIcon className="h-6 w-6 text-destructive" strokeWidth={2} />
            </div>
            <h1 className="text-[18px] font-semibold">Link not available</h1>
            <p className="mt-1 text-[14px] text-muted-foreground">{error}</p>
            {tenant?.support_email && (
              <a href={`mailto:${tenant.support_email}`} className="mt-4 inline-block text-[14px] font-medium text-primary">
                {tenant.support_email}
              </a>
            )}
          </div>
        )}

        {page?.kind === 'referrer' && (
          <>
            <div>
              <h1 className="text-[22px] font-semibold tracking-tight">Hi {page.referrer.name.split(' ')[0]},</h1>
              <p className="mt-1 text-[14px] text-muted-foreground">
                Here is where each client you have referred{page.referrer.organization_name ? ` through ${page.referrer.organization_name}` : ''} is up to.
                This page updates as their files move — bookmark it.
              </p>
            </div>
            {page.deals.length === 0 ? (
              <div className="rounded-2xl border border-border bg-card p-8 text-center text-[14px] text-muted-foreground">
                No referrals to show yet. They will appear here as soon as we receive them.
              </div>
            ) : (
              page.deals.map((deal) => <DealCard key={`${deal.type}-${deal.reference}`} deal={deal} audience="referrer" />)
            )}
            {token && <PortalLogin token={token} hasLogin={page.referrer.has_login} />}
          </>
        )}

        {page?.kind === 'deal' && (
          <>
            <div>
              <h1 className="text-[22px] font-semibold tracking-tight">
                {page.first_name ? `Hi ${page.first_name},` : 'Your loan'}
              </h1>
              <p className="mt-1 text-[14px] text-muted-foreground">
                Here is where your {page.deal.type === 'lead' ? 'loan inquiry' : 'loan application'} is up to. This page updates as it moves.
              </p>
            </div>
            <DealCard deal={page.deal} audience="client" />
            {page.broker && (
              <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
                <p className="text-[12px] text-muted-foreground">Your broker</p>
                <p className="text-[16px] font-semibold">{page.broker.name}</p>
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[14px]">
                  {page.broker.phone && (
                    <a href={`tel:${page.broker.phone}`} className="inline-flex items-center gap-2 text-primary">
                      <PhoneIcon className="h-4 w-4" strokeWidth={2} /> {page.broker.phone}
                    </a>
                  )}
                  {page.broker.email && (
                    <a href={`mailto:${page.broker.email}`} className="inline-flex min-w-0 items-center gap-2 text-primary break-all">
                      <EnvelopeIcon className="h-4 w-4 shrink-0" strokeWidth={2} /> {page.broker.email}
                    </a>
                  )}
                </div>
              </section>
            )}
          </>
        )}

        {page && (
          <p className="text-center text-[12px] text-muted-foreground">
            This link is personal to you — please don't share it.
          </p>
        )}
      </main>
    </div>
  );
}
