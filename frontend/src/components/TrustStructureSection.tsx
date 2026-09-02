import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import api from '../api/client';
import { useToast } from './Toast';
import { useConfirm } from '../hooks/useConfirm';
import { Card, Button, Badge, Input, Select, AbrResultCard } from './ui';
import { useAbrLookup } from '../hooks/useAbrLookup';
import { abnValidationError, acnFromAbn, formatAbn, formatAcn } from '../lib/acn';
import { getErrorMessage } from '../lib/utils';
import {
  TRUST_PARTY_KINDS,
  TRUST_PARTY_ROLES,
  TRUST_PARTY_ROLE_CONFIG,
  isEntityPartyKind,
} from '../lib/constants';
import type { TrustParty, TrustPartyKind, TrustPartyRole } from '../types';

const LABEL = 'block text-[12px] font-medium text-muted-foreground mb-1';

/** The line under a party's name: its ABN, a corporate trustee's ACN, then notes. */
function partyMeta(p: TrustParty): string {
  const parts: string[] = [];
  if (p.abn) parts.push(`ABN ${formatAbn(p.abn)}`);
  else if (isEntityPartyKind(p.party_kind)) parts.push('No ABN on file');
  if (p.acn) parts.push(`ACN ${formatAcn(p.acn)}`);
  if (p.notes) parts.push(p.notes);
  return parts.join(' · ');
}

type ContactHit = { id: string; first_name: string; last_name: string; email: string | null };
type OrgHit = { id: string; name: string; abn: string | null };

/** Add one party to a trust: pick the role, say what the party *is*, then link
 *  an existing contact/entity or just type a name (beneficiary classes, a
 *  settlor who is only ever a name on the deed). */
