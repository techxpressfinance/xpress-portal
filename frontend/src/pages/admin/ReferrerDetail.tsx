import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useConfirm } from '../../hooks/useConfirm';
import { useToast } from '../../components/Toast';
import BusinessDetailsForm from '../../components/referrer/BusinessDetailsForm';
import ProgressLink from '../../components/ProgressLink';
import { Badge, Breadcrumbs, Button, Card, Input, StatCard } from '../../components/ui';
import { applicantDisplayName } from '../../lib/applicantName';
import { LOAN_TYPE_LABELS } from '../../lib/constants';
import { formatDate, formatDateTime, getErrorMessage, getInitials } from '../../lib/utils';
import type { ReferrerDetail as ReferrerDetailData } from '../../types';
import {
  BuildingOffice2Icon,
  CheckCircleIcon,
  DocumentTextIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';

const REFERRAL_STATUS_LABEL: Record<string, string> = {
  pending: 'Invited',
  signed_up: 'Signed up',
  applied: 'Applied',
  expired: 'Expired',
};

const ENGAGEMENT_LABEL: Record<string, string> = {
  self_managed: 'Self-managed',
  direct_engagement: 'Direct engagement',
};

/** ABN as 11 222 333 444. */
const formatAbn = (v: string | null) => {
  if (!v) return null;
  const d = v.replace(/\D/g, '');
  if (d.length !== 11) return v;
  return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
};

const formatMoney = (n: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n);

/** One label/value row. `value` null renders the em-dash placeholder. */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-[14px] text-foreground break-words">{value || '—'}</p>
    </div>
  );
}

/**
 * Everything we hold on one referrer, for admins and brokers.
 *
 * The business and payment details here are the same ones the referrer fills in
 * on their own Business Details page — an admin edits them through the shared
 * form, a broker reads them (minus the bank account, which the API only serves
 * to admins and to the referrer themselves).
 */
