import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../Toast';
import { Button, Card } from '../ui';
import { getErrorMessage } from '../../lib/utils';
import { SHARE_BASE_LABEL } from '../../lib/ledger';
import type { LedgerPayee, LedgerShareBase } from '../../types';
import LedgerModal from './LedgerModal';

const usualCut = (p: LedgerPayee) => {
  if (p.default_share_amount != null) return `$${p.default_share_amount.toLocaleString('en-AU')} per deal`;
  if (p.default_share_percent != null) return `${p.default_share_percent}% ${SHARE_BASE_LABEL[p.default_share_base]}`;
  return '—';
};

type Form = Record<
  'name' | 'company_name' | 'abn' | 'email' | 'phone' | 'address' | 'bank_account_name' | 'bank_name' | 'bank_bsb'
  | 'bank_account_number' | 'notes' | 'default_share_percent' | 'default_share_amount', string
> & { gst_registered: '' | 'yes' | 'no'; default_share_base: LedgerShareBase; cut_mode: 'percent' | 'dollar'; is_active: boolean };

function formFor(p: LedgerPayee | null): Form {
  return {
    name: p?.is_portal ? '' : p?.name ?? '',
    company_name: p?.is_portal ? '' : p?.organization_name ?? '',
    abn: p?.party.abn ?? '',
    email: p?.party.email ?? '',
    phone: p?.phone ?? '',
    address: p?.party.address ?? '',
    bank_account_name: p?.party.bank_account_name ?? '',
    bank_name: p?.party.bank_name ?? '',
    bank_bsb: p?.party.bank_bsb ?? '',
    bank_account_number: p?.party.bank_account_number ?? '',
    notes: p?.notes ?? '',
    gst_registered: p?.gst_registered == null ? '' : p.gst_registered ? 'yes' : 'no',
    default_share_percent: p?.default_share_percent != null ? String(p.default_share_percent) : '',
    default_share_amount: p?.default_share_amount != null ? String(p.default_share_amount) : '',
    default_share_base: p?.default_share_base ?? 'brokerage',
    cut_mode: p?.default_share_amount != null ? 'dollar' : 'percent',
    is_active: p?.is_active ?? true,
  };
}

const num = (s: string) => {
  const t = s.replace(/[$,\s%]/g, '');
  return t === '' ? null : Number(t);
};

/** Everyone commission is paid to. Portal referrers' details are their own
 *  billing profile (edited on the referrer page); here the owner keeps only
 *  their usual cut and notes. Off-portal payees — accountants, partners,
 *  sub-contractors — are kept entirely here. */