function AddPartyModal({ organizationId, initialRole, onClose, onAdded }: {
  organizationId: string;
  initialRole: TrustPartyRole;
  onClose: () => void;
  onAdded: (party: TrustParty) => void;
}) {
  const { toast } = useToast();
  const [role, setRole] = useState<TrustPartyRole>(initialRole);
  const [kind, setKind] = useState<TrustPartyKind>('individual');
  const [query, setQuery] = useState('');
  const [contactHits, setContactHits] = useState<ContactHit[]>([]);
  const [orgHits, setOrgHits] = useState<OrgHit[]>([]);
  const [pickedContact, setPickedContact] = useState<ContactHit | null>(null);
  const [pickedOrg, setPickedOrg] = useState<OrgHit | null>(null);
  const [name, setName] = useState('');
  const [abn, setAbn] = useState('');
  const [percentage, setPercentage] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const linksToEntity = isEntityPartyKind(kind);
  const searchable = kind !== 'other';
  const picked = pickedContact || pickedOrg;

  // A corporate trustee is the party a lender actually contracts with, so its
  // ABN is worth checking as it's typed. ASIC has no per-record API to confirm
  // the company against, so what we can do offline is the check digit plus the
  // ACN its ABN encodes; the ABR lookup supplies the registered name.
  const abnError = !picked && linksToEntity ? abnValidationError(abn) : null;
  const trusteeAcn = kind === 'company' ? acnFromAbn(abn) : null;
  const abr = useAbrLookup(!picked && linksToEntity ? abn : '');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Switching what the party *is* invalidates whatever was picked for the old kind.
  useEffect(() => {
    setPickedContact(null);
    setPickedOrg(null);
    setQuery('');
  }, [kind]);

  useEffect(() => {
    if (!searchable || picked) return;
    let cancelled = false;
    const t = setTimeout(() => {
      const path = linksToEntity ? '/organizations' : '/contacts';
      api.get(path, { params: { search: query || undefined, page: 1, per_page: 20 } })
        .then(({ data }) => {
          if (cancelled) return;
          const items = data.items || [];
          if (linksToEntity) setOrgHits(items.filter((o: OrgHit) => o.id !== organizationId));
          else setContactHits(items);
        })
        .catch(() => { if (!cancelled) { setOrgHits([]); setContactHits([]); } });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, kind, searchable, linksToEntity, picked, organizationId]);

  const submit = async () => {
    if (!picked && !name.trim()) {
      toast('Pick an existing record or enter a name', 'error');
      return;
    }
    // The backend rejects this too; stopping here keeps the message on the field.
    if (abnError) return;
    setSaving(true);
    try {
      const { data } = await api.post<TrustParty>(`/organizations/${organizationId}/trust-parties`, {
        role,
        party_kind: kind,
        contact_id: pickedContact?.id || null,
        linked_organization_id: pickedOrg?.id || null,
        name: picked ? null : name.trim() || null,
        abn: !pickedOrg && linksToEntity ? abn.trim() || null : null,
        ownership_percentage: percentage.trim() ? Number(percentage) : null,
        notes: notes.trim() || null,
      });
      toast(`${TRUST_PARTY_ROLE_CONFIG[role].label} added`, 'success');
      onAdded(data);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to add trust party'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-background border border-border p-6 shadow-xl"
        style={{ animation: 'fadeInUp 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
      >
        <h3 className="text-[17px] font-semibold text-foreground mb-1">Add trust party</h3>
        <p className="text-[13px] text-muted-foreground mb-4">{TRUST_PARTY_ROLE_CONFIG[role].description}</p>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Role</label>
              <Select value={role} onChange={e => setRole(e.target.value as TrustPartyRole)}>
                {TRUST_PARTY_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </Select>
            </div>
            <div>
              <label className={LABEL}>This party is a</label>
              <Select value={kind} onChange={e => setKind(e.target.value as TrustPartyKind)}>
                {TRUST_PARTY_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
              </Select>
            </div>
          </div>

          {picked ? (
            <div className="rounded-xl border border-border bg-secondary/40 px-4 py-3 flex items-center justify-between">
              <div>
                <div className="font-medium">
                  {pickedContact ? `${pickedContact.first_name} ${pickedContact.last_name}` : pickedOrg?.name}
                </div>
                <div className="text-[12px] text-muted-foreground">
                  {pickedContact ? (pickedContact.email || 'No email') : (pickedOrg?.abn ? `ABN ${pickedOrg.abn}` : 'No ABN on file')}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setPickedContact(null); setPickedOrg(null); }}>
                Change
              </Button>
            </div>
          ) : (
            <>
              {searchable && (
                <div>
                  <label className={LABEL}>{linksToEntity ? 'Link an existing entity' : 'Link an existing contact'}</label>
                  <Input
                    autoFocus
                    placeholder={linksToEntity ? 'Search entities by name or ABN…' : 'Search contacts…'}
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                  />
                  <div className="mt-2 max-h-40 overflow-y-auto divide-y divide-border border border-border rounded-xl">
                    {(linksToEntity ? orgHits.length : contactHits.length) === 0 ? (
                      <p className="px-3 py-3 text-[13px] text-muted-foreground">
                        No matches — enter the name below instead.
                      </p>
                    ) : linksToEntity ? (
                      orgHits.map(o => (
                        <button key={o.id} type="button" onClick={() => setPickedOrg(o)}
                          className="w-full text-left px-3 py-2 hover:bg-secondary/50 transition-colors">
                          <div className="font-medium">{o.name}</div>
                          <div className="text-[12px] text-muted-foreground">{o.abn ? `ABN ${o.abn}` : 'No ABN'}</div>
                        </button>
                      ))
                    ) : (
                      contactHits.map(c => (
                        <button key={c.id} type="button" onClick={() => setPickedContact(c)}
                          className="w-full text-left px-3 py-2 hover:bg-secondary/50 transition-colors">
                          <div className="font-medium">{c.first_name} {c.last_name}</div>
                          <div className="text-[12px] text-muted-foreground">{c.email || '—'}</div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              <div className={linksToEntity ? 'grid grid-cols-2 gap-3' : ''}>
                <div>
                  <label className={LABEL}>{searchable ? 'Or enter a name' : 'Name or description'}</label>
                  <Input
                    autoFocus={!searchable}
                    placeholder={kind === 'other' ? 'e.g. the children of John Smith' : 'Full name'}
                    value={name}
                    onChange={e => setName(e.target.value)}
                  />
                </div>
                {linksToEntity && (
                  <div>
                    <label className={LABEL}>ABN</label>
                    <Input
                      placeholder="11 222 333 444"
                      value={abn}
                      onChange={e => setAbn(e.target.value)}
                      error={abnError || undefined}
                    />
                    {trusteeAcn && (
                      <p className="mt-1.5 text-[12px] text-muted-foreground">
                        ACN <span className="tabular-nums">{formatAcn(trusteeAcn)}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>

              {linksToEntity && abr.enabled && (
                <AbrResultCard
                  record={abr.record}
                  loading={abr.loading}
                  onApply={(r) => setName(r.name)}
                />
              )}
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Ownership / control %</label>
              <Input
                type="number"
                min="0"
                max="100"
                placeholder="Optional"
                value={percentage}
                onChange={e => setPercentage(e.target.value)}
              />
            </div>
            <div>
              <label className={LABEL}>Notes</label>
              <Input placeholder="Optional" value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" size="md" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button variant="primary" size="md" loading={saving} onClick={submit} disabled={!!abnError}>Add party</Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Trust structure for an entity_type === 'trust' organization. Guarantees are
 * deliberately absent: they stay per-application (Directors & guarantors on the
 * application), where the invite/sign flow lives.
 */
export default function TrustStructureSection({ organizationId, parties, onChange }: {
  organizationId: string;
  parties: TrustParty[];
  onChange: (parties: TrustParty[]) => void;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState<TrustPartyRole | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const remove = async (party: TrustParty) => {
    if (!(await confirm({
      title: `Remove ${party.display_name}?`,
      message: "They will be taken off this trust's structure.",
      confirmText: 'Remove',
      variant: 'danger',
    }))) return;
    setRemovingId(party.id);
    try {
      await api.delete(`/organizations/${organizationId}/trust-parties/${party.id}`);
      onChange(parties.filter(p => p.id !== party.id));
      toast('Trust party removed', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to remove trust party'), 'error');
    } finally {
      setRemovingId(null);
    }
  };

  const hasTrustee = parties.some(p => p.role === 'trustee');

  return (
    <Card>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-lg font-semibold">
          Trust Structure
          <span className="ml-2 text-sm font-normal text-muted-foreground">({parties.length})</span>
        </h3>
        <Button variant="primary" size="sm" onClick={() => setAdding('trustee')}>+ Add Party</Button>
      </div>
      <p className="text-[13px] text-muted-foreground mb-4">
        Captured once against the trust and reused by every application it borrows through. Guarantors are
        added per application, alongside the directors.
      </p>

      {!hasTrustee && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-chart-5/30 bg-chart-5/10 px-4 py-3 text-[13px]">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-chart-5" />
          <span>No trustee recorded yet — the trustee is the party that actually borrows, so lenders will ask for it.</span>
        </div>
      )}

      <div className="space-y-5">
        {TRUST_PARTY_ROLES.map(roleCfg => {
          const rows = parties.filter(p => p.role === roleCfg.value);
          return (
            <div key={roleCfg.value}>
              <div className="flex items-center justify-between border-b border-border pb-2 mb-2">
                <div>
                  <h4 className="text-[13px] font-semibold text-foreground">{rows.length === 1 ? roleCfg.label : roleCfg.plural}</h4>
                  <p className="text-[12px] text-muted-foreground">{roleCfg.description}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setAdding(roleCfg.value)}>+ Add</Button>
              </div>
              {rows.length === 0 ? (
                <p className="text-[13px] text-muted-foreground py-1">Not recorded.</p>
              ) : (
                <ul className="space-y-2">
                  {rows.map(p => (
                    <li key={p.id} className="flex items-start justify-between gap-3 rounded-xl border border-border/60 px-3 py-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {p.contact_id ? (
                            <Link to={`/admin/contacts/${p.contact_id}`} className="font-medium hover:underline">{p.display_name}</Link>
                          ) : p.linked_organization_id ? (
                            <Link to={`/admin/companies/${p.linked_organization_id}`} className="font-medium hover:underline">{p.display_name}</Link>
                          ) : (
                            <span className="font-medium">{p.display_name}</span>
                          )}
                          <Badge type="custom" value={TRUST_PARTY_KINDS.find(k => k.value === p.party_kind)?.label || p.party_kind} className={roleCfg.className} />
                          {p.ownership_percentage != null && (
                            <Badge type="custom" value={`${Number(p.ownership_percentage)}%`} className="bg-chart-2/10 text-chart-2" />
                          )}
                        </div>
                        <div className="text-[12px] text-muted-foreground">{partyMeta(p)}</div>
                      </div>
                      <Button variant="ghost" size="sm" loading={removingId === p.id} onClick={() => remove(p)}>Remove</Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {adding && (
        <AddPartyModal
          organizationId={organizationId}
          initialRole={adding}
          onClose={() => setAdding(null)}
          onAdded={(party) => { onChange([...parties, party]); setAdding(null); }}
        />
      )}
    </Card>
  );
}
