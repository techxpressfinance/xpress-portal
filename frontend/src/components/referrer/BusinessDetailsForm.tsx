import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../Toast';
import FileDropzone from '../FileDropzone';
import { Button, GlassCard, Input, Select } from '../ui';
import { getErrorMessage } from '../../lib/utils';
import type { ReferrerBusinessProfile } from '../../types';

/**
 * Billing details we need to raise a referrer's monthly tax invoice.
 *
 * Used from two places against the same API shape:
 *  - the referrer's own page       (base `/external-referrers/me`)
 *  - the admin referrer editor     (base `/external-referrers/{id}`)
 */

type AssetKind = 'logo' | 'letterhead';

interface FormState {
  business_abn: string;
  business_gst_registered: '' | 'yes' | 'no';
  business_director_name: string;
  business_address: string;
  bank_account_name: string;
  bank_bsb: string;
  bank_account_number: string;
}

const EMPTY: FormState = {
  business_abn: '',
  business_gst_registered: '',
  business_director_name: '',
  business_address: '',
  bank_account_name: '',
  bank_bsb: '',
  bank_account_number: '',
};

function toForm(profile: ReferrerBusinessProfile): FormState {
  return {
    business_abn: profile.business_abn ?? '',
    business_gst_registered: profile.business_gst_registered == null ? '' : profile.business_gst_registered ? 'yes' : 'no',
    business_director_name: profile.business_director_name ?? '',
    business_address: profile.business_address ?? '',
    bank_account_name: profile.bank_account_name ?? '',
    bank_bsb: profile.bank_bsb ?? '',
    bank_account_number: profile.bank_account_number ?? '',
  };
}

const digits = (v: string) => v.replace(/\D/g, '');

/** Display an ABN as 11 222 333 444. */
const formatAbn = (v: string) => {
  const d = digits(v).slice(0, 11);
  return [d.slice(0, 2), d.slice(2, 5), d.slice(5, 8), d.slice(8, 11)].filter(Boolean).join(' ');
};

const formatBsb = (v: string) => {
  const d = digits(v).slice(0, 6);
  return d.length > 3 ? `${d.slice(0, 3)}-${d.slice(3)}` : d;
};

interface Props {
  /** API path prefix — `/external-referrers/me` or `/external-referrers/{id}`. */
  basePath: string;
  onSaved?: (profile: ReferrerBusinessProfile) => void;
  /** Rendered above the form — e.g. the post-signup welcome note. */
  intro?: React.ReactNode;
  /** Copy shown under the read-only email/phone fields. */
  contactNote?: string;
}

