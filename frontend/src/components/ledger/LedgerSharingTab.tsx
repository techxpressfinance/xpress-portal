import { useCallback, useEffect, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../Toast';
import { useConfirm } from '../../hooks/useConfirm';
import { Badge, Button, Card, Input } from '../ui';
import { formatDateTime, getErrorMessage } from '../../lib/utils';
import type { LedgerAuditEntry, LedgerGrant, LedgerScope, LedgerSettings, LedgerTeamMember, LedgerVbTier } from '../../types';

const STATE_BADGE: Record<LedgerGrant['state'], { label: string; className: string }> = {
  waiting: { label: 'Waiting 24h', className: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100' },
  active: { label: 'Active', className: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100' },
  revoked: { label: 'Revoked', className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
};

const ACTION_LABEL: Record<string, string> = {
  owner_set: 'Ledger owner set',
  owner_transferred: 'Ledger moved to a new owner',
  deal_updated: 'Deal figures edited',
  deal_reset: 'Deal entries cleared',
  deals_marked_paid: 'Deals marked paid',
  grant_created: 'Access granted',
  grant_narrowed: 'Access narrowed',
  grant_revoked: 'Access revoked',
  invoice_created: 'Invoice created',
  invoice_deleted: 'Invoice voided',
  settings_updated: 'Settings changed',
  month_updated: 'Volume bonus received entered',
  exported: 'Downloaded',
};

const tierDraft = (tiers: LedgerVbTier[]) => tiers.map((t) => ({ min: String(t.min_volume), share: String(t.share_percent) }));

/** Owner only: who else can see the ledger and what of it, the details on our
 *  side of the invoices, and the trail of what has happened. */
export default function LedgerSharingTab({ scopeLabels }: { scopeLabels: Record<string, string> }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [grants, setGrants] = useState<LedgerGrant[]>([]);
  const [team, setTeam] = useState<LedgerTeamMember[]>([]);
  const [settings, setSettings] = useState<LedgerSettings | null>(null);
  const [audit, setAudit] = useState<LedgerAuditEntry[]>([]);
  const [newUser, setNewUser] = useState('');
  const [newScopes, setNewScopes] = useState<Set<string>>(new Set(['summary', 'deals']));
  const [granting, setGranting] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [tiers, setTiers] = useState<{ min: string; share: string }[]>([]);
  const [savingTiers, setSavingTiers] = useState(false);
  const [editing, setEditing] = useState<{ id: string; scopes: Set<string> } | null>(null);

  const load = useCallback(async () => {
    try {
      const [g, t, s, a] = await Promise.all([
        api.get<LedgerGrant[]>('/ledger/grants'),
        api.get<LedgerTeamMember[]>('/ledger/team'),
        api.get<LedgerSettings>('/ledger/settings'),
        api.get<LedgerAuditEntry[]>('/ledger/audit'),
      ]);
      setGrants(g.data);
      setTeam(t.data);
      setSettings(s.data);
      setTiers(tierDraft(s.data.vb_tiers));
      setAudit(a.data);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to load sharing'), 'error');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const toggleScope = (set: Set<string>, scope: string) => {
    const next = new Set(set);
    if (next.has(scope)) next.delete(scope); else next.add(scope);
    return next;
  };

  const grant = async () => {
    const member = team.find((m) => m.id === newUser);
    if (!member || !newScopes.size) return;
    const ok = await confirm({
      title: `Share the ledger with ${member.full_name}?`,
      message: `They will be able to see: ${[...newScopes].map((s) => scopeLabels[s]).join('; ')}. Access opens 24 hours from now, and you can revoke it at any time.`,
      confirmText: 'Share',
    });
    if (!ok) return;
    setGranting(true);
    try {
      await api.post('/ledger/grants', { user_id: newUser, scopes: [...newScopes] });
      setNewUser('');
      toast('Shared — access opens in 24 hours', 'success');
      load();
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to share'), 'error');
    } finally {
      setGranting(false);
    }
  };

  const saveNarrowed = async () => {
    if (!editing) return;
    try {
      await api.patch(`/ledger/grants/${editing.id}`, { scopes: [...editing.scopes] });
      setEditing(null);
      load();
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to update'), 'error');
    }
  };

  const revoke = async (g: LedgerGrant) => {
    const ok = await confirm({ title: `Revoke ${g.user_name}'s access?`, message: 'It stops immediately.', confirmText: 'Revoke', variant: 'danger' });
    if (!ok) return;
    try {
      await api.delete(`/ledger/grants/${g.id}`);
      load();
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to revoke'), 'error');
    }
  };

  const saveTiers = async (reset = false) => {
    const parsed: LedgerVbTier[] = reset ? [] : tiers
      .filter((t) => t.min.trim() !== '' || t.share.trim() !== '')
      .map((t) => ({ min_volume: Number(t.min.replace(/[$,\s]/g, '')), share_percent: Number(t.share) }));
    if (parsed.some((t) => Number.isNaN(t.min_volume) || t.min_volume < 0 || Number.isNaN(t.share_percent) || t.share_percent < 0 || t.share_percent > 100)) {
      toast('Each tier needs a volume of $0 or more and a share between 0 and 100%', 'error');
      return;
    }
    setSavingTiers(true);
    try {
      const { data } = await api.put<LedgerSettings>('/ledger/settings', { vb_tiers: parsed });
      setSettings(data);
      setTiers(tierDraft(data.vb_tiers));
      toast('Volume bonus tiers saved', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to save'), 'error');
    } finally {
      setSavingTiers(false);
    }
  };

  const saveSettings = async () => {
    if (!settings) return;
    setSavingSettings(true);
    try {
      const { data } = await api.put<LedgerSettings>('/ledger/settings', {
        business_name: settings.business_name,
        business_abn: settings.business_abn,
        business_address: settings.business_address,
        business_email: settings.business_email,
        invoice_prefix: settings.invoice_prefix,
        next_invoice_number: settings.next_invoice_number,
      });
      setSettings(data);
      toast('Saved', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to save'), 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const live = grants.filter((g) => g.state !== 'revoked');
  const past = grants.filter((g) => g.state === 'revoked');
  const sharedIds = new Set(live.map((g) => g.user_id));
  const scopeKeys = Object.keys(scopeLabels) as LedgerScope[];

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-[14px] font-semibold text-foreground">Who can see the ledger</h2>
        <p className="text-[12.5px] text-muted-foreground mt-0.5 mb-3">
          Nobody but you, unless you share it here. A share opens 24 hours after you make it and is always view-only.
          Payment dates and notes are never shared.
        </p>

        {live.length === 0 ? (
          <p className="text-[13px] text-muted-foreground mb-4">Not shared with anyone.</p>
        ) : (
          <ul className="divide-y divide-border mb-4">
            {live.map((g) => (
              <li key={g.id} className="py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-medium text-foreground">{g.user_name}</span>
                  <span className="text-[12px] text-muted-foreground">{g.user_email} · {g.user_role}</span>
                  <Badge type="custom" value={g.state} label={STATE_BADGE[g.state].label} className={STATE_BADGE[g.state].className} />
                  <span className="text-[12px] text-muted-foreground">
                    {g.state === 'waiting' ? `opens ${formatDateTime(g.active_from)}` : `since ${formatDateTime(g.active_from)}`}
                  </span>
                  <span className="ml-auto flex gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ id: g.id, scopes: new Set(g.scopes) })}>Narrow</Button>
                    <Button size="sm" variant="danger" onClick={() => revoke(g)}>Revoke</Button>
                  </span>
                </div>
                {editing?.id === g.id ? (
                  <div className="mt-2 rounded-md border border-border p-3">
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                      {g.scopes.map((s) => (
                        <label key={s} className="flex items-center gap-1.5 text-[12.5px]">
                          <input type="checkbox" checked={editing.scopes.has(s)} onChange={() => setEditing({ ...editing, scopes: toggleScope(editing.scopes, s) })} />
                          {scopeLabels[s]}
                        </label>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[11.5px] text-muted-foreground">To show more, revoke and share again — that restarts the 24-hour wait.</p>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" onClick={saveNarrowed} disabled={!editing.scopes.size}>Save</Button>
                      <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1 text-[12px] text-muted-foreground">Sees: {g.scopes.map((s) => scopeLabels[s]).join(' · ')}</p>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="rounded-md border border-border p-3">
          <p className="text-[12.5px] font-medium text-foreground mb-2">Share with a team member</p>
          <select className="led-input !h-9 w-full max-w-sm text-[13px]" value={newUser} onChange={(e) => setNewUser(e.target.value)}>
            <option value="">Choose an admin…</option>
            {team.filter((m) => !sharedIds.has(m.id)).map((m) => (
              <option key={m.id} value={m.id}>{m.full_name} · {m.role} · {m.email}</option>
            ))}
          </select>
          <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
            {scopeKeys.map((s) => (
              <label key={s} className="flex items-start gap-2 text-[12.5px]">
                <input type="checkbox" className="mt-0.5" checked={newScopes.has(s)} onChange={() => setNewScopes((prev) => toggleScope(prev, s))} />
                {scopeLabels[s]}
              </label>
            ))}
          </div>
          <Button size="sm" className="mt-3" onClick={grant} loading={granting} disabled={!newUser || !newScopes.size}>Share</Button>
        </div>

        {past.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-[12px] text-muted-foreground">Revoked ({past.length})</summary>
            <ul className="mt-1.5 space-y-1">
              {past.map((g) => (
                <li key={g.id} className="text-[12px] text-muted-foreground">
                  {g.user_name} — shared {formatDateTime(g.created_at)}, revoked {g.revoked_at ? formatDateTime(g.revoked_at) : ''}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      {settings && (
        <Card>
          <h2 className="text-[14px] font-semibold text-foreground">Invoice details</h2>
          <p className="text-[12.5px] text-muted-foreground mt-0.5 mb-3">Printed in the “Bill to” block of every referrer commission invoice.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Business name" value={settings.business_name ?? ''} onChange={(e) => setSettings({ ...settings, business_name: e.target.value })} />
            <Input label="ABN" value={settings.business_abn ?? ''} onChange={(e) => setSettings({ ...settings, business_abn: e.target.value })} />
            <Input label="Address" value={settings.business_address ?? ''} onChange={(e) => setSettings({ ...settings, business_address: e.target.value })} />
            <Input label="Email" value={settings.business_email ?? ''} onChange={(e) => setSettings({ ...settings, business_email: e.target.value })} />
            <Input label="Invoice number prefix" value={settings.invoice_prefix} onChange={(e) => setSettings({ ...settings, invoice_prefix: e.target.value })} />
            <Input
              label="Next invoice number"
              type="number"
              min={1}
              value={settings.next_invoice_number}
              onChange={(e) => setSettings({ ...settings, next_invoice_number: Math.max(1, Number(e.target.value) || 1) })}
            />
          </div>
          <Button size="sm" className="mt-3" onClick={saveSettings} loading={savingSettings}>Save details</Button>
        </Card>
      )}

      {settings && (
        <Card>
          <h2 className="text-[14px] font-semibold text-foreground">Volume bonus tiers</h2>
          <p className="text-[12.5px] text-muted-foreground mt-0.5 mb-3">
            Our share of the lenders&rsquo; volume bonus, set by the month&rsquo;s total settled volume and paid from dollar one.
            Each deal&rsquo;s possible volume bonus = finance amount ex GST × the lender&rsquo;s VBI % (set on the lender) × this share.
          </p>
          <div className="space-y-2 max-w-md">
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-[12px] font-medium text-[var(--led-ink-2)]">
              <span>Month settled from ($)</span><span>Our share (%)</span><span />
            </div>
            {tiers.map((t, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <input className="led-input !h-9 text-[13px]" inputMode="decimal" value={t.min} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)))} />
                <input className="led-input !h-9 text-[13px]" inputMode="decimal" value={t.share} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, share: e.target.value } : x)))} />
                <button type="button" className="led-btn led-btn-ghost led-btn-sm" onClick={() => setTiers(tiers.filter((_, j) => j !== i))} aria-label="Remove tier">✕</button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setTiers([...tiers, { min: '', share: '' }])}>Add tier</Button>
            <Button size="sm" onClick={() => saveTiers()} loading={savingTiers}>Save tiers</Button>
            <Button size="sm" variant="ghost" onClick={() => saveTiers(true)}>Back to defaults</Button>
          </div>
        </Card>
      )}

      <Card>
        <h2 className="text-[14px] font-semibold text-foreground mb-2">Ledger activity</h2>
        {audit.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {audit.map((e) => (
              <li key={e.id} className="py-1.5 flex flex-wrap gap-x-3 text-[12.5px]">
                <span className="text-muted-foreground tabular-nums">{formatDateTime(e.created_at)}</span>
                <span className="text-foreground">{ACTION_LABEL[e.action] ?? e.action}</span>
                <span className="text-muted-foreground">by {e.actor_name}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
