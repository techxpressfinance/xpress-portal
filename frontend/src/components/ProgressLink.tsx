import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import { useClipboard } from '../hooks/useClipboard';
import { useConfirm } from '../hooks/useConfirm';
import { useToast } from './Toast';
import { getErrorMessage, relativeTime } from '../lib/utils';
import type { TrackingAudience, TrackingLinkInfo } from '../types';
import { ArrowPathIcon, CheckIcon, ClipboardDocumentIcon, EnvelopeIcon } from '@heroicons/react/24/outline';

/**
 * One no-login progress link, as staff handle it: copy it, email it, or kill
 * it and mint a new one. The link is fetched (and minted on first use) when
 * this mounts, so it is ready to copy the moment someone is on the phone.
 *
 * `base` is the tracking-links endpoint for the target — `/tracking-links/
 * referrers/:id`, `/applications/:id` or `/leads/:id`. Deal targets take an
 * `audience`; a deal's "referrer" link is that referrer's one standing link,
 * so it can only be regenerated from their profile (`canRegenerate` off).
 */
export default function ProgressLink({
  base,
  audience,
  label,
  canRegenerate = true,
}: {
  base: string;
  audience?: TrackingAudience;
  label?: string;
  canRegenerate?: boolean;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { copied, copy } = useClipboard();
  const [info, setInfo] = useState<TrackingLinkInfo | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [busy, setBusy] = useState<'email' | 'regenerate' | null>(null);
  const params = audience ? { audience } : undefined;

  const load = useCallback(() => {
    setUnavailable(null);
    api.post<TrackingLinkInfo>(base, null, { params: audience ? { audience } : undefined })
      .then(({ data }) => setInfo(data))
      .catch((err) => setUnavailable(getErrorMessage(err, 'Could not load the link')));
  }, [base, audience]);

  useEffect(() => { load(); }, [load]);

  const handleCopy = async () => {
    if (!info) return;
    if (await copy(info.url)) toast('Link copied', 'success');
    else toast('Could not copy — select the link and copy it instead', 'error');
  };

  const handleEmail = async () => {
    if (!info?.recipient_email) return;
    setBusy('email');
    try {
      const { data } = await api.post<TrackingLinkInfo>(`${base}/email`, null, { params });
      setInfo(data);
      toast(`Link emailed to ${data.recipient_email}`, 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to email the link'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleRegenerate = async () => {
    const ok = await confirm({
      title: 'Replace this link?',
      message: 'The current link stops working straight away, including any copy already sent. Use this if the link has gone to the wrong person.',
      confirmText: 'Replace link',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy('regenerate');
    try {
      const { data } = await api.post<TrackingLinkInfo>(`${base}/regenerate`);
      setInfo(data);
      toast('New link created — the old one no longer works', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to replace the link'), 'error');
    } finally {
      setBusy(null);
    }
  };

  if (unavailable) {
    return (
      <div>
        {label && <p className="text-[12px] font-medium text-muted-foreground mb-1">{label}</p>}
        <p className="text-[13px] text-muted-foreground">{unavailable}</p>
      </div>
    );
  }

  return (
    <div>
      {label && <p className="text-[12px] font-medium text-muted-foreground mb-1">{label}</p>}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          className="led-input"
          readOnly
          value={info?.url ?? 'Loading…'}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Progress link"
          style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}
        />
        <button
          type="button"
          className="led-btn led-btn-outline led-btn-sm"
          onClick={handleCopy}
          disabled={!info}
          title="Copy link"
        >
          {copied ? <CheckIcon className="h-3.5 w-3.5" strokeWidth={2} /> : <ClipboardDocumentIcon className="h-3.5 w-3.5" strokeWidth={2} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <button
          type="button"
          className="led-btn led-btn-ghost led-btn-sm"
          onClick={handleEmail}
          disabled={!info?.recipient_email || busy !== null}
          title={info?.recipient_email ? `Email to ${info.recipient_email}` : 'No email address on file'}
        >
          <EnvelopeIcon className="h-3.5 w-3.5" strokeWidth={2} />
          {busy === 'email' ? 'Sending…' : info?.recipient_email ? `Email to ${info.recipient_email}` : 'No email on file'}
        </button>
        {canRegenerate && (
          <button
            type="button"
            className="led-btn led-btn-ghost led-btn-sm"
            onClick={handleRegenerate}
            disabled={!info || busy !== null}
          >
            <ArrowPathIcon className="h-3.5 w-3.5" strokeWidth={2} />
            {busy === 'regenerate' ? 'Replacing…' : 'Replace link'}
          </button>
        )}
        {info && (
          <span className="text-[12px] text-muted-foreground" style={{ marginLeft: 'auto' }}>
            {info.open_count
              ? `Opened ${info.open_count} time${info.open_count === 1 ? '' : 's'} · last ${relativeTime(info.last_opened_at)}`
              : 'Not opened yet'}
          </span>
        )}
      </div>
    </div>
  );
}
