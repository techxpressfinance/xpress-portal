import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { getErrorMessage, formatDate } from '../../lib/utils';
import { GlassCard, PageHeader, Button } from '../../components/ui';
import type { Invitation, LoanApplication, LoanType, PaginatedResponse, User } from '../../types';

interface InviteForm {
  full_name: string;
  email: string;
  phone: string;
}

interface StartAppForm {
  client_id: string;
  loan_type: LoanType;
  amount: string;
  notes: string;
}

const LOAN_TYPES: { value: LoanType; label: string }[] = [
  { value: 'personal', label: 'Personal' },
  { value: 'home', label: 'Home' },
  { value: 'business', label: 'Business' },
  { value: 'vehicle', label: 'Vehicle' },
];

export default function InviteClients() {
  const { toast } = useToast();

  // Section 1: Invite new client
  const [inviteForm, setInviteForm] = useState<InviteForm>({ full_name: '', email: '', phone: '' });
  const [inviting, setInviting] = useState(false);

  // Section 2: Start application for client
  const [clients, setClients] = useState<User[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [startAppForm, setStartAppForm] = useState<StartAppForm>({ client_id: '', loan_type: 'personal', amount: '', notes: '' });
  const [startingApp, setStartingApp] = useState(false);

  // Section 3: Invite to complete draft
  const [draftApps, setDraftApps] = useState<LoanApplication[]>([]);
  const [selectedAppId, setSelectedAppId] = useState('');
  const [sendingComplete, setSendingComplete] = useState(false);
  const [loadingDrafts, setLoadingDrafts] = useState(true);

  // Section 3: Invitation history
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const perPage = 10;

  useEffect(() => {
    api
      .get('/users')
      .then(({ data }) => setClients(data.filter((u: User) => u.role === 'client')))
      .catch(() => toast('Failed to load clients', 'error'))
      .finally(() => setLoadingClients(false));
  }, []);

  useEffect(() => {
    api
      .get('/applications', { params: { status: 'draft', page: 1, per_page: 100 } })
      .then(({ data }) => {
        const items = data.items || data;
        setDraftApps(Array.isArray(items) ? items : []);
      })
      .catch(() => toast('Failed to load draft applications', 'error'))
      .finally(() => setLoadingDrafts(false));
  }, []);

  useEffect(() => {
    setLoadingHistory(true);
    api
      .get('/invitations', { params: { page: historyPage, per_page: perPage } })
      .then(({ data }: { data: PaginatedResponse<Invitation> }) => {
        setInvitations(data.items);
        setHistoryTotal(data.total);
      })
      .catch(() => toast('Failed to load invitation history', 'error'))
      .finally(() => setLoadingHistory(false));
  }, [historyPage]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    try {
      await api.post('/invitations', {
        email: inviteForm.email,
        full_name: inviteForm.full_name,
        phone: inviteForm.phone || null,
      });
      toast('Invitation sent to ' + inviteForm.email, 'success');
      setInviteForm({ full_name: '', email: '', phone: '' });
      // Refresh history
      setHistoryPage(1);
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to send invitation'), 'error');
    } finally {
      setInviting(false);
    }
  };

  const handleStartApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startAppForm.client_id || !startAppForm.amount) return;
    setStartingApp(true);
    try {
      const { data } = await api.post('/invitations/start-application', {
        client_id: startAppForm.client_id,
        loan_type: startAppForm.loan_type,
        amount: parseFloat(startAppForm.amount),
        notes: startAppForm.notes || null,
      });
      toast(data.detail || 'Application created and invite sent', 'success');
      setStartAppForm({ client_id: '', loan_type: 'personal', amount: '', notes: '' });
      // Refresh draft apps list
      api.get('/applications', { params: { status: 'draft', page: 1, per_page: 100 } })
        .then(({ data }) => {
          const items = data.items || data;
          setDraftApps(Array.isArray(items) ? items : []);
        })
        .catch(() => {});
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to create application'), 'error');
    } finally {
      setStartingApp(false);
    }
  };

  const handleCompleteInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAppId) return;
    setSendingComplete(true);
    try {
      const { data } = await api.post('/invitations/complete-application', {
        application_id: selectedAppId,
      });
      toast(data.detail || 'Invitation sent', 'success');
      setSelectedAppId('');
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to send invitation'), 'error');
    } finally {
      setSendingComplete(false);
    }
  };

  const handleResend = async (invitation: Invitation) => {
    try {
      await api.post('/invitations', {
        email: invitation.email,
        full_name: invitation.full_name,
        phone: invitation.phone,
      });
      toast('New code sent to ' + invitation.email, 'success');
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to resend'), 'error');
    }
  };

  const totalPages = Math.ceil(historyTotal / perPage);

  const inputClass =
    'w-full rounded-lg border border-border bg-secondary px-3 py-2 text-[14px] text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30';

  return (
    <div>
      <PageHeader title="Invite Clients" subtitle="Invite new clients or remind existing clients to complete applications" />

      <div className="grid gap-6 lg:grid-cols-3 mb-8">
        {/* Section 1: Invite New Client */}
        <GlassCard>
          <h3 className="text-[15px] font-semibold text-foreground mb-1">Invite New Client</h3>
          <p className="text-[13px] text-muted-foreground mb-4">
            They'll receive an email with a one-time login code.
          </p>
          <form onSubmit={handleInvite} className="space-y-3">
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1">Full Name *</label>
              <input
                type="text"
                required
                value={inviteForm.full_name}
                onChange={(e) => setInviteForm((f) => ({ ...f, full_name: e.target.value }))}
                className={inputClass}
                placeholder="John Smith"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1">Email *</label>
              <input
                type="email"
                required
                value={inviteForm.email}
                onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                className={inputClass}
                placeholder="john@example.com"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1">Phone</label>
              <input
                type="tel"
                value={inviteForm.phone}
                onChange={(e) => setInviteForm((f) => ({ ...f, phone: e.target.value }))}
                className={inputClass}
                placeholder="0412 345 678"
              />
            </div>
            <Button type="submit" size="sm" loading={inviting} className="w-full">
              {inviting ? 'Sending...' : 'Send Invitation'}
            </Button>
          </form>
        </GlassCard>

        {/* Section 2: Start Application for Client */}
        <GlassCard>
          <h3 className="text-[15px] font-semibold text-foreground mb-1">Start Application for Client</h3>
          <p className="text-[13px] text-muted-foreground mb-4">
            Create a draft application and send the client a link to complete it.
          </p>
          <form onSubmit={handleStartApp} className="space-y-3">
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1">Client *</label>
              {loadingClients ? (
                <div className="h-10 rounded-lg shimmer" />
              ) : clients.length === 0 ? (
                <p className="text-[13px] text-muted-foreground py-2">No clients found. Invite one first.</p>
              ) : (
                <select
                  required
                  value={startAppForm.client_id}
                  onChange={(e) => setStartAppForm((f) => ({ ...f, client_id: e.target.value }))}
                  className={inputClass}
                >
                  <option value="">Select a client...</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name} ({c.email})
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1">Loan Type *</label>
              <select
                required
                value={startAppForm.loan_type}
                onChange={(e) => setStartAppForm((f) => ({ ...f, loan_type: e.target.value as LoanType }))}
                className={inputClass}
              >
                {LOAN_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1">Amount *</label>
              <input
                type="number"
                required
                min="1"
                step="any"
                value={startAppForm.amount}
                onChange={(e) => setStartAppForm((f) => ({ ...f, amount: e.target.value }))}
                className={inputClass}
                placeholder="50000"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1">Notes</label>
              <input
                type="text"
                value={startAppForm.notes}
                onChange={(e) => setStartAppForm((f) => ({ ...f, notes: e.target.value }))}
                className={inputClass}
                placeholder="Optional notes for the client"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              loading={startingApp}
              disabled={!startAppForm.client_id || !startAppForm.amount || startingApp}
              className="w-full"
            >
              {startingApp ? 'Creating...' : 'Create & Send Invite'}
            </Button>
          </form>
        </GlassCard>

        {/* Section 3: Invite to Complete Draft */}
        <GlassCard>
          <h3 className="text-[15px] font-semibold text-foreground mb-1">Invite to Complete Draft</h3>
          <p className="text-[13px] text-muted-foreground mb-4">
            Send a reminder email to a client with a draft application.
          </p>
          <form onSubmit={handleCompleteInvite} className="space-y-3">
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1">Draft Application *</label>
              {loadingDrafts ? (
                <div className="h-10 rounded-lg shimmer" />
              ) : draftApps.length === 0 ? (
                <p className="text-[13px] text-muted-foreground py-2">No draft applications found.</p>
              ) : (
                <select
                  required
                  value={selectedAppId}
                  onChange={(e) => setSelectedAppId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Select an application...</option>
                  {draftApps.map((app) => (
                    <option key={app.id} value={app.id}>
                      {app.user_name || app.user_email || 'Unknown'} — {app.loan_type.charAt(0).toUpperCase() + app.loan_type.slice(1)} Loan — ${Number(app.amount).toLocaleString()}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              loading={sendingComplete}
              disabled={!selectedAppId || sendingComplete}
              className="w-full"
            >
              {sendingComplete ? 'Sending...' : 'Send Reminder'}
            </Button>
          </form>
        </GlassCard>
      </div>

      {/* Section 3: Invitation History */}
      <GlassCard padding="none">
        <div className="px-4 sm:px-6 py-4 border-b border-border">
          <h3 className="text-[15px] font-semibold text-foreground">Invitation History</h3>
          <p className="text-[13px] text-muted-foreground">
            {historyTotal} invited client{historyTotal !== 1 ? 's' : ''}
          </p>
        </div>
        {loadingHistory ? (
          <div className="p-6">
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-xl shimmer" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-32 rounded-lg shimmer" />
                    <div className="h-3 w-48 rounded-lg shimmer" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : invitations.length === 0 ? (
          <div className="p-6 text-center text-[14px] text-muted-foreground">
            No invitations yet.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[14px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 sm:px-6 py-3 text-[12px] font-medium text-muted-foreground">Client</th>
                    <th className="hidden sm:table-cell px-4 sm:px-6 py-3 text-[12px] font-medium text-muted-foreground">Invited By</th>
                    <th className="hidden md:table-cell px-4 sm:px-6 py-3 text-[12px] font-medium text-muted-foreground">Date</th>
                    <th className="px-4 sm:px-6 py-3 text-[12px] font-medium text-muted-foreground">Status</th>
                    <th className="px-4 sm:px-6 py-3 text-[12px] font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invitations.map((inv) => (
                    <tr key={inv.id} className="transition-colors hover:bg-secondary/50">
                      <td className="px-4 sm:px-6 py-3">
                        <div>
                          <p className="text-[14px] font-medium text-foreground">{inv.full_name}</p>
                          <p className="text-[12px] text-muted-foreground">{inv.email}</p>
                        </div>
                      </td>
                      <td className="hidden sm:table-cell px-4 sm:px-6 py-3 text-[13px] text-muted-foreground">
                        {inv.invited_by_name || '—'}
                      </td>
                      <td className="hidden md:table-cell px-4 sm:px-6 py-3 text-[13px] text-muted-foreground">
                        {formatDate(inv.created_at)}
                      </td>
                      <td className="px-4 sm:px-6 py-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium ${inv.is_active ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${inv.is_active ? 'bg-success' : 'bg-destructive'}`} />
                          {inv.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 sm:px-6 py-3">
                        <Button variant="secondary" size="sm" onClick={() => handleResend(inv)}>
                          Resend
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-t border-border">
                <p className="text-[13px] text-muted-foreground">
                  Page {historyPage} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={historyPage <= 1}
                    onClick={() => setHistoryPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={historyPage >= totalPages}
                    onClick={() => setHistoryPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </GlassCard>
    </div>
  );
}