export default function BusinessDetailsForm({ basePath, onSaved, intro, contactNote }: Props) {
  const { toast } = useToast();
  const [profile, setProfile] = useState<ReferrerBusinessProfile | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<AssetKind | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  useEffect(() => {
    setLoading(true);
    api.get<ReferrerBusinessProfile>(`${basePath}/business-profile`)
      .then(({ data }) => { setProfile(data); setForm(toForm(data)); })
      .catch(err => toast(getErrorMessage(err, 'Failed to load business details'), 'error'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath]);

  const update = (field: keyof FormState, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: undefined }));
  };

  const applyProfile = (data: ReferrerBusinessProfile) => {
    setProfile(data);
    setForm(toForm(data));
    onSaved?.(data);
  };

  const validate = (): boolean => {
    const errs: Partial<Record<keyof FormState, string>> = {};
    const abn = digits(form.business_abn);
    if (abn && abn.length !== 11) errs.business_abn = 'ABN must be 11 digits';
    const bsb = digits(form.bank_bsb);
    if (bsb && bsb.length !== 6) errs.bank_bsb = 'BSB must be 6 digits';
    const acct = digits(form.bank_account_number);
    if (acct && (acct.length < 4 || acct.length > 10)) errs.bank_account_number = 'Account number must be 4–10 digits';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleAbnLookup = async () => {
    const abn = digits(form.business_abn);
    if (abn.length !== 11) {
      setErrors(prev => ({ ...prev, business_abn: 'Enter an 11-digit ABN to look up' }));
      return;
    }
    setLookingUp(true);
    try {
      const { data } = await api.get('/organizations/abr-lookup', { params: { abn } });
      if (!data.enabled) { toast('ABN lookup is not configured', 'info'); return; }
      if (!data.record) { toast('No ABR record found for that ABN', 'error'); return; }
      if (data.record.gst_registered != null) {
        update('business_gst_registered', data.record.gst_registered ? 'yes' : 'no');
      }
      toast(`Matched: ${data.record.name || abn}`, 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'ABN lookup failed'), 'error');
    } finally {
      setLookingUp(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const { data } = await api.put<ReferrerBusinessProfile>(`${basePath}/business-profile`, {
        business_abn: digits(form.business_abn) || null,
        business_gst_registered: form.business_gst_registered === '' ? null : form.business_gst_registered === 'yes',
        business_director_name: form.business_director_name.trim() || null,
        business_address: form.business_address.trim() || null,
        bank_account_name: form.bank_account_name.trim() || null,
        bank_bsb: digits(form.bank_bsb) || null,
        bank_account_number: digits(form.bank_account_number) || null,
      });
      applyProfile(data);
      toast('Business details saved', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to save business details'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (asset: AssetKind, file: File) => {
    setUploading(asset);
    const body = new FormData();
    body.append('file', file);
    try {
      const { data } = await api.post<ReferrerBusinessProfile>(`${basePath}/business-profile/${asset}`, body);
      applyProfile(data);
      toast(`${asset === 'logo' ? 'Logo' : 'Letterhead'} uploaded`, 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Upload failed'), 'error');
    } finally {
      setUploading(null);
    }
  };

  const handleRemove = async (asset: AssetKind) => {
    try {
      const { data } = await api.delete<ReferrerBusinessProfile>(`${basePath}/business-profile/${asset}`);
      applyProfile(data);
      toast(`${asset === 'logo' ? 'Logo' : 'Letterhead'} removed`, 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to remove file'), 'error');
    }
  };

  const handleView = async (asset: AssetKind) => {
    try {
      const { data } = await api.get(`${basePath}/business-profile/${asset}/file`, { responseType: 'blob' });
      const url = URL.createObjectURL(data as Blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to open file'), 'error');
    }
  };

  if (loading) {
    return (
      <GlassCard>
        <div className="space-y-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-10 rounded-lg shimmer" />)}
        </div>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-6">
      {intro}

      {profile && !profile.is_complete && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-[13px] text-foreground">
          Some details are still missing. We need all of them before we can issue a monthly tax invoice for payment.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <GlassCard>
          <h3 className="text-[15px] font-semibold text-foreground mb-1">Business details</h3>
          <p className="text-[13px] text-muted-foreground mb-4">These appear on the tax invoice we raise for you each month.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  label="Business ABN"
                  placeholder="11 222 333 444"
                  inputMode="numeric"
                  value={formatAbn(form.business_abn)}
                  onChange={e => update('business_abn', e.target.value)}
                  error={errors.business_abn}
                />
              </div>
              <Button type="button" variant="secondary" size="md" loading={lookingUp} onClick={handleAbnLookup}>Look up</Button>
            </div>
            <Select
              label="Registered for GST"
              value={form.business_gst_registered}
              onChange={e => update('business_gst_registered', e.target.value as FormState['business_gst_registered'])}
            >
              <option value="">Select…</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Select>
            <Input
              label="Director's name"
              placeholder="Jane Smith"
              value={form.business_director_name}
              onChange={e => update('business_director_name', e.target.value)}
            />
            <Input
              label="Business address"
              placeholder="12 Example St, Sydney NSW 2000"
              value={form.business_address}
              onChange={e => update('business_address', e.target.value)}
            />
            <Input label="Email" value={profile?.email ?? ''} readOnly disabled />
            <Input label="Phone" value={profile?.phone ?? 'Not provided'} readOnly disabled />
          </div>
          {contactNote && <p className="mt-3 text-[12px] text-muted-foreground">{contactNote}</p>}
        </GlassCard>

        <GlassCard>
          <h3 className="text-[15px] font-semibold text-foreground mb-1">Bank account for payment</h3>
          <p className="text-[13px] text-muted-foreground mb-4">Stored encrypted. Only you and portal administrators can see it.</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="Account name"
              placeholder="Example Pty Ltd"
              value={form.bank_account_name}
              onChange={e => update('bank_account_name', e.target.value)}
            />
            <Input
              label="BSB"
              placeholder="123-456"
              inputMode="numeric"
              value={formatBsb(form.bank_bsb)}
              onChange={e => update('bank_bsb', e.target.value)}
              error={errors.bank_bsb}
            />
            <Input
              label="Account number"
              placeholder="12345678"
              inputMode="numeric"
              value={form.bank_account_number}
              onChange={e => update('bank_account_number', digits(e.target.value).slice(0, 10))}
              error={errors.bank_account_number}
            />
          </div>
        </GlassCard>

        <div className="flex justify-end">
          <Button type="submit" loading={saving}>Save details</Button>
        </div>
      </form>

      <GlassCard>
        <h3 className="text-[15px] font-semibold text-foreground mb-1">Branding (optional)</h3>
        <p className="text-[13px] text-muted-foreground mb-4">If you have them, we'll use your logo and letterhead on your invoice.</p>
        <div className="grid gap-6 sm:grid-cols-2">
          {(['logo', 'letterhead'] as AssetKind[]).map(asset => {
            const filename = asset === 'logo' ? profile?.business_logo_filename : profile?.business_letterhead_filename;
            return (
              <div key={asset}>
                <p className="text-[13px] font-medium text-foreground mb-2">
                  {asset === 'logo' ? 'Business logo' : 'Business letterhead'}
                </p>
                {filename ? (
                  <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/50 px-4 py-3">
                    <span className="flex-1 truncate text-[13px] text-foreground">{filename}</span>
                    <Button type="button" variant="secondary" size="sm" onClick={() => handleView(asset)}>View</Button>
                    <Button type="button" variant="danger" size="sm" onClick={() => handleRemove(asset)}>Remove</Button>
                  </div>
                ) : (
                  <FileDropzone
                    uploading={uploading === asset}
                    onFile={file => handleUpload(asset, file)}
                    onError={msg => toast(msg, 'error')}
                    hint="PDF, JPG, PNG — up to 10 MB"
                  />
                )}
              </div>
            );
          })}
        </div>
      </GlassCard>
    </div>
  );
}
