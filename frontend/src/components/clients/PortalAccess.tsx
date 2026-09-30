import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useConfirm } from '../../hooks/useConfirm';
import { useToast } from '../Toast';
import { Button, Card, Input, InviteLinkBox } from '../ui';
import { getErrorMessage } from '../../lib/utils';
import type { ContactDetail } from '../../types';

export default function PortalAccess({ contact, onChanged }: { contact: ContactDetail; onChanged: () => Promise<void> }) {
  const { user, impersonate } = useAuth();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [editingEmail, setEditingEmail] = useState(false);
  const [email, setEmail] = useState('');
  const account = contact.client_account;
  const admin = user?.role === 'admin';

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try { await action(); await onChanged(); toast(success, 'success'); }
    catch (error) { toast(getErrorMessage(error, 'Could not update portal access'), 'error'); }
    finally { setBusy(false); }
  };
  const invite = () => run(async () => {
    const { data } = await api.post('/invitations', {
      contact_id: contact.id, email: account?.email || contact.email,
      full_name: [contact.first_name, contact.middle_name, contact.last_name].filter(Boolean).join(' '), phone: contact.phone,
    });
    setInviteUrl(data.invite_url || null);
  }, 'Invitation sent');

  return <Card>
    <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
      <div><h3 className="text-lg font-semibold">Portal access</h3><p className="text-sm text-muted-foreground mt-1">Manage this person's login and account setup.</p></div>
      <Link className="text-sm text-primary hover:underline" to="/admin/contacts/invitations">Invitation history</Link>
    </div>
    {account ? <>
      <dl className="grid gap-4 sm:grid-cols-2 mb-5 text-sm">
        <div><dt className="text-muted-foreground">Login email</dt><dd className="font-medium break-all">{account.email}</dd></div>
        <div><dt className="text-muted-foreground">Status</dt><dd className="font-medium">{!account.is_active ? 'Inactive' : account.setup_pending ? 'Pending setup' : 'Active'}</dd></div>
      </dl>
      <div className="flex flex-wrap gap-2">
        {account.is_active && (account.setup_pending
          ? <Button size="sm" variant="secondary" disabled={busy} onClick={invite}>Resend invitation</Button>
          : <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => api.post(`/users/${account.id}/send-password-reset`), 'Password reset sent')}>Reset password</Button>)}
        {admin && account.id !== user?.id && <>
          {account.is_active && <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => impersonate(account.id), 'View-as session started')}>Login as</Button>}
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setEmail(account.email); setEditingEmail(!editingEmail); }}>Change login email</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={async () => {
            if (await confirm({ title: `${account.is_active ? 'Deactivate' : 'Activate'} portal access?`, message: 'The profile and lending history will remain available.' }))
              await run(() => api.patch(`/users/${account.id}/active`, { is_active: !account.is_active }), 'Portal access updated');
          }}>{account.is_active ? 'Deactivate' : 'Activate'}</Button>
          <Button size="sm" variant="danger" disabled={busy} onClick={async () => {
            if (await confirm({ title: 'Delete this portal account?', message: 'This removes login access. The contact profile and lending records remain available.', confirmText: 'Delete account', variant: 'danger' }))
              await run(() => api.delete(`/users/${account.id}`), 'Portal account deleted');
          }}>Delete account</Button>
        </>}
      </div>
      {editingEmail && <form className="flex flex-wrap gap-3 mt-4 items-end" onSubmit={event => {
        event.preventDefault();
        void run(async () => { await api.patch(`/users/${account.id}`, { email }); setEditingEmail(false); }, 'Login email updated');
      }}><Input label="Login email" type="email" required value={email} onChange={event => setEmail(event.target.value)} /><Button type="submit" loading={busy}>Save</Button></form>}
    </> : <>
      <p className="text-sm text-muted-foreground mb-4">No portal account. Their profile and lending history are available here without a login.</p>
      {!contact.email && <p className="text-sm mb-3">Add an email address to invite this person.</p>}
      <Button size="sm" disabled={!contact.email || busy} loading={busy} onClick={invite}>Invite to portal</Button>
    </>}
    {inviteUrl && <div className="mt-4"><InviteLinkBox url={inviteUrl} onDismiss={() => setInviteUrl(null)} /></div>}
  </Card>;
}
