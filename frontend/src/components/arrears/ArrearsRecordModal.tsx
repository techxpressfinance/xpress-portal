import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api/client';
import { useToast } from '../Toast';
import { Button, DatePicker, Input, Select } from '../ui';
import { getErrorMessage } from '../../lib/utils';
import {
  ARREARS_FILE_TYPES,
  ARREARS_FREQUENCIES,
  bucketClass,
  bucketForDays,
  bucketLabel,
  daysInArrears,
} from '../../lib/arrears';
import type {
  ArrearsFileType,
  ArrearsLender,
  ArrearsRecord,
  ArrearsRepaymentFrequency,
  ContactDetail,
  ContactOrganization,
  Lender,
  OrganizationContactLite,
  OrganizationDetail,
} from '../../types';
import EntityPicker from './EntityPicker';

interface Props {
  record: ArrearsRecord | null;
  /** Pre-linked party when opened from a contact or company page. */
  fixedContact?: { id: string; name: string } | null;
  fixedOrganization?: { id: string; name: string } | null;
  onClose: () => void;
  onSaved: (record: ArrearsRecord) => void;
}

/** What EntityPicker hands back on a pick — see EntityPicker's own Picked. */
type Picked = { id: string; label: string };

interface FormState {
  contact_id: string | null;
  contact_name: string | null;
  organization_id: string | null;
  organization_name: string | null;
  /** Co-financed contracts carry several; the first is the primary lender. */
  lenders: ArrearsLender[];
  contract_number: string;
  vin: string;
  asset_details: string;
  file_type: ArrearsFileType;
  repayment_amount: string;
  repayment_frequency: ArrearsRepaymentFrequency | '';
  arrears_amount: string;
  in_arrears_since: string;
  notes: string;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Sentinel option value for typing a lender that isn't in the pick list. */
const OTHER_LENDER = '__other__';

export default function ArrearsRecordModal({
  record,
  fixedContact,
  fixedOrganization,
  onClose,
  onSaved,
}: Props) {
  const { toast } = useToast();
  const [lenderBook, setLenderBook] = useState<Lender[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(() => ({
    contact_id: record?.contact_id ?? fixedContact?.id ?? null,
    contact_name: record?.contact_name ?? fixedContact?.name ?? null,
    organization_id: record?.organization_id ?? fixedOrganization?.id ?? null,
    organization_name: record?.organization_name ?? fixedOrganization?.name ?? null,
    lenders: record
      ? record.lenders?.length
        ? record.lenders.map((l) => ({ lender_id: l.lender_id, lender_name: l.lender_name }))
        : record.lender_name
          ? [{ lender_id: record.lender_id, lender_name: record.lender_name }]
          : []
      : [],
    contract_number: record?.contract_number ?? '',
    vin: record?.vin ?? '',
    asset_details: record?.asset_details ?? '',
    file_type: record?.file_type ?? 'asset_finance',
    repayment_amount: record?.repayment_amount != null ? String(record.repayment_amount) : '',
    repayment_frequency: record?.repayment_frequency ?? 'monthly',
    arrears_amount: record?.arrears_amount != null ? String(record.arrears_amount) : '',
    in_arrears_since: record?.in_arrears_since ?? today(),
    notes: record?.notes ?? '',
  }));

  useEffect(() => {
    api.get<Lender[]>('/lenders').then(({ data }) => setLenderBook(data)).catch(() => setLenderBook([]));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saving, onClose]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  /**
   * Lender picking is scoped to the chosen business: once a client or company
   * is set, the dropdown only offers lenders they already deal with (existing
   * arrears contracts, lending history, lender submissions). With no party
   * chosen — or no history — it falls back to the full lender book, and a
   * name can always be typed by hand.
   */
  const [scopedLenders, setScopedLenders] = useState<ArrearsLender[]>([]);
  const [scopedLoading, setScopedLoading] = useState(false);
  const lenderSeq = useRef(0);
  const [lenderPick, setLenderPick] = useState('');
  const [otherLenderName, setOtherLenderName] = useState('');

  useEffect(() => {
    const seq = ++lenderSeq.current;
    if (!form.contact_id && !form.organization_id) {
      setScopedLenders([]);
      return;
    }
    setScopedLoading(true);
    api
      .get<ArrearsLender[]>('/arrears/lender-options', {
        params: {
          contact_id: form.contact_id ?? undefined,
          organization_id: form.organization_id ?? undefined,
        },
      })
      .then(({ data }) => { if (seq === lenderSeq.current) setScopedLenders(data); })
      .catch(() => { if (seq === lenderSeq.current) setScopedLenders([]); })
      .finally(() => { if (seq === lenderSeq.current) setScopedLoading(false); });
  }, [form.contact_id, form.organization_id]);

  const lenderOptions = useMemo(() => {
    const base: ArrearsLender[] = scopedLenders.length
      ? scopedLenders
      : lenderBook.map((l) => ({ lender_id: l.id, lender_name: l.name }));
    const chosen = (candidate: ArrearsLender) =>
      form.lenders.some(
        (c) =>
          (candidate.lender_id && c.lender_id === candidate.lender_id) ||
          c.lender_name.toLowerCase() === candidate.lender_name.toLowerCase(),
      );
    return base.filter((o) => !chosen(o));
  }, [scopedLenders, lenderBook, form.lenders]);

  // A fetch can shrink the list out from under a selected index.
  useEffect(() => {
    if (lenderPick !== OTHER_LENDER && lenderPick !== '' && !lenderOptions[Number(lenderPick)]) {
      setLenderPick('');
    }
  }, [lenderOptions, lenderPick]);

  const addLender = () => {
    const entry =
      lenderPick === OTHER_LENDER
        ? otherLenderName.trim()
          ? { lender_id: null, lender_name: otherLenderName.trim() }
          : null
        : lenderPick !== ''
          ? lenderOptions[Number(lenderPick)] ?? null
          : null;
    if (!entry) return;
    const duplicate = form.lenders.some(
      (c) =>
        (entry.lender_id && c.lender_id === entry.lender_id) ||
        c.lender_name.toLowerCase() === entry.lender_name.toLowerCase(),
    );
    if (duplicate) {
      toast('That lender is already on this contract', 'error');
      return;
    }
    setForm((f) => ({ ...f, lenders: [...f.lenders, entry] }));
    setLenderPick('');
    setOtherLenderName('');
  };

  const removeLender = (index: number) => {
    setForm((f) => ({ ...f, lenders: f.lenders.filter((_, i) => i !== index) }));
  };

  const lenderHint = (() => {
    if (!form.contact_id && !form.organization_id) {
      return 'Pick the client or company first and only their lenders will be listed.';
    }
    if (scopedLoading) return 'Finding lenders this business already uses…';
    return scopedLenders.length
      ? 'Lenders this client/company already deals with.'
      : 'No lending history for this client/company yet — showing the full lender book.';
  })();

  /**
   * Client and company are two ends of the same relationship: a contract is
   * consumer (client) or business (company), and picking one side narrows the
   * other to that party's links. `null` options mean "no constraint" — the
   * field stays a free-search EntityPicker.
   */
  const [companyOptions, setCompanyOptions] = useState<ContactOrganization[] | null>(null);
  const [contactOptions, setContactOptions] = useState<OrganizationContactLite[] | null>(null);
  const [linksLoading, setLinksLoading] = useState<'company' | 'contact' | null>(null);
  const linkSeq = useRef(0);

  /**
   * Companies linked to the given client. `autoFill` selects a lone link
   * outright (the common one-company client); without it the options are
   * listed but nothing is selected — used after a deliberate clear, so the
   * auto-fill doesn't immediately undo it.
   */
  const loadCompanyOptions = async (contactId: string, autoFill: boolean) => {
    const seq = ++linkSeq.current;
    setLinksLoading('company');
    try {
      const { data } = await api.get<ContactDetail>(`/contacts/${contactId}`);
      if (seq !== linkSeq.current) return;
      const orgs = data.organizations ?? [];
      setCompanyOptions(orgs.length ? orgs : null);
      setForm((f) => {
        // Keep a company already on the record if the client is still linked to it.
        if (orgs.some((o) => o.id === f.organization_id)) return f;
        if (autoFill && orgs.length === 1) {
          return { ...f, organization_id: orgs[0].id, organization_name: orgs[0].name };
        }
        return f.organization_id ? { ...f, organization_id: null, organization_name: null } : f;
      });
    } catch {
      if (seq === linkSeq.current) setCompanyOptions(null);
    } finally {
      if (seq === linkSeq.current) setLinksLoading(null);
    }
  };

  const loadContactOptions = async (orgId: string, autoFill: boolean) => {
    const seq = ++linkSeq.current;
    setLinksLoading('contact');
    try {
      const { data } = await api.get<OrganizationDetail>(`/organizations/${orgId}`);
      if (seq !== linkSeq.current) return;
      const contacts = data.contacts ?? [];
      setContactOptions(contacts.length ? contacts : null);
      const nameOf = (c: OrganizationContactLite) =>
        [c.first_name, c.last_name].filter(Boolean).join(' ');
      setForm((f) => {
        if (contacts.some((c) => c.id === f.contact_id)) return f;
        if (autoFill && contacts.length === 1) {
          return { ...f, contact_id: contacts[0].id, contact_name: nameOf(contacts[0]) };
        }
        return f.contact_id ? { ...f, contact_id: null, contact_name: null } : f;
      });
    } catch {
      if (seq === linkSeq.current) setContactOptions(null);
    } finally {
      if (seq === linkSeq.current) setLinksLoading(null);
    }
  };

  const pickContact = (p: Picked | null) => {
    setForm((f) => ({ ...f, contact_id: p?.id ?? null, contact_name: p?.label ?? null }));
    setContactOptions(null);
    if (p) loadCompanyOptions(p.id, true);
    // Clearing the client leaves the company as the anchor: constrain the
    // client field to its contacts instead of leaving both loose.
    else if (form.organization_id) loadContactOptions(form.organization_id, false);
    else setCompanyOptions(null);
  };

  const pickOrganization = (p: Picked | null) => {
    setForm((f) => ({ ...f, organization_id: p?.id ?? null, organization_name: p?.label ?? null }));
    setCompanyOptions(null);
    if (p) {
      // The client only derives from the company when it isn't already the anchor.
      if (!form.contact_id) loadContactOptions(p.id, true);
    } else if (form.contact_id) {
      loadCompanyOptions(form.contact_id, false);
    } else {
      setContactOptions(null);
    }
  };

  const pickCompanyOption = (orgId: string) => {
    const org = companyOptions?.find((o) => o.id === orgId) ?? null;
    setForm((f) => ({ ...f, organization_id: org?.id ?? null, organization_name: org?.name ?? null }));
  };

  const pickContactOption = (contactId: string) => {
    const c = contactOptions?.find((x) => x.id === contactId) ?? null;
    setForm((f) => ({
      ...f,
      contact_id: c?.id ?? null,
      contact_name: c ? [c.first_name, c.last_name].filter(Boolean).join(' ') : null,
    }));
  };

  // Opening with exactly one side known — a fixed party from a detail page, or
  // a record that only ever had one — narrows the other side to that party's
  // links. Auto-filling a lone link is right for a NEW record, but on an edit
  // it would silently add a company the broker never chose and persist it on
  // the next save, so an existing record only gets the narrowed list.
  useEffect(() => {
    const autoFill = !record;
    if (form.contact_id && !form.organization_id) loadCompanyOptions(form.contact_id, autoFill);
    else if (form.organization_id && !form.contact_id) loadContactOptions(form.organization_id, autoFill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const valid =
    (form.contact_id || form.organization_id) && form.lenders.length > 0
    && form.vin.trim() && form.in_arrears_since;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    const payload = {
      contact_id: form.contact_id,
      organization_id: form.organization_id,
      lenders: form.lenders,
      contract_number: form.contract_number.trim() || null,
      vin: form.vin.trim(),
      asset_details: form.asset_details.trim() || null,
      file_type: form.file_type,
      repayment_amount: form.repayment_amount ? Number(form.repayment_amount) : null,
      repayment_frequency: form.repayment_frequency || null,
      arrears_amount: form.arrears_amount ? Number(form.arrears_amount) : null,
      in_arrears_since: form.in_arrears_since,
      notes: form.notes.trim() || null,
    };
    try {
      const { data } = record
        ? await api.patch<ArrearsRecord>(`/arrears/${record.id}`, payload)
        : await api.post<ArrearsRecord>('/arrears', payload);
      toast(record ? 'Arrears record updated' : 'Arrears record added', 'success');
      onSaved(data);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to save arrears record'), 'error');
    } finally {
      setSaving(false);
    }
  };

  /** Say what's still missing rather than leaving a dead Save button — the
   *  required fields are spread over three groups and "why can't I save?" is
   *  otherwise a hunt. */
  const missing = [
    !form.contact_id && !form.organization_id ? 'a client or company' : '',
    form.lenders.length === 0 ? 'a lender' : '',
    !form.vin.trim() ? 'the VIN' : '',
    !form.in_arrears_since ? 'the in-arrears date' : '',
  ].filter(Boolean);

  // Portals mount into document.body, outside the .ledger-theme host that
  // declares every --led-* variable, so led-btn / led-input / led-chip render
  // with no background, border, or colour unless the theme is re-declared here.
  return createPortal(
    <div className="ledger-theme fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !saving && onClose()} />
      <div className="relative flex max-h-[90vh] w-full max-w-[680px] flex-col rounded-2xl border border-border bg-background shadow-xl">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-[17px] font-semibold text-foreground">
            {record ? 'Edit arrears record' : 'Add contract to arrears book'}
          </h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            One record per contract — a client with three contracts and one in arrears gets one record.
          </p>
        </div>

        <div className="flex-1 divide-y divide-border overflow-y-auto px-6">
          {/* ── Who the contract belongs to ─────────────────────────────── */}
          <FormSection title="Who" hint="The record shows on both the client's and the company's page.">
            <div className="grid gap-4 sm:grid-cols-2">
              {linksLoading === 'contact' ? (
                <FieldShell label="Client">Checking contacts linked to {form.organization_name}…</FieldShell>
              ) : contactOptions ? (
                <div>
                  <Select
                    label="Client"
                    value={form.contact_id ?? ''}
                    onChange={(e) => pickContactOption(e.target.value)}
                    disabled={Boolean(fixedContact)}
                  >
                    <option value="">— None —</option>
                    {contactOptions.map((c) => {
                      const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
                      return (
                        <option key={c.id} value={c.id}>{c.role ? `${name} · ${c.role}` : name}</option>
                      );
                    })}
                  </Select>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    Contacts linked to {form.organization_name}.
                  </p>
                </div>
              ) : (
                <EntityPicker
                  kind="contact"
                  label="Client"
                  value={form.contact_id}
                  valueLabel={form.contact_name}
                  disabled={Boolean(fixedContact)}
                  onChange={pickContact}
                />
              )}
              {linksLoading === 'company' ? (
                <FieldShell label="Company">Checking companies linked to {form.contact_name}…</FieldShell>
              ) : companyOptions ? (
                <div>
                  <Select
                    label="Company"
                    value={form.organization_id ?? ''}
                    onChange={(e) => pickCompanyOption(e.target.value)}
                    disabled={Boolean(fixedOrganization)}
                  >
                    <option value="">— None (consumer loan) —</option>
                    {companyOptions.map((o) => (
                      <option key={o.id} value={o.id}>{o.role ? `${o.name} · ${o.role}` : o.name}</option>
                    ))}
                  </Select>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    Companies linked to {form.contact_name}.
                  </p>
                </div>
              ) : (
                <EntityPicker
                  kind="organization"
                  label="Company"
                  value={form.organization_id}
                  valueLabel={form.organization_name}
                  disabled={Boolean(fixedOrganization)}
                  onChange={pickOrganization}
                />
              )}
            </div>
          </FormSection>

          {/* ── The contract itself ─────────────────────────────────────── */}
          <FormSection title="The contract">
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-foreground">
                Lenders <span className="font-normal text-muted-foreground">· co-financed contracts can have several</span>
              </label>
              {form.lenders.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {form.lenders.map((l, i) => (
                    <span
                      key={`${l.lender_id ?? 'x'}:${l.lender_name}`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-[13px] text-foreground"
                    >
                      {/* The first lender is the one the book, filters, and PDF show. */}
                      {i === 0 && form.lenders.length > 1 && (
                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Primary</span>
                      )}
                      {l.lender_name}
                      <button
                        type="button"
                        onClick={() => removeLender(i)}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Remove ${l.lender_name}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <Select
                    value={lenderPick}
                    onChange={(e) => setLenderPick(e.target.value)}
                    disabled={scopedLoading}
                  >
                    <option value="">
                      {scopedLoading ? 'Finding lenders…' : 'Add a lender…'}
                    </option>
                    {lenderOptions.map((o, i) => (
                      <option key={`${o.lender_id ?? 'x'}:${o.lender_name}`} value={String(i)}>
                        {o.lender_name}
                      </option>
                    ))}
                    <option value={OTHER_LENDER}>Other — type a name…</option>
                  </Select>
                </div>
                {lenderPick === OTHER_LENDER && (
                  <div className="min-w-0 flex-1">
                    <Input
                      value={otherLenderName}
                      onChange={(e) => setOtherLenderName(e.target.value)}
                      placeholder="e.g. Angle Finance"
                    />
                  </div>
                )}
                <Button
                  variant="secondary"
                  onClick={addLender}
                  disabled={!lenderPick || (lenderPick === OTHER_LENDER && !otherLenderName.trim())}
                >
                  Add
                </Button>
              </div>
              <p className="mt-1 text-[12px] text-muted-foreground">{lenderHint}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                label="VIN number"
                value={form.vin}
                onChange={(e) => set('vin', e.target.value.toUpperCase())}
                placeholder="JALC4W88767001234"
              />
              <Input
                label="Contract number"
                value={form.contract_number}
                onChange={(e) => set('contract_number', e.target.value)}
                placeholder="If available"
              />
              <Select
                label="Loan type"
                value={form.file_type}
                onChange={(e) => set('file_type', e.target.value as ArrearsFileType)}
              >
                {ARREARS_FILE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </Select>
            </div>

            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-foreground">Asset details</label>
              <textarea
                className="led-input min-h-[64px] !text-[14px]"
                value={form.asset_details}
                onChange={(e) => set('asset_details', e.target.value)}
                placeholder="e.g. 2022 Isuzu NPR 45-155, rego XY12ZW"
              />
            </div>
          </FormSection>

          {/* ── The money and the clock ─────────────────────────────────── */}
          <FormSection title="The arrears">
            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                label="Repayment amount"
                type="number"
                value={form.repayment_amount}
                onChange={(e) => set('repayment_amount', e.target.value)}
                placeholder="0.00"
              />
              <Select
                label="Frequency"
                value={form.repayment_frequency}
                onChange={(e) => set('repayment_frequency', e.target.value as ArrearsRepaymentFrequency | '')}
              >
                <option value="">—</option>
                {ARREARS_FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </Select>
              <Input
                label="Amount in arrears"
                type="number"
                value={form.arrears_amount}
                onChange={(e) => set('arrears_amount', e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div className="sm:max-w-[320px]">
              <DatePicker
                label="In arrears since"
                value={form.in_arrears_since}
                onChange={(v) => set('in_arrears_since', v)}
              />
              {/* Show the consequence of the date immediately — this is the one
                  field that decides which bucket the contract reports in. */}
              {(() => {
                const days = daysInArrears(form.in_arrears_since);
                const b = bucketForDays(days);
                return (
                  <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
                    <span className={`rounded px-1.5 py-0.5 font-medium ${bucketClass(b)}`}>
                      {days} day{days === 1 ? '' : 's'} · {bucketLabel(b)}
                    </span>
                    recalculated from this date every day
                  </p>
                );
              })()}
            </div>

            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-foreground">Notes</label>
              <textarea
                className="led-input min-h-[64px] !text-[14px]"
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </div>
          </FormSection>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
          {missing.length > 0 && (
            <p className="mr-auto text-[12px] text-muted-foreground">
              Still needed: {missing.join(', ')}
            </p>
          )}
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} loading={saving} disabled={!valid}>
            {record ? 'Save changes' : 'Add to arrears book'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A labelled group of fields. The form asks for a dozen things; grouping them
 *  into who / what / how much keeps it readable instead of a single long run. */
function FormSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 py-5">
      <div>
        <h4 className="text-[13px] font-semibold text-foreground">{title}</h4>
        {hint && <p className="mt-0.5 text-[12px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** Placeholder that keeps a field's slot while its options are being fetched,
 *  so the two-column row doesn't collapse and reflow. */
function FieldShell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[13px] font-medium text-foreground">{label}</label>
      <div className="flex items-center rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[14px] text-muted-foreground">
        {children}
      </div>
    </div>
  );
}
