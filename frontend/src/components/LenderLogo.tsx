import { useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { useToast } from './Toast';
import { useConfirm } from '../hooks/useConfirm';
import { getErrorMessage } from '../lib/utils';
import { Button } from './ui';
import type { Lender } from '../types';
import { lenderLogoDataUrl } from '../lib/lenderLogo';

const ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,image/png,image/jpeg,image/gif,image/webp';

/** The logo on the lender page: preview, and upload/replace/remove for staff. */
export default function LenderLogo({
  lender,
  editable,
  onChange,
}: {
  lender: Lender;
  editable: boolean;
  onChange: (lender: Lender) => void;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const inputRef = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Keyed on the filename and updated_at so a replaced logo is fetched again.
  useEffect(() => {
    let cancelled = false;
    if (!lender.logo_filename) {
      setSrc(null);
      return;
    }
    lenderLogoDataUrl(lender.id).then((url) => { if (!cancelled) setSrc(url); });
    return () => { cancelled = true; };
  }, [lender.id, lender.logo_filename, lender.updated_at]);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post<Lender>(`/lenders/${lender.id}/logo`, form);
      onChange(data);
      toast('Logo uploaded', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to upload logo'), 'error');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Remove the logo?', message: 'Letters in this lender\'s name will print without a logo.', confirmText: 'Remove', variant: 'danger' }))) return;
    setBusy(true);
    try {
      const { data } = await api.delete<Lender>(`/lenders/${lender.id}/logo`);
      onChange(data);
      toast('Logo removed', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to remove logo'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!editable && !lender.logo_filename) return null;

  return (
    <div className="mb-4 flex items-center gap-4 rounded-xl border border-border p-3">
      <div className="flex h-16 w-28 flex-none items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-border">
        {src ? (
          <img src={src} alt={`${lender.name} logo`} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-[11px] text-muted-foreground">No logo</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground">Logo</p>
        <p className="text-[12px] text-muted-foreground">
          Heads letters issued in this lender&rsquo;s name, like the direct debit first payment request. PNG, JPEG, GIF or WebP, up to 5MB.
        </p>
      </div>
      {editable && (
        <div className="flex flex-none gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
          />
          <Button variant="secondary" size="sm" loading={busy} onClick={() => inputRef.current?.click()}>
            {lender.logo_filename ? 'Replace' : 'Upload'}
          </Button>
          {lender.logo_filename && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={remove}>Remove</Button>
          )}
        </div>
      )}
    </div>
  );
}