export default function ReferrerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { user: currentUser, impersonate } = useAuth();
  const isAdmin = currentUser?.role === 'admin';

  const [referrer, setReferrer] = useState<ReferrerDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<'impersonate' | 'active' | 'delete' | null>(null);

  // Account edit — the same three fields the list's Edit modal writes.
  const [editingAccount, setEditingAccount] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountDraft, setAccountDraft] = useState({ full_name: '', phone: '', organization_name: '' });

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    api.get<ReferrerDetailData>(`/external-referrers/${id}/detail`)
      .then(({ data }) => setReferrer(data))
      .catch(err => {
        setNotFound(true);
        toast(getErrorMessage(err, 'Failed to load referrer'), 'error');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const startEditAccount = () => {
    if (!referrer) return;
    setAccountDraft({
      full_name: referrer.full_name,
      phone: referrer.phone ?? '',
      organization_name: referrer.organization_name ?? '',
    });
    setEditingAccount(true);
  };

  const handleSaveAccount = async () => {
    if (!referrer || !accountDraft.full_name.trim()) return;
    setSavingAccount(true);
    try {
      await api.patch(`/users/${referrer.id}`, {
        full_name: accountDraft.full_name.trim(),
        phone: accountDraft.phone.trim() || null,
        organization_name: accountDraft.organization_name.trim() || null,
      });
      setReferrer(prev => prev && {
        ...prev,
        full_name: accountDraft.full_name.trim(),
        phone: accountDraft.phone.trim() || null,
        organization_name: accountDraft.organization_name.trim() || null,
      });
      setEditingAccount(false);
      toast('Referrer updated', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to update referrer'), 'error');
    } finally {
      setSavingAccount(false);
    }
  };

  const handleImpersonate = async () => {
    if (!id) return;
    setBusy('impersonate');
    try {
      await impersonate(id);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to start view-as session'), 'error');
      setBusy(null);
    }
  };

  const handleToggleActive = async () => {
    if (!referrer) return;
    const next = !referrer.is_active;
    const ok = await confirm({
      title: `${next ? 'Activate' : 'Deactivate'} ${referrer.full_name}?`,
      message: next ? undefined : 'They will no longer be able to log in.',
      variant: next ? 'primary' : 'danger',
    });
    if (!ok) return;
    setBusy('active');
    try {
      await api.patch(`/users/${referrer.id}/active`, { is_active: next });
      setReferrer(prev => prev && { ...prev, is_active: next });
      toast(`Referrer ${next ? 'activated' : 'deactivated'}`, 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Action failed'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (!referrer) return;
    const ok = await confirm({
      title: `Permanently delete ${referrer.full_name}?`,
      message: 'This cannot be undone.',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy('delete');
    try {
      await api.delete(`/users/${referrer.id}`);
      toast('Referrer deleted', 'success');
      navigate('/admin/referrers');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to delete referrer'), 'error');
      setBusy(null);
    }
  };

  const handleViewAsset = async (asset: 'logo' | 'letterhead') => {
    try {
      const { data } = await api.get(`/external-referrers/${id}/business-profile/${asset}/file`, { responseType: 'blob' });
      const url = URL.createObjectURL(data as Blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to open file'), 'error');
    }
  };

  if (loading) {
    return (
      <div>
        <Breadcrumbs items={[{ label: 'Referrers', href: '/admin/referrers' }, { label: 'Loading…' }]} />
        <Card className="mb-5"><div className="h-20 rounded-lg shimmer" /></Card>
        <div className="space-y-5">{[1, 2, 3].map(i => <Card key={i}><div className="h-32 rounded-lg shimmer" /></Card>)}</div>
      </div>
    );
  }

  if (notFound || !referrer) {
    return (
      <div>
        <Breadcrumbs items={[{ label: 'Referrers', href: '/admin/referrers' }, { label: 'Not found' }]} />
        <Card><p className="text-[14px] text-muted-foreground">This referrer could not be loaded.</p></Card>
      </div>
    );
  }

  const gst = referrer.business_gst_registered;

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Referrers', href: '/admin/referrers' }, { label: referrer.full_name }]} />

      {/* Identity + actions */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-chart-4/10">
              <span className="text-[14px] font-semibold text-chart-4">{getInitials(referrer.full_name)}</span>
            </div>
            <div className="min-w-0">
              <h2 className="text-[19px] font-semibold text-foreground truncate">{referrer.full_name}</h2>
              <p className="text-[13px] text-muted-foreground truncate">
                {referrer.email}{referrer.organization_name ? ` · ${referrer.organization_name}` : ''}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge
                  type="custom"
                  value=""
                  label={referrer.is_active ? 'Active' : 'Inactive'}
                  className={referrer.is_active ? 'led-chip-success' : 'led-chip-danger'}
                />
                <Badge
                  type="custom"
                  value=""
                  label={referrer.is_complete ? 'Ready to invoice' : 'Business details incomplete'}
                  className={referrer.is_complete ? 'led-chip-success' : 'led-chip-warning'}
                />
                {referrer.login_state === 'setup_pending' && (
                  <Badge type="custom" value="" label="Login not set up" className="led-chip-warning" />
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {isAdmin && referrer.is_active && (
              <Button size="sm" variant="secondary" loading={busy === 'impersonate'} onClick={handleImpersonate}>Login as</Button>
            )}
            {isAdmin && (
              <>
                <Button size="sm" variant={referrer.is_active ? 'danger' : 'success'} loading={busy === 'active'} onClick={handleToggleActive}>
                  {referrer.is_active ? 'Deactivate' : 'Activate'}
                </Button>
                <Button size="sm" variant="danger" loading={busy === 'delete'} onClick={handleDelete}>Delete</Button>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* One way in, whatever they rang about: the access email carries their
          standing progress link AND a portal login link — setup until they
          have a password, a reset after. Replaces the separate reset button. */}
      {referrer.is_active && (
        <Card className="mb-6">
          <h3 className="text-[15px] font-semibold text-foreground">Access</h3>
          <p className="text-[13px] text-muted-foreground mb-3">
            The progress link shows {referrer.full_name.split(' ')[0]} every deal they've referred, no login needed — it stays
            the same and goes out with their stage-update emails. The access email sends it together with{' '}
            {referrer.login_state === 'setup_pending'
              ? <>a link to <strong>set up their portal login</strong> (they haven't yet; valid 7 days).</>
              : <>a <strong>password reset</strong> link for the portal (valid 24 hours).</>}
          </p>
          <ProgressLink base={`/tracking-links/referrers/${referrer.id}`} emailVerb="Email access link to" />
        </Card>
      )}

      {/* Referral activity at a glance */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <StatCard label="Clients referred" value={referrer.stats.total_referred} gradient="from-chart-4 to-chart-4" icon={<UserGroupIcon className="h-5 w-5" />} />
        <StatCard label="Signed up" value={referrer.stats.signed_up} gradient="from-success to-success" valueColor="text-success" icon={<CheckCircleIcon className="h-5 w-5" />} />
        <StatCard label="Applied" value={referrer.stats.applied} gradient="from-chart-2 to-chart-2" icon={<BuildingOffice2Icon className="h-5 w-5" />} />
        <StatCard label="Applications" value={referrer.stats.applications} gradient="from-chart-1 to-chart-1" icon={<DocumentTextIcon className="h-5 w-5" />} />
      </div>

      {/* Account */}
      <Card className="mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <h3 className="text-[15px] font-semibold text-foreground">Account</h3>
          {isAdmin && !editingAccount && (
            <Button size="sm" variant="secondary" onClick={startEditAccount}>Edit</Button>
          )}
        </div>
        {editingAccount ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Input label="Full name *" value={accountDraft.full_name} onChange={e => setAccountDraft(d => ({ ...d, full_name: e.target.value }))} />
              <Input label="Phone" type="tel" placeholder="+61 400 000 000" value={accountDraft.phone} onChange={e => setAccountDraft(d => ({ ...d, phone: e.target.value }))} />
              <Input label="Organization" value={accountDraft.organization_name} onChange={e => setAccountDraft(d => ({ ...d, organization_name: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setEditingAccount(false)} disabled={savingAccount}>Cancel</Button>
              <Button size="sm" loading={savingAccount} onClick={handleSaveAccount}>Save</Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Full name" value={referrer.full_name} />
            <Field label="Email" value={referrer.email} />
            <Field label="Phone" value={referrer.phone} />
            <Field label="Organization" value={referrer.organization_name} />
            <Field label="Joined" value={referrer.created_at ? formatDate(referrer.created_at) : null} />
            <Field label="Invited by" value={referrer.invited_by_name} />
          </div>
        )}
      </Card>

      {/*
        Business & payment details. Admins get the same editable form the
        referrer uses, so anything they enter here and anything the referrer
        entered themselves are one and the same record.
      */}
      {isAdmin ? (
        <div className="mb-6">
          <div className="mb-3">
            <h3 className="text-[15px] font-semibold text-foreground">Business &amp; payment details</h3>
            <p className="text-[13px] text-muted-foreground">
              As entered by the referrer. Editing here updates their record.
              {referrer.business_details_updated_at && ` Last updated ${formatDateTime(referrer.business_details_updated_at)}.`}
            </p>
          </div>
          <BusinessDetailsForm
            basePath={`/external-referrers/${referrer.id}`}
            contactNote="Email and phone are edited from the referrer's account above."
            onSaved={updated => setReferrer(prev => prev && { ...prev, ...updated })}
          />
        </div>
      ) : (
        <Card className="mb-6">
          <h3 className="text-[15px] font-semibold text-foreground mb-1">Business &amp; payment details</h3>
          <p className="text-[13px] text-muted-foreground mb-4">
            As entered by the referrer.
            {referrer.business_details_updated_at && ` Last updated ${formatDateTime(referrer.business_details_updated_at)}.`}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Business ABN" value={formatAbn(referrer.business_abn)} />
            <Field label="Registered for GST" value={gst == null ? null : gst ? 'Yes' : 'No'} />
            <Field label="Director's name" value={referrer.business_director_name} />
            <Field label="Business address" value={referrer.business_address} />
          </div>
          <div className="mt-4 rounded-xl border border-border bg-secondary/50 px-4 py-3 text-[13px] text-muted-foreground">
            Bank account details are visible to portal administrators only.
          </div>
        </Card>
      )}

      {/* Branding — admins already see these inside the form above. */}
      {!isAdmin && (
        <Card className="mb-6">
          <h3 className="text-[15px] font-semibold text-foreground mb-4">Branding</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {(['logo', 'letterhead'] as const).map(asset => {
              const filename = asset === 'logo' ? referrer.business_logo_filename : referrer.business_letterhead_filename;
              return (
                <div key={asset}>
                  <p className="text-[12px] font-medium text-muted-foreground mb-1.5">
                    {asset === 'logo' ? 'Business logo' : 'Business letterhead'}
                  </p>
                  {filename ? (
                    <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/50 px-4 py-2.5">
                      <span className="flex-1 truncate text-[13px] text-foreground">{filename}</span>
                      <Button variant="secondary" size="sm" onClick={() => handleViewAsset(asset)}>View</Button>
                    </div>
                  ) : (
                    <p className="text-[14px] text-muted-foreground">Not provided</p>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Clients they referred */}
      <Card padding="none" className="mb-6">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-[15px] font-semibold text-foreground">Referred clients</h3>
          <p className="text-[13px] text-muted-foreground">{referrer.referrals.length} referral{referrer.referrals.length !== 1 ? 's' : ''}</p>
        </div>
        {referrer.referrals.length === 0 ? (
          <div className="p-8 text-center text-[14px] text-muted-foreground">No referrals yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[14px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-6 py-3 text-[12px] font-medium text-muted-foreground">Client</th>
                  <th className="hidden sm:table-cell px-6 py-3 text-[12px] font-medium text-muted-foreground">Engagement</th>
                  <th className="px-6 py-3 text-[12px] font-medium text-muted-foreground">Status</th>
                  <th className="hidden md:table-cell px-6 py-3 text-[12px] font-medium text-muted-foreground">Referred</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {referrer.referrals.map(ref => (
                  <tr key={ref.id} className="transition-colors hover:bg-secondary/50">
                    <td className="px-6 py-3">
                      <p className="font-medium text-foreground">{ref.referred_client_name || '—'}</p>
                      <p className="text-[12px] text-muted-foreground">{ref.referred_email}</p>
                    </td>
                    <td className="hidden sm:table-cell px-6 py-3 text-[13px] text-muted-foreground">
                      {ref.client_engagement_model ? ENGAGEMENT_LABEL[ref.client_engagement_model] ?? ref.client_engagement_model : '—'}
                    </td>
                    <td className="px-6 py-3">
                      <Badge type="custom" value="" label={REFERRAL_STATUS_LABEL[ref.status] ?? ref.status} className="led-chip-info" />
                    </td>
                    <td className="hidden md:table-cell px-6 py-3 text-[13px] text-muted-foreground">{formatDate(ref.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Applications that came through them */}
      <Card padding="none">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-[15px] font-semibold text-foreground">Applications</h3>
          <p className="text-[13px] text-muted-foreground">
            {referrer.applications.length} application{referrer.applications.length !== 1 ? 's' : ''} from their referred clients and direct leads
          </p>
        </div>
        {referrer.applications.length === 0 ? (
          <div className="p-8 text-center text-[14px] text-muted-foreground">No applications yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[14px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-6 py-3 text-[12px] font-medium text-muted-foreground">Applicant</th>
                  <th className="hidden sm:table-cell px-6 py-3 text-[12px] font-medium text-muted-foreground">Type</th>
                  <th className="hidden sm:table-cell px-6 py-3 text-[12px] font-medium text-muted-foreground">Amount</th>
                  <th className="px-6 py-3 text-[12px] font-medium text-muted-foreground">Status</th>
                  <th className="hidden md:table-cell px-6 py-3 text-[12px] font-medium text-muted-foreground">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {referrer.applications.map(app => (
                  <tr key={app.id} className="transition-colors hover:bg-secondary/50">
                    <td className="px-6 py-3">
                      <Link to={`/admin/applications/${app.id}`} className="font-medium text-foreground hover:underline">
                        {applicantDisplayName(app, 'Unnamed applicant')}
                      </Link>
                    </td>
                    <td className="hidden sm:table-cell px-6 py-3 text-[13px] text-muted-foreground">
                      {LOAN_TYPE_LABELS[app.loan_type] ?? app.loan_type}
                    </td>
                    <td className="hidden sm:table-cell px-6 py-3 text-[13px] text-muted-foreground">
                      {app.amount ? formatMoney(Number(app.amount)) : '—'}
                    </td>
                    <td className="px-6 py-3"><Badge value={app.status} /></td>
                    <td className="hidden md:table-cell px-6 py-3 text-[13px] text-muted-foreground">{formatDate(app.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
