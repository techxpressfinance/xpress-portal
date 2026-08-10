import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api/client';
import { useToast } from '../Toast';
import { Button, DatePicker, Input, Select } from '../ui';
import { getErrorMessage } from '../../lib/utils';
import { ARREARS_FILE_TYPES, ARREARS_FREQUENCIES } from '../../lib/arrears';
import type { ArrearsFileType, ArrearsRecord, ArrearsRepaymentFrequency, Lender } from '../../types';
import EntityPicker from './EntityPicker';

interface Props {
  record: ArrearsRecord | null;
  /** Pre-linked party when opened from a contact or company page. */
  fixedContact?: { id: string; name: string } | null;
  fixedOrganization?: { id: string; name: string } | null;
  onClose: () => void;
  onSaved: (record: ArrearsRecord) => void;
}

interface FormState {
  contact_id: string | null;
  contact_name: string | null;
  organization_id: string | null;
  organization_name: string | null;
  lender_id: string;
  lender_name: string;
  contract_number: string;
  asset_details: string;
  file_type: ArrearsFileType;
  repayment_amount: string;
  repayment_frequency: ArrearsRepaymentFrequency | '';
  arrears_amount: string;
  in_arrears_since: string;
  notes: string;
}

const today = () => new Date().toISOString().slice(0, 10);

export default function ArrearsRecordModal({
  record,
  fixedContact,
  fixedOrganization,
  onClose,
  onSaved,
}: Props) {
  const { toast } = useToast();
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(() => ({
    contact_id: record?.contact_id ?? fixedContact?.id ?? null,
    contact_name: record?.contact_name ?? fixedContact?.name ?? null,
    organization_id: record?.organization_id ?? fixedOrganization?.id ?? null,
    organization_name: record?.organization_name ?? fixedOrganization?.name ?? null,
    lender_id: record?.lender_id ?? '',
    lender_name: record?.lender_name ?? '',
    contract_number: record?.contract_number ?? '',
    asset_details: record?.asset_details ?? '',
    file_type: record?.file_type ?? 'asset_finance',
    repayment_amount: record?.repayment_amount != null ? String(record.repayment_amount) : '',
    repayment_frequency: record?.repayment_frequency ?? 'monthly',
    arrears_amount: record?.arrears_amount != null ? String(record.arrears_amount) : '',
    in_arrears_since: record?.in_arrears_since ?? today(),
    notes: record?.notes ?? '',
  }));

  useEffect(() => {
    api.get<Lender[]>('/lenders').then(({ data }) => setLenders(data)).catch(() => setLenders([]));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saving, onClose]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  /** Picking a known lender fills the name; typing a name clears the link. */
  const pickLender = (id: string) => {
    const lender = lenders.find((l) => l.id === id);
    setForm((f) => ({ ...f, lender_id: id, lender_name: lender ? lender.name : f.lender_name }));
  };

  const valid =
    (form.contact_id || form.organization_id) && form.lender_name.trim() && form.in_arrears_since;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    const payload = {
      contact_id: form.contact_id,
      organization_id: form.organization_id,
      lender_id: form.lender_id || null,
      lender_name: form.lender_name.trim(),
      contract_number: form.contract_number.trim() || null,
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

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !saving && onClose()} />
      <div className="relative flex max-h-[90vh] w-full max-w-[640px] flex-col rounded-2xl border border-border bg-background shadow-xl">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-[17px] font-semibold text-foreground">
            {record ? 'Edit arrears record' : 'Add contract to arrears book'}
          </h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            One record per contract — a client with three contracts and one in arrears gets one record.
          </p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <EntityPicker
              kind="contact"
              label="Client"
              value={form.contact_id}
              valueLabel={form.contact_name}
              disabled={Boolean(fixedContact)}
              onChange={(p) => setForm((f) => ({ ...f, contact_id: p?.id ?? null, contact_name: p?.label ?? null }))}
            />
            <EntityPicker
              kind="organization"
              label="Company"
              value={form.organization_id}
              valueLabel={form.organization_name}
              disabled={Boolean(fixedOrganization)}
              onChange={(p) => setForm((f) => ({ ...f, organization_id: p?.id ?? null, organization_name: p?.label ?? null }))}
            />
          </div>
          {!form.contact_id && !form.organization_id && (
            <p className="text-[12px] text-muted-foreground">
              Link a client, a company, or both — this is how the record appears on their detail page.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Lender" value={form.lender_id} onChange={(e) => pickLender(e.target.value)}>
              <option value="">Not in the lender book…</option>
              {lenders.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </Select>
            <Input
              label="Lender name"
              value={form.lender_name}
              onChange={(e) => set('lender_name', e.target.value)}
              placeholder="e.g. Angle Finance"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Contract number"
              value={form.contract_number}
              onChange={(e) => set('contract_number', e.target.value)}
              placeholder="If available"
            />
            <Select
              label="File type"
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
              className="led-input min-h-[72px] !text-[14px]"
              value={form.asset_details}
              onChange={(e) => set('asset_details', e.target.value)}
              placeholder="e.g. 2022 Isuzu NPR 45-155, rego XY12ZW"
            />
          </div>

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

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <DatePicker
                label="In arrears since"
                value={form.in_arrears_since}
                onChange={(v) => set('in_arrears_since', v)}
              />
              <p className="mt-1 text-[12px] text-muted-foreground">
                Days in arrears and the ageing bucket are calculated from this date, every day.
              </p>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-foreground">Notes</label>
            <textarea
              className="led-input min-h-[72px] !text-[14px]"
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
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
