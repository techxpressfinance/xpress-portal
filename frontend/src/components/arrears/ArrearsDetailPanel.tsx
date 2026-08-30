import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api/client';
import { useToast } from '../Toast';
import { useConfirm } from '../../hooks/useConfirm';
import { Badge, Button } from '../ui';
import { getErrorMessage } from '../../lib/utils';
import {
  ARREARS_ACCEPT,
  ATTEMPT_METHODS,
  EVENT_LABELS,
  attemptMethodLabel,
  bucketClass,
  bucketLabel,
  fileTypeLabel,
  formatMoney,
  formatRepayment,
  formatStamp,
  isEmailAttachment,
  isImageAttachment,
  lenderNames,
  saveBlob,
  toDatetimeLocal,
} from '../../lib/arrears';
import type {
  ArrearsAttachment,
  ArrearsAttempt,
  ArrearsAttemptMethod,
  ArrearsRecord,
  ArrearsRecordDetail,
} from '../../types';
import FileDropzone from '../FileDropzone';
import { downloadElementPdf } from '../../lib/pdfExport';
import ArrearsRecordPrint from './ArrearsRecordPrint';
import { loadArrearsPrintImages, type ArrearsPrintImages } from './printImages';
import { CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';

/** "Now" as a datetime-local value (local wall clock, no timezone shift). */
const localNow = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/** True when the row was genuinely touched after creation. Rows written before
 *  updated_at was seeded from created_at have the two stamps a few microseconds
 *  apart, so anything under a second counts as "never edited". */
const wasEdited = (a: ArrearsAttempt) =>
  new Date(a.updated_at).getTime() - new Date(a.created_at).getTime() > 1000;

const downloadAttachment = async (recordId: string, attachmentId: string, filename: string) => {
  const { data } = await api.get(`/arrears/${recordId}/attachments/${attachmentId}/download`, {
    responseType: 'blob',
  });
  saveBlob(data as Blob, filename);
};

/** What to call the thing that just landed, so the confirmation names it back to
 *  the broker ("Snip added") rather than saying a generic "Attached". */
const evidenceNoun = (file: File) => {
  if (/\.(msg|eml)$/i.test(file.name)) return 'Email';
  if (/^screenshot-/i.test(file.name)) return 'Snip';
  if (isImageAttachment(file.name)) return 'Screenshot';
  return 'File';
};

/** Full-screen image viewer for screenshot evidence. Mounts on document.body so
 *  it sits above the detail panel's own portal. */
function ImageViewer({ src, label, onClose }: { src: string; label: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="ledger-theme fixed inset-0 z-[70] flex items-center justify-center p-6">
      <div className="fixed inset-0 bg-black/80" onClick={onClose} />
      <div className="relative flex max-h-[92vh] max-w-[92vw] flex-col overflow-hidden rounded-xl bg-black shadow-2xl">
        <img src={src} alt={label} className="max-h-[85vh] max-w-[92vw] object-contain" />
        <div className="flex items-center justify-between gap-4 px-4 py-2">
          <p className="truncate text-[12px] text-white/80">{label}</p>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-3 py-1 text-[12px] font-medium text-white/90 hover:bg-white/10"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The email fields both record-level attachments and attempt evidence carry. */
type ViewableEmail = Pick<
  ArrearsAttachment,
  'id' | 'original_filename' | 'email_subject' | 'email_from' | 'email_to' | 'email_body' | 'email_sent_at'
>;

/** Reader for a dropped .eml/.msg. A chase email is evidence that gets read in
 *  full, so it opens like the image viewer rather than expanding a cramped row
 *  inside the panel — and it opens even when the body couldn't be extracted,
 *  where the original file is the only way to read it. */
function EmailViewer({
  email,
  onDownload,
  onClose,
}: {
  email: ViewableEmail;
  onDownload: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const header: [string, string][] = [
    ['From', email.email_from || 'Unknown sender'],
    ['To', email.email_to || '—'],
    ['Sent', email.email_sent_at ? formatStamp(email.email_sent_at) : '—'],
  ];

  return createPortal(
    <div className="ledger-theme fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-[760px] flex-col rounded-2xl border border-border bg-background shadow-2xl">
        <div className="border-b border-border px-5 py-4">
          <p className="text-[15px] font-semibold text-foreground">
            {email.email_subject || email.original_filename}
          </p>
          <dl className="mt-2 grid gap-x-4 gap-y-1 text-[12px] sm:grid-cols-[auto_1fr]">
            {header.map(([term, value]) => (
              <div key={term} className="flex gap-2 sm:contents">
                <dt className="shrink-0 uppercase tracking-wide text-muted-foreground sm:text-right">{term}</dt>
                <dd className="min-w-0 break-words text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {email.email_body ? (
            <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-foreground">
              {email.email_body}
            </pre>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              No readable text could be pulled out of this message — download the original
              to open it in your mail client.
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">
          <p className="mr-auto truncate text-[12px] text-muted-foreground">{email.original_filename}</p>
          <Button size="sm" variant="secondary" onClick={onDownload}>Download original</Button>
          <Button size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** One titled block in the panel. Consistent heading weight and an optional
 *  count so the eye can skip a section without reading into it. */
function Section({
  title,
  count,
  hint,
  children,
}: {
  title: string;
  count?: number;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <h4 className="text-[13px] font-semibold text-foreground">{title}</h4>
        {count !== undefined && count > 0 && (
          <span className="text-[12px] tabular-nums text-muted-foreground">{count}</span>
        )}
      </div>
      {hint && <p className="mb-2 text-[12px] text-muted-foreground">{hint}</p>}
      {children}
    </section>
  );
}

/** Emails carry their own header block; everything else is a plain file row. */
function AttachmentRow({
  attachment,
  recordId,
  onDelete,
  onView,
  onReadEmail,
}: {
  attachment: ArrearsAttachment;
  recordId: string;
  onDelete: (id: string) => void;
  onView: (id: string, filename: string) => void;
  onReadEmail: (email: ViewableEmail) => void;
}) {
  const download = () => downloadAttachment(recordId, attachment.id, attachment.original_filename);
  const viewable = isImageAttachment(attachment.original_filename);
  const isEmail = isEmailAttachment(attachment);

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {isEmail ? (
            <>
              <p className="truncate text-[13px] font-medium text-foreground">
                {attachment.email_subject || attachment.original_filename}
              </p>
              <p className="truncate text-[12px] text-muted-foreground">
                {attachment.email_from || 'Unknown sender'}
                {attachment.email_sent_at ? ` · ${formatStamp(attachment.email_sent_at)}` : ''}
              </p>
            </>
          ) : (
            <p className="truncate text-[13px] font-medium text-foreground">{attachment.original_filename}</p>
          )}
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {attachment.kind === 'screenshot' ? 'Snip' : isEmail ? 'Email' : 'File'}
            {' · added '}
            {formatStamp(attachment.uploaded_at)}
            {attachment.uploaded_by_name ? ` by ${attachment.uploaded_by_name}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Always offered for an email, body or no body — the viewer is also
              where "we couldn't read this one, here's the original" is said. */}
          {isEmail && (
            <button
              type="button"
              onClick={() => onReadEmail(attachment)}
              className="text-[12px] font-medium text-primary hover:underline"
            >
              Read
            </button>
          )}
          {viewable && (
            <button
              type="button"
              onClick={() => onView(attachment.id, attachment.original_filename)}
              className="text-[12px] font-medium text-primary hover:underline"
            >
              View
            </button>
          )}
          <button type="button" onClick={download} className="text-[12px] font-medium text-primary hover:underline">
            Download
          </button>
          <button
            type="button"
            onClick={() => onDelete(attachment.id)}
            className="text-[12px] font-medium text-muted-foreground hover:text-destructive"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

/** What "evidence" means for each attempt type — a phone call gets a snip of
 *  the call log, an email gets the message itself. Drives the button, the
 *  dropzone copy, and nothing else: the API accepts any of them either way, so
 *  a broker who screenshots their sent mail isn't blocked. */
const ATTEMPT_EVIDENCE: Record<ArrearsAttemptMethod, { action: string; prompt: string }> = {
  phone: { action: 'Add screenshot', prompt: 'Paste, drop, or click to add a snip of the call log' },
  email: { action: 'Attach email', prompt: 'Drop the email itself, or paste a screenshot of it' },
  text: { action: 'Add screenshot', prompt: 'Paste, drop, or click to add a snip of the message' },
};

/** The log-attempt composer's own evidence field, per attempt type. A phone call
 *  takes a snip of the call log, a text takes a snip of the thread, and an email
 *  takes the message itself — dragged straight out of Outlook desktop (.msg/.eml)
 *  or pasted as a screenshot. Drives only this field; the API accepts any of them. */
const ATTEMPT_EVIDENCE_FIELD: Record<
  ArrearsAttemptMethod,
  { label: string; prompt: string; hint: string; accept: string }
> = {
  phone: {
    label: 'Call log screenshot',
    prompt: 'Paste, drop, or click to add a snip of the call log',
    hint: 'JPG or PNG screenshot',
    accept: '.jpg,.jpeg,.png',
  },
  email: {
    label: 'Email',
    prompt: 'Drop the email from Outlook, or click to browse',
    hint: 'Drag a message out of Outlook desktop (.msg / .eml) — or paste a screenshot',
    accept: ARREARS_ACCEPT,
  },
  text: {
    label: 'Message screenshot',
    prompt: 'Paste, drop, or click to add a snip of the message',
    hint: 'JPG or PNG screenshot',
    accept: '.jpg,.jpeg,.png',
  },
};

/** One phone/email/text attempt — inline-editable, with its own evidence. */
function AttemptRow({
  attempt,
  recordId,
  onSaved,
  onDeleted,
  onAttach,
  onAttachmentRemoved,
  onView,
  onReadEmail,
  attachBusy,
}: {
  attempt: ArrearsAttempt;
  recordId: string;
  onSaved: (method: ArrearsAttemptMethod, attemptedAt: string, note: string) => Promise<void>;
  onDeleted: () => Promise<void>;
  /** Resolves true once the file is on the server, so the zone can close itself. */
  onAttach: (file: File) => Promise<boolean>;
  onAttachmentRemoved: (attachmentId: string) => Promise<void>;
  onView: (id: string, filename: string) => void;
  onReadEmail: (email: ViewableEmail) => void;
  attachBusy: boolean;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [method, setMethod] = useState<ArrearsAttemptMethod>(attempt.method);
  const [attemptedAt, setAttemptedAt] = useState(toDatetimeLocal(attempt.attempted_at));
  const [note, setNote] = useState(attempt.note ?? '');

  /** Seed the form from the row's current props every time it opens — the row
   *  isn't remounted when a save swaps the record in, so state set at mount
   *  goes stale as soon as anything else on the record changes. */
  const startEdit = () => {
    setMethod(attempt.method);
    setAttemptedAt(toDatetimeLocal(attempt.attempted_at));
    setNote(attempt.note ?? '');
    setEditing(true);
  };

  const save = async () => {
    if (!attemptedAt) return;
    await onSaved(method, attemptedAt, note.trim());
    setEditing(false);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      {!editing ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-foreground">
                {attemptMethodLabel(attempt.method)} · {formatStamp(attempt.attempted_at)}
              </p>
              {attempt.note && (
                <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-foreground">{attempt.note}</p>
              )}
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Logged {formatStamp(attempt.created_at)}
                {attempt.created_by_name ? ` by ${attempt.created_by_name}` : ''}
                {wasEdited(attempt) ? ` · Edited ${formatStamp(attempt.updated_at)}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={startEdit} className="text-[12px] font-medium text-primary hover:underline">
                Edit
              </button>
              <button
                type="button"
                onClick={() => setAttaching((v) => !v)}
                className="text-[12px] font-medium text-primary hover:underline"
              >
                {attaching ? 'Cancel' : ATTEMPT_EVIDENCE[attempt.method].action}
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (await confirm({
                    title: 'Remove this attempt?',
                    message: 'Everything attached to it is removed as well.',
                    confirmText: 'Remove',
                    variant: 'danger',
                  })) onDeleted();
                }}
                className="text-[12px] font-medium text-muted-foreground hover:text-destructive"
              >
                Remove
              </button>
            </div>
          </div>
          {attempt.attachments.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {/* An email carries a subject, a sender, and a body worth reading;
                  a snip is just a file, so it stays a compact pill. */}
              {attempt.attachments.filter(isEmailAttachment).map((f) => (
                <div
                  key={f.id}
                  className="rounded-lg border border-border bg-secondary/40 px-2.5 py-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium text-foreground">
                        {f.email_subject || f.original_filename}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {f.email_from || 'Unknown sender'}
                        {f.email_sent_at ? ` · ${formatStamp(f.email_sent_at)}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onReadEmail(f)}
                        className="text-[11px] font-medium text-primary hover:underline"
                      >
                        Read
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadAttachment(recordId, f.id, f.original_filename)}
                        className="text-[11px] font-medium text-primary hover:underline"
                      >
                        Download
                      </button>
                      <button
                        type="button"
                        onClick={() => onAttachmentRemoved(f.id)}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Remove ${f.email_subject || f.original_filename}`}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap gap-1.5">
                {attempt.attachments.filter((f) => !isEmailAttachment(f)).map((f) => (
                  <span
                    key={f.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-[12px] text-foreground"
                  >
                    {isImageAttachment(f.original_filename) && (
                      <button type="button" onClick={() => onView(f.id, f.original_filename)} className="font-medium text-primary hover:underline">
                        View
                      </button>
                    )}
                    <button type="button" onClick={() => downloadAttachment(recordId, f.id, f.original_filename)} className="hover:underline">
                      {f.original_filename}
                    </button>
                    <button
                      type="button"
                      onClick={() => onAttachmentRemoved(f.id)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${f.original_filename}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              className="led-input !h-9 !text-[13px] cursor-pointer"
              value={method}
              onChange={(e) => setMethod(e.target.value as ArrearsAttemptMethod)}
            >
              {ATTEMPT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <input
              type="datetime-local"
              className="led-input !h-9 !text-[13px]"
              value={attemptedAt}
              onChange={(e) => setAttemptedAt(e.target.value)}
            />
          </div>
          <input
            className="led-input !h-9 !text-[13px]"
            placeholder="How did it go? (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={!attemptedAt}>Save</Button>
          </div>
        </div>
      )}
      {attaching && !editing && (
        <div className="mt-3">
          {/* An open evidence zone is what the broker is aiming a paste at, so it
              outranks the passive record-level zone further down the panel. */}
          <FileDropzone
            uploading={attachBusy}
            onFile={async (file) => { if (await onAttach(file)) setAttaching(false); }}
            onError={(m) => toast(m, 'error')}
            accept={ARREARS_ACCEPT}
            maxSizeMb={15}
            pastePriority={2}
            multiple
            prompt={ATTEMPT_EVIDENCE[attempt.method].prompt}
            hint="PDF, JPG, PNG, or a dropped .eml / .msg email"
          />
        </div>
      )}
    </div>
  );
}

export default function ArrearsDetailPanel({
  recordId,
  onClose,
  onChanged,
  onEdit,
}: {
  recordId: string;
  onClose: () => void;
  onChanged: (record: ArrearsRecord) => void;
  onEdit: (record: ArrearsRecord) => void;
}) {
  const { toast } = useToast();
  const [record, setRecord] = useState<ArrearsRecordDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [delinquentReason, setDelinquentReason] = useState('');
  const [attemptMethod, setAttemptMethod] = useState<ArrearsAttemptMethod>('phone');
  const [attemptAt, setAttemptAt] = useState(localNow);
  const [attemptNote, setAttemptNote] = useState('');
  // Several snips can be staged before the attempt exists — a chase often has a
  // call log, the message thread, and the email all worth keeping together.
  const [pendingEvidence, setPendingEvidence] = useState<File[]>([]);
  const [savingAttempt, setSavingAttempt] = useState(false);
  const [attachBusy, setAttachBusy] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [printImages, setPrintImages] = useState<ArrearsPrintImages>({});
  const [imageView, setImageView] = useState<{ url: string; label: string } | null>(null);
  const [emailView, setEmailView] = useState<ViewableEmail | null>(null);
  const imageUrlRef = useRef<string | null>(null);

  const viewImage = async (attachmentId: string, filename: string) => {
    try {
      const { data } = await api.get(`/arrears/${recordId}/attachments/${attachmentId}/download`, {
        responseType: 'blob',
      });
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
      const url = URL.createObjectURL(data as Blob);
      imageUrlRef.current = url;
      setImageView({ url, label: filename });
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to load image'), 'error');
    }
  };

  const closeImage = () => {
    if (imageUrlRef.current) {
      URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = null;
    }
    setImageView(null);
  };

  const load = async () => {
    try {
      const { data } = await api.get<ArrearsRecordDetail>(`/arrears/${recordId}`);
      setRecord(data);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to load arrears record'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const apply = (data: ArrearsRecordDetail) => {
    setRecord(data);
    onChanged(data);
  };

  const patch = async (payload: Record<string, unknown>) => {
    try {
      const { data } = await api.patch<ArrearsRecordDetail>(`/arrears/${recordId}`, payload);
      apply(data);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to update record'), 'error');
    }
  };

  const confirmDelinquent = async () => {
    await patch({ delinquent: true, delinquent_reason: delinquentReason.trim() || null });
    setFlagging(false);
    setDelinquentReason('');
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const { data } = await api.post<ArrearsRecordDetail>(`/arrears/${recordId}/attachments`, body);
      apply(data);
      toast(`${evidenceNoun(file)} added to this record`, 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Upload failed'), 'error');
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = async (attachmentId: string) => {
    try {
      const { data } = await api.delete<ArrearsRecordDetail>(`/arrears/${recordId}/attachments/${attachmentId}`);
      apply(data);
      toast('Attachment removed', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to remove attachment'), 'error');
    }
  };

  const addNote = async () => {
    if (!note.trim()) return;
    setSavingNote(true);
    try {
      const { data } = await api.post<ArrearsRecordDetail>(`/arrears/${recordId}/events`, { detail: note.trim() });
      apply(data);
      setNote('');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to add note'), 'error');
    } finally {
      setSavingNote(false);
    }
  };

  const addAttempt = async () => {
    if (!attemptAt) return;
    setSavingAttempt(true);
    try {
      const existingIds = new Set((record?.attempts ?? []).map((a) => a.id));
      const { data } = await api.post<ArrearsRecordDetail>(`/arrears/${recordId}/attempts`, {
        method: attemptMethod,
        attempted_at: attemptAt,
        note: attemptNote.trim() || null,
      });
      // Attach the staged evidence to the freshly created attempt. The create
      // response is the full record, so diff its attempt ids to find the new
      // row, then upload through the existing attempt-attachment endpoint —
      // one at a time, since each response is the whole record.
      const created = data.attempts.find((a) => !existingIds.has(a.id));
      if (pendingEvidence.length && created) {
        let latest = data;
        const failed: File[] = [];
        let lastError: unknown = null;
        for (const file of pendingEvidence) {
          try {
            const { data: withEvidence } = await api.post<ArrearsRecordDetail>(
              `/arrears/${recordId}/attempts/${created.id}/attachments`,
              (() => { const body = new FormData(); body.append('file', file); return body; })(),
            );
            latest = withEvidence;
          } catch (err) {
            failed.push(file);
            lastError = err;
          }
        }
        apply(latest);
        // The attempt already exists at this point, so a failed evidence upload
        // must not read as a failed attempt — report the two separately and keep
        // the failures staged so they can be retried.
        setPendingEvidence(failed);
        if (failed.length === 0) {
          const uploaded = pendingEvidence.length;
          toast(
            uploaded === 1
              ? `Attempt logged with the ${evidenceNoun(pendingEvidence[0]).toLowerCase()}`
              : `Attempt logged with ${uploaded} files`,
            'success',
          );
        } else {
          toast(
            getErrorMessage(
              lastError,
              `Attempt logged, but ${failed.length} of ${pendingEvidence.length} files failed to upload`,
            ),
            'error',
          );
        }
      } else {
        apply(data);
        toast('Attempt logged', 'success');
        setPendingEvidence([]);
      }
      setAttemptNote('');
      setAttemptAt(localNow());
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to log attempt'), 'error');
    } finally {
      setSavingAttempt(false);
    }
  };

  const saveAttempt = async (attemptId: string, method: ArrearsAttemptMethod, attemptedAt: string, note: string) => {
    try {
      const { data } = await api.patch<ArrearsRecordDetail>(`/arrears/${recordId}/attempts/${attemptId}`, {
        method,
        attempted_at: attemptedAt,
        note: note || null,
      });
      apply(data);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to update attempt'), 'error');
    }
  };

  const deleteAttempt = async (attemptId: string) => {
    try {
      const { data } = await api.delete<ArrearsRecordDetail>(`/arrears/${recordId}/attempts/${attemptId}`);
      apply(data);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to remove attempt'), 'error');
    }
  };

  /** Evidence for one attempt — a snip, a photo, or the chase email itself.
   *  Same endpoint whichever it is; the server parses emails for their headers. */
  const uploadAttemptFile = async (attemptId: string, file: File) => {
    setAttachBusy(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const { data } = await api.post<ArrearsRecordDetail>(
        `/arrears/${recordId}/attempts/${attemptId}/attachments`, body,
      );
      apply(data);
      toast(`${evidenceNoun(file)} saved to this attempt`, 'success');
      return true;
    } catch (err) {
      toast(getErrorMessage(err, 'Upload failed'), 'error');
      return false;
    } finally {
      setAttachBusy(false);
    }
  };

  /** Attempt evidence is an ArrearsAttachment like any other, so it deletes
   *  through the record-level endpoint. */
  const removeAttemptFile = async (attachmentId: string) => {
    try {
      const { data } = await api.delete<ArrearsRecordDetail>(`/arrears/${recordId}/attachments/${attachmentId}`);
      apply(data);
      toast('Attachment removed', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to remove attachment'), 'error');
    }
  };

  /** Full record PDF — contract facts, every contact attempt (with its
   *  screenshots), the record's attachments, and the event timeline, rendered
   *  off-screen and captured. */
  const downloadPdf = async () => {
    if (!record) return;
    setDownloadingPdf(true);
    try {
      // Inline the screenshots first: they live behind an authenticated
      // endpoint, so html2canvas can only paint them as data URLs.
      setPrintImages(await loadArrearsPrintImages([record]));
      // Let React paint the off-screen print block before html2pdf reads it.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const name = (record.contact_name || record.organization_name || 'arrears').replace(/[^\w-]+/g, '_');
      await downloadElementPdf('arrears-record-print', `arrears-${name}.pdf`, 'portrait');
    } catch (err) {
      toast(getErrorMessage(err, 'PDF export failed'), 'error');
    } finally {
      setDownloadingPdf(false);
      setPrintImages({});
    }
  };

  const bucketMeta = record
    ? { label: bucketLabel(record.bucket), className: bucketClass(record.bucket) }
    : null;

  // Portals mount into document.body, outside the .ledger-theme host that
  // declares every --led-* variable, so led-btn / led-input / led-chip render
  // with no background, border, or colour unless the theme is re-declared here.
  const panel = createPortal(
    <div className="ledger-theme fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-[720px] flex-col overflow-y-auto rounded-2xl border border-border bg-background shadow-xl">
        {loading || !record ? (
          <div className="p-6 text-[14px] text-muted-foreground">Loading…</div>
        ) : (
          <>
            {/* Header answers the three questions a broker opens this for:
                who, how much, how late. Everything else is below the fold. */}
            <div className="sticky top-0 z-10 border-b border-border bg-background px-6 pb-4 pt-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[17px] font-semibold text-foreground">
                    {record.contact_name || record.organization_name || 'Arrears record'}
                  </p>
                  {record.contact_name && record.organization_name && (
                    <p className="truncate text-[13px] text-muted-foreground">{record.organization_name}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={downloadPdf} loading={downloadingPdf}>
                    Download PDF
                  </Button>
                  <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
                    <XMarkIcon className="h-5 w-5" strokeWidth={1.75} />
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1">
                <p className="text-[24px] font-semibold tabular-nums text-foreground">
                  {formatMoney(record.arrears_amount)}
                </p>
                <p
                  className={`rounded-md px-2 py-0.5 text-[13px] font-medium ${bucketMeta?.className}`}
                >
                  {record.days_in_arrears} days · {bucketMeta?.label}
                </p>
                {record.resolved && (
                  <Badge type="custom" value="resolved" label="Resolved" className="led-chip-success" />
                )}
                {record.proof_of_payment_received && (
                  <Badge type="custom" value="proof" label="Proof received" className="led-chip-info" />
                )}
              </div>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {lenderNames(record)} · {fileTypeLabel(record.file_type)} · in arrears since{' '}
                {new Date(`${record.in_arrears_since}T00:00:00`).toLocaleDateString('en-AU')}
              </p>
            </div>

            <div className="space-y-6 px-6 py-5">
              {/* The actions a broker takes on this record, in the order they
                  usually take them. Editing the record itself is a rarer,
                  quieter action, so it sits apart. */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={record.proof_of_payment_received ? 'secondary' : 'primary'}
                  onClick={() => patch({ proof_of_payment_received: !record.proof_of_payment_received })}
                >
                  {record.proof_of_payment_received ? 'Clear proof of payment' : 'Proof of payment received'}
                </Button>
                <Button
                  size="sm"
                  variant={record.resolved ? 'secondary' : 'primary'}
                  onClick={() => patch({ resolved: !record.resolved })}
                >
                  {record.resolved ? 'Reopen arrears' : 'Mark resolved'}
                </Button>
                <Button
                  size="sm"
                  variant={record.delinquent ? 'secondary' : 'danger'}
                  onClick={() => {
                    if (record.delinquent) { patch({ delinquent: false }); return; }
                    setFlagging(true);
                  }}
                >
                  {record.delinquent ? 'Remove delinquent flag' : 'Flag delinquent'}
                </Button>
                <button
                  type="button"
                  onClick={() => onEdit(record)}
                  className="ml-auto text-[12px] font-medium text-primary hover:underline"
                >
                  Edit details
                </button>
              </div>

              {record.delinquent && record.delinquent_reason && (
                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[12px] text-foreground">
                  <span className="font-medium">Delinquent:</span> {record.delinquent_reason}
                  {record.delinquent_at ? ` · flagged ${formatStamp(record.delinquent_at)}` : ''}
                </p>
              )}

              {flagging && !record.delinquent && (
                <div className="flex gap-2">
                  <input
                    className="led-input !h-9 !text-[13px]"
                    autoFocus
                    placeholder="Reason — default, legal action, repossession…"
                    value={delinquentReason}
                    onChange={(e) => setDelinquentReason(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') confirmDelinquent(); }}
                  />
                  <Button size="sm" variant="danger" onClick={confirmDelinquent}>Flag</Button>
                  <Button size="sm" variant="secondary" onClick={() => { setFlagging(false); setDelinquentReason(''); }}>
                    Cancel
                  </Button>
                </div>
              )}

              {/* Chasing the debt is the daily job, so it comes before the
                  reference detail rather than after it. */}
              <Section
                title="Contact attempts"
                count={record.attempts.length}
                hint="Phone, email, and text touches. Log one as you make it, then attach its evidence — a snip of the call log, or the chase email itself."
              >
                <div className="rounded-lg border border-border bg-card p-3">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)]">
                    <select
                      className="led-input !h-9 !text-[13px] cursor-pointer"
                      value={attemptMethod}
                      onChange={(e) => {
                        setAttemptMethod(e.target.value as ArrearsAttemptMethod);
                        if (pendingEvidence.length) toast('Evidence cleared — attempt type changed', 'info');
                        setPendingEvidence([]);
                      }}
                      aria-label="Attempt type"
                    >
                      {ATTEMPT_METHODS.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                    <input
                      type="datetime-local"
                      className="led-input !h-9 !text-[13px]"
                      value={attemptAt}
                      onChange={(e) => setAttemptAt(e.target.value)}
                      aria-label="When the attempt happened"
                      title="When the attempt happened — edit freely"
                    />
                  </div>
                  <div className="mt-2 space-y-2">
                    {/* Nothing here is on the server yet — it uploads with "Log
                        attempt" — so each row says so outright rather than
                        letting a filename imply it's already filed. */}
                    {pendingEvidence.map((file, i) => (
                      <div
                        key={`${file.name}:${file.lastModified}:${i}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2"
                      >
                        <span className="shrink-0 text-success" aria-hidden>
                          <CheckIcon className="h-4 w-4" strokeWidth={2.25} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            {ATTEMPT_EVIDENCE_FIELD[attemptMethod].label} attached
                          </p>
                          <p className="truncate text-[12px] font-medium text-foreground">{file.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            Saves with the attempt — press Log attempt to file it.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setPendingEvidence((prev) => prev.filter((_, x) => x !== i));
                            toast('Evidence discarded', 'info');
                          }}
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                          aria-label={`Remove ${file.name}`}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    {/* The zone stays put once something is staged, so a second
                        snip goes where the first one did. The composer is also
                        what a pasted snip is aimed at, so it outranks the
                        record-level zone below, which mounts later and would
                        otherwise swallow every paste. */}
                    <FileDropzone
                      uploading={false}
                      onFile={(file) => {
                        setPendingEvidence((prev) => [...prev, file]);
                        toast(`${evidenceNoun(file)} attached — log the attempt to save it`, 'success');
                      }}
                      onError={(m) => toast(m, 'error')}
                      accept={ATTEMPT_EVIDENCE_FIELD[attemptMethod].accept}
                      maxSizeMb={15}
                      pastePriority={1}
                      multiple
                      prompt={pendingEvidence.length
                        ? 'Add another — paste, drop, or click to browse'
                        : ATTEMPT_EVIDENCE_FIELD[attemptMethod].prompt}
                      hint={ATTEMPT_EVIDENCE_FIELD[attemptMethod].hint}
                    />
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input
                      className="led-input !h-9 min-w-0 flex-1 !text-[13px]"
                      placeholder="How did it go? (optional)"
                      value={attemptNote}
                      onChange={(e) => setAttemptNote(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') addAttempt(); }}
                    />
                    <Button size="sm" onClick={addAttempt} loading={savingAttempt} disabled={!attemptAt}>
                      Log attempt
                    </Button>
                  </div>
                </div>
                <div className="mt-2 space-y-2">
                  {record.attempts.length === 0 && (
                    <p className="px-1 text-[13px] text-muted-foreground">
                      No attempts logged yet.
                    </p>
                  )}
                  {record.attempts.map((a) => (
                    <AttemptRow
                      key={a.id}
                      attempt={a}
                      recordId={record.id}
                      onSaved={(method, attemptedAt, note) => saveAttempt(a.id, method, attemptedAt, note)}
                      onDeleted={() => deleteAttempt(a.id)}
                      onAttach={(file) => uploadAttemptFile(a.id, file)}
                      onAttachmentRemoved={removeAttemptFile}
                      onView={viewImage}
                      onReadEmail={setEmailView}
                      attachBusy={attachBusy}
                    />
                  ))}
                </div>
              </Section>

              <Section title="Contract details">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
                  {[
                    ['Lenders', lenderNames(record)],
                    ['Repayment', formatRepayment(record.repayment_amount, record.repayment_frequency)],
                    ['Contract number', record.contract_number || '—'],
                    ['VIN', record.vin || '—'],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
                      <dd className="mt-0.5 break-words text-foreground">{value}</dd>
                    </div>
                  ))}
                  <div className="col-span-2">
                    <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Asset</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap text-foreground">{record.asset_details || '—'}</dd>
                  </div>
                  {record.notes && (
                    <div className="col-span-2">
                      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Notes</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap text-foreground">{record.notes}</dd>
                    </div>
                  )}
                </dl>
              </Section>

              <Section
                title="Attachments & emails"
                count={record.attachments.length}
                hint="Evidence for the contract as a whole. Anything tied to a specific call or email belongs on that attempt above."
              >
                <FileDropzone
                  uploading={uploading}
                  onFile={upload}
                  onError={(m) => toast(m, 'error')}
                  accept={ARREARS_ACCEPT}
                  maxSizeMb={15}
                  pastePriority={0}
                  multiple
                  prompt="Drop an email or file, click to browse, or paste a snip"
                  hint="Drag a message from Outlook desktop, or save it from Gmail/Outlook Web and drop the .eml — PDF, JPG, PNG also accepted"
                />
                <div className="mt-2 space-y-2">
                  {record.attachments.map((a) => (
                    <AttachmentRow
                      key={a.id}
                      attachment={a}
                      recordId={record.id}
                      onDelete={removeAttachment}
                      onView={viewImage}
                      onReadEmail={setEmailView}
                    />
                  ))}
                </div>
              </Section>

              <Section title="History">
                <div className="flex gap-2">
                  <input
                    className="led-input !h-9 !text-[13px]"
                    placeholder="Add a note to the timeline…"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addNote(); }}
                  />
                  <Button size="sm" onClick={addNote} loading={savingNote} disabled={!note.trim()}>Add</Button>
                </div>
                <ol className="mt-3 space-y-3">
                  {record.events.map((e) => (
                    <li key={e.id} className="border-l-2 border-border pl-3">
                      <p className="text-[13px] text-foreground">{e.detail || EVENT_LABELS[e.event_type] || e.event_type}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatStamp(e.created_at)}
                        {e.created_by_name ? ` · ${e.created_by_name}` : ''}
                      </p>
                    </li>
                  ))}
                </ol>
              </Section>
            </div>
          </>
        )}
      </div>

      {/* Off-screen print source for the single-record PDF. */}
      {downloadingPdf && record && (
        <div style={{ position: 'fixed', left: -10000, top: 0 }} aria-hidden>
          <div id="arrears-record-print">
            <ArrearsRecordPrint records={[record]} images={printImages} />
          </div>
        </div>
      )}
    </div>,
    document.body,
  );

  return (
    <>
      {panel}
      {imageView && <ImageViewer src={imageView.url} label={imageView.label} onClose={closeImage} />}
      {emailView && (
        <EmailViewer
          email={emailView}
          onDownload={() => downloadAttachment(recordId, emailView.id, emailView.original_filename)}
          onClose={() => setEmailView(null)}
        />
      )}
    </>
  );
}