export default function LedgerPayeesPanel({ payees, isOwner, onChanged }: {
  payees: LedgerPayee[];
  isOwner: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState<LedgerPayee | 'new' | null>(null);
  const [form, setForm] = useState<Form>(formFor(null));
  const [saving, setSaving] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const open = (p: LedgerPayee | 'new') => {
    setForm(formFor(p === 'new' ? null : p));
    setEditing(p);
  };
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const portal = editing !== null && editing !== 'new' && editing.is_portal;

  const save = async () => {
    if (!editing) return;
    const pct = form.cut_mode === 'percent' ? num(form.default_share_percent) : null;
    const amt = form.cut_mode === 'dollar' ? num(form.default_share_amount) : null;
    if ((pct != null && Number.isNaN(pct)) || (amt != null && Number.isNaN(amt))) {
      toast('The usual cut must be a number', 'error');
      return;
    }
    const body: Record<string, unknown> = {
      notes: form.notes,
      default_share_percent: pct,
      default_share_amount: amt,
      default_share_base: form.default_share_base,
      is_active: form.is_active,
    };
    if (!portal) {
      if (!form.name.trim() && !form.company_name.trim()) {
        toast('Enter a name or a company', 'error');
        return;
      }
      Object.assign(body, {
        name: form.name, company_name: form.company_name, abn: form.abn.replace(/\s/g, ''), email: form.email,
        phone: form.phone, address: form.address, bank_account_name: form.bank_account_name, bank_name: form.bank_name,
        bank_bsb: form.bank_bsb.replace(/\D/g, ''), bank_account_number: form.bank_account_number.replace(/\D/g, ''),
        gst_registered: form.gst_registered === '' ? null : form.gst_registered === 'yes',
      });
    }
    setSaving(true);
    try {
      if (editing === 'new') await api.post('/ledger/payees', body);
      else await api.patch(`/ledger/payees/${editing.key}`, body);
      toast('Saved', 'success');
      setEditing(null);
      onChanged();
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to save'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const shown = payees.filter((p) => showInactive || p.is_active);
  const inputCls = 'led-input !h-9 w-full text-[13px]';
  const labelCls = 'mb-1 block text-[12px] font-medium text-[var(--led-ink-2)]';
  const field = (k: keyof Form, label: string, placeholder?: string) => (
    <label className="block">
      <span className={labelCls}>{label}</span>
      <input className={inputCls} value={form[k] as string} placeholder={placeholder} onChange={(e) => set(k, e.target.value as never)} />
    </label>
  );

  return (
    <Card padding="none">
      <div className="px-4 py-3 border-b border-border flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[14px] font-semibold text-foreground">Payees</h2>
          <p className="text-[12px] text-muted-foreground">Portal referrers and people paid outside the portal. Only admins with ledger access see this.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
          </label>
          {isOwner && <Button size="sm" onClick={() => open('new')}>Add payee</Button>}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-[12.5px]">
          <thead className="bg-[var(--led-surface-2)] text-[11.5px] text-[var(--led-ink-2)]">
            <tr>
              <th className="px-3 py-2 text-left">Payee</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">ABN</th>
              <th className="px-3 py-2 text-left">GST</th>
              <th className="px-3 py-2 text-left">Usual cut</th>
              {isOwner && <th className="px-3 py-2 text-left">Bank</th>}
              <th className="px-3 py-2 text-left">Notes</th>
              {isOwner && <th />}
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.key} className={`border-t border-border ${p.is_active ? '' : 'text-muted-foreground'}`}>
                <td className="px-3 py-2">
                  <span className="font-medium">{p.name || p.organization_name || 'Unnamed'}</span>
                  {p.name && p.organization_name && <span className="text-muted-foreground"> · {p.organization_name}</span>}
                </td>
                <td className="px-3 py-2">{p.is_portal ? 'Portal referrer' : 'Off-portal'}</td>
                <td className="px-3 py-2 tabular-nums">{p.party.abn || '—'}</td>
                <td className="px-3 py-2">{p.gst_registered == null ? '—' : p.gst_registered ? 'Registered' : 'No'}</td>
                <td className="px-3 py-2">{usualCut(p)}</td>
                {isOwner && (
                  <td className="px-3 py-2 whitespace-nowrap">
                    {p.party.bank_bsb || p.party.bank_account_number
                      ? `${p.party.bank_name ? `${p.party.bank_name} · ` : ''}${p.party.bank_bsb ?? ''} ${p.party.bank_account_number ?? ''}`
                      : <span className="text-muted-foreground">Missing</span>}
                  </td>
                )}
                <td className="px-3 py-2 max-w-[260px] truncate" title={p.notes ?? undefined}>{p.notes || '—'}</td>
                {isOwner && (
                  <td className="px-2 py-1 text-right whitespace-nowrap">
                    {p.is_portal && p.user_id && (
                      <Link to={`/admin/referrers/${p.user_id}`} className="led-btn led-btn-ghost led-btn-sm">Profile</Link>
                    )}
                    <button type="button" className="led-btn led-btn-ghost led-btn-sm" onClick={() => open(p)}>Edit</button>
                  </td>
                )}
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-muted-foreground">No payees yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <LedgerModal
          title={editing === 'new' ? 'Add a payee' : editing.name || editing.organization_name || 'Payee'}
          subtitle={portal ? 'Portal referrer — their ABN, GST and bank details are on their referrer profile.' : 'Paid outside the portal — kept in the ledger only.'}
          onClose={() => setEditing(null)}
          wide
          footer={
            <>
              <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={save} loading={saving}>Save</Button>
            </>
          }
        >
          {!portal && (
            <div className="grid gap-3 sm:grid-cols-2 mb-4">
              {field('name', 'Name', 'e.g. Paras Abrol')}
              {field('company_name', 'Company', 'e.g. Abrol Associates')}
              {field('abn', 'ABN')}
              <label className="block">
                <span className={labelCls}>GST registered</span>
                <select className={inputCls} value={form.gst_registered} onChange={(e) => set('gst_registered', e.target.value as Form['gst_registered'])}>
                  <option value="">Not recorded</option>
                  <option value="yes">Yes — add GST to their commission</option>
                  <option value="no">No</option>
                </select>
              </label>
              {field('email', 'Email')}
              {field('phone', 'Phone')}
              <div className="sm:col-span-2">{field('address', 'Address')}</div>
              {field('bank_account_name', 'Bank account name')}
              {field('bank_name', 'Bank', 'e.g. NAB')}
              {field('bank_bsb', 'BSB')}
              {field('bank_account_number', 'Account number')}
            </div>
          )}
          <h4 className="text-[13px] font-semibold text-foreground mb-1">Usual cut</h4>
          <p className="text-[12px] text-muted-foreground mb-2">Filled in when they're added to a deal; you can change it per deal.</p>
          <div className="inline-flex rounded-md border border-border p-0.5 mb-2" role="radiogroup" aria-label="Usual cut as">
            {(['percent', 'dollar'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={form.cut_mode === m}
                onClick={() => set('cut_mode', m)}
                className={`rounded px-3 py-1 text-[12.5px] ${form.cut_mode === m ? 'bg-[var(--led-ink)] text-[var(--led-surface)]' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {m === 'percent' ? 'Percentage' : 'Dollar amount'}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3 mb-4">
            {form.cut_mode === 'percent' ? (
              <>
                {field('default_share_percent', 'Share %', 'e.g. 35')}
                <label className="block">
                  <span className={labelCls}>Of</span>
                  <select className={inputCls} value={form.default_share_base} onChange={(e) => set('default_share_base', e.target.value as LedgerShareBase)}>
                    {(Object.keys(SHARE_BASE_LABEL) as LedgerShareBase[]).map((b) => <option key={b} value={b}>{SHARE_BASE_LABEL[b].replace(/^of /, '')}</option>)}
                  </select>
                </label>
              </>
            ) : field('default_share_amount', 'Amount per deal (ex GST)', 'e.g. 300')}
          </div>
          <label className="block mb-3">
            <span className={labelCls}>Notes</span>
            <textarea className="led-input w-full min-h-[60px] py-2 text-[13px]" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
            Active (offered when adding payees to a deal)
          </label>
        </LedgerModal>
      )}
    </Card>
  );
}
