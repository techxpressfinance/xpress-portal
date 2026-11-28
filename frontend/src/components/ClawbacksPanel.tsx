import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useToast } from './Toast';
import { useConfirm } from '../hooks/useConfirm';
import { Button, Card, Input } from './ui';
import { fmtCurrency } from '../lib/lenderPricing';
import { formatDate, getErrorMessage } from '../lib/utils';
import type { Clawback } from '../types';

const today = () => new Date().toLocaleDateString('en-CA');

type Form = { clawback_date: string; amount: string; reason: string; high_priority: boolean };
const EMPTY: Form = { clawback_date: '', amount: '', reason: '', high_priority: true };

function ClawbackLine({ c, applicationLink, onEdit, onDelete }: {
  c: Clawback;
  applicationLink?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <li className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[14px] font-semibold text-destructive tabular-nums">
          −{fmtCurrency(c.amount)} <span className="text-[12px] font-normal text-muted-foreground">brokerage ex GST</span>
        </p>
        <p className="text-[12.5px] tabular-nums text-muted-foreground">Clawed back {formatDate(c.clawback_date)}</p>
      </div>
      {applicationLink && c.loan_label && (
        <Link to={`/admin/applications/${c.application_id}`} className="mt-1 block text-[13px] text-primary hover:underline">
          {c.loan_label}
        </Link>
      )}
      {c.reason && <p className="mt-1 text-[13px] text-foreground whitespace-pre-wrap">{c.reason}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
        <span>Recorded by {c.created_by_name || 'staff'}{c.created_at ? ` · ${formatDate(c.created_at)}` : ''}</span>
        {c.alert_high_priority === true && <span className="rounded bg-destructive/10 px-1.5 py-px font-medium text-destructive">High client alert</span>}
        {c.alert_high_priority === false && <span className="rounded bg-muted px-1.5 py-px">Client alert</span>}
        {(onEdit || onDelete) && (
          <span className="ml-auto flex gap-3">
            {onEdit && <button type="button" className="font-medium text-primary hover:underline" onClick={onEdit}>Edit</button>}
            {onDelete && <button type="button" className="font-medium text-destructive hover:underline" onClick={onDelete}>Delete</button>}
          </span>
        )}
      </div>
    </li>
  );
}

/** Clawbacks on one file, for the whole team. Recording one raises a client
 *  alert (shown on every one of the client's applications) and puts a red
 *  row in the private ledger in the month of the clawback. Only a settled
 *  loan can be clawed back. */
export default function ClawbacksPanel({ applicationId, settled, onChanged }: {
  applicationId: string;
  settled: boolean;
  /** Called after a change — the client alerts it raised need reloading. */
  onChanged?: () => void;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<Clawback[] | null>(null);
  const [editing, setEditing] = useState<Clawback | 'new' | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.get<Clawback[]>(`/applications/${applicationId}/clawbacks`)
      .then(({ data }) => setItems(data))
      .catch(() => setItems([]));
  }, [applicationId]);
  useEffect(() => { load(); }, [load]);

  // Nothing to show on a loan that hasn't settled and was never clawed back.
  if (items === null || (!settled && items.length === 0)) return null;

  const open = (c: Clawback | 'new') => {
    setEditing(c);
    setForm(c === 'new'
      ? { ...EMPTY, clawback_date: today() }
      : { clawback_date: c.clawback_date, amount: String(c.amount), reason: c.reason ?? '', high_priority: c.alert_high_priority ?? true });
  };

  const amount = Number(form.amount);
  const valid = Boolean(form.clawback_date) && form.amount.trim() !== '' && amount > 0 && form.clawback_date <= today();

  const save = async () => {
    if (!valid || !editing) return;
    setSaving(true);
    try {
      const body = { clawback_date: form.clawback_date, amount: amount.toFixed(2), reason: form.reason.trim() || null, high_priority: form.high_priority };
      const { data } = editing === 'new'
        ? await api.post<Clawback[]>(`/applications/${applicationId}/clawbacks`, body)
        : await api.patch<Clawback[]>(`/applications/${applicationId}/clawbacks/${editing.id}`, body);
      setItems(data);
      setEditing(null);
      toast(editing === 'new' ? 'Clawback recorded — client alert raised' : 'Clawback updated', 'success');
      onChanged?.();
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to save the clawback'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: Clawback) => {
    const ok = await confirm({
      title: 'Delete this clawback?',
      message: 'Its client alert goes too, and it comes off the ledger. Only do this if it was recorded by mistake.',
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const { data } = await api.delete<Clawback[]>(`/applications/${applicationId}/clawbacks/${c.id}`);
      setItems(data);
      toast('Clawback deleted', 'success');
      onChanged?.();
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to delete'), 'error');
    }
  };

  const total = items.reduce((sum, c) => sum + c.amount, 0);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">
            Clawbacks
            {items.length > 0 && <span className="ml-2 text-[13px] font-medium text-destructive tabular-nums">−{fmtCurrency(total)}</span>}
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Brokerage the lender took back on this loan. Recording one raises a client alert and reverses the brokerage in the ledger in the month it happened.
          </p>
        </div>
        {settled && !editing && <Button size="sm" variant="secondary" onClick={() => open('new')}>Record clawback</Button>}
      </div>

      {editing && (
        <div className="mt-4 rounded-xl border border-border bg-secondary/40 p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Date clawed back"
              type="date"
              max={today()}
              value={form.clawback_date}
              onChange={(e) => setForm((f) => ({ ...f, clawback_date: e.target.value }))}
              error={form.clawback_date > today() ? "Can't be in the future" : undefined}
            />
            <Input
              label="Brokerage clawed back (ex GST)"
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="clawback-reason" className="mb-1.5 block text-[13px] font-medium text-[var(--led-ink-2)]">Reason</label>
            <textarea
              id="clawback-reason"
              className="led-input w-full min-h-[64px] resize-y py-2 text-[14px]"
              maxLength={2000}
              placeholder="e.g. Loan paid out in month 4 — 100% clawback"
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            />
          </div>
          <label className="flex items-center gap-2 text-[13px] text-foreground">
            <input type="checkbox" checked={form.high_priority} onChange={(e) => setForm((f) => ({ ...f, high_priority: e.target.checked }))} />
            High alert — show it as a banner on every one of this client&rsquo;s applications
          </label>
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={!valid || saving}>{saving ? 'Saving…' : editing === 'new' ? 'Record clawback' : 'Save'}</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
          </div>
        </div>
      )}

      {items.length > 0 ? (
        <ul className="mt-4 space-y-2.5">
          {items.map((c) => (
            <ClawbackLine key={c.id} c={c} onEdit={() => open(c)} onDelete={() => remove(c)} />
          ))}
        </ul>
      ) : !editing && (
        <p className="mt-3 text-[13px] text-muted-foreground">No clawbacks on this loan.</p>
      )}
    </Card>
  );
}

/** Every clawback across a client's or an entity's loans — read-only, each
 *  linking to its file. Renders nothing when there are none. */
export function ClawbackHistory({ contactId, organizationId }: { contactId?: string; organizationId?: string }) {
  const [items, setItems] = useState<Clawback[]>([]);
  useEffect(() => {
    if (!contactId && !organizationId) return;
    api.get<Clawback[]>('/clawbacks', { params: { contact_id: contactId, organization_id: organizationId } })
      .then(({ data }) => setItems(data))
      .catch(() => setItems([]));
  }, [contactId, organizationId]);
  if (items.length === 0) return null;
  const total = items.reduce((sum, c) => sum + c.amount, 0);
  return (
    <Card>
      <h2 className="text-[15px] font-semibold text-foreground">
        Clawbacks
        <span className="ml-2 text-[13px] font-medium text-destructive tabular-nums">−{fmtCurrency(total)}</span>
      </h2>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        Brokerage clawed back on {contactId ? 'this client’s' : 'this entity’s'} loans.
      </p>
      <ul className="mt-4 space-y-2.5">
        {items.map((c) => <ClawbackLine key={c.id} c={c} applicationLink />)}
      </ul>
    </Card>
  );
}
