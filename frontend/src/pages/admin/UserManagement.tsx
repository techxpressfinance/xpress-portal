import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { getErrorMessage, formatDate } from '../../lib/utils';
import { loanTypeOptions } from '../../lib/constants';
import { Card, PageHeader, Button, InviteLinkBox, Breadcrumbs } from '../../components/ui';
import { CopyButton } from '../../components/ui/CopyButton';
import type { Invitation, LoanApplication, LoanType, PaginatedResponse } from '../../types';

const inputClass = 'w-full rounded-lg border border-border bg-secondary px-3 py-2.5 sm:py-2 text-[16px] sm:text-[14px] text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30';

export default function UserManagement() {
  const { toast } = useToast();

  // Invite new client + start application
  const [inviteForm, setInviteForm] = useState<{ full_name: string; email: string; phone: string; loan_type: LoanType; amount: string; notes: string }>({
    full_name: '', email: '', phone: '', loan_type: 'personal', amount: '', notes: '',
  });
  const [startingApp, setStartingApp] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  // Invite to complete draft
  const [draftApps, setDraftApps] = useState<LoanApplication[]>([]);
  const [selectedAppId, setSelectedAppId] = useState('');
  const [sendingComplete, setSendingComplete] = useState(false);
  const [reminderLink, setReminderLink] = useState<string | null>(null);
  const [resendLink, setResendLink] = useState<string | null>(null);
  const [loadingDrafts, setLoadingDrafts] = useState(true);

  // Personal standing invite link — exists before any client details are entered
  const [personalLink, setPersonalLink] = useState<string | null>(null);

  // Invitation history
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const perPage = 10;

  useEffect(() => {
    api.get('/applications', { params: { status: 'draft', page: 1, per_page: 100 } })
      .then(({ data }) => { const items = data.items || data; setDraftApps(Array.isArray(items) ? items : []); })
      .catch(() => { })
      .finally(() => setLoadingDrafts(false));

    api.get('/referrals/my-link')
      .then(({ data }) => setPersonalLink(`${window.location.origin}/register?ref=${data.code}`))
      .catch(() => { });
  }, [toast]);

  useEffect(() => {
    setLoadingHistory(true);
    api.get('/invitations', { params: { page: historyPage, per_page: perPage, role: 'client' } })
      .then(({ data }: { data: PaginatedResponse<Invitation> }) => {
        setInvitations(data.items);
        setHistoryTotal(data.total);
      })
      .catch(() => toast('Failed to load invitation history', 'error'))
      .finally(() => setLoadingHistory(false));
  }, [historyPage]);

  const handleStartApp = async (e: React.FormEvent) => {
    e.preventDefault();
    const [firstName, ...rest] = inviteForm.full_name.trim().split(' ');
    const lastName = rest.join(' ');
    if (!firstName || !inviteForm.email.trim() || !inviteForm.amount) return;
    setStartingApp(true);
    try {
      const { data } = await api.post('/invitations/invite-new-client', {
        first_name: firstName,
        last_name: lastName || '',
        email: inviteForm.email.trim(),
        phone: inviteForm.phone.trim() || null,
        loan_type: inviteForm.loan_type,
        amount: parseFloat(inviteForm.amount),
        notes: inviteForm.notes.trim() || null,
      });
      toast(data.detail || 'Client invited and application created', 'success');
      setInviteLink(data.invite_url || null);
      setInviteForm({ full_name: '', email: '', phone: '', loan_type: 'personal', amount: '', notes: '' });
      api.get('/applications', { params: { status: 'draft', page: 1, per_page: 100 } })
        .then(({ data: ad }) => { const items = ad.items || ad; setDraftApps(Array.isArray(items) ? items : []); })
        .catch(() => { });
      setHistoryPage(1);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to invite client'), 'error');
    } finally {
      setStartingApp(false);
    }
  };

  const handleCompleteInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAppId) return;
    setSendingComplete(true);
    try {
      const { data } = await api.post('/invitations/complete-application', { application_id: selectedAppId });
      toast(data.detail || 'Invitation sent', 'success');
      setReminderLink(data.invite_url || null);
      setSelectedAppId('');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to send invitation'), 'error');
    } finally {
      setSendingComplete(false);
    }
  };

  const handleResendInvitation = async (inv: Invitation) => {
    try {
      const { data } = await api.post('/invitations', { email: inv.email, full_name: inv.full_name, phone: inv.phone });
      toast('New code sent to ' + inv.email, 'success');
      setResendLink(data.invite_url || null);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to resend'), 'error');
    }
  };

  const totalPages = Math.ceil(historyTotal / perPage);

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Clients & Contacts', href: '/admin/contacts' }, { label: 'Invitations' }]} />
      <PageHeader title="Client Invitations" subtitle="Invite clients, send reminders, and track account setup" action={<Link to="/admin/contacts"><Button variant="secondary">Back to directory</Button></Link>} />

      {/* Invite & Onboarding */}
      <h3 className="text-[15px] font-semibold text-foreground mb-4">Invite & Onboarding</h3>
      {personalLink && (
        <div className="mb-6">
          <InviteLinkBox
            url={personalLink}
            label="Your personal invite link"
            hint="Share with anyone — no details needed up front. They sign up, fill in their own information, and appear here linked to you."
          />
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2 mb-8">
        <Card>
          <h4 className="text-[14px] font-semibold text-foreground mb-1">Invite New Client</h4>
          <p className="text-[13px] text-muted-foreground mb-4">Invite a new client and create a draft application for them to complete.</p>
          <form onSubmit={handleStartApp} className="space-y-3">
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1">Full Name *</label>
              <input required type="text" value={inviteForm.full_name} onChange={e => setInviteForm(f => ({ ...f, full_name: e.target.value }))} className={inputClass} placeholder="Jane Smith" />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1">Email *</label>
              <input required type="email" value={inviteForm.email} onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))} className={inputClass} placeholder="jane@example.com" />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1">Phone</label>
              <input type="tel" value={inviteForm.phone} onChange={e => setInviteForm(f => ({ ...f, phone: e.target.value }))} className={inputClass} placeholder="04XX XXX XXX" />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1">Loan Type *</label>
              <select required value={inviteForm.loan_type} onChange={e => setInviteForm(f => ({ ...f, loan_type: e.target.value as LoanType }))} className={inputClass}>
                {loanTypeOptions().map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1">Amount *</label>
              <input type="number" required min="1" step="any" value={inviteForm.amount} onChange={e => setInviteForm(f => ({ ...f, amount: e.target.value }))} className={inputClass} placeholder="50000" />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1">Notes</label>
              <input type="text" value={inviteForm.notes} onChange={e => setInviteForm(f => ({ ...f, notes: e.target.value }))} className={inputClass} placeholder="Optional notes" />
            </div>
            <Button type="submit" size="sm" loading={startingApp} disabled={!inviteForm.full_name.trim() || !inviteForm.email.trim() || !inviteForm.amount} className="w-full">Invite & Create Application</Button>
          </form>
          {inviteLink && <div className="mt-3"><InviteLinkBox url={inviteLink} onDismiss={() => setInviteLink(null)} /></div>}
        </Card>

        <Card>
          <h4 className="text-[14px] font-semibold text-foreground mb-1">Remind to Complete Draft</h4>
          <p className="text-[13px] text-muted-foreground mb-4">Send a reminder to a client with an existing draft application.</p>
          <form onSubmit={handleCompleteInvite} className="space-y-3">
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1">Draft Application *</label>
              {loadingDrafts ? (
                <div className="h-10 rounded-lg shimmer" />
              ) : draftApps.length === 0 ? (
                <p className="text-[13px] text-muted-foreground py-2">No draft applications found.</p>
              ) : (
                <select required value={selectedAppId} onChange={e => setSelectedAppId(e.target.value)} className={inputClass}>
                  <option value="">Select an application...</option>
                  {draftApps.map(app => (
                    <option key={app.id} value={app.id}>
                      {app.user_name || app.user_email || 'Unknown'} — {app.loan_type.charAt(0).toUpperCase() + app.loan_type.slice(1)} — ${Number(app.amount).toLocaleString('en-AU')}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <Button type="submit" size="sm" variant="secondary" loading={sendingComplete} disabled={!selectedAppId} className="w-full">Send Reminder</Button>
          </form>
          {reminderLink && <div className="mt-3"><InviteLinkBox url={reminderLink} onDismiss={() => setReminderLink(null)} /></div>}
        </Card>
      </div>

      {/* Invitation History */}
      <Card padding="none">
        <div className="px-4 sm:px-6 py-4 border-b border-border">
          <h4 className="text-[15px] font-semibold text-foreground">Invitation History</h4>
          <p className="text-[13px] text-muted-foreground">{historyTotal} invited client{historyTotal !== 1 ? 's' : ''}</p>
          {resendLink && <div className="mt-3"><InviteLinkBox url={resendLink} label="Setup link" onDismiss={() => setResendLink(null)} /></div>}
        </div>
        {loadingHistory ? (
          <div className="p-6 space-y-4">
            {[1, 2, 3].map(i => <div key={i} className="flex items-center gap-4"><div className="h-10 w-10 rounded-xl shimmer" /><div className="flex-1 space-y-2"><div className="h-4 w-32 rounded-lg shimmer" /><div className="h-3 w-48 rounded-lg shimmer" /></div></div>)}
          </div>
        ) : invitations.length === 0 ? (
          <div className="p-6 text-center text-[14px] text-muted-foreground">No invitations yet.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[14px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 sm:px-6 py-3 text-[12px] font-medium text-muted-foreground">Client</th>
                    <th className="hidden sm:table-cell px-6 py-3 text-[12px] font-medium text-muted-foreground">Invited By</th>
                    <th className="hidden md:table-cell px-6 py-3 text-[12px] font-medium text-muted-foreground">Date</th>
                    <th className="px-4 sm:px-6 py-3 text-[12px] font-medium text-muted-foreground">Status</th>
                    <th className="px-4 sm:px-6 py-3 text-[12px] font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invitations.map(inv => (
                    <tr key={inv.id} className="transition-colors hover:bg-secondary/50">
                      <td className="px-4 sm:px-6 py-3">
                        <p className="text-[14px] font-medium text-foreground">{inv.full_name}</p>
                        <p className="text-[12px] text-muted-foreground">{inv.email}</p>
                      </td>
                      <td className="hidden sm:table-cell px-6 py-3 text-[13px] text-muted-foreground">{inv.invited_by_name || '—'}</td>
                      <td className="hidden md:table-cell px-6 py-3 text-[13px] text-muted-foreground">{formatDate(inv.created_at)}</td>
                      <td className="px-4 sm:px-6 py-3">
                        {(() => {
                          let label: string;
                          let tone: string;
                          if (!inv.is_active) {
                            label = 'Disabled';
                            tone = 'bg-destructive/10 text-destructive';
                          } else if (inv.setup_pending && inv.setup_expired) {
                            label = 'Setup expired';
                            tone = 'bg-warning/10 text-warning';
                          } else if (inv.setup_pending) {
                            label = 'Pending setup';
                            tone = 'bg-info/10 text-info';
                          } else {
                            label = 'Active';
                            tone = 'bg-success/10 text-success';
                          }
                          return (
                            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium ${tone}`}>
                              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                              {label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 sm:px-6 py-3">
                        <div className="flex items-center gap-2">
                          <Button variant="secondary" size="sm" onClick={() => handleResendInvitation(inv)}>Resend</Button>
                          {inv.invite_url && <CopyButton text={inv.invite_url} size="sm" />}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-t border-border">
                <p className="text-[13px] text-muted-foreground">Page {historyPage} of {totalPages}</p>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" disabled={historyPage <= 1} onClick={() => setHistoryPage(p => p - 1)}>Previous</Button>
                  <Button variant="secondary" size="sm" disabled={historyPage >= totalPages} onClick={() => setHistoryPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

    </div>
  );
}
