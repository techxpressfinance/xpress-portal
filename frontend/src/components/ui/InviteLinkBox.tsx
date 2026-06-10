import { CopyButton } from './CopyButton';

interface InviteLinkBoxProps {
  url: string;
  label?: string;
  hint?: string;
  onDismiss?: () => void;
}

/**
 * Shows an invite link so it can be copy-pasted (e.g. into SMS/WhatsApp, or
 * when the email lands in spam). Admin/broker only — the backend never exposes
 * invite links to client or referrer viewers.
 */
export default function InviteLinkBox({
  url,
  label = 'Invite link',
  hint = 'Also emailed to the recipient. Copy it to share another way (e.g. SMS or WhatsApp).',
  onDismiss,
}: InviteLinkBoxProps) {
  return (
    <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-muted-foreground/60 hover:text-foreground transition-colors"
            title="Dismiss"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate text-[12px] text-foreground" title={url}>{url}</code>
        <CopyButton text={url} size="sm" />
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}
